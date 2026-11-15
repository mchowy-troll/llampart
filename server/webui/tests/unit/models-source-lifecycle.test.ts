import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { ServerModelStatus, ServerRole } from '$lib/enums';
import { ModelsService } from '$lib/services/models.service';
import { PropsService } from '$lib/services/props.service';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/backend.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import type { ProviderConnectionContext } from '$lib/types/provider';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function setSource(serverBaseUrl: string, apiKey: string): void {
	settingsStore.updateMultipleConfig({
		apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
		serverBaseUrl,
		apiKey
	});
}

function list(...ids: string[]): ApiModelListResponse {
	return {
		object: 'list',
		data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'test' }))
	} as ApiModelListResponse;
}

function routerList(id: string, status = ServerModelStatus.LOADED): ApiRouterModelsListResponse {
	return {
		data: [{ id, status: { value: status } }]
	} as ApiRouterModelsListResponse;
}

const originalConfig = { ...settingsStore.config };

beforeEach(() => {
	modelsStore.resetAllModelState();
	serverStore.clear();
	serverStore.role = ServerRole.ROUTER;
	serverStore.props = {} as ApiLlamaCppServerProps;
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	settingsStore.config = { ...originalConfig };
	modelsStore.resetAllModelState();
	serverStore.clear();
	vi.restoreAllMocks();
});

describe('source-bound model metadata', () => {
	it('shares one pending props request between callers for the same model', async () => {
		setSource('https://a.example.test', 'key-a');
		modelsStore.models = [{ id: 'model-a', model: 'model-a', name: 'A' } as ModelOption];
		modelsStore.routerModels = routerList('model-a').data;
		const pending = deferred<ApiLlamaCppServerProps>();
		const fetchProps = vi.spyOn(PropsService, 'fetchForModel').mockReturnValue(pending.promise);
		const props = { model_alias: 'model-a' } as ApiLlamaCppServerProps;

		const first = modelsStore.fetchModelProps('model-a');
		const second = modelsStore.fetchModelProps('model-a');
		pending.resolve(props);

		await expect(Promise.all([first, second])).resolves.toEqual([props, props]);
		expect(fetchProps).toHaveBeenCalledTimes(1);
	});

	it('keeps video in model modalities', async () => {
		setSource('https://a.example.test', 'key-a');
		modelsStore.models = [{ id: 'model-a', model: 'model-a', name: 'A' } as ModelOption];
		modelsStore.routerModels = routerList('model-a').data;
		vi.spyOn(PropsService, 'fetchForModel').mockResolvedValue({
			modalities: { vision: false, audio: false, video: true }
		} as ApiLlamaCppServerProps);

		await modelsStore.fetchModalitiesForLoadedModels();
		expect(modelsStore.getModelModalities('model-a')).toEqual({
			vision: false,
			audio: false,
			video: true
		});
	});

	it('does not commit late router metadata from an old source', async () => {
		const requestA = deferred<ApiRouterModelsListResponse>();
		const requestB = deferred<ApiRouterModelsListResponse>();
		const contexts: ProviderConnectionContext[] = [];
		vi.spyOn(ModelsService, 'listRouter').mockImplementation((context) => {
			contexts.push(context);
			return context.serverBaseUrl.includes('a.example') ? requestA.promise : requestB.promise;
		});
		vi.spyOn(PropsService, 'fetchForModel').mockRejectedValue(new Error('not needed'));

		setSource('https://a.example.test', 'key-a');
		modelsStore.models = [{ id: 'model-a', model: 'model-a', name: 'A' } as ModelOption];
		const fetchA = modelsStore.fetchRouterModels();
		modelsStore.clear();
		serverStore.role = ServerRole.ROUTER;
		setSource('https://b.example.test', 'key-b');
		modelsStore.models = [{ id: 'model-b', model: 'model-b', name: 'B' } as ModelOption];
		const fetchB = modelsStore.fetchRouterModels();

		requestB.resolve(routerList('model-b'));
		await fetchB;
		requestA.resolve(routerList('model-a'));
		await fetchA;

		expect(contexts.map((context) => context.serverBaseUrl)).toEqual([
			'https://a.example.test',
			'https://b.example.test'
		]);
		expect(modelsStore.routerModels.map((model) => model.id)).toEqual(['model-b']);
		expect(modelsStore.hasRouterMetadataForCurrentSource).toBe(true);
	});

	it('preserves per-source selection without exposing raw API keys in source keys', async () => {
		vi.spyOn(ModelsService, 'list').mockImplementation(async (context) =>
			context.serverBaseUrl.includes('a.example') ? list('model-a') : list('model-b')
		);

		setSource('https://a.example.test', 'RAW-KEY-A');
		await modelsStore.fetch();
		await modelsStore.selectModelById('model-a');
		expect(modelsStore.modelListSourceKey).not.toContain('RAW-KEY-A');

		modelsStore.clear();
		serverStore.role = ServerRole.ROUTER;
		setSource('https://b.example.test', 'RAW-KEY-B');
		await modelsStore.fetch();
		await modelsStore.selectModelById('model-b');
		expect(modelsStore.modelListSourceKey).not.toContain('RAW-KEY-B');

		modelsStore.clear();
		serverStore.role = ServerRole.ROUTER;
		setSource('https://a.example.test', 'RAW-KEY-A');
		await modelsStore.fetch();

		expect(modelsStore.selectedModelId).toBe('model-a');
	});

	it('aborts load polling on source switch and never polls the replacement source', async () => {
		setSource('https://a.example.test', 'key-a');
		modelsStore.models = [{ id: 'model-a', model: 'model-a', name: 'A' } as ModelOption];
		modelsStore.routerModels = routerList('model-a', ServerModelStatus.UNLOADED).data;
		const load = deferred<ApiRouterModelsLoadResponse>();
		let capturedSignal: AbortSignal | undefined;
		vi.spyOn(ModelsService, 'load').mockImplementation((_context, _modelId, _extra, signal) => {
			capturedSignal = signal;
			return load.promise;
		});
		const listRouter = vi.spyOn(ModelsService, 'listRouter');

		const operation = modelsStore.loadModel('model-a');
		modelsStore.clear();
		serverStore.role = ServerRole.ROUTER;
		setSource('https://b.example.test', 'key-b');
		load.resolve({ success: true } as ApiRouterModelsLoadResponse);

		await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
		expect(capturedSignal?.aborted).toBe(true);
		expect(listRouter).not.toHaveBeenCalled();
	});
});
