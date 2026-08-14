import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { ChatService } from '$lib/services/chat.service';
import { settingsStore } from '$lib/stores/settings.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

const originalConfig = { ...settingsStore.config };

afterEach(() => {
	settingsStore.config = { ...originalConfig };
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('chat provider request context', () => {
	it('freezes source A and turns a deferred slots result into a no-op after switching to B', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://a.example.test/',
			apiKey: 'key-a'
		});
		const context = ChatService.createProviderRequestContext();
		expect(Object.isFrozen(context)).toBe(true);

		const slotsResponse = deferred<Response>();
		const fetchMock = vi.fn(() => slotsResponse.promise);
		vi.stubGlobal('fetch', fetchMock);
		const slots = ChatService.areAllSlotsIdle(context, 'model-a');

		expect(fetchMock).toHaveBeenCalledWith(
			'https://a.example.test/slots?model=model-a',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer key-a' })
			})
		);

		settingsStore.updateMultipleConfig({
			serverBaseUrl: 'https://b.example.test',
			apiKey: 'key-b'
		});
		ChatService.invalidateProviderRequestContexts();
		slotsResponse.resolve(
			new Response(JSON.stringify([{ is_processing: false }]), { status: 200 })
		);

		await expect(slots).resolves.toBe(false);
		await ChatService.preEncode(
			[{ role: 'user', content: 'history from A' } as ApiChatMessageData],
			context,
			'model-a'
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('fails closed when slots returns an auth error', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://a.example.test',
			apiKey: 'key-a'
		});
		const context = ChatService.createProviderRequestContext();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

		await expect(ChatService.areAllSlotsIdle(context)).resolves.toBe(false);
	});
});
