import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '$lib/services/database.service';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { runChatRouteTask } from '$lib/utils/chat-route-task';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function conversation(id: string): DatabaseConversation {
	return { id, name: id, currNode: null, lastModified: 0 };
}

function message(id: string, convId: string): DatabaseMessage {
	return {
		id,
		convId,
		type: 'text',
		role: 'user',
		content: id,
		timestamp: 0,
		toolCalls: '',
		children: [],
		parent: null
	} as DatabaseMessage;
}

afterEach(() => {
	vi.restoreAllMocks();
	conversationsStore.clearActiveConversation();
});

describe('conversation navigation generations', () => {
	it('commits B-fast atomically and ignores messages from A-slow', async () => {
		const messagesA = deferred<DatabaseMessage[]>();
		const messagesB = deferred<DatabaseMessage[]>();
		const startedA = deferred<void>();
		const startedB = deferred<void>();
		vi.spyOn(DatabaseService, 'getConversation').mockImplementation(async (id) => conversation(id));
		vi.spyOn(DatabaseService, 'getConversationMessages').mockImplementation((id) => {
			if (id === 'A') {
				startedA.resolve();
				return messagesA.promise;
			}
			startedB.resolve();
			return messagesB.promise;
		});

		const loadA = conversationsStore.loadConversation('A');
		await startedA.promise;
		const loadB = conversationsStore.loadConversation('B');
		await startedB.promise;
		messagesB.resolve([message('message-B', 'B')]);
		await expect(loadB).resolves.toBe(true);
		messagesA.resolve([message('message-A', 'A')]);
		await expect(loadA).resolves.toBe(false);

		expect(conversationsStore.activeConversation?.id).toBe('B');
		expect(conversationsStore.activeMessages.map((item) => item.convId)).toEqual(['B']);
	});

	it('does not start stale route resume or URL handling after B becomes current', async () => {
		let generation = 1;
		const loadA = deferred<boolean>();
		const calls: string[] = [];
		const taskA = runChatRouteTask({
			isCurrent: () => generation === 1,
			isAlreadyActive: false,
			loadConversation: () => loadA.promise,
			syncLoadingState: () => calls.push('sync-A'),
			resumeStream: async () => calls.push('resume-A'),
			handleUrlParams: async () => {
				calls.push('params-A');
			},
			gotoFallback: async () => calls.push('fallback-A')
		});

		generation = 2;
		await runChatRouteTask({
			isCurrent: () => generation === 2,
			isAlreadyActive: true,
			loadConversation: async () => true,
			syncLoadingState: () => calls.push('sync-B'),
			resumeStream: async () => calls.push('resume-B'),
			handleUrlParams: async () => {
				calls.push('params-B');
			},
			gotoFallback: async () => calls.push('fallback-B')
		});
		loadA.resolve(true);
		await taskA;

		expect(calls).toEqual(['sync-B', 'resume-B', 'params-B']);
	});
});
