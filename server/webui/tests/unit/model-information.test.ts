import { describe, expect, it } from 'vitest';
import { getModelContextSize } from '$lib/utils/model-information';

describe('model information', () => {
	it('uses explicit vLLM runtime context limits', () => {
		expect(getModelContextSize({ max_model_len: 60160, context_length: 262144 })).toBe(60160);
	});
	it('accepts explicit compatible-provider context lengths', () => {
		expect(getModelContextSize({ context_length: 32768 })).toBe(32768);
	});
	it('does not infer a runtime context from a model name or training metadata', () => {
		expect(
			getModelContextSize({ id: 'model-128k', meta: { n_ctx_train: 262144 } })
		).toBeUndefined();
	});
	it('rejects missing, invalid and non-numeric context metadata', () => {
		for (const value of [
			undefined,
			null,
			{},
			{ max_model_len: '32768' },
			{ max_model_len: 0 },
			{ max_model_len: -1 },
			{ max_model_len: NaN },
			{ context_length: Infinity },
			{ context_length: 1.5 }
		]) {
			expect(getModelContextSize(value)).toBeUndefined();
		}
	});
});
