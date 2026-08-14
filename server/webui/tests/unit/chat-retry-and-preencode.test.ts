import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { ChatService } from '$lib/services/chat.service';
import { getReconnectDelay, sleepWithAbort } from '$lib/utils/retry';
import { settingsStore } from '$lib/stores/settings.svelte';

const originalConfig = { ...settingsStore.config };

afterEach(() => {
	settingsStore.config = { ...originalConfig };
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('chat reconnect policy', () => {
	it('uses deterministic bounded exponential backoff with jitter', () => {
		expect(getReconnectDelay(0, () => 0)).toBe(200);
		expect(getReconnectDelay(1, () => 0.5)).toBe(500);
		expect(getReconnectDelay(2, () => 1)).toBe(1200);
		expect(getReconnectDelay(20, () => 1)).toBe(4000);
	});

	it('removes the abort listener when sleep completes normally', async () => {
		const controller = new AbortController();
		const add = vi.spyOn(controller.signal, 'addEventListener');
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		let callback: (() => void) | undefined;

		const sleeping = sleepWithAbort(250, controller.signal, {
			setTimeout: (fn) => {
				callback = fn;
				return 1;
			},
			clearTimeout: vi.fn()
		});
		callback?.();

		await expect(sleeping).resolves.toBe(true);
		expect(add).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it('clears the timeout and listener when aborted', async () => {
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		const clearTimeout = vi.fn();
		const sleeping = sleepWithAbort(250, controller.signal, {
			setTimeout: () => 1,
			clearTimeout
		});

		controller.abort();

		await expect(sleeping).resolves.toBe(false);
		expect(clearTimeout).toHaveBeenCalledWith(1);
		expect(remove).toHaveBeenCalledTimes(1);
	});
});

describe('pre-encode response status', () => {
	it('reports a rejected HTTP response instead of treating it as success', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://source.example.test',
			apiKey: 'secret'
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ error: { message: 'pre-encode denied' } }), {
					status: 403,
					statusText: 'Forbidden'
				})
			)
		);

		await ChatService.preEncode(
			[{ role: 'user', content: 'history' } as ApiChatMessageData],
			ChatService.createProviderRequestContext()
		);

		expect(warning).toHaveBeenCalledWith(
			'[ChatService] Pre-encode request failed:',
			expect.objectContaining({ message: 'pre-encode denied' })
		);
	});
});
