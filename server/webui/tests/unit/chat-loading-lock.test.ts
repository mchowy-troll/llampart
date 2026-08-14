import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';

afterEach(() => {
	vi.restoreAllMocks();
	(
		chatStore as unknown as { conversationOperationLocks: Set<string> }
	).conversationOperationLocks.clear();
	conversationsStore.activeConversation = null;
	conversationsStore.activeMessages = [];
});

describe('per-conversation chat operation lock', () => {
	it('rejects a second send synchronously before the first send creates messages', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		conversationsStore.activeConversation = {
			id: 'conversation-1',
			name: 'Conversation',
			currNode: null,
			lastModified: Date.now()
		} as DatabaseConversation;
		const firstMessage = Promise.reject(new Error('stop after lock assertion'));
		const addMessage = vi.spyOn(chatStore, 'addMessage').mockReturnValue(firstMessage);

		const first = chatStore.sendMessage('first');
		const second = chatStore.sendMessage('second');

		await second;
		expect(addMessage).toHaveBeenCalledTimes(1);
		await first;
	});

	it('keeps the new-conversation lock while the conversation is being created', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let releaseCreation!: () => void;
		const creating = new Promise<void>((resolve) => {
			releaseCreation = resolve;
		});
		const createConversation = vi
			.spyOn(conversationsStore, 'createConversation')
			.mockImplementation(async () => {
				await creating;
				return 'conversation-created';
			});

		const first = chatStore.sendMessage('first');
		const second = chatStore.sendMessage('second');

		await second;
		expect(createConversation).toHaveBeenCalledTimes(1);
		releaseCreation();
		await first;
	});
});
