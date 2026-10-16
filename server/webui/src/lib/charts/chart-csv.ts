import type { ChartSpec } from './chart-schema';

function field(value: string | number): string {
	// Spreadsheet engines may skip whitespace/control characters before a formula.
	// Numeric values are never prefixed: negative numbers remain numbers.
	let text =
		typeof value === 'number' ? String(value) : value.replace(/^(?=[\s\p{Cc}\p{Cf}]*[=+@-])/u, "'");
	if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
	return text;
}

export function chartCsv(spec: ChartSpec): string {
	const keys =
		'series' in spec
			? [spec.xKey, ...spec.series.map((series) => series.key)]
			: [spec.labelKey, spec.valueKey];
	const headers =
		'series' in spec
			? [spec.xLabel || spec.xKey, ...spec.series.map((series) => series.label)]
			: [spec.labelKey, spec.valueKey];
	return (
		'\uFEFF' +
		[headers, ...spec.data.map((row) => keys.map((key) => row[key]))]
			.map((row) => row.map(field).join(','))
			.join('\r\n') +
		'\r\n'
	);
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
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
