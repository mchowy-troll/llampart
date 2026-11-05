import { describe, expect, it } from 'vitest';
import { chartSchema, parseChart, CHART_LIMITS } from '$lib/charts/chart-schema';
import { diagramType, MAX_DIAGRAM_LINES, MAX_DIAGRAM_SOURCE } from '$lib/diagrams/mermaid-policy';
import {
	diagnostic,
	diagnosticMessage,
	VisualizationError,
	visualizationFailure,
	VISUALIZATION_PROBLEMS
} from '$lib/visualizations/diagnostics';
import { INTERFACE_LANGUAGES, type TranslationDictionary } from '$lib/i18n/types';

const valid = {
	type: 'line',
	xKey: 'month',
	series: [{ key: 'value', label: 'Value' }],
	data: [{ month: 'Jan', value: 1 }]
};
const donut = {
	type: 'donut',
	labelKey: 'name',
	valueKey: 'value',
	data: [{ name: 'A', value: 1 }]
};
function problem(input: unknown) {
	const result = parseChart(JSON.stringify(input));
	expect(result.success).toBe(false);
	if (result.success) throw new Error('Expected diagnostic');
	return result.diagnostic;
}

describe('Charts structural diagnostics (one existing validator)', () => {
	it('keeps field paths unambiguous for unusual column names', () => {
		expect(problem({ ...valid, data: [{ month: 'Jan', value: 1, 'a.b': true }] }).path).toBe(
			'data[0]["a.b"]'
		);
		expect(problem({}).code).toBe('chart.required');
		expect(problem({}).path).toBe('type');
		expect(problem({ ...donut, data: [{ name: 'A', value: 1, extra: 2 }] })).toMatchObject({
			code: 'chart.columns',
			path: 'data[0]'
		});
	});
	it.each([
		[{ ...valid, type: undefined }, 'chart.required', 'type'],
		[{ ...valid, type: 'pie' }, 'chart.type', 'type'],
		[{ ...valid, xKey: undefined }, 'chart.required', 'xKey'],
		[{ ...valid, xKey: 'absent' }, 'chart.columnMissing', 'xKey'],
		[{ ...valid, data: [...valid.data, { value: 2 }] }, 'chart.columnPartial', 'data[1].month'],
		[{ ...valid, data: [{ value: 2 }, ...valid.data] }, 'chart.columnPartial', 'data[0].month'],
		[{ ...valid, series: undefined }, 'chart.required', 'series'],
		[{ ...valid, series: [] }, 'chart.field', 'series'],
		[{ ...valid, series: [{ label: 'X' }] }, 'chart.required', 'series[0].key'],
		[{ ...valid, series: [{ key: 'value' }] }, 'chart.required', 'series[0].label'],
		[{ ...valid, series: [{ key: 'month', label: 'X' }] }, 'chart.collision', 'series[0].key'],
		[{ ...valid, data: 'bad' }, 'chart.field', 'data'],
		[{ ...valid, data: [null] }, 'chart.field', 'data[0]'],
		[{ ...valid, data: [{ month: 'A', value: 'NaN' }] }, 'chart.field', 'data[0].value'],
		[{ ...valid, data: [{ month: 'A', value: true }] }, 'chart.field', 'data[0].value'],
		[{ ...valid, data: [{ month: 'A', value: 1e13 }] }, 'chart.field', 'data[0].value'],
		[{ ...valid, data: [{ month: 'A', value: 1, extra: 2 }] }, 'chart.columns', 'data[0]'],
		[{ ...valid, formatter: 'untrusted' }, 'chart.columns', undefined],
		[{ ...valid, data: [...valid.data, ...valid.data] }, 'chart.duplicate', 'xKey'],
		[{ ...valid, orientation: 'horizontal' }, 'chart.field', 'orientation'],
		[{ ...donut, labelKey: undefined }, 'chart.required', 'labelKey'],
		[{ ...donut, valueKey: undefined }, 'chart.required', 'valueKey'],
		[{ ...donut, labelKey: 'absent' }, 'chart.field', 'labelKey'],
		[{ ...donut, valueKey: 'absent' }, 'chart.field', 'valueKey'],
		[{ ...donut, valueKey: 'name' }, 'chart.collision', 'valueKey'],
		[{ ...donut, data: [{ name: 'A', value: -1 }] }, 'chart.field', 'data[0].value'],
		[{ ...donut, data: [{ name: 'A', value: 0 }] }, 'chart.field', 'valueKey']
	])('%# has a stable code and exact field path', (input, code, path) => {
		expect(problem(input)).toMatchObject({ kind: 'chart', code, category: 'source' });
		expect(problem(input).path).toBe(path);
	});
	it('separates invalid JSON, forbidden keys and bounded limits', () => {
		expect(parseChart('{')).toMatchObject({ success: false, diagnostic: { code: 'chart.json' } });
		expect(parseChart('{"constructor":1}')).toMatchObject({
			success: false,
			diagnostic: { code: 'chart.forbidden', category: 'policy' }
		});
		for (const source of [
			' '.repeat(CHART_LIMITS.sourceBytes + 1),
			'界'.repeat(CHART_LIMITS.sourceBytes / 2)
		])
			expect(parseChart(source)).toMatchObject({
				diagnostic: { code: 'chart.sourceLimit', category: 'limit' }
			});
		expect(problem({ ...valid, data: Array(501).fill(valid.data[0]) })).toMatchObject({
			code: 'chart.dataLimit',
			path: 'data',
			params: { limit: '500' }
		});
		expect(problem({ ...donut, data: Array(21).fill(donut.data[0]) })).toMatchObject({
			code: 'chart.dataLimit',
			params: { limit: '20' }
		});
		expect(problem({ ...valid, series: Array(6).fill(valid.series[0]) })).toMatchObject({
			code: 'chart.seriesLimit',
			path: 'series',
			params: { limit: '5' }
		});
	});
	it('keeps acceptance equivalent to the schema including finite numbers and strict keys', () => {
		for (const input of [
			valid,
			{ ...valid, type: 'bar', orientation: 'horizontal' },
			{ ...valid, type: 'area' },
			donut
		]) {
			expect(chartSchema.safeParse(input).success).toBe(true);
			expect(parseChart(JSON.stringify(input))).toMatchObject({ success: true });
		}
		for (const n of [NaN, Infinity, -Infinity, 1e13])
			expect(chartSchema.safeParse({ ...valid, data: [{ month: 'A', value: n }] }).success).toBe(
				false
			);
	});
});

