import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsService } from '$lib/services/models.service';
import { PropsService } from '$lib/services/props.service';
import { ChatService } from '$lib/services/chat.service';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { backendIdentity } from '$lib/utils/backend-identity';
import * as capabilities from '$lib/services/providers/provider-capabilities';

const originalConfig = { ...settingsStore.config };
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function props(version = 'A', router = false) {
	return {
		build_info: 'review-synthetic',
		role: router ? 'router' : 'model',
		model_alias: 'same-alias',
		model_path: `/synthetic/${version}.gguf`,
		chat_template: `template-${version}`,
		chat_template_caps: { supports_tool_calls: version === 'B' },
		modalities: { vision: version === 'B' },
		default_generation_settings: { n_ctx: 8192, params: {} }
	} as unknown as ApiLlamaCppServerProps;
}
function catalog(version = 'A') {
	return {
		object: 'list',
		data: ['same-alias', 'other'].map((id) => ({
			id,
			status: { value: 'loaded' },
			capabilities: { vision: version === 'B', tools: version === 'B' },
			meta: { version }
		}))
	} as unknown as ApiModelListResponse;
}
const context = () => ChatService.createProviderRequestContext();
const bind = (model: string | null = null) =>
	modelsStore.refreshCapabilities(context(), model, true);
