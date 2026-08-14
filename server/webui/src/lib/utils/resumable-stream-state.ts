import { RESUMABLE_STREAMS_LOCALSTORAGE_KEY } from '$lib/constants/localstorage-keys';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import type { ProviderConnectionContext } from '$lib/types/provider';
import { normalizeProviderBaseUrl } from '$lib/services/providers/provider-url';

export interface ResumableStreamState {
	schemaVersion: 2;
	conversationId: string;
	assistantMessageId: string;
	providerId: typeof API_PROVIDER_IDS.LLAMA_SERVER;
	sourceFingerprint: string;
	streamIdentity: string;
	model: string | null;
	bytesReceived: number;
	updatedAt: number;
}

export const RESUMABLE_STREAM_STATE_TTL_MS = 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getBrowserStorage(): StorageLike | null {
	return typeof localStorage === 'undefined' ? null : localStorage;
}

function isResumableStreamState(value: unknown): value is ResumableStreamState {
	if (!value || typeof value !== 'object') return false;
	const state = value as Record<string, unknown>;

	return (
		state.schemaVersion === 2 &&
		typeof state.conversationId === 'string' &&
		typeof state.assistantMessageId === 'string' &&
		state.assistantMessageId.length > 0 &&
		state.providerId === API_PROVIDER_IDS.LLAMA_SERVER &&
		typeof state.sourceFingerprint === 'string' &&
		state.sourceFingerprint.length > 0 &&
		typeof state.streamIdentity === 'string' &&
		(typeof state.model === 'string' || state.model === null) &&
		typeof state.bytesReceived === 'number' &&
		Number.isSafeInteger(state.bytesReceived) &&
		state.bytesReceived >= 0 &&
		typeof state.updatedAt === 'number'
	);
}

function persistStates(states: ResumableStreamState[], storage: StorageLike): void {
	if (states.length === 0) storage.removeItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY);
	else storage.setItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY, JSON.stringify(states));
}

export async function createSourceFingerprint(context: ProviderConnectionContext): Promise<string> {
	const source = JSON.stringify([
		context.providerId,
		normalizeProviderBaseUrl(context.serverBaseUrl),
		context.apiKey
	]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
	return `sha256:${hex}`;
}

export function loadResumableStreamStates(
	storage = getBrowserStorage(),
	now = Date.now()
): ResumableStreamState[] {
	if (!storage) return [];

	try {
		const parsed: unknown = JSON.parse(storage.getItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY) ?? '[]');
		if (!Array.isArray(parsed)) {
			persistStates([], storage);
			return [];
		}
		const states = parsed.filter(
			(value): value is ResumableStreamState =>
				isResumableStreamState(value) &&
				now - value.updatedAt >= 0 &&
				now - value.updatedAt <= RESUMABLE_STREAM_STATE_TTL_MS
		);
		if (states.length !== parsed.length) persistStates(states, storage);
		return states;
	} catch {
		storage.removeItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY);
		return [];
	}
}

export function saveResumableStreamState(
	state: ResumableStreamState,
	storage = getBrowserStorage(),
	now = Date.now()
): void {
	if (!storage) return;
	const states = loadResumableStreamStates(storage, now).filter(
		(item) => item.conversationId !== state.conversationId
	);
	states.push(state);
	storage.setItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY, JSON.stringify(states));
}

export function getResumableStreamState(
	conversationId: string,
	storage = getBrowserStorage(),
	now = Date.now()
): ResumableStreamState | null {
	return (
		loadResumableStreamStates(storage, now).find(
			(state) => state.conversationId === conversationId
		) ?? null
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

	persistStates(states, storage);
}
