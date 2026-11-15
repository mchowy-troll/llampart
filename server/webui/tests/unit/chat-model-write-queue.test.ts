import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';
import { DatabaseService } from '$lib/services/database.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { chatStore, type GenerationModel } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { serverStore } from '$lib/stores/backend.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { captureMessageModelInfo, modelInfoForResponse } from '$lib/utils/message-model-info';

const originalConfig = { ...settingsStore.config };
const originalRole = serverStore.role;
const internalChat = chatStore as unknown as {
	streamChatCompletion: (
		messages: DatabaseMessage[],
		assistant: DatabaseMessage,
		onComplete: (content: string) => Promise<void>,
		onError: (error: Error) => void,
		binding: GenerationModel
	) => Promise<void>;
	abortControllers: Map<string, AbortController>;
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	settingsStore.config = { ...originalConfig };
	serverStore.role = originalRole;
	ChatService.invalidateProviderRequestContexts();
	conversationsStore.clearActiveConversation();
	conversationsStore.conversations = [];
	internalChat.abortControllers.clear();
	chatStore.chatLoadingStates.clear();
	chatStore.chatStreamingStates.clear();
	chatStore.chatReasoningStates.clear();
	chatStore.dismissErrorDialog();
	chatStore.clearUIState();
});

function setup(failedModel: string) {
	settingsStore.config = {
		...originalConfig,
		apiProvider: 'openai-compatible',
		serverBaseUrl: 'http://synthetic.invalid',
		openAiCompatibleBaseUrl: 'http://synthetic.invalid',
		apiKey: '',
		preEncodeConversation: false
	};
	serverStore.role = null;
	const context = ChatService.createProviderRequestContext();
	const info = captureMessageModelInfo('openai-compatible', 'Model-A', null, null);
	const assistant: DatabaseMessage = {
		id: 'owned-assistant',
		convId: 'owned-conversation',
		type: 'text',
		role: 'assistant',
		content: '',
		timestamp: 1,
		parent: 'owned-user',
		children: [],
		toolCalls: ''
	};
	let persisted = structuredClone(assistant);
	const failure = new Error(`Synthetic IndexedDB write rejected: ${failedModel}`);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	let release!: () => void;
	let entered!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const firstStarted = new Promise<void>((resolve) => (entered = resolve));
	const update = vi
		.spyOn(DatabaseService, 'updateMessage')
		.mockImplementation(async (id, changes) => {
			expect(id).toBe(assistant.id);
			if (changes.model === 'Model-B' && !('content' in changes)) {
				entered();
				await gate;
			}
			if (changes.model === failedModel) throw failure;
			persisted = { ...persisted, ...structuredClone(changes) };
		});
	vi.spyOn(DatabaseService, 'deleteEmptyAssistantMessage').mockResolvedValue(null);
	const currentNode = vi
		.spyOn(conversationsStore, 'updateConversationCurrentNode')
		.mockResolvedValue();
	vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
		enabled: false,
		maxTurns: 1,
		maxToolPreviewLines: 10
	});
	conversationsStore.activeConversation = {
		id: assistant.convId,
		name: 'Synthetic queue test',
		currNode: assistant.id,
		lastModified: 1
	};
	conversationsStore.activeMessages = [structuredClone(assistant)];
	chatStore.chatLoadingStates.set(assistant.convId, true);
	chatStore.isLoading = true;
	// Exercise ChatStore's actual private queue and ChatService's real SSE/checkpoint/
	// error/finalization path. Only the DB boundary, HTTP and model notifications are controlled.
	const send = ChatService.sendMessage.bind(ChatService);
	vi.spyOn(ChatService, 'sendMessage').mockImplementation((messages, options, ...rest) => {
		options?.onModel?.('Model-B');
		options?.onModel?.('Model-C');
		return send(messages, options, ...rest);
	});
	vi.stubGlobal(
		'fetch',
		vi
			.fn()
			.mockResolvedValue(
				new Response(
					`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Synthetic answer' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
					{ headers: { 'Content-Type': 'text/event-stream' } }
				)
			)
	);
	const binding: GenerationModel = {
		providerRequestContext: context,
		apiOptions: {},
		operationModel: {
			conversationId: assistant.convId,
			model: 'Model-A',
			requestContext: context,
			capabilities: Promise.resolve(null),
			modelInfo: Promise.resolve(info)
		}
	};
	const onComplete = vi.fn(async () => {});
	const onError = vi.fn();
	return {
		assistant,
		failure,
		info,
		update,
		currentNode,
		firstStarted,
		release: () => release(),
		onComplete,
		onError,
		persisted: () => persisted,
		run: () => internalChat.streamChatCompletion([], assistant, onComplete, onError, binding)
	};
}

describe('AUD-010 model write queue recovery', () => {
	it('WRITE-01 executes the next queued write after rejection, preserving ID, order and latest model/info pair', async () => {
		const test = setup('Model-B');
		const completed = expect(test.run()).resolves.toBeUndefined();
		await test.firstStarted;
		// The second write is already queued, but cannot overtake the pending first one.
		expect(test.update.mock.calls.map(([, changes]) => changes.model)).toEqual([
			'Model-A',
			'Model-B'
		]);
		test.release();
		await completed;
		const writes = test.update.mock.calls.filter(
			([, changes]) => changes.model === 'Model-B' || changes.model === 'Model-C'
		);
		expect(writes[0]).toEqual([
			test.assistant.id,
			{ model: 'Model-B', modelInfo: modelInfoForResponse(test.info, 'Model-B') }
		]);
		expect(writes[1]).toEqual([
			test.assistant.id,
			{ model: 'Model-C', modelInfo: modelInfoForResponse(test.info, 'Model-C') }
		]);
		expect(test.persisted()).toMatchObject({
			id: test.assistant.id,
			model: 'Model-C',
			modelInfo: modelInfoForResponse(test.info, 'Model-C'),
			content: 'Synthetic answer'
		});
		expect(test.onComplete).toHaveBeenCalledExactlyOnceWith('Synthetic answer');
		expect(test.onError).not.toHaveBeenCalled();
		expect(chatStore.errorDialogState).toBeNull();
		expect(chatStore.isLoading).toBe(false);
		expect(chatStore.isStreaming()).toBe(false);
	});

	it('WRITE-02 propagates the final rejected write through real checkpoint error handling without successful finalization', async () => {
		const test = setup('Model-C');
		const failed = expect(test.run()).rejects.toMatchObject({
			name: 'StreamCheckpointError',
			cause: test.failure
		});
		await test.firstStarted;
		test.release();
		await failed;
		expect(test.update).toHaveBeenCalledWith(test.assistant.id, {
			model: 'Model-C',
			modelInfo: modelInfoForResponse(test.info, 'Model-C')
		});
		expect(test.persisted()).toMatchObject({
			model: 'Model-B',
			modelInfo: modelInfoForResponse(test.info, 'Model-B'),
			content: 'Synthetic answer'
		});
		expect(test.onError).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ name: 'StreamCheckpointError', cause: test.failure })
		);
		expect(test.onComplete).not.toHaveBeenCalled();
		expect(test.currentNode).not.toHaveBeenCalled();
		expect(chatStore.errorDialogState).toMatchObject({
			message: 'Failed to persist stream checkpoint'
		});
		expect(chatStore.isLoading).toBe(false);
		expect(chatStore.isStreaming()).toBe(false);
		expect(chatStore.chatLoadingStates.has(test.assistant.convId)).toBe(false);
		expect(chatStore.chatStreamingStates.has(test.assistant.convId)).toBe(false);
		expect(internalChat.abortControllers.has(test.assistant.convId)).toBe(false);
	});
});
