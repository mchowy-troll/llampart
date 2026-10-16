import { z } from 'zod';
import { MAX_MESSAGE_CHARTS } from '$lib/markdown/chart-blocks';

export const CHART_LIMITS = {
	sourceBytes: 131072,
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
	.refine((value) => !forbidden.has(value));
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
	const fail = () => ctx.addIssue({ code: 'custom', message: 'Invalid chart columns or values' });
	if ('series' in spec) {
		const keys = [spec.xKey, ...spec.series.map((series) => series.key)];
		if (new Set(keys).size !== keys.length) fail();
		if (spec.type !== 'bar' && spec.orientation !== 'vertical') fail();
		const categoryType = typeof spec.data[0]?.[spec.xKey];
		for (const item of spec.data) {
			if (typeof item[spec.xKey] !== categoryType) fail();
			if (Object.keys(item).length !== keys.length || keys.some((key) => !Object.hasOwn(item, key)))
				fail();
			if (spec.series.some((series) => typeof item[series.key] !== 'number')) fail();
		}
		// A category denotes exactly one row; duplicate categories would silently overlap.
		if (new Set(spec.data.map((item) => String(item[spec.xKey]))).size !== spec.data.length) fail();
	} else {
		if (spec.labelKey === spec.valueKey) fail();
		let total = 0;
		for (const item of spec.data) {
			const value = item[spec.valueKey];
			if (
				Object.keys(item).length !== 2 ||
				typeof item[spec.labelKey] !== 'string' ||
				typeof value !== 'number' ||
				value < 0
			)
				fail();
			if (typeof value === 'number') total += value;
		}
		if (!(total > 0) || !Number.isFinite(total)) fail();
		if (new Set(spec.data.map((item) => item[spec.labelKey])).size !== spec.data.length) fail();
	}
});

export type ChartSpec = z.infer<typeof chartSchema>;
export type ChartResult = { success: true; spec: ChartSpec } | { success: false };

export function parseChart(source: string): ChartResult {
	if (
		source.length > CHART_LIMITS.sourceBytes ||
		new TextEncoder().encode(source).length > CHART_LIMITS.sourceBytes
	)
		return { success: false };
	try {
		const json: unknown = JSON.parse(source, (key, value) => {
			if (forbidden.has(key)) throw new Error('Forbidden key');
			return value;
		});
		// Zod arrays validate their children even when max() fails. Bound breadth first,
		// so a small JSON string containing thousands of tiny rows cannot expand errors.
		if (!json || typeof json !== 'object' || Array.isArray(json)) return { success: false };
		const input = json as Record<string, unknown>;
		const maxRows = input.type === 'donut' ? CHART_LIMITS.slices : CHART_LIMITS.points;
		if (
			Object.keys(input).length > 11 ||
			!Array.isArray(input.data) ||
			input.data.length > maxRows ||
			(Array.isArray(input.series) && input.series.length > CHART_LIMITS.series) ||
			input.data.some(
				(row) =>
					!row ||
					typeof row !== 'object' ||
					Array.isArray(row) ||
					Object.keys(row).length > CHART_LIMITS.series + 1
			)
		)
			return { success: false };
		const result = chartSchema.safeParse(json);
		return result.success ? { success: true, spec: result.data } : { success: false };
	} catch {
		return { success: false };
	}
}

export function formatChartValue(spec: ChartSpec, value: number, locale?: string): string {
	return new Intl.NumberFormat(locale, {
		style: spec.format === 'percent' ? 'percent' : 'decimal',
		maximumFractionDigits: spec.decimals
	}).format(value);
}