async function seed(router = false) {
	vi.mocked(PropsService.fetch).mockResolvedValue(props('A', router));
	await bind(router ? 'same-alias' : null);
	if (router) await modelsStore.selectModelById('same-alias');
}
function replaceBackend(router = false) {
	vi.mocked(PropsService.fetch).mockResolvedValue(props('B', router));
	vi.mocked(PropsService.fetchForModel).mockResolvedValue(props('B'));
	vi.mocked(ModelsService.list).mockResolvedValue(catalog('B'));
	vi.mocked(ModelsService.listRouter).mockResolvedValue(catalog('B'));
}
beforeEach(() => {
	modelsStore.resetAllModelState();
	serverStore.clear();
	settingsStore.updateMultipleConfig({
		apiProvider: 'llama-server',
		serverBaseUrl: 'http://review.synthetic',
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

describe('AUD-010 operation-owned model information', () => {
	it.each([false, true])(
		'keeps same-alias A and B evidence separate after mandatory verification (router=%s)',
		async (router) => {
			await seed(router);
			const a = ChatService.captureOperationModel(context(), router ? 'same-alias' : null, null, {
				conversationId: 'synthetic-A'
			});
			const aInfo = await a.modelInfo;
			expect(aInfo?.native?.model_path).toBe('/synthetic/A.gguf');
			replaceBackend(router);
			const b = ChatService.captureOperationModel(context(), router ? 'same-alias' : null, null, {
				conversationId: 'synthetic-B'
			});
			expect((await b.modelInfo)?.native?.chat_template).toBe('template-B');
			expect((await a.modelInfo)?.native?.chat_template).toBe('template-A');
			expect(a.conversationId).toBe('synthetic-A');
			expect(b.conversationId).toBe('synthetic-B');
			expect(JSON.stringify(aInfo)).not.toMatch(
				/synthetic-key|review\.synthetic|connectionIdentity|"raw"/
			);
			serverStore.clear();
			modelsStore.clear();
			expect((await a.modelInfo)?.native?.model_path).toBe('/synthetic/A.gguf');
		}
	);
	it('rejects late metadata from a superseded provider instead of resolving it for a new owner', async () => {
		await seed();
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch).mockReturnValueOnce(gate.promise);
		const a = ChatService.captureOperationModel(context());
		const rejected = expect(a.modelInfo).rejects.toThrow();
		settingsStore.updateMultipleConfig({
			apiProvider: 'vllm',
			vllmBaseUrl: 'http://other.synthetic'
		});
		modelsStore.clear();
		serverStore.clear();
		ChatService.invalidateProviderRequestContexts();
		gate.resolve(props());
		await rejected;
	});
});

describe('final review FRESH (real verification/fetch/ChatService)', () => {
	it('FRESH-01 direct ordinary server props cannot be reused by mandatory catalog verification', async () => {
		await seed();
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch).mockReturnValueOnce(gate.promise);
		const old = serverStore.fetch(context(), true);
		replaceBackend();
		const fresh = await bind();
		gate.resolve(props());
		await old;
		expect(fresh?.features.vision.state).toBe('supported');
		expect(serverStore.props?.model_path).toBe('/synthetic/B.gguf');
		expect(modelsStore.capabilitySnapshot).toEqual(fresh);
	});
	it('FRESH-01/06 ChatService serializes an image only after fresh B, not pending ordinary A', async () => {
		await seed();
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch).mockReturnValueOnce(gate.promise);
		const old = modelsStore.fetch(true, true);
		replaceBackend();
		const io = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: 'synthetic B answer' }, finish_reason: 'stop' }]
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			)
		);
		vi.stubGlobal('fetch', io);
		await ChatService.sendMessage(
			[
				{
					role: 'user',
					content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,SYNTHETIC' } }]
				}
			],
			{ stream: false }
		);
		gate.resolve(props());
		await old;
		expect(io).toHaveBeenCalledTimes(1);
		const body = JSON.parse(io.mock.calls[0][1].body);
		expect(body.messages[0].content[0].type).toBe('image_url');
		expect(body).not.toHaveProperty('reasoning_effort');
		expect(body).not.toHaveProperty('enable_thinking');
		expect(modelsStore.capabilitySnapshot?.features.vision.state).toBe('supported');
	});
	it.each([false, true])(
		'FRESH-01/02 ordinary pending root cannot certify B; late A cannot overwrite B (router=%s)',
		async (router) => {
			await seed(router);
			const old = deferred<ApiLlamaCppServerProps>();
			vi.mocked(PropsService.fetch).mockReturnValueOnce(old.promise);
			const ordinary = modelsStore.fetch(true, true);
			replaceBackend(router);
			const count = vi.mocked(PropsService.fetch).mock.calls.length;
			const operation = bind(router ? 'same-alias' : null);
			try {
				expect(PropsService.fetch).toHaveBeenCalledTimes(count + 1);
				const snapshot = await operation;
				expect(snapshot?.backendIdentity).toBe(
					backendIdentity(router ? props('B') : props('B', router))
				);
				old.resolve(props('A', router));
				await ordinary;
				expect(serverStore.props?.model_path).toBe('/synthetic/B.gguf');
				expect(modelsStore.models[0].meta).toEqual({ version: 'B' });
				expect(modelsStore.capabilitySnapshot).toEqual(snapshot);
			} finally {
				old.resolve(props('A', router));
				await Promise.allSettled([ordinary, operation]);
			}
		}
	);
	it.each(['llama-server', 'vllm', 'openai-compatible'] as const)(
		'FRESH-01/02 pending %s catalog cannot certify B; late catalog A is ignored',
		async (provider) => {
			settingsStore.updateMultipleConfig({
				apiProvider: provider,
				serverBaseUrl: 'http://review.synthetic',
				vllmBaseUrl: 'http://review.synthetic',
				openAiCompatibleBaseUrl: 'http://review.synthetic'
			});
			await seed();
			const gate = deferred<ApiModelListResponse>(),
				started = deferred<void>();
			vi.mocked(ModelsService.list).mockImplementationOnce(() => {
				started.resolve();
				return gate.promise;
			});
			const ordinary = modelsStore.fetch(true, true);
			await started.promise;
			replaceBackend();
			const count = vi.mocked(ModelsService.list).mock.calls.length;
			const propsCount = vi.mocked(PropsService.fetch).mock.calls.length;
			const operation = bind(provider === 'llama-server' ? null : 'same-alias');
			try {
				if (provider === 'llama-server')
					expect(PropsService.fetch).toHaveBeenCalledTimes(propsCount + 1);
				else expect(ModelsService.list).toHaveBeenCalledTimes(count + 1);
				const fresh = await operation;
				expect(ModelsService.list).toHaveBeenCalledTimes(count + 1);
				gate.resolve(catalog('A'));
				await ordinary;
				expect(fresh?.features.vision.state).toBe('supported');
				expect(modelsStore.models[0].meta).toEqual({ version: 'B' });
				expect(modelsStore.capabilitySnapshot).toEqual(fresh);
				if (provider !== 'llama-server') expect(PropsService.fetch).not.toHaveBeenCalled();
			} finally {
				gate.resolve(catalog());
				await Promise.allSettled([ordinary, operation]);
			}
		}
	);
	it('FRESH-03 late rejection of ordinary A does not invalidate the new source B', async () => {
		await seed();
		const gate = deferred<ApiModelListResponse>(),
			ready = deferred<void>();
		vi.mocked(ModelsService.list).mockImplementationOnce(() => {
			ready.resolve();
			return gate.promise;
		});
		const old = modelsStore.fetch(true);
		await ready.promise;
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://second.synthetic' });
		modelsStore.clear();
		serverStore.clear();
		ChatService.invalidateProviderRequestContexts();
		replaceBackend();
		const current = await bind();
		gate.reject(new Error('late ordinary A'));
		await old;
		expect(modelsStore.error).toBeNull();
		expect(serverStore.error).toBeNull();
		expect(modelsStore.capabilitySnapshot).toEqual(current);
		expect(serverStore.props?.model_path).toBe('/synthetic/B.gguf');
	});
	it.each([false, true])(
		'FRESH-04 simultaneous mandatory checks supersede ordinary work once (router=%s)',
		async (router) => {
			await seed(router);
			const old = deferred<ApiLlamaCppServerProps>(),
				fresh = deferred<ApiLlamaCppServerProps>();
			vi.mocked(PropsService.fetch)
				.mockReturnValueOnce(old.promise)
				.mockReturnValueOnce(fresh.promise);
			const ordinary = modelsStore.fetch(true, true);
			const count = vi.mocked(PropsService.fetch).mock.calls.length;
			const checks = Array.from({ length: 6 }, () =>
				modelsStore.verifyBackend(context(), router ? 'same-alias' : null)
			);
			try {
				expect(new Set(checks).size).toBe(1);
				expect(PropsService.fetch).toHaveBeenCalledTimes(count + 1);
				fresh.resolve(props('B', router));
				await Promise.all(checks);
				expect(ModelsService.list).toHaveBeenCalledTimes(2);
			} finally {
				old.resolve(props('A', router));
				fresh.resolve(props('B', router));
				await Promise.allSettled([ordinary, ...checks]);
			}
		}
	);
	it.each(['provider', 'credential', 'protocol'] as const)(
		'FRESH-05/SNAP-06 source %s changes during await never publish old evidence',
		async (change) => {
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				vllmBaseUrl: 'http://review.synthetic'
			});
			await bind('same-alias');
			const gate = deferred<ApiModelListResponse>();
			vi.mocked(ModelsService.list).mockReturnValueOnce(gate.promise);
			const old = bind('same-alias');
			const rejected = expect(old).rejects.toThrow(/source changed/i);
			if (change === 'provider')
				settingsStore.updateMultipleConfig({
					apiProvider: 'openai-compatible',
					openAiCompatibleBaseUrl: 'http://review.synthetic'
				});
			else if (change === 'credential')
				settingsStore.updateMultipleConfig({ apiKey: 'new-synthetic-key' });
			else
				settingsStore.config = Object.assign({}, settingsStore.config, {
					capabilities: { required_protocol: 'responses' }
				});
			modelsStore.clear();
			serverStore.clear();
			ChatService.invalidateProviderRequestContexts();
			replaceBackend();
			const current = await bind('same-alias');
			gate.resolve(catalog());
			await rejected;
			expect(modelsStore.capabilitySnapshot).toEqual(current);
			expect(current?.features.vision.state).toBe('supported');
		}
	);
	it('FRESH-06/SNAP-08 failed fresh check blocks ChatService completion despite cached A', async () => {
		await seed();
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch)
			.mockReturnValueOnce(gate.promise)
			.mockRejectedValueOnce(new Error('fresh B unavailable'));
		const old = modelsStore.fetch(true, true),
			io = vi.fn(),
			onError = vi.fn();
		vi.stubGlobal('fetch', io);
		const sending = ChatService.sendMessage([{ role: 'user', content: 'synthetic' }], {
			stream: false,
			onError
		});
		const rejected = expect(sending).rejects.toThrow();
		try {
			expect(PropsService.fetch).toHaveBeenCalledTimes(3);
			await rejected;
			expect(io).not.toHaveBeenCalled();
			expect(onError).toHaveBeenCalledTimes(1);
			expect(modelsStore.capabilitySnapshot).toBeNull();
		} finally {
			gate.resolve(props());
			await Promise.allSettled([old, sending, rejected]);
		}
	});
	it('FRESH-07 supersedes pending per-model A and ignores its result within cache TTL', async () => {
		await seed(true);
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetchForModel)
			.mockReturnValueOnce(gate.promise)
			.mockResolvedValue(props('B'));
		const old = modelsStore.fetchModelProps('same-alias', true),
			fresh = await bind('same-alias');
		gate.resolve(props());
		expect(await old).toBeNull();
		expect(modelsStore.getModelProps('same-alias')?.model_path).toBe('/synthetic/B.gguf');
		expect(fresh?.features.vision.state).toBe('supported');
		expect(modelsStore.capabilitySnapshot).toEqual(fresh);
	});
});

