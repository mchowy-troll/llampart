import { conversationsStore } from '$lib/stores/conversations.svelte';

/** One rename dialog session. Late results may update their owner in the store,
 * but must never clear or close a newer dialog session. */
export class ConversationRenameState {
	open = $state(false);
	conversationId = $state<string | null>(null);
	name = $state('');
	pending = $state(false);
	hasError = $state(false);
	private session = 0;

	openFor(conversation: DatabaseConversation): void {
		this.reset();
		this.conversationId = conversation.id;
		this.name = conversation.name;
		this.open = true;
	}

	reset(): void {
		this.session += 1;
		this.open = false;
		this.conversationId = null;
		this.name = '';
		this.pending = false;
		this.hasError = false;
	}

	cancel(): void {
		// IndexedDB transactions cannot be cancelled through this UI. Keep the
		// pending operation visible until its outcome is known.
		if (!this.pending) this.reset();
	}

	async save(): Promise<void> {
		if (!this.open || this.pending || !this.conversationId || !this.name.trim()) return;
		const session = this.session;
		const id = this.conversationId;
		const name = this.name;
		this.pending = true;
		this.hasError = false;
		try {
			await conversationsStore.updateConversationName(id, name);
			if (session === this.session) this.reset();
		} catch {
			if (session === this.session) this.hasError = true;
		} finally {
			if (session === this.session) this.pending = false;
		}
	}
}
