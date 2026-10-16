import { describe, expect, it } from 'vitest';
import { donutTooltipValues } from '$lib/charts/chart-donut-tooltip';
import { chartSchema } from '$lib/charts/chart-schema';

const spec = chartSchema.parse({
	type: 'donut',
	labelKey: 'category',
	valueKey: 'value',
	data: [
		{ category: 'A', value: 25 },
		{ category: 'B', value: 75 }
	]
});
describe('donut tooltip value/share semantics', () => {
	it('omits repeated values when whole-number percentages sum to 100', () =>
		expect(donutTooltipValues(spec, 25, 100, 'en')).toEqual({ value: null, share: '25%' }));
	it('omits repeated percent-format fractions summing to one', () =>
		expect(donutTooltipValues({ ...spec, format: 'percent' }, 0.25, 1, 'en')).toEqual({
			value: null,
			share: '25%'
		}));
	it('keeps counts with distinct meaning, without inventing units', () =>
		expect(donutTooltipValues(spec, 250, 1000, 'en')).toEqual({ value: '250', share: '25%' }));
	it('uses the actual total instead of assuming 100', () =>
		expect(donutTooltipValues(spec, 3, 12, 'en')).toEqual({ value: '3', share: '25%' }));
	it('keeps the original value when hiding categories changes the share', () =>
		expect(donutTooltipValues(spec, 27, 57, 'pl')).toEqual({ value: '27', share: '47,4%' }));
	it('distinguishes percent-format source values from normalized shares', () =>
		expect(donutTooltipValues({ ...spec, format: 'percent' }, 0.25, 2, 'en')).toEqual({
			value: '25%',
			share: '12.5%'
		}));
	it('does not drop a source value just because display rounding matches', () =>
		expect(donutTooltipValues(spec, 25, 100.001, 'en')).toEqual({ value: '25', share: '25%' }));
	it('handles decimal totals without floating-point duplicates', () =>
		expect(donutTooltipValues({ ...spec, format: 'percent' }, 0.1, 0.1 + 0.2 + 0.7, 'en')).toEqual({
			value: null,
			share: '10%'
		}));
	it('formats zero as a real share and never mutates the specification', () => {
		const before = JSON.stringify(spec);
		expect(donutTooltipValues(spec, 0, 100, 'en')).toEqual({ value: null, share: '0%' });
		expect(JSON.stringify(spec)).toBe(before);
	});
});
