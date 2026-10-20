import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, MessageType } from '$lib/enums';
import { DatabaseService } from '$lib/services/database.service';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore as c } from '$lib/stores/conversations.svelte';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

let rows: DatabaseMessage[];
let conversations: DatabaseConversation[];

beforeEach(async () => {
	rows = ['A', 'B'].flatMap((convId) => [
		{
			id: `${convId}-root`,
			convId,
			role: MessageRole.SYSTEM,
			type: MessageType.ROOT,
			parent: null,
			children: [`${convId}-system`],
			content: '',
			timestamp: 1
		},
		{
			id: `${convId}-system`,
			convId,
			role: MessageRole.SYSTEM,
			type: MessageType.SYSTEM,
			parent: `${convId}-root`,
			children: [],
			content: 'Instrukcja stara',
			timestamp: 2,
			extra: [{ type: 'TEXT', name: 'keep.txt', content: 'metadata' }]
		}
	]);
	conversations = ['A', 'B'].map((id) => ({
		id,
		name: id,
		currNode: `${id}-system`,
		lastModified: 1
	}));
	vi.spyOn(DatabaseService, 'getConversation').mockImplementation(async (id) =>
		structuredClone(conversations.find((row) => row.id === id))
	);
	vi.spyOn(DatabaseService, 'getConversationMessages').mockImplementation(async (id) =>
		structuredClone(rows.filter((row) => row.convId === id))
	);
	vi.spyOn(DatabaseService, 'updateConversationMessage').mockImplementation(
		async (convId, id, updates) => {
			const row = rows.find((row) => row.id === id && row.convId === convId);
			if (!row) throw new Error('Missing owned message');
			Object.assign(row, updates);
			conversations.find((row) => row.id === convId)!.lastModified++;
		}
	);
	c.conversations = structuredClone(conversations);
	await c.loadConversation('A');
});

afterEach(() => {
	vi.restoreAllMocks();
	c.clearActiveConversation();
	c.conversations = [];
});

describe('OWN-008 system message edit', () => {
	it('commits only content in place, then publishes and refreshes the owner timestamp', async () => {
		const before = structuredClone(rows);
		const snapshot = c.activeMessages[0];
		await chatStore.editSystemMessage('A', 'A-system', 'Instrukcja nowa');
		expect(DatabaseService.updateConversationMessage).toHaveBeenCalledExactlyOnceWith(
			'A',
			'A-system',
			{ content: 'Instrukcja nowa' }
		);
		expect(rows).toEqual(
			before.map((row) => (row.id === 'A-system' ? { ...row, content: 'Instrukcja nowa' } : row))
		);
		expect(c.activeMessages[0].content).toBe('Instrukcja nowa');
		expect(snapshot.content).toBe('Instrukcja stara');
		expect(c.activeConversation).toEqual({ ...conversations[0] });
	});

	it.each(['B', 'A-B-A', 'clear'])(
		'binds both IDs before persistence; navigation %s cannot retarget it',
		async (navigation) => {
			const ready = deferred(),
				gate = deferred();
			const save = vi.mocked(DatabaseService.updateConversationMessage).getMockImplementation()!;
			vi.mocked(DatabaseService.updateConversationMessage).mockImplementation(async (...args) => {
				ready.resolve();
				await gate.promise;
				await save(...args);
			});
			const pending = chatStore.editSystemMessage('A', 'A-system', 'Instrukcja nowa');
			await ready.promise;
			expect(c.activeMessages[0].content).toBe('Instrukcja stara');
			await c.loadConversation('B');
			if (navigation === 'A-B-A') await c.loadConversation('A');
			if (navigation === 'clear') c.clearActiveConversation();
			const view = JSON.stringify(c.activeMessages);
			gate.resolve();
			await pending;
			expect(c.activeConversation?.id ?? null).toBe(
				navigation === 'clear' ? null : navigation === 'B' ? 'B' : 'A'
			);
			if (navigation !== 'A-B-A') expect(JSON.stringify(c.activeMessages)).toBe(view);
			else expect(c.activeMessages[0].content).toBe('Instrukcja nowa');
			expect(rows.find((row) => row.id === 'B-system')!.content).toBe('Instrukcja stara');
			await c.loadConversation('A');
			expect(c.activeMessages[0].content).toBe('Instrukcja nowa');
		}
	);

	it('does not publish before confirmation and propagates failure without changing state; retry works', async () => {
		const before = JSON.stringify([rows, c.activeMessages, c.activeConversation]);
		vi.mocked(DatabaseService.updateConversationMessage).mockRejectedValueOnce(
			new Error('IndexedDB abort')
		);
		await expect(chatStore.editSystemMessage('A', 'A-system', 'Draft')).rejects.toThrow(
			'IndexedDB abort'
		);
		expect(JSON.stringify([rows, c.activeMessages, c.activeConversation])).toBe(before);
		await chatStore.editSystemMessage('A', 'A-system', 'Retry');
		expect(c.activeMessages[0].content).toBe('Retry');
	});

	it('rejects a second save until the first settles, including a different draft', async () => {
		const ready = deferred(),
			gate = deferred();
		const save = vi.mocked(DatabaseService.updateConversationMessage).getMockImplementation()!;
		vi.mocked(DatabaseService.updateConversationMessage).mockImplementation(async (...args) => {
			ready.resolve();
			await gate.promise;
			await save(...args);
		});
		const pending = chatStore.editSystemMessage('A', 'A-system', 'First');
		await ready.promise;
		try {
			await expect(chatStore.editSystemMessage('A', 'A-system', 'Second')).rejects.toThrow(
				/progress|pending/i
			);
			expect(DatabaseService.updateConversationMessage).toHaveBeenCalledTimes(1);
		} finally {
			gate.resolve();
			await pending;
		}
		await chatStore.editSystemMessage('A', 'A-system', 'Second');
		expect(rows.find((row) => row.id === 'A-system')!.content).toBe('Second');
	});

	it.each(['missing', 'foreign', 'user', 'root'])('rejects invalid target: %s', async (kind) => {
		if (kind === 'user') rows.find((row) => row.id === 'A-system')!.role = MessageRole.USER;
		const id =
			kind === 'missing'
				? 'absent'
				: kind === 'foreign'
					? 'B-system'
					: kind === 'root'
						? 'A-root'
						: 'A-system';
		await expect(chatStore.editSystemMessage('A', id, 'Invalid')).rejects.toThrow();
		expect(DatabaseService.updateConversationMessage).not.toHaveBeenCalled();
	});

	it('allows independent B edits while A is pending without retargeting either write', async () => {
		const ready = deferred(),
			gate = deferred();
		const save = vi.mocked(DatabaseService.updateConversationMessage).getMockImplementation()!;
		vi.mocked(DatabaseService.updateConversationMessage).mockImplementation(async (...args) => {
			if (args[0] === 'A') {
				ready.resolve();
				await gate.promise;
			}
			await save(...args);
		});
		const pending = chatStore.editSystemMessage('A', 'A-system', 'A new');
		await ready.promise;
		await c.loadConversation('B');
		await chatStore.editSystemMessage('B', 'B-system', 'B new');
		gate.resolve();
		await pending;
		expect(c.activeMessages[0].content).toBe('B new');
		expect(rows.find((row) => row.id === 'A-system')!.content).toBe('A new');
		expect(rows.find((row) => row.id === 'B-system')!.content).toBe('B new');
	});
});
