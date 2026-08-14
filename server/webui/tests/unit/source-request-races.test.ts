import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { ServerRole } from '$lib/enums';
import { ModelsService } from '$lib/services/models.service';
import { PropsService } from '$lib/services/props.service';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { ProviderConnectionContext } from '$lib/types/provider';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
}

function source(
	providerId: ProviderConnectionContext['providerId'],
	serverBaseUrl: string,
	apiKey: string
): ProviderConnectionContext {
	return Object.freeze({ providerId, serverBaseUrl, apiKey });
}

function setSource(context: ProviderConnectionContext): void {
	settingsStore.updateMultipleConfig({
		apiProvider: context.providerId,
		serverBaseUrl: context.serverBaseUrl,
		apiKey: context.apiKey
	});
}

function modelList(id: string): ApiModelListResponse {
	return {
		object: 'list',
		data: [{ id, object: 'model', created: 0, owned_by: 'test' }]
	} as ApiModelListResponse;
}

function props(role: ServerRole, marker: string): ApiLlamaCppServerProps {
	return {
		role,
		model_alias: marker,
		default_generation_settings: { n_ctx: 4096, params: {} }
	} as ApiLlamaCppServerProps;
}

const originalConfig = { ...settingsStore.config };

beforeEach(() => {
	modelsStore.clear();
	serverStore.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.config = { ...originalConfig };
	modelsStore.clear();
	serverStore.clear();
});

describe('source-bound model requests', () => {
	it('keeps provider A bound to URL and key A while the live config points at B', async () => {
		const sourceA = source(
			API_PROVIDER_IDS.OPENAI_COMPATIBLE,
			'https://a.example.test/v1',
			'key-a'
		);
		const sourceB = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://b.example.test', 'key-b');
		const response = deferred<Response>();
		const fetchMock = vi.fn(() => response.promise);
		vi.stubGlobal('fetch', fetchMock);
		setSource(sourceB);

		const request = ModelsService.list(sourceA);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://a.example.test/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer key-a' })
			})
		);

		response.resolve(
			new Response(JSON.stringify(modelList('model-a')), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		await expect(request).resolves.toEqual(modelList('model-a'));
	});

	it('commits B-fast and ignores the late A-slow model response after clear', async () => {
		const sourceA = source(API_PROVIDER_IDS.OPENAI_COMPATIBLE, 'https://a.example.test', 'key-a');
		const sourceB = source(API_PROVIDER_IDS.OPENAI_COMPATIBLE, 'https://b.example.test', 'key-b');
		const requestA = deferred<ApiModelListResponse>();
		const requestB = deferred<ApiModelListResponse>();
		const contexts: ProviderConnectionContext[] = [];

		vi.spyOn(ModelsService, 'list').mockImplementation((context) => {
			contexts.push(context);
			return context.serverBaseUrl === sourceA.serverBaseUrl ? requestA.promise : requestB.promise;
		});

		setSource(sourceA);
		const fetchA = modelsStore.fetch();
		modelsStore.clear();
		setSource(sourceB);
		const fetchB = modelsStore.fetch();

		requestB.resolve(modelList('model-b'));
		await fetchB;
		requestA.resolve(modelList('model-a'));
		await fetchA;

		expect(contexts).toEqual([sourceA, sourceB]);
		expect(modelsStore.models.map((model) => model.id)).toEqual(['model-b']);
		expect(modelsStore.selectedModelId).toBe('model-b');
		expect(modelsStore.error).toBeNull();
		expect(modelsStore.loading).toBe(false);
	});

	it('does not let request A finally clear request B loading state', async () => {
		const sourceA = source(API_PROVIDER_IDS.OPENAI_COMPATIBLE, 'https://a.example.test', 'key-a');
		const sourceB = source(API_PROVIDER_IDS.OPENAI_COMPATIBLE, 'https://b.example.test', 'key-b');
		const requestA = deferred<ApiModelListResponse>();
		const requestB = deferred<ApiModelListResponse>();
		const list = vi
			.spyOn(ModelsService, 'list')
			.mockImplementation((context) =>
				context.serverBaseUrl === sourceA.serverBaseUrl ? requestA.promise : requestB.promise
			);

		setSource(sourceA);
		const fetchA = modelsStore.fetch();
		modelsStore.clear();
		setSource(sourceB);
		const fetchB = modelsStore.fetch();

		requestA.resolve(modelList('model-a'));
		await fetchA;

		expect(modelsStore.loading).toBe(true);
		expect(modelsStore.fetch()).toBe(fetchB);
		expect(list).toHaveBeenCalledTimes(2);

		requestB.resolve(modelList('model-b'));
		await fetchB;
	});
});

describe('source-bound server props requests', () => {
	it('uses the frozen URL and key instead of the current config', async () => {
		const sourceA = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://a.example.test', 'key-a');
		const sourceB = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://b.example.test', 'key-b');
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(props(ServerRole.MODEL, 'server-a')), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		setSource(sourceB);

		await PropsService.fetch(sourceA);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://a.example.test/props?autoload=false',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer key-a' })
			})
		);
	});

	it('commits B-fast and ignores the late A-slow props response after clear', async () => {
		const sourceA = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://a.example.test', 'key-a');
		const sourceB = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://b.example.test', 'key-b');
		const requestA = deferred<ApiLlamaCppServerProps>();
		const requestB = deferred<ApiLlamaCppServerProps>();
		const contexts: ProviderConnectionContext[] = [];

		vi.spyOn(console, 'info').mockImplementation(() => undefined);
		vi.spyOn(PropsService, 'fetch').mockImplementation((context) => {
			contexts.push(context);
			return context.serverBaseUrl === sourceA.serverBaseUrl ? requestA.promise : requestB.promise;
		});

		setSource(sourceA);
		const fetchA = serverStore.fetch();
		serverStore.clear();
		setSource(sourceB);
		const fetchB = serverStore.fetch();

		const propsB = props(ServerRole.ROUTER, 'server-b');
		requestB.resolve(propsB);
		await fetchB;
		requestA.resolve(props(ServerRole.MODEL, 'server-a'));
		await fetchA;

		expect(contexts).toEqual([sourceA, sourceB]);
		expect(serverStore.props).toBe(propsB);
		expect(serverStore.role).toBe(ServerRole.ROUTER);
		expect(serverStore.error).toBeNull();
		expect(serverStore.loading).toBe(false);
	});

	it('does not let request A finally clear request B promise or loading state', async () => {
		const sourceA = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://a.example.test', 'key-a');
		const sourceB = source(API_PROVIDER_IDS.LLAMA_SERVER, 'https://b.example.test', 'key-b');
		const requestA = deferred<ApiLlamaCppServerProps>();
		const requestB = deferred<ApiLlamaCppServerProps>();
		const fetchProps = vi
			.spyOn(PropsService, 'fetch')
			.mockImplementation((context) =>
				context.serverBaseUrl === sourceA.serverBaseUrl ? requestA.promise : requestB.promise
			);
		vi.spyOn(console, 'info').mockImplementation(() => undefined);

		setSource(sourceA);
		const fetchA = serverStore.fetch();
		serverStore.clear();
		setSource(sourceB);
		const fetchB = serverStore.fetch();

		requestA.resolve(props(ServerRole.MODEL, 'server-a'));
		await fetchA;

		expect(serverStore.loading).toBe(true);
		expect(serverStore.fetch()).toBe(fetchB);
		expect(fetchProps).toHaveBeenCalledTimes(2);

		requestB.resolve(props(ServerRole.ROUTER, 'server-b'));
		await fetchB;
	});
});
