import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsService } from '$lib/services/models.service';
import { PropsService } from '$lib/services/props.service';
import { ChatService } from '$lib/services/chat.service';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/backend.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { backendIdentity } from '$lib/utils/backend-identity';
import * as capabilities from '$lib/services/providers/provider-capabilities';

const originalConfig = { ...settingsStore.config };
function props(version = 'A', router = false) {
	return {
		build_info: 'synthetic-build',
		role: router ? 'router' : 'model',
		model_alias: 'same-alias',
		model_path: `/synthetic/${version}.gguf`,
		chat_template: `synthetic-template-${version}`,
		chat_template_caps: { supports_tool_calls: version === 'B' },
		default_generation_settings: { n_ctx: version === 'B' ? 16384 : 8192, params: {} },
		modalities: { vision: version === 'B' }
	} as unknown as ApiLlamaCppServerProps;
}
function catalog(vision = false) {
	return {
		object: 'list',
		data: [
			{ id: 'same-alias', status: { value: 'loaded' }, capabilities: { vision, tools: vision } }
		]
	} as unknown as ApiModelListResponse;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
beforeEach(() => {
	modelsStore.resetAllModelState();
	serverStore.clear();
	settingsStore.updateMultipleConfig({
		apiProvider: 'llama-server',
		serverBaseUrl: 'http://synthetic.test',
		apiKey: 'synthetic-key'
	});
	vi.spyOn(PropsService, 'fetch').mockResolvedValue(props());
	vi.spyOn(PropsService, 'fetchForModel').mockResolvedValue(props());
	vi.spyOn(ModelsService, 'list').mockResolvedValue(catalog());
	vi.spyOn(ModelsService, 'listRouter').mockResolvedValue(catalog());
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	settingsStore.config = { ...originalConfig };
	modelsStore.resetAllModelState();
	serverStore.clear();
	ChatService.invalidateProviderRequestContexts();
});
const context = () => ChatService.createProviderRequestContext();
async function bind(model: string | null = null) {
	return modelsStore.refreshCapabilities(context(), model, true);
}

describe('AUD-011B real freshness barrier (never stub verifyBackend)', () => {
	it('aborts a waiting completion immediately without cancelling shared metadata verification', async () => {
		await bind();
		const gate = deferred<ApiLlamaCppServerProps>(),
			ready = deferred<void>();
		vi.mocked(PropsService.fetch).mockImplementationOnce(async () => {
			ready.resolve();
			return gate.promise;
		});
		const io = vi.fn();
		vi.stubGlobal('fetch', io);
		const controller = new AbortController(),
			onError = vi.fn();
		const pending = ChatService.sendMessage(
			[{ role: 'user', content: 'synthetic' }],
			{
				stream: false,
				onError
			},
			undefined,
			controller.signal
		);
		await ready.promise;
		controller.abort();
		await pending;
		expect(io).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		gate.resolve(props());
		await modelsStore.verifyBackend(context(), null);
	});
	it('does not invalidate the native MODEL snapshot when syncing a historical display name', async () => {
		await modelsStore.refreshBackend();
		const snapshot = modelsStore.capabilitySnapshot;
		expect(snapshot?.model).toBeNull();
		modelsStore.selectModelByName('same-alias');
		expect(modelsStore.capabilitySnapshot).toBe(snapshot);
	});
	it('keeps a populated selector interactive during a background verification', async () => {
		await bind();
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch).mockReturnValueOnce(gate.promise);
		const pending = bind();
		expect(modelsStore.loading).toBe(false);
		expect(serverStore.loading).toBe(false);
		gate.resolve(props());
		await pending;
	});
	it('isolates concurrent router models while coalescing the shared root and catalog check', async () => {
		vi.mocked(PropsService.fetch).mockResolvedValue(props('A', true));
		const list = {
			object: 'list',
			data: ['model-A', 'model-B'].map((id) => ({ id, status: { value: 'loaded' } }))
		} as ApiModelListResponse;
		vi.mocked(ModelsService.list).mockResolvedValue(list);
		vi.mocked(ModelsService.listRouter).mockResolvedValue(list);
		vi.mocked(PropsService.fetchForModel).mockImplementation(async (_context, model) =>
			props(model === 'model-B' ? 'B' : 'A')
		);
		const [a, b] = await Promise.all([bind('model-A'), bind('model-B')]);
		expect(a?.model).toBe('model-A');
		expect(a?.features.vision.state).toBe('unsupported');
		expect(b?.model).toBe('model-B');
		expect(b?.features.vision.state).toBe('supported');
		expect(PropsService.fetch).toHaveBeenCalledTimes(1);
		expect(ModelsService.list).toHaveBeenCalledTimes(1);
	});
	it('drops stale router model props and badges after a forced per-model failure', async () => {
		vi.mocked(PropsService.fetch).mockResolvedValue(props('A', true));
		await bind('same-alias');
		vi.mocked(PropsService.fetchForModel).mockRejectedValue(
			new Error('synthetic per-model failure')
		);
		await expect(bind('same-alias')).rejects.toThrow(/properties unavailable/);
		expect(modelsStore.capabilitySnapshot).toBeNull();
		expect(modelsStore.getModelProps('same-alias')).toBeNull();
		expect(modelsStore.getModelModalities('same-alias')).toBeNull();
	});
	it('rejects late catalog failure from an old source without invalidating current evidence', async () => {
		const gate = deferred<void>(),
			ready = deferred<void>();
		vi.mocked(ModelsService.list)
			.mockImplementationOnce(async () => {
				ready.resolve();
				await gate.promise;
				throw new Error('late catalog failure');
			})
			.mockResolvedValue(catalog(true));
		const late = bind();
		const rejected = expect(late).rejects.toThrow(/source changed/i);
		await ready.promise;
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://second-synthetic.test' });
		modelsStore.clear();
		serverStore.clear();
		ChatService.invalidateProviderRequestContexts();
		vi.mocked(PropsService.fetch).mockResolvedValue(props('B'));
		const next = await bind();
		gate.resolve();
		await rejected;
		expect(modelsStore.error).toBeNull();
		expect(next?.features.vision.state).toBe('supported');
		expect(serverStore.props?.model_path).toBe('/synthetic/B.gguf');
	});
	it.each([
		'model_path',
		'chat_template',
		'build_info',
		'modalities',
		'chat_template_caps'
	] as const)('detects only %s changed under the same alias', async (field) => {
		const first = await bind();
		const next = { ...props(), [field]: props('B')[field] };
		if (field === 'build_info') next.build_info = 'synthetic-build-B';
		vi.mocked(PropsService.fetch).mockResolvedValue(next);
		expect((await bind())?.backendIdentity).not.toBe(first?.backendIdentity);
	});
	it('canonicalizes key order and does not claim to detect an unobservable process restart', () => {
		expect(backendIdentity({ model_path: 'A', modalities: { vision: true, audio: false } })).toBe(
			backendIdentity({ modalities: { audio: false, vision: true }, model_path: 'A' })
		);
	});
	it.each(['props', 'catalog'] as const)(
		'invalidates cached evidence on %s failure and recovers',
		async (failure) => {
			await bind();
			if (failure === 'props')
				vi.mocked(PropsService.fetch).mockRejectedValueOnce(new Error('synthetic offline'));
			else vi.mocked(ModelsService.list).mockRejectedValueOnce(new Error('synthetic offline'));
			await expect(bind()).rejects.toThrow();
			expect(modelsStore.capabilitySnapshot).toBeNull();
			expect(modelsStore.getModelProps('same-alias')).toBeNull();
			expect(modelsStore.getModelModalities('same-alias')).toBeNull();
			vi.mocked(PropsService.fetch).mockResolvedValue(props('B'));
			expect((await bind())?.features.vision.state).toBe('supported');
		}
	);
	it('rejects a vanished router model rather than falling back to the first model', async () => {
		vi.mocked(PropsService.fetch).mockResolvedValue(props('A', true));
		await bind('same-alias');
		vi.mocked(ModelsService.list).mockResolvedValue({
			object: 'list',
			data: [{ id: 'other' }]
		} as ApiModelListResponse);
		await expect(bind('same-alias')).rejects.toThrow(/no longer available/);
	});
	it('forces model props past the TTL even when the router root identity is unchanged', async () => {
		vi.mocked(PropsService.fetch).mockResolvedValue(props('A', true));
		const first = await bind('same-alias');
		vi.mocked(PropsService.fetchForModel).mockResolvedValue(props('B'));
		const second = await bind('same-alias');
		expect(second?.backendIdentity).not.toBe(first?.backendIdentity);
		expect(PropsService.fetchForModel).toHaveBeenCalledTimes(2);
	});
	it.each(['success', 'failure'] as const)(
		'ignores late source A props %s after switching to B',
		async (result) => {
			const gate = deferred<ApiLlamaCppServerProps>();
			vi.mocked(PropsService.fetch)
				.mockImplementationOnce(async () => {
					await gate.promise;
					if (result === 'failure') throw new Error('late A');
					return props('A');
				})
				.mockResolvedValue(props('B'));
			const late = bind();
			const rejected = expect(late).rejects.toThrow(/source changed/i);
			settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://second-synthetic.test' });
			modelsStore.clear();
			serverStore.clear();
			ChatService.invalidateProviderRequestContexts();
			const second = await bind();
			gate.resolve(props());
			await rejected;
			expect(serverStore.props?.model_path).toBe('/synthetic/B.gguf');
			expect(serverStore.error).toBeNull();
			expect(second?.features.vision.state).toBe('supported');
		}
	);
	it('rejects a catalog refresh during asynchronous capability binding', async () => {
		await bind();
		const gate = deferred<void>();
		const ready = deferred<void>();
		const create = capabilities.createCapabilitySnapshot;
		vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
			ready.resolve();
			await gate.promise;
			return create(...args);
		});
		const late = bind();
		const rejected = expect(late).rejects.toThrow(/metadata changed/);
		await ready.promise;
		await modelsStore.fetch(true);
		gate.resolve();
		await rejected;
	});
	it('verifies a catalog-only backend without /props', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'vllm',
			serverBaseUrl: 'http://synthetic.test',
			vllmBaseUrl: 'http://synthetic.test'
		});
		const first = await bind('same-alias');
		vi.mocked(ModelsService.list).mockResolvedValue(catalog(true));
		const next = await bind('same-alias');
		expect(first?.features.vision.state).toBe('unsupported');
		expect(next?.features.vision.state).toBe('supported');
		expect(next?.backendIdentity).not.toBe(first?.backendIdentity);
		expect(PropsService.fetch).not.toHaveBeenCalled();
		expect(PropsService.fetchForModel).not.toHaveBeenCalled();
	});
});