describe('final review SNAP (returned snapshot AND published store)', () => {
	it('SNAP-02/03 layout refresh during mandatory verification does not consume the final UI ticket', async () => {
		await seed();
		const gate = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch).mockReturnValueOnce(gate.promise);
		const operation = bind();
		await modelsStore.refreshCapabilities(context(), null);
		gate.resolve(props('B'));
		const b = await operation;
		expect(modelsStore.capabilitySnapshot).toEqual(b);
		expect(modelsStore.capabilitySnapshot?.features.vision.state).toBe('supported');
		expect(modelsStore.capabilitySnapshot?.features.tools.state).toBe('supported');
	});
	it.each([false, true])(
		'SNAP-01/02/03 single A→B binds operation and UI without second refresh (router=%s)',
		async (router) => {
			await seed(router);
			const a = await bind(router ? 'same-alias' : null);
			replaceBackend(router);
			const operation = ChatService.captureOperationModel(context(), router ? 'same-alias' : null);
			const b = await operation.capabilities;
			expect(b?.features.vision.state).toBe('supported');
			expect(b?.features.tools.state).toBe('supported');
			expect(b?.backendIdentity).not.toBe(a?.backendIdentity);
			expect(modelsStore.capabilitySnapshot).toEqual(b);
			expect(modelsStore.capabilitySnapshot?.backendIdentity).toBe(b?.backendIdentity);
			expect(a?.features.vision.state).toBe('unsupported');
			expect(Object.isFrozen(b)).toBe(true);
		}
	);
	it('SNAP-04 inactive model finishing later cannot cancel or replace selected model publication', async () => {
		await seed(true);
		const gate = deferred<void>(),
			ready = deferred<void>(),
			create = capabilities.createCapabilitySnapshot;
		vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
			ready.resolve();
			await gate.promise;
			return create(...args);
		});
		const active = modelsStore.refreshCapabilities(context(), 'same-alias');
		await ready.promise;
		await modelsStore.refreshCapabilities(context(), 'other');
		gate.resolve();
		const selected = await active;
		expect(selected?.model).toBe('same-alias');
		expect(modelsStore.capabilitySnapshot).toEqual(selected);
	});
	it('SNAP-05 late A binding cannot replace B published by verified operation plus layout refresh', async () => {
		await seed();
		const gate = deferred<void>(),
			ready = deferred<void>(),
			create = capabilities.createCapabilitySnapshot;
		vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
			ready.resolve();
			await gate.promise;
			return create(...args);
		});
		const oldLayout = modelsStore.refreshCapabilities(context(), null);
		await ready.promise;
		replaceBackend();
		const operation = bind();
		const b = await operation;
		const layout = await modelsStore.refreshCapabilities(context(), null);
		gate.resolve();
		await oldLayout;
		expect(modelsStore.capabilitySnapshot).toEqual(layout);
		expect(layout?.backendIdentity).toBe(b?.backendIdentity);
		expect(modelsStore.capabilitySnapshot?.features.vision.state).toBe('supported');
	});
	it('SNAP-07 A→A keeps capabilities, connection identity and frozen operation evidence', async () => {
		await seed();
		const a = await bind(),
			b = await bind();
		expect(b).toEqual(a);
		expect(modelsStore.capabilitySnapshot).toEqual(b);
		expect(Object.isFrozen(a?.features)).toBe(true);
	});
});
