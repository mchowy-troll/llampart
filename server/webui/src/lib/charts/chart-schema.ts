import { z } from 'zod';
import { MAX_CHART_SOURCE_BYTES, MAX_MESSAGE_CHARTS } from '$lib/markdown/chart-blocks';
import {
	diagnostic,
	type VisualizationCode,
	type VisualizationDiagnostic
} from '$lib/visualizations/diagnostics';

export const CHART_LIMITS = {
	sourceBytes: MAX_CHART_SOURCE_BYTES,
	series: 5,
	points: 500,
	slices: 20,
	perMessage: MAX_MESSAGE_CHARTS
} as const;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const key = z
	.string()
	.min(1)
	.max(80)
	.refine((value) => !forbidden.has(value), { params: { diagnostic: 'chart.forbidden' } });
const label = z.string().min(1).max(120);
const number = z.number().finite().min(-1e12).max(1e12);
const row = z.record(key, z.union([label, number]));
const common = {
	title: label.optional(),
	description: z.string().max(500).optional(),
	format: z.enum(['number', 'percent']).default('number'),
	decimals: z.number().int().min(0).max(6).default(2)
};
const cartesian = z
	.object({
		...common,
		type: z.enum(['line', 'bar', 'area']),
		xKey: key,
		xLabel: label.optional(),
		yLabel: label.optional(),
		orientation: z.enum(['vertical', 'horizontal']).default('vertical'),
		series: z.array(z.object({ key, label }).strict()).min(1).max(CHART_LIMITS.series),
		data: z.array(row).min(1).max(CHART_LIMITS.points)
	})
	.strict();
const circular = z
	.object({
		...common,
		type: z.literal('donut'),
		labelKey: key,
		valueKey: key,
		data: z.array(row).min(1).max(CHART_LIMITS.slices)
	})
	.strict();

export const chartSchema = z.union([cartesian, circular]).superRefine((spec, ctx) => {
	const fail = (code: VisualizationCode, path: (string | number)[], column?: string) =>
		ctx.addIssue({ code: 'custom', path, message: code, params: { diagnostic: code, column } });
	if ('series' in spec) {
		const keys = [spec.xKey, ...spec.series.map((series) => series.key)];
		if (new Set(keys).size !== keys.length) {
			const index = spec.series.findIndex((series, i) => keys.slice(0, i + 1).includes(series.key));
			fail('chart.collision', ['series', index, 'key']);
		}
		if (spec.type !== 'bar' && spec.orientation !== 'vertical')
			fail('chart.field', ['orientation']);
		const categoryType = typeof spec.data[0]?.[spec.xKey];
		const missingX = spec.data.every((item) => !Object.hasOwn(item, spec.xKey));
		for (const [i, item] of spec.data.entries()) {
			if (!Object.hasOwn(item, spec.xKey))
				fail(
					missingX ? 'chart.columnMissing' : 'chart.columnPartial',
					missingX ? ['xKey'] : ['data', i, spec.xKey],
					spec.xKey
				);
			if (typeof item[spec.xKey] !== categoryType) fail('chart.field', ['data', i, spec.xKey]);
			if (Object.keys(item).length !== keys.length || keys.some((key) => !Object.hasOwn(item, key)))
				fail('chart.columns', ['data', i]);
			for (const series of spec.series)
				if (typeof item[series.key] !== 'number') fail('chart.field', ['data', i, series.key]);
		}
		// A category denotes exactly one row; duplicate categories would silently overlap.
		if (new Set(spec.data.map((item) => String(item[spec.xKey]))).size !== spec.data.length)
			fail('chart.duplicate', ['xKey']);
	} else {
		if (spec.labelKey === spec.valueKey) fail('chart.collision', ['valueKey']);
		let total = 0;
		for (const [i, item] of spec.data.entries()) {
			const value = item[spec.valueKey];
			if (typeof item[spec.labelKey] !== 'string') fail('chart.field', ['labelKey']);
			if (typeof value !== 'number' || value < 0)
				fail(
					'chart.field',
					!Object.hasOwn(item, spec.valueKey) ? ['valueKey'] : ['data', i, spec.valueKey]
				);
			if (Object.keys(item).length !== 2) fail('chart.columns', ['data', i]);
			if (typeof value === 'number') total += value;
		}
		if (!(total > 0) || !Number.isFinite(total)) fail('chart.field', ['valueKey']);
		if (new Set(spec.data.map((item) => item[spec.labelKey])).size !== spec.data.length)
			fail('chart.duplicate', ['labelKey']);
	}
});

