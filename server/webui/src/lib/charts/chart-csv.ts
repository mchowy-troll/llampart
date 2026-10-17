import type { ChartSpec } from './chart-schema';
import { serializeCsv } from '$lib/utils/csv';

export function chartCsv(spec: ChartSpec): string {
	const keys =
		'series' in spec
			? [spec.xKey, ...spec.series.map((series) => series.key)]
			: [spec.labelKey, spec.valueKey];
	const headers =
		'series' in spec
			? [spec.xLabel || spec.xKey, ...spec.series.map((series) => series.label)]
			: [spec.labelKey, spec.valueKey];
	return serializeCsv([headers, ...spec.data.map((row) => keys.map((key) => row[key]))]);
}

export function chartFilename(title?: string): string {
	const slug =
		(title || 'chart')
			.normalize('NFKC')
			.replace(/[^\p{L}\p{N}_-]+/gu, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 70) || 'chart';
	return `chart-${slug}`;
}

export function downloadChartBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	try {
		link.click();
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
