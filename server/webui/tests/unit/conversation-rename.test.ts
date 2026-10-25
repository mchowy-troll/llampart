import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationRenameState } from '$lib/components/app/chat/ChatSidebar/conversation-rename.svelte';
import { DatabaseService } from '$lib/services/database.service';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { t } from '$lib/i18n';

function deferred() {
	let resolve!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const originalConfig = { ...settingsStore.config };
let rename: ConversationRenameState;
const conversation = (id: string): DatabaseConversation => ({
	id,
	name: `Old ${id}`,
	currNode: null,
	lastModified: 1
});

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	conversationsStore.conversations = [conversation('A'), conversation('B')];
	conversationsStore.activeConversation = conversation('A');
	settingsStore.config = { ...originalConfig, askForTitleConfirmation: false };
	rename = new ConversationRenameState();
	rename.openFor(conversation('A'));
	rename.name = 'New A';
});

afterEach(() => {
	rename.reset();
	vi.restoreAllMocks();
	conversationsStore.clearActiveConversation();
	conversationsStore.conversations = [];
	conversationsStore.titleUpdateConfirmationCallback = undefined;
	settingsStore.config = { ...originalConfig };
});

describe('AUD-006 rename persistence and dialog state', () => {
	it('serializes saves, blocks cancellation until persistence and updates only the owner', async () => {
		const gate = deferred();
		const write = vi.spyOn(DatabaseService, 'updateConversation').mockReturnValue(gate.promise);
		const saving = rename.save();
		expect(rename.pending).toBe(true);
		expect(rename.open).toBe(true);
		expect(conversationsStore.activeConversation?.name).toBe('Old A');
		expect(conversationsStore.conversations[0].name).toBe('Old A');
		await Promise.all([rename.save(), rename.save(), rename.save()]);
		rename.cancel();
		expect(rename.open).toBe(true);
		expect(write).toHaveBeenCalledTimes(1);
		gate.resolve();
		await saving;
		expect(write).toHaveBeenCalledExactlyOnceWith('A', { name: 'New A' });
		expect(conversationsStore.activeConversation?.name).toBe('New A');
		expect(conversationsStore.conversations.map((item) => item.name)).toEqual(['New A', 'Old B']);
		expect([rename.open, rename.pending, rename.hasError]).toEqual([false, false, false]);
		expect(rename.conversationId).toBeNull();
		expect(rename.name).toBe('');
		await rename.save();
		expect(write).toHaveBeenCalledTimes(1);
	});

	it.each(['rejection', 'throw'])(
		'preserves draft and store on DB %s, then allows retry',
		async (mode) => {
			const error = new Error('Synthetic persistence failure');
			const write = vi.spyOn(DatabaseService, 'updateConversation');
			if (mode === 'rejection') write.mockRejectedValueOnce(error);
			else
				write.mockImplementationOnce(() => {
					throw error;
				});
			write.mockResolvedValue(undefined);
			await expect(rename.save()).resolves.toBeUndefined();
			expect([rename.open, rename.pending, rename.hasError]).toEqual([true, false, true]);
			expect(rename.name).toBe('New A');
			expect(rename.conversationId).toBe('A');
			expect(conversationsStore.activeConversation?.name).toBe('Old A');
			expect(conversationsStore.conversations[0].name).toBe('Old A');
			await rename.save();
			expect(write).toHaveBeenCalledTimes(2);
			expect(rename.open).toBe(false);
			expect(conversationsStore.activeConversation?.name).toBe('New A');
		}
	);

	it('propagates the original DB error from the store without a false update', async () => {
		const error = new DOMException('Synthetic transaction abort', 'AbortError');
		vi.spyOn(DatabaseService, 'updateConversation').mockRejectedValue(error);
		await expect(conversationsStore.updateConversationName('A', 'New A')).rejects.toBe(error);
		expect(conversationsStore.activeConversation?.name).toBe('Old A');
		expect(conversationsStore.conversations[0].name).toBe('Old A');
	});

	it('updates only A when the active conversation changes to B during save', async () => {
		const gate = deferred();
		vi.spyOn(DatabaseService, 'updateConversation').mockReturnValue(gate.promise);
		const saving = rename.save();
		conversationsStore.activeConversation = conversation('B');
		gate.resolve();
		await saving;
		expect(conversationsStore.activeConversation).toEqual(conversation('B'));
		expect(conversationsStore.conversations[0].name).toBe('New A');
	});

	it.each(['success', 'failure'])(
		'ignores late %s in a replacement dialog session',
		async (outcome) => {
			const gate = deferred();
			vi.spyOn(DatabaseService, 'updateConversation').mockReturnValue(gate.promise);
			const saving = rename.save();
			rename.openFor(conversation('B'));
			rename.name = 'Draft B';
			if (outcome === 'success') gate.resolve();
			else gate.reject(new Error('Late failure A'));
			await expect(saving).resolves.toBeUndefined();
			expect([rename.open, rename.pending, rename.hasError]).toEqual([true, false, false]);
			expect(rename.conversationId).toBe('B');
			expect(rename.name).toBe('Draft B');
		}
	);

	it('ignores a late rejection after the owning component is destroyed/reset', async () => {
		const gate = deferred();
		vi.spyOn(DatabaseService, 'updateConversation').mockReturnValue(gate.promise);
		const saving = rename.save();
		rename.reset();
		gate.reject(new Error('Late rejected transaction'));
		await expect(saving).resolves.toBeUndefined();
		expect([rename.open, rename.pending, rename.hasError]).toEqual([false, false, false]);
	});

	it('does not clear a newer pending save when the old promise settles', async () => {
		const a = deferred();
		const b = deferred();
		vi.spyOn(DatabaseService, 'updateConversation')
			.mockReturnValueOnce(a.promise)
			.mockReturnValueOnce(b.promise);
		const savingA = rename.save();
		rename.openFor(conversation('B'));
		rename.name = 'New B';
		const savingB = rename.save();
		a.resolve();
		await savingA;
		expect(rename.pending).toBe(true);
		expect(rename.open).toBe(true);
		expect(rename.name).toBe('New B');
		b.reject(new Error('B failed'));
		await expect(savingB).resolves.toBeUndefined();
		expect([rename.open, rename.pending, rename.hasError]).toEqual([true, false, true]);
		expect(conversationsStore.conversations.map((item) => item.name)).toEqual(['New A', 'Old B']);
	});

	it('cancels without writing and rejects blank names without closing', async () => {
		const write = vi.spyOn(DatabaseService, 'updateConversation');
		rename.name = '  ';
		await rename.save();
		expect(rename.open).toBe(true);
		rename.cancel();
		expect(rename.open).toBe(false);
		expect(rename.name).toBe('');
		expect(write).not.toHaveBeenCalled();
	});

	it.each(['pl', 'en', 'de', 'fr', 'es', 'it'] as const)(
		'has localized error/pending messages in %s',
		(language) => {
			for (const key of ['sidebar.failedToRenameConversation', 'sidebar.savingConversationName']) {
				expect(t(key, language)).not.toBe(key);
				expect(t(key, language).length).toBeGreaterThan(5);
			}
		}
	);
});