export type ChartSpec = z.infer<typeof chartSchema>;
export type ChartResult =
	{ success: true; spec: ChartSpec } | { success: false; diagnostic: VisualizationDiagnostic };

function failure(code: VisualizationCode, path?: string, limit?: number): ChartResult {
	return { success: false, diagnostic: diagnostic(code, { path, limit }) };
}

function fieldPath(path: PropertyKey[]): string {
	return path
		.map((part, i) =>
			typeof part === 'number'
				? `[${part}]`
				: /^[A-Za-z_$][\w$]*$/.test(String(part))
					? `${i ? '.' : ''}${String(part)}`
					: `[${JSON.stringify(String(part))}]`
		)
		.join('');
}

function schemaFailure(issues: z.core.$ZodIssue[], donut: boolean, input: unknown): ChartResult {
	const issue = issues[0];
	if (issue.code === 'invalid_union') {
		if (issue.path.length) return failure('chart.field', fieldPath(issue.path));
		return schemaFailure(issue.errors[donut ? 1 : 0], donut, input);
	}
	const path = fieldPath(issue.path);
	const missing =
		issue.path.reduce<unknown>(
			(value, key) =>
				value && typeof value === 'object'
					? (value as Record<PropertyKey, unknown>)[key]
					: undefined,
			input
		) === undefined;
	if (issue.code === 'custom' && issue.params?.diagnostic)
		return {
			success: false,
			diagnostic: diagnostic(issue.params.diagnostic as VisualizationCode, {
				path,
				column: issue.params.column
			})
		};
	if (issue.code === 'unrecognized_keys') return failure('chart.columns', path || undefined);
	if (path === 'type') return failure(missing ? 'chart.required' : 'chart.type', path);
	return failure(missing ? 'chart.required' : 'chart.field', path || 'data');
}

export function parseChart(source: string): ChartResult {
	if (
		source.length > CHART_LIMITS.sourceBytes ||
		new TextEncoder().encode(source).length > CHART_LIMITS.sourceBytes
	)
		return failure('chart.sourceLimit', undefined, CHART_LIMITS.sourceBytes);
	let forbiddenKey = false;
	try {
		const json: unknown = JSON.parse(source, (key, value) => {
			if (forbidden.has(key)) {
				forbiddenKey = true;
				throw new Error('Forbidden key');
			}
			return value;
		});
		// Zod arrays validate their children even when max() fails. Bound breadth first,
		// so a small JSON string containing thousands of tiny rows cannot expand errors.
		if (!json || typeof json !== 'object' || Array.isArray(json))
			return failure('chart.field', 'data');
		const input = json as Record<string, unknown>;
		const maxRows = input.type === 'donut' ? CHART_LIMITS.slices : CHART_LIMITS.points;
		if (Object.keys(input).length > 11) return failure('chart.columns');
		if (Array.isArray(input.data) && input.data.length > maxRows)
			return failure('chart.dataLimit', 'data', maxRows);
		if (Array.isArray(input.series) && input.series.length > CHART_LIMITS.series)
			return failure('chart.seriesLimit', 'series', CHART_LIMITS.series);
		for (const [i, row] of (Array.isArray(input.data) ? input.data : []).entries()) {
			if (!row || typeof row !== 'object' || Array.isArray(row))
				return failure('chart.field', `data[${i}]`);
			if (Object.keys(row).length > CHART_LIMITS.series + 1)
				return failure('chart.columns', `data[${i}]`);
		}
		const result = chartSchema.safeParse(json);
		return result.success
			? { success: true, spec: result.data }
			: schemaFailure(result.error.issues, input.type === 'donut', json);
	} catch {
		return failure(forbiddenKey ? 'chart.forbidden' : 'chart.json');
	}
}

export function formatChartValue(spec: ChartSpec, value: number, locale?: string): string {
	return new Intl.NumberFormat(locale, {
		style: spec.format === 'percent' ? 'percent' : 'decimal',
		maximumFractionDigits: spec.decimals
	}).format(value);
}
