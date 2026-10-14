import { describe, expect, it } from 'vitest';
import { getProviderStatistics } from '$lib/utils/provider-statistics';
import type { ChatMessageTimings } from '$lib/types/chat';

describe('provider statistics badges', () => {
	const provider: NonNullable<ChatMessageTimings['provider']> = {
		usage: { promptTokens: 79, completionTokens: 12 },
		metrics: [
			{ name: 'generationTime', value: 200, unit: 'ms', source: 'backend', available: true },
			{
				name: 'tokensPerSecond',
				value: 69.98,
				unit: 'tokens/s',
				source: 'backend',
				available: true
			},
			{ name: 'timeToFirstToken', value: 100, unit: 'ms', source: 'backend', available: true },
			{ name: 'elapsedTime', value: 500, unit: 'ms', source: 'browser', available: true }
		]
	};

	it('shows output tokens and explicit backend generation metrics', () => {
		expect(getProviderStatistics(provider, 'generation')).toEqual({
			tokens: 12,
			timeMs: 200,
			tokensPerSecond: 69.98
		});
	});

	it('does not substitute TTFT or browser elapsed time for prompt processing', () => {
		expect(getProviderStatistics(provider, 'reading')).toEqual({
			tokens: 79,
			timeMs: undefined,
			tokensPerSecond: undefined
		});
	});

	it('does not synthesize rates or zero values when metrics are missing', () => {
		expect(getProviderStatistics({ usage: { completionTokens: 12 } }, 'generation')).toEqual({
			tokens: 12,
			timeMs: undefined,
			tokensPerSecond: undefined
		});
	});

	it('preserves reported zeros while rejecting unavailable, non-finite, wrong-unit or browser metrics', () => {
		expect(
			getProviderStatistics(
				{
					usage: { completionTokens: 0 },
					metrics: [
						{ name: 'generationTime', value: 0, unit: 'ms', source: 'backend', available: true },
						{
							name: 'tokensPerSecond',
							value: 0,
							unit: 'tokens/s',
							source: 'backend',
							available: true
						}
					]
				},
				'generation'
			)
		).toEqual({ tokens: 0, timeMs: 0, tokensPerSecond: 0 });
		for (const override of [
			{ source: 'browser' as const },
			{ available: false },
			{ value: NaN },
			{ value: -1 },
			{ unit: 'tokens' as const }
		]) {
			expect(
				getProviderStatistics(
					{
						metrics: [
							{
								name: 'generationTime',
								value: 200,
								unit: 'ms',
								source: 'backend',
								available: true,
								...override
							}
						]
					},
					'generation'
				).timeMs
			).toBeUndefined();
		}
	});
});
