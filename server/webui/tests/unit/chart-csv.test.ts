import { describe, expect, it } from 'vitest';
import { chartSchema } from '$lib/charts/chart-schema';
import { chartCsv, chartFilename } from '$lib/charts/chart-csv';

describe('chart CSV', () => {
	it.each(['line', 'bar', 'area'])(
		'exports %s source numbers in row/series order, with UTF-8 BOM',
		(type) => {
			const spec = chartSchema.parse({
				type,
				xKey: 'month',
				xLabel: 'Miesiąc',
				series: [
					{ key: 'b', label: 'Koszty' },
					{ key: 'a', label: 'Przychód' }
				],
				data: [
					{ month: 'Łódź 東京', b: -1.25, a: 0.12345678 },
					{ month: 'B', b: 0, a: 2 }
				],
				decimals: 0
			});
			expect(chartCsv(spec)).toBe(
				'\uFEFFMiesiąc,Koszty,Przychód\r\nŁódź 東京,-1.25,0.12345678\r\nB,0,2\r\n'
			);
		}
	);
	it('supports a single series and quotes commas, newlines and double quotes', () => {
		const spec = chartSchema.parse({
			type: 'line',
			xKey: 'x',
			series: [{ key: 'y', label: 'a,"b"' }],
			data: [{ x: 'a,\n"b"', y: -2.5 }]
		});
		expect(chartCsv(spec)).toBe('\uFEFFx,"a,""b"""\r\n"a,\n""b""",-2.5\r\n');
	});
	it('exports donut labels and original values', () => {
		expect(
			chartCsv(
				chartSchema.parse({
					type: 'donut',
					labelKey: 'Nazwa',
					valueKey: 'Wartość',
					data: [
						{ Nazwa: 'Łódź', Wartość: 1.23456 },
						{ Nazwa: 'A', Wartość: 0 }
					]
				})
			)
		).toBe('\uFEFFNazwa,Wartość\r\nŁódź,1.23456\r\nA,0\r\n');
	});
	it.each(['=1+1', '+cmd', '-cmd', '@SUM(A1)', ' \t\r=1', '\u0000\u200B+1', '\n -1'])(
		'neutralizes text formula injection %j but not numeric negatives',
		(label) => {
			const csv = chartCsv(
				chartSchema.parse({
					type: 'bar',
					xKey: 'x',
					xLabel: label,
					series: [{ key: 'y', label }],
					data: [{ x: label, y: -1.25 }]
				})
			);
			expect(csv).toContain("'");
			expect(csv).toContain(',-1.25\r\n');
			expect(csv).not.toContain(",' -1.25");
		}
	);
	it('uses bounded filenames without paths/control characters', () => {
		expect(chartFilename('../../A / B\n')).toBe('chart-A-B');
		expect(chartFilename('')).toBe('chart-chart');
		expect(chartFilename('CON')).toBe('chart-CON');
		expect(chartFilename('A'.repeat(200))).toHaveLength(76);
	});
});
