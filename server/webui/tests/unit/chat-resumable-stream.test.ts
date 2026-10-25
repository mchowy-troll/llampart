import '../fixtures/verified-backend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';
import { MessageRole } from '$lib/enums';
import type { ResumableStreamState } from '$lib/utils/resumable-stream-state';
import { createSourceFingerprint } from '$lib/utils/resumable-stream-state';
import { RESUMABLE_STREAM_STATE_TTL_MS } from '$lib/utils/resumable-stream-state';
import { saveResumableStreamState } from '$lib/utils/resumable-stream-state';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { settingsStore } from '$lib/stores/settings.svelte';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { DatabaseService } from '$lib/services/database.service';

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;
const originalConfig = { ...settingsStore.config };

function streamResponse(raw: string): Response {
	return new Response(encoder.encode(raw), {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	settingsStore.config = { ...originalConfig };
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('ChatService resumable streams', () => {
	it.each([404, 405, 501])(
		'reconnects from parsed UTF-8 bytes without reporting unsupported replay as success (%s)',
		async (status) => {
			const values = new Map<string, string>();
			vi.stubGlobal('localStorage', {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
				removeItem: (key: string) => values.delete(key)
			});
			const otherState: ResumableStreamState = {
				schemaVersion: 2,
				conversationId: 'chat/other',
				assistantMessageId: 'assistant-other',
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				sourceFingerprint: 'sha256:other-source',
				streamIdentity: 'stream-other',
				model: null,
				bytesReceived: 17,
				updatedAt: Date.now()
			};
			saveResumableStreamState(otherState);
			const firstEvent = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ż' } }] })}\r\n\r\n`;
			const fetchMock = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(streamResponse(firstEvent))
				.mockResolvedValueOnce(new Response(null, { status }));
			globalThis.fetch = fetchMock;
			const onComplete = vi.fn();
			const onError = vi.fn();
			const onChunk = vi.fn();
			const onStreamCheckpoint = vi.fn();

			const result = await ChatService.sendMessage(
				[{ role: MessageRole.USER, content: 'hello' }],
				{
					stream: true,
					model: 'org/repo/model',
					assistantMessageId: 'assistant-one',
					onChunk,
					onStreamCheckpoint,
					onComplete,
					onError
				},
				'chat/one'
			).then(
				() => undefined,
				(error: unknown) => error
			);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
			expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages).toContainEqual({
				role: MessageRole.USER,
				content: 'hello'
			});
			const originalHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
			const streamIdentity = originalHeaders.get('X-Conversation-Id');
			expect(streamIdentity).toBeTruthy();
			const replayRequest = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
			expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
			expect(replayRequest.pathname).toBe('/__llampart/api/llama-server/v1/stream');
			expect(replayRequest.searchParams.get('conv_id')).toBe(streamIdentity);
			expect(replayRequest.searchParams.get('from')).toBe(
				String(encoder.encode(firstEvent).length)
			);
			expect(onChunk.mock.calls).toEqual([['ż']]);
			expect(onComplete).not.toHaveBeenCalled();
			expect(onError).toHaveBeenCalledExactlyOnceWith(result);
			expect(result).toMatchObject({ name: 'IncompleteStreamError' });
			expect(onStreamCheckpoint).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ content: 'ż', bytesReceived: encoder.encode(firstEvent).length })
			);
			expect(ChatService.getResumableState('chat/one')).toBeNull();
			expect(ChatService.getResumableState(otherState.conversationId)).toEqual(otherState);
		}
	);

	it('looks up a persisted stream and attaches replay to seeded content', async () => {
		const sourceFingerprint = await createSourceFingerprint({
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
			apiKey: String(settingsStore.config.apiKey ?? '')
		});
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-1',
			assistantMessageId: 'assistant-1',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint,
			streamIdentity: 'conversation=chat-1&model=org%2Frepo%2Fmodel&request=req-1',
			model: 'org/repo/model',
			bytesReceived: 91,
			updatedAt: Date.now()
		};
		const replay =
			`data: ${JSON.stringify({ choices: [{ delta: { content: ' new' } }] })}\n\n` +
			'data: [DONE]\n\n';
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('{}', { status: 200 }))
			.mockResolvedValueOnce(streamResponse(replay));
		globalThis.fetch = fetchMock;
		const onComplete = vi.fn();
		const onError = vi.fn();
		const onChunk = vi.fn();

		const resumed = await ChatService.resumeStream(state, {
			resumeSeed: { content: 'prior', reasoningContent: 'plan', toolCalls: [] },
			onChunk,
			onComplete,
			onError
		});

		expect(resumed).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			conversation_ids: [state.streamIdentity]
		});
		const replayRequest = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
		expect(replayRequest.searchParams.get('conv_id')).toBe(state.streamIdentity);
		expect(replayRequest.searchParams.get('from')).toBe('91');
		expect(onChunk.mock.calls).toEqual([[' new']]);
		expect(onComplete).toHaveBeenCalledOnce();
		expect(onComplete.mock.calls[0][0]).toBe('prior new');
		expect(onComplete.mock.calls[0][1]).toBe('plan');
		expect(onError).not.toHaveBeenCalled();
	});

	it('returns false when the optional lookup endpoint is unavailable', async () => {
		const sourceFingerprint = await createSourceFingerprint({
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
			apiKey: String(settingsStore.config.apiKey ?? '')
		});
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-fallback',
			assistantMessageId: 'assistant-fallback',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint,
			streamIdentity: 'stream-fallback',
			model: 'frozen-model',
			bytesReceived: 10,
			updatedAt: Date.now()
		};
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
		globalThis.fetch = fetchMock;

		await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('stops an active replay, preserving committed content and the other conversation', async () => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key)
		});
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-stop',
			assistantMessageId: 'assistant-stop',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: await createSourceFingerprint({
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
				apiKey: String(settingsStore.config.apiKey ?? '')
			}),
			streamIdentity: 'stream-stop',
			model: null,
			bytesReceived: 91,
			updatedAt: Date.now()
		};
		const otherState = { ...state, conversationId: 'chat-other', streamIdentity: 'stream-other' };
		saveResumableStreamState(state);
		saveResumableStreamState(otherState);
		const history = {
			id: 'user-stop',
			convId: state.conversationId,
			role: MessageRole.USER,
			content: 'committed history'
		} as DatabaseMessage;
		const assistant = {
			id: state.assistantMessageId,
			convId: state.conversationId,
			role: MessageRole.ASSISTANT,
			content: 'prior'
		} as DatabaseMessage;
		vi.spyOn(conversationsStore, 'getConversationMessages').mockResolvedValue([history, assistant]);
		const update = vi.spyOn(DatabaseService, 'updateMessage').mockResolvedValue(undefined);
		const advanceHistory = vi
			.spyOn(conversationsStore, 'updateConversationCurrentNode')
			.mockResolvedValue(undefined);
		let replaySignal: AbortSignal | undefined;
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			if (init?.method !== 'GET') return new Response('{}', { status: 200 });
			replaySignal = init.signal ?? undefined;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({ choices: [{ delta: { content: ' new' } }] })}\n\n`
							)
						);
						replaySignal?.addEventListener(
							'abort',
							() => {
								controller.error(new DOMException('Stopped', 'AbortError'));
							},
							{ once: true }
						);
					}
				})
			);
		});
		globalThis.fetch = fetchMock;

		const resuming = chatStore.resumeStreamForChat(state.conversationId);
		let stoppedSynchronously = false;
		try {
			await vi.waitFor(() => {
				expect(update).toHaveBeenCalledWith(
					assistant.id,
					expect.objectContaining({ content: 'prior new' })
				);
			});
		} finally {
			const stopping = chatStore.stopGenerationForChat(state.conversationId);
			stoppedSynchronously = replaySignal?.aborted ?? false;
			await stopping;
			await resuming;
		}

		expect(stoppedSynchronously).toBe(true);
		expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'DELETE']);
		const stopUrl = new URL(String(fetchMock.mock.calls[2][0]), 'http://localhost');
		expect(stopUrl.searchParams.get('conv_id')).toBe(state.streamIdentity);
		expect(stopUrl.searchParams.has('from')).toBe(false);
		expect(ChatService.getResumableState(state.conversationId)).toBeNull();
		expect(ChatService.getResumableState(otherState.conversationId)).toEqual(otherState);
		expect(assistant.content).toBe('prior new');
		expect(history.content).toBe('committed history');
		expect(update.mock.calls.every(([id]) => id === assistant.id)).toBe(true);
		expect(advanceHistory).not.toHaveBeenCalled();
		expect(chatStore.isChatLoadingPublic(state.conversationId)).toBe(false);
		expect(chatStore.getChatStreamingPublic(state.conversationId)).toBeUndefined();
	});

	it('rejects a source mismatch before issuing a lookup request', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-source-a',
			assistantMessageId: 'assistant-source-a',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: await createSourceFingerprint({
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: 'https://a.example.test',
				apiKey: 'secret-a'
			}),
			streamIdentity: 'stream-source-a',
			model: null,
			bytesReceived: 0,
			updatedAt: Date.now()
		};
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.example.test',
			apiKey: 'secret-b'
		});
		const fetchMock = vi.fn<typeof fetch>();
		globalThis.fetch = fetchMock;

		await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects an expired state before issuing a lookup request', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-expired',
			assistantMessageId: 'assistant-expired',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: await createSourceFingerprint({
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
				apiKey: String(settingsStore.config.apiKey ?? '')
			}),
			streamIdentity: 'stream-expired',
			model: null,
			bytesReceived: 0,
			updatedAt: Date.now() - RESUMABLE_STREAM_STATE_TTL_MS - 1
		};
		const fetchMock = vi.fn<typeof fetch>();
		globalThis.fetch = fetchMock;

		await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a missing exact assistant message without resuming or mutating another message', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-exact',
			assistantMessageId: 'missing-assistant',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: 'sha256:test',
			streamIdentity: 'stream-exact',
			model: null,
			bytesReceived: 0,
			updatedAt: Date.now()
		};
		const otherAssistant = {
			id: 'other-assistant',
			convId: state.conversationId,
			role: MessageRole.ASSISTANT,
			content: 'must remain unchanged'
		} as DatabaseMessage;
		vi.spyOn(ChatService, 'getResumableState').mockReturnValue(state);
		vi.spyOn(ChatService, 'canResumeStream').mockResolvedValue(true);
		const discard = vi.spyOn(ChatService, 'discardResumableStream').mockImplementation(() => {});
		const resume = vi.spyOn(ChatService, 'resumeStream');
		vi.spyOn(conversationsStore, 'getConversationMessages').mockResolvedValue([otherAssistant]);
		const update = vi.spyOn(DatabaseService, 'updateMessage');

		await chatStore.resumeStreamForChat(state.conversationId);

		expect(discard).toHaveBeenCalledWith(state.conversationId);
		expect(resume).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(otherAssistant.content).toBe('must remain unchanged');
	});
});