describe('Mermaid policy diagnostics before lazy engine loading', () => {
	it.each([
		['sequenceDiagram\nA->>B: X', 'diagram.unsupported', 'source'],
		['flowchart LR\nclick A callback', 'diagram.policy', 'policy'],
		['flowchart LR\nA[&lt;script&gt;]', 'diagram.policy', 'policy'],
		['flowchart LR\n' + 'A'.repeat(MAX_DIAGRAM_SOURCE), 'diagram.sourceLimit', 'limit'],
		['flowchart LR\n' + '\n'.repeat(MAX_DIAGRAM_LINES), 'diagram.sourceLimit', 'limit']
	])('%# preserves the actual reason', (source, code, category) => {
		try {
			diagramType(source);
			throw new Error('Expected rejection');
		} catch (error) {
			expect(error).toBeInstanceOf(VisualizationError);
			expect(visualizationFailure(error, 'diagram.render')).toMatchObject({ code, category });
		}
	});
});

const modules = import.meta.glob<{ [key: string]: TranslationDictionary }>(
	'/src/lib/i18n/locales/*.ts',
	{ eager: true }
);
const dictionaries = Object.fromEntries(
	Object.entries(modules).map(([path, module]) => {
		const id = path.split('/').at(-1)!.replace('.ts', '');
		return [id, module[id].visualizationErrors as Record<string, string>];
	})
);
const keys = [
	...new Set(
		Object.values(VISUALIZATION_PROBLEMS)
			.map((entry) => entry[1])
			.filter(Boolean)
	)
];
describe('safe localized messages, all 25 catalogs', () => {
	it('uses exactly the registered locales', () =>
		expect(Object.keys(dictionaries).sort()).toEqual([...INTERFACE_LANGUAGES].sort()));
	it.each(INTERFACE_LANGUAGES)(
		'%s has every diagnostic, no English fallback, same placeholders',
		(id) => {
			expect(Object.keys(dictionaries[id]).sort()).toEqual([...keys].sort());
			for (const key of keys) {
				const text = dictionaries[id][key!];
				expect(text.trim().length).toBeGreaterThan(0);
				if (id !== 'en') expect(text).not.toBe(dictionaries.en[key!]);
				expect(text.match(/\{\w+\}/g) ?? []).toEqual(dictionaries.en[key!].match(/\{\w+\}/g) ?? []);
			}
		}
	);
	it('never maps raw exception text, payloads or guessed line numbers', () => {
		const raw = new Error(
			'<img onerror=alert(1)> SECRET /home/private stack\nParse error on line 99:'
		);
		const problem = visualizationFailure(raw, 'diagram.module');
		expect(JSON.stringify(problem)).not.toMatch(/SECRET|private|onerror|99/);
		expect(diagnosticMessage(problem, (key) => dictionaries.en[key.split('.')[1]])).toContain(
			'module'
		);
		expect(problem.category).toBe('infrastructure');
		expect(diagnostic('diagram.countLimit').category).toBe('limit');
		expect(diagnostic('diagram.cancelled').category).not.toBe('source');
		expect(diagnosticMessage(diagnostic('diagram.cancelled'), () => 'unexpected')).toBe('');
	});
	it('bounds dynamic fragments and leaves markup as text rather than Markdown/HTML', () => {
		const p = diagnostic('chart.columnMissing', {
			path: 'xKey',
			column: '<img>\u202e\n' + 'X'.repeat(1000),
			line: 99999
		});
		expect(p.params.column).toHaveLength(120);
		expect(p.params.column).not.toMatch(/[\n\u202e]/);
		expect(p.line).toBeUndefined();
		expect(diagnosticMessage(p, (key) => dictionaries.pl[key.split('.')[1]])).toContain(
			'Pole „xKey” wskazuje kolumnę „<img>'
		);
	});
});
