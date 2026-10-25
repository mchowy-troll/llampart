import { describe, expect, it, vi } from 'vitest';
import { chartSchema } from '$lib/charts/chart-schema';
import { chartCsv, downloadChartBlob } from '$lib/charts/chart-csv';

describe('chart CSV', () => {
	it('exports source numbers in row/series order and quotes CSV fields, with BOM and CRLF', () => {
		const spec = chartSchema.parse({
			type: 'line',
			xKey: 'month',
			xLabel: 'Miesiąc',
			series: [
				{ key: 'b', label: 'a,"b"' },
				{ key: 'a', label: 'Przychód' }
			],
			data: [
				{ month: 'Łódź 東京', b: -1.25, a: 0.12345678 },
				{ month: 'a,\n"b"', b: 0, a: 2 }
			],
			decimals: 0
		});
		expect(chartCsv(spec)).toBe(
			'\uFEFFMiesiąc,"a,""b""",Przychód\r\nŁódź 東京,-1.25,0.12345678\r\n"a,\n""b""",0,2\r\n'
		);
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

	it('preserves CSV bytes: escapes text formulas in headers and labels, but not numeric values', () => {
		const labels = [
			'-12',
			'-1,25',
			'\u034F=1',
			'\uFE0F+cmd',
			'=1',
			'+1',
			'@A',
			' \t\u200B-1',
			'\u0000\u200B+1',
			' \t\r=1',
			'\n -1'
		];
		const spec = chartSchema.parse({
			type: 'line',
			xKey: 'x',
			xLabel: '-12',
			series: [{ key: 'y', label: '-1,25' }],
			data: labels.map((x) => ({ x, y: -1.25 }))
		});
		const expected =
			'\uFEFF\'-12,"\'-1,25"\r\n' +
			"'-12,-1.25\r\n" +
			'"\'-1,25",-1.25\r\n' +
			'\u034F=1,-1.25\r\n' +
			'\uFE0F+cmd,-1.25\r\n' +
			"'=1,-1.25\r\n" +
			"'+1,-1.25\r\n" +
			"'@A,-1.25\r\n" +
			"' \t\u200B-1,-1.25\r\n" +
			"'\u0000\u200B+1,-1.25\r\n" +
			'"\' \t\r=1",-1.25\r\n' +
			'"\'\n -1",-1.25\r\n';
		expect(new TextEncoder().encode(chartCsv(spec))).toEqual(new TextEncoder().encode(expected));
	});

	it.each([false, true])('revokes the download URL even when link.click fails (%s)', (fails) => {
		vi.useFakeTimers();
		const click = vi.fn(() => {
			if (fails) throw new Error('download failed');
		});
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv-test');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.stubGlobal('document', { createElement: () => ({ click }) });
		try {
			const download = () => downloadChartBlob(new Blob(['CSV']), 'table-1.csv');
			if (fails) expect(download).toThrow('download failed');
			else download();
			expect(create).toHaveBeenCalledOnce();
			expect(click).toHaveBeenCalledOnce();
			vi.runAllTimers();
			expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:csv-test');
		} finally {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
			vi.useRealTimers();
		}
	});
});
