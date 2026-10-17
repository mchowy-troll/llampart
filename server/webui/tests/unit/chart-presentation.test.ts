import { describe, expect, it } from 'vitest';
import { chartSchema } from '$lib/charts/chart-schema';
import { chartPresentation } from '$lib/charts/chart-presentation';
import { chartPalette } from '$lib/themes/frosted-glass/chart-palette';
import { chartCsv } from '$lib/charts/chart-csv';
import { donutTooltipValues } from '$lib/charts/chart-donut-tooltip';

describe('chart presentation order and stable identity', () => {
	it.each(['line', 'area', 'bar'])(
		'keeps %s series order/colors across crossing values',
		(type) => {
			const spec = chartSchema.parse({
				type,
				xKey: 'x',
				series: [
					{ key: 'b', label: 'Second key first' },
					{ key: 'a', label: 'First key second' }
				],
				data: [
					{ x: 'I', a: 100, b: 1 },
					{ x: 'II', a: -1, b: 200 }
				]
			});
			const { entries, data } = chartPresentation(spec);
			expect(entries.map((e) => e.key)).toEqual(['b', 'a']);
			expect(entries.map((e) => e.color)).toEqual(chartPalette(2));
			expect(data).toBe(spec.data);
			const changed = chartPresentation({
				...spec,
				data: [
					{ x: 'I', a: 0, b: 500 },
					{ x: 'II', a: 900, b: -100 }
				]
			});
			expect(changed.entries).toEqual(entries);
		}
	);
	it('sorts a copy, maps labels/colors/tooltips to sorted rows, and leaves CSV source order', () => {
		const spec = chartSchema.parse({
			type: 'donut',
			labelKey: 'name',
			valueKey: 'value',
			data: [
				{ name: 'A', value: 35 },
				{ name: 'B', value: 15 },
				{ name: 'C', value: 25 },
				{ name: 'D', value: 10 },
				{ name: 'E', value: 20 }
			]
		});
		const before = JSON.stringify(spec),
			{ data, entries } = chartPresentation(spec);
		expect(entries.map((e) => e.key)).toEqual(['D', 'B', 'E', 'C', 'A']);
		expect(entries.map((e) => e.color)).toEqual(chartPalette(5));
		data.forEach((row, i) => {
			expect(entries[i].key).toBe(row.name);
			expect(spec.data).toContain(row);
			expect(donutTooltipValues(spec, Number(row.value), 105, 'en').value).toBe(String(row.value));
		});
		expect(chartCsv(spec)).toBe('\uFEFFname,value\r\nA,35\r\nB,15\r\nC,25\r\nD,10\r\nE,20\r\n');
		expect(JSON.stringify(spec)).toBe(before);
	});
	it('preserves input order at ties and zeros and handles maximum accepted values', () => {
		const spec = chartSchema.parse({
			type: 'donut',
			labelKey: 'name',
			valueKey: 'value',
			data: [
				{ name: 'Max', value: 1e12 },
				{ name: 'B', value: 0 },
				{ name: 'C', value: 0 },
				{ name: 'D', value: 1e-9 },
				{ name: 'E', value: 1e-9 }
			]
		});
		expect(chartPresentation(spec).entries.map((e) => e.key)).toEqual(['B', 'C', 'D', 'E', 'Max']);
	});
	it.each([9, 10, 15, 20])(
		'supports %i categories without color reuse or stale mappings',
		(count) => {
			const spec = chartSchema.parse({
				type: 'donut',
				labelKey: 'name',
				valueKey: 'value',
				data: Array.from({ length: count }, (_, i) => ({ name: `C${i}`, value: count - i }))
			});
			const before = JSON.stringify(spec),
				first = chartPresentation(spec);
			expect(first.entries.map((e) => e.key)).toEqual(
				spec.data.map((r) => String(r.name)).reverse()
			);
			expect(first.entries.map((e) => e.color)).toEqual(chartPalette(count));
			const changed = chartPresentation({
				...spec,
				data: spec.data.map((r) => ({ ...r, value: count - Number(r.value) }))
			});
			expect(changed.entries[0].key).toBe('C0');
			expect(changed.entries[0].color).toBe('#00BEFF');
			expect(JSON.stringify(spec)).toBe(before);
		}
	);
});
