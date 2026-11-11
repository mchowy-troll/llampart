// Deliberately non-reactive: no subscriptions or work per streamed token.
// A scope outlives UI loading flags, including stop/drain, checkpoints and titles.
const writers = new Map<string, number>();
const revisions = new Map<string, object>();
type ReplacementQueue = {
	casActive: boolean;
	pending: number;
	released: Promise<void>;
	tail: Promise<void>;
};
const replacements = new Map<string, ReplacementQueue>();

function cleanupQueue(conversationId: string, queue: ReplacementQueue): void {
	if (!queue.casActive && queue.pending === 0 && replacements.get(conversationId) === queue)
		replacements.delete(conversationId);
}
type QueuedGeneration = {
	started: boolean;
	cancelled: boolean;
	ready: Promise<void>;
	releaseReady: () => void;
};
const queuedGenerations = new Map<string, Set<QueuedGeneration>>();
export type ConversationWriterKind = 'write' | 'generation' | 'stop';

/** Called only once the real stream controller has been installed. A queued Stop
 * can then abort safely, without waiting for the generation's completion. */
export function queuedGenerationReady(conversationId: string): void {
	for (const generation of queuedGenerations.get(conversationId) ?? []) {
		if (generation.started) generation.releaseReady();
	}
}

export async function withConversationWriter<T>(
	conversationId: string | undefined,
	operation: () => Promise<T>,
	kind: ConversationWriterKind = 'write'
): Promise<T> {
	if (!conversationId) return operation();
	// Register synchronously, including work waiting behind CAS. This invalidates
	// an in-flight repair before yielding, but never drops the user's operation.
	writers.set(conversationId, (writers.get(conversationId) ?? 0) + 1);
	revisions.set(conversationId, {});
	const replacement = replacements.get(conversationId);
	// Keep the queue alive for both waiting and executing operations, including
	// writers arriving after CAS has released its exclusive section.
	if (replacement) replacement.pending++;
	let generation: QueuedGeneration | undefined;
	let predecessor: Promise<void> | undefined;
	let releaseSlot: (() => void) | undefined;
	if (kind === 'stop') {
		const barriers: Promise<void>[] = replacement ? [replacement.released] : [];
		for (const pending of queuedGenerations.get(conversationId) ?? []) {
			if (pending.started) barriers.push(pending.ready);
			else pending.cancelled = true;
		}
		// Stop bypasses earlier generations' completion, not CAS/controller readiness.
		if (barriers.length) predecessor = Promise.all(barriers).then(() => undefined);
		if (replacement) {
			const previous = replacement.tail;
			const stopped = new Promise<void>((resolve) => (releaseSlot = resolve));
			// Later writers must wait for both prior writes and Stop's cleanup.
			replacement.tail = Promise.all([previous, stopped]).then(() => undefined);
		}
	} else if (replacement) {
		// Reserve FIFO slots synchronously during CAS and throughout queue drain.
		predecessor = replacement.tail;
		replacement.tail = new Promise<void>((resolve) => (releaseSlot = resolve));
		if (kind === 'generation') {
			let releaseReady!: () => void;
			const ready = new Promise<void>((resolve) => (releaseReady = resolve));
			generation = { started: false, cancelled: false, ready, releaseReady };
			let pending = queuedGenerations.get(conversationId);
			if (!pending) queuedGenerations.set(conversationId, (pending = new Set()));
			pending.add(generation);
		}
	}
	try {
		if (predecessor) await predecessor;
		if (generation?.cancelled)
			throw new DOMException('Queued generation cancelled by Stop', 'AbortError');
		if (generation) generation.started = true;
		return await operation();
	} finally {
		if (generation) {
			// Also unblock Stop if startup returned or failed before a controller existed.
			generation.releaseReady();
			const pending = queuedGenerations.get(conversationId);
			pending?.delete(generation);
			if (!pending?.size) queuedGenerations.delete(conversationId);
		}
		const remaining = (writers.get(conversationId) ?? 1) - 1;
		if (remaining) writers.set(conversationId, remaining);
		else writers.delete(conversationId);
		releaseSlot?.();
		if (replacement) {
			replacement.pending--;
			cleanupQueue(conversationId, replacement);
		}
	}
}

export function hasConversationWriters(conversationId: string): boolean {
	return writers.has(conversationId);
}

export function conversationWriterSnapshot(conversationId: string) {
	const revision = revisions.get(conversationId);
	return () => !writers.has(conversationId) && revisions.get(conversationId) === revision;
}

/** A very short exclusive section around CAS + local publication, never the LLM request. */
export async function withVisualizationReplacement(
	conversationId: string,
	isIdle: () => boolean,
	operation: () => Promise<void>
) {
	if (replacements.has(conversationId) || !isIdle()) throw new Error('Conversation is busy');
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const queue: ReplacementQueue = {
		casActive: true,
		pending: 0,
		released,
		tail: released
	};
	replacements.set(conversationId, queue);
	try {
		await operation();
	} finally {
		queue.casActive = false;
		release();
		cleanupQueue(conversationId, queue);
	}
}
