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

describe('AUD-008: selection only invalidates capabilities for an accepted change', () => {
	it.each([false, true, undefined])(
		'preserves the exact snapshot on A→A (vision=%s)',
		async (vision) => {
			// Pass undefined explicitly: it represents missing evidence, not false.
			await setup();
			vi.mocked(ModelsService.list).mockResolvedValue(catalog(vision));
			await modelsStore.fetch(true);
			const snapshot = await modelsStore.refreshCapabilities(
				ChatService.createProviderRequestContext()
			);
			const discovery = vi.spyOn(capabilities, 'createCapabilitySnapshot');
			await modelsStore.selectModelById('model-A');
			expect(modelsStore.selectedModelId).toBe('model-A');
			expect(modelsStore.selectedModelName).toBe('model-A');
			expect(modelsStore.capabilitySnapshot).toBe(snapshot);
			expect(snapshot?.features.vision.state).toBe(
				vision === undefined ? 'unknown' : vision ? 'supported' : 'unsupported'
			);
			expect(modelsStore.modelSupportsVision('model-A')).toBe(vision !== false);
			expect(snapshot?.features.tools.state).toBe('unsupported');
			expect(discovery).not.toHaveBeenCalled();
		}
	);

	it.each(['same', 'empty', 'updating', 'missing'] as const)(
		'does not cancel pending A discovery for an ignored/rejected selection: %s',
		async (kind) => {
			await setup();
			const gate = deferred();
			const discovery = vi
				.spyOn(capabilities, 'createCapabilitySnapshot')
				.mockImplementationOnce(async (...args) => {
					await gate.promise;
					return createSnapshot(...args);
				});
			const pending = modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
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
			gate.resolve();
			const snapshot = await pending;
			expect(modelsStore.capabilitySnapshot).toBe(snapshot);
			expect(snapshot?.features.vision.state).toBe('unsupported');
			expect(modelsStore.selectedModelName).toBe('model-A');
			expect(discovery).toHaveBeenCalledTimes(1);
		}
	);

	it.each(['empty', 'updating', 'missing'] as const)(
		'keeps a valid snapshot for %s',
		async (kind) => {
			const snapshot = await setup();
			modelsStore.updating = kind === 'updating';
			const selection = modelsStore.selectModelById(
				kind === 'empty' ? '' : kind === 'missing' ? 'missing' : 'model-B'
			);
			if (kind === 'missing')
				await expect(selection).rejects.toThrow('Selected model is not available');
			else await selection;
			expect(modelsStore.capabilitySnapshot).toBe(snapshot);
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

	it('invalidates an already published snapshot before B discovery starts', async () => {
		await setup();
		await modelsStore.selectModelById('model-B');
		expect(modelsStore.capabilitySnapshot).toBeNull();
		expect(modelsStore.selectedModelName).toBe('model-B');
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

	it('allows explicit refresh without a selection change', async () => {
		const before = await setup();
		const discovery = vi.spyOn(capabilities, 'createCapabilitySnapshot');
		const pending = modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
		expect(modelsStore.capabilitySnapshot).toBeNull();
		const after = await pending;
		expect(after).not.toBe(before);
		expect(after).toEqual(before);
		expect(modelsStore.capabilitySnapshot).toBe(after);
		expect(discovery).toHaveBeenCalledTimes(1);
	});

	it('refreshes changed catalog metadata with the same selection (layout discovery boundary)', async () => {
		const before = await setup();
		vi.mocked(ModelsService.list).mockResolvedValue(catalog(true));
		const oldList = modelsStore.models;
		await modelsStore.fetch(true);
		expect(modelsStore.models).not.toBe(oldList); // +layout watches this reference.
		await modelsStore.selectModelById('model-A');
		expect(modelsStore.capabilitySnapshot).toBe(before);
		const after = await modelsStore.refreshCapabilities(ChatService.createProviderRequestContext());
		expect(after?.features.vision.state).toBe('supported');
		expect(after).not.toBe(before);
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
