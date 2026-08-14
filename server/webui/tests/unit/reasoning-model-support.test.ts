import { beforeEach, describe, expect, it } from 'vitest';
import { ServerRole } from '$lib/enums';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';

describe('model thinking support ownership', () => {
	beforeEach(() => {
		modelsStore.clear();
		serverStore.clear();
	});

	it('uses server props in single-model mode even when a model is selected', () => {
		serverStore.role = ServerRole.MODEL;
		serverStore.props = {
			chat_template: '{% if enable_thinking %}think{% endif %}',
			default_generation_settings: { n_ctx: 8192, params: {} }
		} as ApiLlamaCppServerProps;
		modelsStore.selectedModelId = 'single-model';
		modelsStore.selectedModelName = 'single-model';

		expect(modelsStore.supportsThinking).toBe(true);
		expect(modelsStore.checkModelSupportsThinking('single-model')).toBe(true);
		expect(modelsStore.thinkingSupportDetails.supported).toBe(true);
	});

	it('uses cached model-specific props in router mode', () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = {
			chat_template: 'plain router default',
			default_generation_settings: { n_ctx: 8192, params: {} }
		} as ApiLlamaCppServerProps;
		modelsStore.selectedModelId = 'thinking-model';
		modelsStore.selectedModelName = 'thinking-model';
		const internals = modelsStore as unknown as {
			modelPropsCache: Map<string, ApiLlamaCppServerProps>;
			getSourceModelKey: (context: unknown, modelId: string) => string;
			currentRequestContext: () => unknown;
		};
		internals.modelPropsCache.set(
			internals.getSourceModelKey(internals.currentRequestContext(), 'thinking-model'),
			{
				chat_template: '{% if enable_thinking %}think{% endif %}',
				default_generation_settings: { n_ctx: 16384, params: {} }
			} as ApiLlamaCppServerProps
		);

		expect(modelsStore.supportsThinking).toBe(true);
		expect(modelsStore.thinkingSupportDetails.supported).toBe(true);
	});
});
