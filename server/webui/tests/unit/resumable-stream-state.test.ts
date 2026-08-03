import { describe, expect, it } from 'vitest';
import { RESUMABLE_STREAMS_LOCALSTORAGE_KEY } from '$lib/constants/localstorage-keys';
import {
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
			conversationId: 'chat-1',
			streamIdentity: 'stream-1',
			model: 'org/repo/model',
			bytesReceived: 0,
			updatedAt: 10
		};

		saveResumableStreamState(initial, storage);
		saveResumableStreamState({ ...initial, bytesReceived: 42, updatedAt: 20 }, storage);

		expect(getResumableStreamState('chat-1', storage)).toEqual({
			conversationId: 'chat-1',
			streamIdentity: 'stream-1',
			model: 'org/repo/model',
			bytesReceived: 42,
			updatedAt: 20
		});
		expect(Object.keys(loadResumableStreamStates(storage)[0]).sort()).toEqual(
			['conversationId', 'streamIdentity', 'model', 'bytesReceived', 'updatedAt'].sort()
		);

		removeResumableStreamState('chat-1', storage);
		expect(storage.getItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY)).toBeNull();
	});

	it('ignores malformed persisted data', () => {
		const storage = createStorage();
		storage.setItem(RESUMABLE_STREAMS_LOCALSTORAGE_KEY, '{bad json');
		expect(loadResumableStreamStates(storage)).toEqual([]);
	});
});
