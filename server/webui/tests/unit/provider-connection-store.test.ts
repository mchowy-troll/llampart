import { describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { ProviderConnectionStore } from '$lib/stores/provider-connection.svelte';

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('provider connection store', () => {
	it('keeps the disconnected notice state while a single retry is running', async () => {
		const store = new ProviderConnectionStore();
		const source = {
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'http://localhost:8080',
			apiKey: ''
		};

		await store.check(source, vi.fn().mockResolvedValue(jsonResponse({}, 503)));
		expect(store.status).toBe('disconnected');
		expect(store.hasDisconnected).toBe(true);

		let resolveFetch!: (response: Response) => void;
		const retryFetch = vi.fn(
			() => new Promise<Response>((resolve) => (resolveFetch = resolve))
		) as unknown as typeof fetch;
		const firstRetry = store.check(source, retryFetch);
		const duplicateRetry = store.check(source, retryFetch);

		expect(firstRetry).toBe(duplicateRetry);
		expect(store.status).toBe('checking');
		expect(store.hasDisconnected).toBe(true);
		expect(retryFetch).toHaveBeenCalledTimes(1);

		resolveFetch(jsonResponse({ default_generation_settings: {}, build_info: {} }));
		await firstRetry;

		expect(store.status).toBe('connected');
		expect(store.hasDisconnected).toBe(false);
	});

	it('validates OpenAI-compatible sources through their provider adapter', async () => {
		const store = new ProviderConnectionStore();
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ object: 'list', data: [{ id: 'model-a', object: 'model' }] })
			);

		await store.check(
			{
				providerId: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				serverBaseUrl: 'https://api.example.test/v1',
				apiKey: 'secret'
			},
			fetchMock
		);

		expect(store.status).toBe('connected');
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.example.test/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer secret' })
			})
		);
	});
});
