import { describe, expect, it, vi } from 'vitest';
import { resolveHistoricalContextTotal } from '$lib/stores/chat.svelte';

describe('historical chat context total', () => {
	it('keeps model A context after model B becomes selected', () => {
		const getModelContextSize = vi.fn((model: string) => (model === 'model-b' ? 65536 : null));

		expect(
			resolveHistoricalContextTotal(
				{ model: 'model-a', timings: { context_total: 8192 } },
				getModelContextSize
			)
		).toBe(8192);
		expect(getModelContextSize).not.toHaveBeenCalled();
	});

	it('retains the persisted value after reload', () => {
		const restoredMessage = JSON.parse(
			JSON.stringify({ model: 'model-a', timings: { context_total: 16384 } })
		);

		expect(resolveHistoricalContextTotal(restoredMessage, () => 32768)).toBe(16384);
	});

	it('uses the message model for legacy timings', () => {
		const getModelContextSize = vi.fn((model: string) => (model === 'model-a' ? 4096 : null));

		expect(
			resolveHistoricalContextTotal(
				{ model: 'model-a', timings: { prompt_n: 12, predicted_n: 4 } },
				getModelContextSize
			)
		).toBe(4096);
		expect(getModelContextSize).toHaveBeenCalledWith('model-a');
	});

	it('returns null when the historical message has no model', () => {
		const getModelContextSize = vi.fn(() => 32768);

		expect(
			resolveHistoricalContextTotal(
				{ model: undefined, timings: { prompt_n: 12, predicted_n: 4 } },
				getModelContextSize
			)
		).toBeNull();
		expect(getModelContextSize).not.toHaveBeenCalled();
	});
});
