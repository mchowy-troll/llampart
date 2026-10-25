import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsService } from '$lib/services/models.service';
import { ChatService } from '$lib/services/chat.service';
import * as capabilities from '$lib/services/providers/provider-capabilities';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';

const originalConfig = { ...settingsStore.config };
const createSnapshot = capabilities.createCapabilitySnapshot;

function catalog(vision: boolean | undefined, responses = false): ApiModelListResponse {
	return {
		object: 'list',
		data: [false, true].map((_, index) => ({
			id: index === 0 ? 'model-A' : 'model-B',
			capabilities: {
				...(responses ? { required_protocol: 'responses' } : {}),
				...(index === 0 && vision === undefined ? {} : { vision: index === 0 ? vision : true }),
				reasoning_effort: { supported: true, values: index === 0 ? ['low'] : ['high'] },
				tools: index === 1
			}
		}))
	} as unknown as ApiModelListResponse;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

async function setup(vision: boolean | undefined = false) {
	vi.spyOn(ModelsService, 'list').mockResolvedValue(catalog(vision));
	await modelsStore.fetch();
	await modelsStore.selectModelById('model-A');
	return modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
}

beforeEach(() => {
	modelsStore.resetAllModelState();
	serverStore.clear();
	settingsStore.updateMultipleConfig({
		apiProvider: 'openai-compatible',
		serverBaseUrl: 'http://synthetic.test',
		apiKey: 'synthetic-key'
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.config = { ...originalConfig };
	modelsStore.resetAllModelState();
	serverStore.clear();
	ChatService.invalidateProviderRequestContexts();
});

describe('selection only invalidates capabilities for an accepted change', () => {
	it.each(['same', 'empty', 'updating', 'missing'] as const)(
		'preserves published and pending A capabilities for an ignored/rejected selection: %s',
		async (kind) => {
			const before = await setup();
			async function attemptSelection() {
				modelsStore.updating = kind === 'updating';
				const selection = modelsStore.selectModelById(
					kind === 'same'
						? 'model-A'
						: kind === 'empty'
							? ''
							: kind === 'missing'
								? 'missing'
								: 'model-B'
				);
				if (kind === 'missing')
					await expect(selection).rejects.toThrow('Selected model is not available');
				else await selection;
			}
			await attemptSelection();
			expect(modelsStore.capabilitySnapshot).toBe(before);
			expect(modelsStore.selectedModelId).toBe('model-A');
			expect(modelsStore.selectedModelName).toBe('model-A');
			const gate = deferred();
			vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
				await gate.promise;
				return createSnapshot(...args);
			});
			const pending = modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
			await attemptSelection();
			gate.resolve();
			const snapshot = await pending;
			expect(modelsStore.capabilitySnapshot).toBe(snapshot);
			expect(snapshot?.features.vision.state).toBe('unsupported');
			expect(modelsStore.selectedModelName).toBe('model-A');
		}
	);

	it('invalidates A on A→B, rejects late A publication, and rediscovers A on B→A', async () => {
		const firstA = await setup();
		const gate = deferred();
		vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
			await gate.promise;
			return createSnapshot(...args);
		});
		const pendingA = modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
		await modelsStore.selectModelById('model-B');
		expect(modelsStore.capabilitySnapshot).toBeNull();
		const snapshotB = await modelsStore.refreshCapabilities(
			ChatService.createProviderRequestContext()
		);
		expect(snapshotB?.model).toBe('model-B');
		expect(snapshotB?.features.vision.state).toBe('supported');
		gate.resolve();
		expect((await pendingA)?.model).toBe('model-A');
		expect(modelsStore.capabilitySnapshot).toBe(snapshotB);
		await modelsStore.selectModelById('model-A');
		expect(modelsStore.capabilitySnapshot).toBeNull();
		const nextA = await modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
		expect(nextA).not.toBe(firstA);
		expect(nextA?.features).toEqual(firstA?.features);
		expect(modelsStore.capabilitySnapshot).toBe(nextA);
	});

	it('rejects late A even before B starts its discovery', async () => {
		await setup();
		const gate = deferred();
		vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
			await gate.promise;
			return createSnapshot(...args);
		});
		const pendingA = modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
		await modelsStore.selectModelById('model-B');
		gate.resolve();
		await pendingA;
		expect(modelsStore.capabilitySnapshot).toBeNull();
		expect(modelsStore.selectedModelName).toBe('model-B');
	});

	it('refreshes changed catalog capabilities without changing the selected model', async () => {
		const before = await setup();
		vi.mocked(ModelsService.list).mockResolvedValue(catalog(true));
		await modelsStore.fetch(true);
		await modelsStore.selectModelById('model-A');
		expect(modelsStore.capabilitySnapshot).toBe(before);
		const pending = modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
		expect(modelsStore.capabilitySnapshot).toBeNull();
		const after = await pending;
		expect(after?.features.vision.state).toBe('supported');
		expect(after).not.toBe(before);
		expect(modelsStore.capabilitySnapshot).toBe(after);
		expect(modelsStore.selectedModelName).toBe('model-A');
	});

	it.each(['provider', 'url', 'key', 'protocol'] as const)(
		'keeps identical model names source-owned across a %s change and late discovery',
		async (change) => {
			const before = await setup();
			const sourceKey = modelsStore.modelListSourceKey;
			const gate = deferred();
			vi.spyOn(capabilities, 'createCapabilitySnapshot').mockImplementationOnce(async (...args) => {
				await gate.promise;
				return createSnapshot(...args);
			});
			const pendingOld = modelsStore.refreshCapabilities(
				ChatService.createProviderRequestContext()
			);
			settingsStore.updateMultipleConfig({
				...(change === 'provider'
					? { apiProvider: 'vllm', vllmBaseUrl: 'http://synthetic.test' }
					: {}),
				...(change === 'url' ? { serverBaseUrl: 'http://second-synthetic.test' } : {}),
				...(change === 'key' ? { apiKey: 'second-key' } : {})
			});
			if (change === 'protocol')
				settingsStore.config = Object.assign({}, settingsStore.config, {
					capabilities: { required_protocol: 'responses' }
				});
			// Mirror the existing +layout/source lifecycle, not an ID-based ownership shortcut.
			ChatService.invalidateProviderRequestContexts();
			modelsStore.clear();
			expect(modelsStore.capabilitySnapshot).toBeNull();
			expect(modelsStore.modelListSourceKey).not.toBe(sourceKey);
			vi.mocked(ModelsService.list).mockResolvedValue(catalog(true, change === 'protocol'));
			await modelsStore.fetch();
			await modelsStore.selectModelById('model-A');
			const after = await modelsStore.refreshCapabilities(
				ChatService.createProviderRequestContext()
			);
			expect(after?.model).toBe(before?.model);
			expect(after?.connectionIdentity).not.toBe(before?.connectionIdentity);
			expect(after?.sourceGeneration).not.toBe(before?.sourceGeneration);
			expect(after?.features.vision.state).toBe('supported');
			gate.resolve();
			expect(await pendingOld).toBeNull();
			expect(modelsStore.capabilitySnapshot).toBe(after);
		}
	);
});
