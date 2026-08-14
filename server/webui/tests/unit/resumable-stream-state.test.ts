import { describe, expect, it } from 'vitest';
import { RESUMABLE_STREAMS_LOCALSTORAGE_KEY } from '$lib/constants/localstorage-keys';
import {
	RESUMABLE_STREAM_STATE_TTL_MS,
	getResumableStreamState,
	loadResumableStreamStates,
	removeResumableStreamState,
	saveResumableStreamState,
	type ResumableStreamState
} from '$lib/utils/resumable-stream-state';

function createStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	};
}

describe('resumable stream state storage', () => {
	it('stores the exact resumable fields and replaces state per conversation', () => {
		const storage = createStorage();
		const initial: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-1',
			assistantMessageId: 'assistant-1',
			providerId: 'llama-server',
			sourceFingerprint: 'sha256:source-a',
			streamIdentity: 'stream-1',
			model: 'org/repo/model',
			bytesReceived: 0,
			updatedAt: 10
		};

		saveResumableStreamState(initial, storage, 10);
		saveResumableStreamState({ ...initial, bytesReceived: 42, updatedAt: 20 }, storage, 20);

		expect(getResumableStreamState('chat-1', storage, 20)).toEqual({
			schemaVersion: 2,
			conversationId: 'chat-1',
			assistantMessageId: 'assistant-1',
			providerId: 'llama-server',
			sourceFingerprint: 'sha256:source-a',
			streamIdentity: 'stream-1',
			model: 'org/repo/model',
			bytesReceived: 42,
			updatedAt: 20
		});
		expect(Object.keys(loadResumableStreamStates(storage, 20)[0]).sort()).toEqual(
			[
				'schemaVersion',
				'conversationId',
				'assistantMessageId',
				'providerId',
				'sourceFingerprint',
				'streamIdentity',
				'model',
				'bytesReceived',
				'updatedAt'
			].sort()
		);

		removeResumableStreamState('chat-1', storage);
		expect(storage.getItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY)).toBeNull();
	});

	it('ignores malformed persisted data', () => {
		const storage = createStorage();
		storage.setItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY, '{bad json');
		expect(loadResumableStreamStates(storage)).toEqual([]);
	});

	it('rejects v1 and expired state and removes it from storage', () => {
		const storage = createStorage();
		storage.setItem(
			RESUMABLE_STREAMS_LOCALSTORAGE_KEY,
			JSON.stringify([
				{
					conversationId: 'v1',
					streamIdentity: 'legacy',
					model: null,
					bytesReceived: 0,
					updatedAt: 100
				},
				{
					schemaVersion: 2,
					conversationId: 'expired',
					assistantMessageId: 'assistant-expired',
					providerId: 'llama-server',
					sourceFingerprint: 'sha256:old',
					streamIdentity: 'old',
					model: null,
					bytesReceived: 0,
					updatedAt: 100
				}
			])
		);

		expect(loadResumableStreamStates(storage, 101 + RESUMABLE_STREAM_STATE_TTL_MS)).toEqual([]);
		expect(storage.getItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY)).toBeNull();
	});
});
