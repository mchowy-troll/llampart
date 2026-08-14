import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, MessageType } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { DatabaseService } from '$lib/services/database.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';

function message(
	id: string,
	parent: string | null,
	children: string[],
	role: DatabaseMessage['role']
): DatabaseMessage {
	return {
		id,
		convId: 'stream-conversation',
		type: MessageType.TEXT,
		role,
		content: '',
		timestamp: 1,
		parent,
		children,
		toolCalls: ''
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	conversationsStore.activeConversation = null;
	conversationsStore.activeMessages = [];
	conversationsStore.conversations = [];
	chatStore.chatLoadingStates.clear();
	chatStore.chatStreamingStates.clear();
	chatStore.chatReasoningStates.clear();
	chatStore.clearUIState();
});

describe('ChatStore database cleanup', () => {
	it('keeps a committed user edit consistent after an agentic failure and reload', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const conversation: DatabaseConversation = {
			id: 'stream-conversation',
			name: 'Conversation',
			currNode: 'assistant',
			lastModified: 1
		};
		const root = {
			...message('root', null, ['system'], MessageRole.SYSTEM),
			type: MessageType.ROOT
		};
		const system = message('system', 'root', ['user'], MessageRole.SYSTEM);
		const user = {
			...message('user', 'system', ['assistant'], MessageRole.USER),
			content: 'Original'
		};
		const assistant = message('assistant', 'user', [], MessageRole.ASSISTANT);
		const replacementAssistant = message(
			'replacement-assistant',
			'user',
			[],
			MessageRole.ASSISTANT
		);
		let persistedConversation = { ...conversation };
		let persistedMessages = [root, system, user, assistant];

		conversationsStore.conversations = [conversation];
		conversationsStore.activeConversation = conversation;
		conversationsStore.activeMessages = [system, user, assistant];
		vi.spyOn(DatabaseService, 'getConversation').mockImplementation(async () => ({
			...persistedConversation
		}));
		vi.spyOn(DatabaseService, 'getConversationMessages').mockImplementation(async () =>
			persistedMessages.map((item) => ({ ...item }))
		);
		vi.spyOn(DatabaseService, 'replaceUserMessageAndTruncateBranch').mockImplementation(
			async (_convId, messageId, content) => {
				persistedMessages = persistedMessages
					.filter((item) => item.id !== 'assistant')
					.map((item) => (item.id === messageId ? { ...item, content, children: [] } : item));
				persistedConversation = { ...persistedConversation, currNode: messageId, lastModified: 2 };
				return { deletedIds: ['assistant'], lastModified: 2 };
			}
		);
		vi.spyOn(DatabaseService, 'createMessageBranch').mockResolvedValue(replacementAssistant);
		vi.spyOn(DatabaseService, 'updateCurrentNode').mockImplementation(async (_convId, nodeId) => {
			persistedConversation = { ...persistedConversation, currNode: nodeId };
		});
		const internalChatStore = chatStore as unknown as {
			streamChatCompletion: (
				messages: DatabaseMessage[],
				assistantMessage: DatabaseMessage,
				onComplete?: (content: string) => Promise<void>,
				onError?: (error: Error) => void
			) => Promise<void>;
		};
		vi.spyOn(internalChatStore, 'streamChatCompletion').mockImplementation(
			async (_messages, _assistantMessage, _onComplete, onError) => {
				persistedConversation = { ...persistedConversation, currNode: 'user' };
				conversationsStore.activeMessages = conversationsStore.activeMessages.filter(
					(item) => item.id !== 'replacement-assistant'
				);
				onError?.(new Error('agentic stream failed'));
			}
		);

		await chatStore.updateMessage('user', 'Edited');

		expect(conversationsStore.activeMessages.find((item) => item.id === 'user')?.content).toBe(
			'Edited'
		);
		conversationsStore.clearActiveConversation();
		await conversationsStore.loadConversation('stream-conversation');
		expect(conversationsStore.activeMessages.find((item) => item.id === 'user')?.content).toBe(
			'Edited'
		);
	});

	it('cleans up a failed assistant even after another conversation becomes active', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		conversationsStore.activeConversation = {
			id: 'other-conversation',
			name: 'Other',
			currNode: null,
			lastModified: 1
		};
		const failedAssistant = message('failed-assistant', 'user-message', [], MessageRole.ASSISTANT);
		const deleteBranch = vi
			.spyOn(DatabaseService, 'deleteMessageCascading')
			.mockResolvedValue(['failed-assistant']);
		vi.spyOn(ChatService, 'sendMessage').mockImplementation(async (_messages, options) => {
			await options?.onError?.(new Error('stream failed'));
		});

		await (
			chatStore as unknown as {
				streamChatCompletion: (
					messages: DatabaseMessage[],
					assistant: DatabaseMessage
				) => Promise<void>;
			}
		).streamChatCompletion([], failedAssistant);

		expect(deleteBranch).toHaveBeenCalledWith(
			'stream-conversation',
			'failed-assistant',
			'user-message'
		);
	});

	it('passes the replacement node into the atomic delete without a prior current-node write', async () => {
		conversationsStore.activeConversation = {
			id: 'stream-conversation',
			name: 'Conversation',
			currNode: 'assistant',
			lastModified: 1
		};
		const root = { ...message('root', null, ['user'], MessageRole.SYSTEM), type: MessageType.ROOT };
		const user = message('user', 'root', ['assistant'], MessageRole.USER);
		const assistant = message('assistant', 'user', [], MessageRole.ASSISTANT);
		conversationsStore.activeMessages = [user, assistant];
		vi.spyOn(conversationsStore, 'getConversationMessages').mockResolvedValue([
			root,
			user,
			assistant
		]);
		const updateCurrentNode = vi.spyOn(conversationsStore, 'updateCurrentNode');
		const deleteBranch = vi
			.spyOn(DatabaseService, 'deleteMessageCascading')
			.mockResolvedValue(['assistant']);
		vi.spyOn(conversationsStore, 'refreshActiveMessages').mockResolvedValue();
		vi.spyOn(conversationsStore, 'refreshConversationTimestamp').mockResolvedValue();

		await chatStore.deleteMessage('assistant');

		expect(updateCurrentNode).not.toHaveBeenCalled();
		expect(deleteBranch).toHaveBeenCalledWith('stream-conversation', 'assistant', 'user');
	});

	it('removes the complete failed multi-turn branch from memory before the next add', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		conversationsStore.activeConversation = {
			id: 'stream-conversation',
			name: 'Conversation',
			currNode: 'assistant-2',
			lastModified: 1
		};
		const user = message('user', 'root', ['assistant'], MessageRole.USER);
		const assistant = message('assistant', 'user', ['tool'], MessageRole.ASSISTANT);
		const tool = message('tool', 'assistant', ['assistant-2'], MessageRole.TOOL);
		const assistant2 = message('assistant-2', 'tool', [], MessageRole.ASSISTANT);
		const nextUser = message('next-user', 'user', [], MessageRole.USER);
		conversationsStore.activeMessages = [user, assistant];

		vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
			enabled: true,
			maxTurns: 3,
			maxToolPreviewLines: 10
		});
		vi.spyOn(DatabaseService, 'updateMessage').mockResolvedValue();
		const createBranch = vi
			.spyOn(DatabaseService, 'createMessageBranch')
			.mockResolvedValueOnce(tool)
			.mockResolvedValueOnce(assistant2)
			.mockResolvedValueOnce(nextUser);
		vi.spyOn(conversationsStore, 'updateCurrentNode').mockResolvedValue();
		vi.spyOn(conversationsStore, 'refreshConversationTimestamp').mockResolvedValue();
		const deleteBranch = vi
			.spyOn(DatabaseService, 'deleteMessageCascading')
			.mockResolvedValue(['assistant', 'tool', 'assistant-2']);
		vi.spyOn(agenticStore, 'runAgenticFlow').mockImplementation(async ({ callbacks }) => {
			await callbacks.createToolResultMessage?.('call', 'result');
			await callbacks.createAssistantMessage?.();
			await callbacks.onAssistantTurnComplete?.(
				'<!-- llm-error -->failed',
				undefined,
				undefined,
				undefined
			);
			await callbacks.onError?.(new Error('later turn failed'));
			return { handled: true, error: new Error('later turn failed') };
		});

		await (
			chatStore as unknown as {
				streamChatCompletion: (
					messages: DatabaseMessage[],
					assistant: DatabaseMessage
				) => Promise<void>;
			}
		).streamChatCompletion([user], assistant);

		expect(deleteBranch).toHaveBeenCalledWith('stream-conversation', 'assistant', 'user');
		expect(conversationsStore.activeMessages).toEqual([{ ...user, children: [] }]);
		expect(conversationsStore.activeConversation.currNode).toBe('user');

		await chatStore.addMessage(MessageRole.USER, 'next');
		expect(createBranch).toHaveBeenLastCalledWith(
			expect.objectContaining({ content: 'next' }),
			'user'
		);
	});
});
