import { describe, expect, it } from 'vitest';
import { chartSchema, parseChart, CHART_LIMITS, formatChartValue } from '$lib/charts/chart-schema';

const cartesian = {
	type: 'line',
	xKey: 'month',
	series: [
		{ key: 'a', label: 'Łącznie 東京' },
		{ key: 'b', label: 'B' }
	],
	data: [{ month: 'Styczeń', a: -1.25, b: 3.14159 }]
};
const donut = {
	type: 'donut',
	labelKey: 'name',
	valueKey: 'value',
	data: [
		{ name: 'Łódź', value: 2 },
		{ name: '東京', value: 0 }
	]
};
describe('bounded chart schema', () => {
	it('rejects excessive breadth before constructing per-row validation issues', () => {
		expect(
			parseChart(JSON.stringify({ ...cartesian, data: Array.from({ length: 10000 }, () => ({})) }))
				.success
		).toBe(false);
	});
	it('formats with explicit locale/precision without modifying source values', () => {
		const spec = chartSchema.parse({ ...cartesian, format: 'percent', decimals: 1 });
		expect(formatChartValue(spec, 0.12345, 'en')).toBe('12.3%');
		expect(formatChartValue(spec, 0.12345, 'pl')).toMatch(/^12,3\s?%$/);
		expect(spec.data[0].a).toBe(-1.25);
	});
	it.each(['line', 'bar', 'area'])('accepts %s with multiple series', (type) =>
		expect(parseChart(JSON.stringify({ ...cartesian, type })).success).toBe(true)
	);
	it('accepts donut with zero slices and a positive total', () =>
		expect(parseChart(JSON.stringify(donut)).success).toBe(true));
	it('supports grouped horizontal bars and safe formatting', () =>
		expect(
			chartSchema.parse({
				...cartesian,
				type: 'bar',
				orientation: 'horizontal',
				format: 'percent',
				decimals: 4
			})
		).toMatchObject({ orientation: 'horizontal' }));
	it.each(['{', 'null', '[]', '{}', 'NaN', 'Infinity'])('rejects malformed JSON %s', (source) =>
		expect(parseChart(source).success).toBe(false)
	);
	it.each([
		{ ...cartesian, type: 'radar' },
		{ ...donut, type: 'pie' },
		{ ...cartesian, data: [] },
		{ ...cartesian, series: [] },
		{ ...cartesian, data: [{ month: 'x', a: 1 }] },
		{ ...cartesian, data: [{ month: 'x', a: null, b: 1 }] },
		{ ...cartesian, data: [{ month: 'x', a: '1', b: 1 }] },
		{ ...cartesian, data: [{ month: 'x', a: 1, b: 1, props: 'unsafe' }] },
		{ ...cartesian, title: 'x'.repeat(121) },
		{ ...cartesian, description: 'x'.repeat(501) },
		{
			...cartesian,
			series: Array.from({ length: 6 }, (_, i) => ({ key: String(i), label: 'test' }))
		},
		{
			...cartesian,
			data: Array.from({ length: 501 }, (_, i) => ({ month: String(i), a: 1, b: 2 }))
		},
		{ ...cartesian, data: [cartesian.data[0], cartesian.data[0]] },
		{ ...cartesian, series: [{ key: 'month', label: 'X' }] },
		{ ...cartesian, color: 'red' },
		{ ...cartesian, font: 'anything' },
		{ ...cartesian, url: 'https://evil.test' },
		{ ...cartesian, formatter: '(x) => alert(x)' },
		{ ...cartesian, orientation: 'horizontal' },
		{ ...donut, data: [{ name: 'A', value: -1 }] },
		{ ...donut, data: [{ name: 'A', value: 0 }] },
		{ ...donut, data: [{ name: 'A', value: 1, extra: 1 }] },
		{
			...donut,
			data: [
				{ name: 'A', value: 1 },
				{ name: 'A', value: 2 }
			]
		},
		{ ...donut, data: Array.from({ length: 21 }, (_, i) => ({ name: String(i), value: 1 })) },
		{ ...cartesian, series: [{ key: 'a', label: 'x'.repeat(121) }] }
	])('rejects invalid structures and forbidden fields %#', (input) =>
		expect(parseChart(JSON.stringify(input)).success).toBe(false)
	);
	it.each([NaN, Infinity, -Infinity, 1e13])('rejects non-finite/out-of-range values %s', (a) =>
		expect(chartSchema.safeParse({ ...cartesian, data: [{ month: 'x', a, b: 1 }] }).success).toBe(
			false
		)
	);
	it('allows a maximal Cartesian dataset and enforces UTF-8 source limits', () => {
		expect(
			parseChart(
				JSON.stringify({
					...cartesian,
					data: Array.from({ length: 500 }, (_, i) => ({ month: String(i), a: 1, b: 2 }))
				})
			).success
		).toBe(true);
		expect(parseChart(' '.repeat(CHART_LIMITS.sourceBytes + 1)).success).toBe(false);
		expect(
			parseChart(JSON.stringify({ ...cartesian, title: '界'.repeat(CHART_LIMITS.sourceBytes / 2) }))
				.success
		).toBe(false);
	});
	it('preserves suspicious labels as inert text, never HTML or options', () => {
		const title = '<img src=x onerror=alert(1)> ${alert(1)}';
		const result = parseChart(JSON.stringify({ ...cartesian, title }));
		expect(result.success && result.spec.title).toBe(title);
		expect(parseChart('{"type":"line","__proto__":{"polluted":true}}').success).toBe(false);
		expect(
			parseChart(JSON.stringify({ ...cartesian, series: [{ key: 'constructor', label: 'x' }] }))
				.success
		).toBe(false);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
});
