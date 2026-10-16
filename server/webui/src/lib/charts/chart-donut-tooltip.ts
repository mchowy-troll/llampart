import { formatChartValue, type ChartSpec } from './chart-schema';

/** Presentation only: never infer units, normalize stored data, or deduplicate
 * merely because two different numbers happen to round to the same string. */
export function donutTooltipValues(spec: ChartSpec, value: number, total: number, locale?: string) {
	const ratio = total > 0 ? value / total : 0;
	const share = new Intl.NumberFormat(locale, {
		style: 'percent',
		maximumFractionDigits: 1
	}).format(ratio);
	const sourceFraction = spec.format === 'percent' ? value : value / 100;
	const duplicate =
		Math.abs(sourceFraction - ratio) <=
		Number.EPSILON * 8 * Math.max(Math.abs(sourceFraction), Math.abs(ratio));
	return { value: duplicate ? null : formatChartValue(spec, value, locale), share };
}
