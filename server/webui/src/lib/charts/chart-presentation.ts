import type { ChartSpec } from './chart-schema';
import { chartPalette } from '$lib/themes/frosted-glass/chart-palette';

/** A presentation-only copy: CSV and stored Markdown always use spec.data. */
export function chartPresentation(spec: ChartSpec) {
	const data =
		'series' in spec
			? spec.data
			: spec.data
					.map((row, index) => ({ row, index }))
					.sort(
						(a, b) =>
							Number(a.row[spec.valueKey]) - Number(b.row[spec.valueKey]) || a.index - b.index
					)
					.map((item) => item.row);
	const colors = chartPalette('series' in spec ? spec.series.length : data.length);
	const entries =
		'series' in spec
			? spec.series.map((series, index) => ({ ...series, color: colors[index], index }))
			: data.map((row, index) => ({
					key: String(row[spec.labelKey]),
					label: String(row[spec.labelKey]),
					color: colors[index],
					index
				}));
	return { data, entries };
}
