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
	it('keeps the latest source when switching A → B → A during a probe', async () => {
		const store = new ProviderConnectionStore();
		const a = {
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'http://a.test',
			apiKey: ''
		};
		const b = { ...a, providerId: API_PROVIDER_IDS.VLLM };
		let resolve!: (response: Response) => void;
		const slow = vi.fn(
			() =>
				new Promise<Response>((done) => {
					resolve = done;
				})
		);
		const skipped = vi.fn().mockResolvedValue(jsonResponse({}, 401));
		const latest = vi
			.fn()
			.mockResolvedValue(jsonResponse({ default_generation_settings: {}, build_info: {} }));
		const running = store.check(a, slow);
		void store.check(b, skipped);
		void store.check(a, latest);
		resolve(jsonResponse({}, 503));
		await running;
		expect(skipped).not.toHaveBeenCalled();
		expect(latest).toHaveBeenCalledTimes(1);
		expect(store.status).toBe('connected');
		expect(store.hasDisconnected).toBe(false);
	});
	// Cover both error shapes: llama-server HTTP status and OpenAI-family discovery errors.
	// vLLM shares the latter validator and is also exercised by the source-switch tests.
	it.each([API_PROVIDER_IDS.LLAMA_SERVER, API_PROVIDER_IDS.OPENAI_COMPATIBLE])(
		'distinguishes offline/authentication and recovers for %s',
		async (providerId) => {
			const store = new ProviderConnectionStore();
			const source = { providerId, serverBaseUrl: 'http://localhost:8080', apiKey: '' };
			await store.check(source, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
			expect(store.hasDisconnected).toBe(true);
			expect(store.authenticationError).toBe(false);
			for (const status of [401, 403]) {
				await store.check(source, vi.fn().mockResolvedValue(jsonResponse({}, status)));
				expect(store.authenticationError).toBe(true);
			}
			await store.check(
				source,
				vi
					.fn()
					.mockResolvedValue(
						jsonResponse(
							providerId === API_PROVIDER_IDS.LLAMA_SERVER
								? { default_generation_settings: {}, build_info: {} }
								: { object: 'list', data: [{ id: 'model-a' }] }
						)
					)
			);
			expect(store.status).toBe('connected');
			expect(store.hasDisconnected).toBe(false);
			expect(store.authenticationError).toBe(false);
		}
	);

	it('does not show a previous provider failure while validating a new source', async () => {
		const store = new ProviderConnectionStore();
		const oldSource = {
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'http://old.test',
			apiKey: ''
		};
		await store.check(oldSource, vi.fn().mockResolvedValue(jsonResponse({}, 401)));
		let resolve!: (response: Response) => void;
		const pending = store.check(
			{ ...oldSource, providerId: API_PROVIDER_IDS.VLLM },
			vi.fn(
				() =>
					new Promise<Response>((done) => {
						resolve = done;
					})
			)
		);
		expect(store.hasDisconnected).toBe(false);
		expect(store.authenticationError).toBe(false);
		resolve(jsonResponse({ object: 'list', data: [{ id: 'vllm-model' }] }));
		await pending;
		expect(store.status).toBe('connected');
	});
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
			'/__llampart/api/openai-compatible/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer secret' })
			})
		);
	});
});