describe('AUD-006 confirmed automatic titles distinguish cancellation from failure', () => {
	beforeEach(() => {
		settingsStore.config = { ...originalConfig, askForTitleConfirmation: true };
		vi.spyOn(DatabaseService, 'getConversation').mockResolvedValue(conversation('A'));
	});

	it.each([false, true])('saves without a confirmation callback (ask=%s)', async (ask) => {
		settingsStore.config = { ...settingsStore.config, askForTitleConfirmation: ask };
		const write = vi.spyOn(DatabaseService, 'updateConversation').mockResolvedValue();
		await expect(
			conversationsStore.updateConversationTitleWithConfirmation('A', 'New A')
		).resolves.toBe(true);
		expect(write).toHaveBeenCalledExactlyOnceWith('A', { name: 'New A' });
	});

	it('returns false only on declined confirmation without a write', async () => {
		const confirm = vi.fn().mockResolvedValue(false);
		conversationsStore.setTitleUpdateConfirmationCallback(confirm);
		const write = vi.spyOn(DatabaseService, 'updateConversation');
		await expect(
			conversationsStore.updateConversationTitleWithConfirmation('A', 'New A')
		).resolves.toBe(false);
		expect(confirm).toHaveBeenCalledExactlyOnceWith('Old A', 'New A');
		expect(write).not.toHaveBeenCalled();
	});

	it('returns true after accepted and committed update', async () => {
		conversationsStore.setTitleUpdateConfirmationCallback(async () => true);
		const write = vi.spyOn(DatabaseService, 'updateConversation').mockResolvedValue();
		await expect(
			conversationsStore.updateConversationTitleWithConfirmation('A', 'New A')
		).resolves.toBe(true);
		expect(write).toHaveBeenCalledTimes(1);
		expect(conversationsStore.activeConversation?.name).toBe('New A');
	});

	it('rejects failed persistence rather than returning success or cancellation', async () => {
		conversationsStore.setTitleUpdateConfirmationCallback(async () => true);
		const error = new Error('Synthetic DB rejection');
		vi.spyOn(DatabaseService, 'updateConversation').mockRejectedValue(error);
		await expect(
			conversationsStore.updateConversationTitleWithConfirmation('A', 'New A')
		).rejects.toBe(error);
		expect(conversationsStore.activeConversation?.name).toBe('Old A');
	});

	it('rejects a missing owner instead of reporting a user cancellation', async () => {
		conversationsStore.setTitleUpdateConfirmationCallback(async () => true);
		vi.mocked(DatabaseService.getConversation).mockResolvedValue(undefined);
		await expect(
			conversationsStore.updateConversationTitleWithConfirmation('A', 'New A')
		).rejects.toThrow(/not found/);
	});

	it('propagates confirmation errors and never writes', async () => {
		const error = new Error('Synthetic confirmation error');
		conversationsStore.setTitleUpdateConfirmationCallback(async () => {
			throw error;
		});
		const write = vi.spyOn(DatabaseService, 'updateConversation');
		await expect(
			conversationsStore.updateConversationTitleWithConfirmation('A', 'New A')
		).rejects.toBe(error);
		expect(write).not.toHaveBeenCalled();
	});
});
