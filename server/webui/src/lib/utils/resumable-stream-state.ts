import { RESUMABLE_STREAMS_LOCALSTORAGE_KEY } from '$lib/constants/localstorage-keys';

export interface ResumableStreamState {
	conversationId: string;
	streamIdentity: string;
	model: string | null;
	bytesReceived: number;
	updatedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getBrowserStorage(): StorageLike | null {
	return typeof localStorage === 'undefined' ? null : localStorage;
}

function isResumableStreamState(value: unknown): value is ResumableStreamState {
	if (!value || typeof value !== 'object') return false;
	const state = value as Record<string, unknown>;

	return (
		typeof state.conversationId === 'string' &&
		typeof state.streamIdentity === 'string' &&
		(typeof state.model === 'string' || state.model === null) &&
		typeof state.bytesReceived === 'number' &&
		Number.isSafeInteger(state.bytesReceived) &&
		state.bytesReceived >= 0 &&
		typeof state.updatedAt === 'number'
	);
}

export function loadResumableStreamStates(storage = getBrowserStorage()): ResumableStreamState[] {
	if (!storage) return [];

	try {
		const parsed: unknown = JSON.parse(storage.getItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter(isResumableStreamState) : [];
	} catch {
		return [];
	}
}

export function saveResumableStreamState(
	state: ResumableStreamState,
	storage = getBrowserStorage()
): void {
	if (!storage) return;
	const states = loadResumableStreamStates(storage).filter(
		(item) => item.conversationId !== state.conversationId
	);
	states.push(state);
	storage.setItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY, JSON.stringify(states));
}

export function getResumableStreamState(
	conversationId: string,
	storage = getBrowserStorage()
): ResumableStreamState | null {
	return (
		loadResumableStreamStates(storage).find((state) => state.conversationId === conversationId) ??
		null
	);
}

export function removeResumableStreamState(
	conversationId: string,
	storage = getBrowserStorage()
): void {
	if (!storage) return;
	const states = loadResumableStreamStates(storage).filter(
		(state) => state.conversationId !== conversationId
	);

	if (states.length === 0) storage.removeItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY);
	else storage.setItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY, JSON.stringify(states));
}
