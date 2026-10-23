/** Data colors are fixed, independent of wallpaper accents and glass materials. */
export const CHART_BASE_COLORS = [
	'#00BEFF',
	'#00A3A3',
	'#00C853',
	'#AEEA00',
	'#FF6D00',
	'#FF1744',
	'#D500F9',
	'#651FFF',
	'#263238'
] as const;
export const CHART_COLOR_COUNT = 20;

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function rgb(hex: string) {
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function lab(hex: string) {
	const [r, g, b] = rgb(hex).map(linear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}
function linearRgb(L: number, C: number, hue: number) {
	const a = C * Math.cos((hue * Math.PI) / 180),
		b = C * Math.sin((hue * Math.PI) / 180);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}
function wheelColor(L: number, hue: number) {
	let low = 0,
		high = 0.26;
	for (let i = 0; i < 18; i++) {
		const mid = (low + high) / 2;
		if (linearRgb(L, mid, hue).every((v) => v >= 0 && v <= 1)) low = mid;
		else high = mid;
	}
	// Reject dull wheel regions at this lightness rather than desaturating them.
	if (low < 0.13) return null;
	return (
		'#' +
		linearRgb(L, low, hue)
			.map((v) =>
				Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
let extended: string[] | undefined;
export function chartPalette(count: number = CHART_BASE_COLORS.length): string[] {
	if (!Number.isInteger(count) || count < 0 || count > CHART_COLOR_COUNT)
		throw new RangeError('Invalid chart palette size');
	if (count <= CHART_BASE_COLORS.length) return CHART_BASE_COLORS.slice(0, count);
	if (!extended) {
		const selected: string[] = [...CHART_BASE_COLORS];
		const points = selected.map(lab);
		const hues = Array.from({ length: 72 }, (_, i) => i * 5);
		const candidates = [0.54, 0.65, 0.76]
			// Allow luminous warm colors, but not dark orange/brown mixtures.
			.flatMap((L) =>
				hues.filter((h) => L >= 0.76 || h < 35 || h > 105).map((h) => wheelColor(L, h))
			)
			.filter((color): color is string => color !== null)
			.map((color) => ({ color, point: lab(color) }));
		while (selected.length < CHART_COLOR_COUNT) {
			// Farthest-point sampling favors missing wheel regions, with a small
			// adjacent-color bonus. Prefixes never depend on the requested count.
			let best = candidates[0],
				score = -Infinity;
			for (const candidate of candidates) {
				if (selected.includes(candidate.color)) continue;
				const next =
					Math.min(...points.map((p) => distance(p, candidate.point))) +
					0.08 * distance(points.at(-1)!, candidate.point);
				if (next > score) {
					best = candidate;
					score = next;
				}
			}
			selected.push(best.color);
			points.push(best.point);
		}
		extended = selected;
	}
	return extended.slice(0, count);
}
export const CHART_STYLE_PROPERTIES = [
	...Array.from({ length: CHART_COLOR_COUNT }, (_, i) => `--llampart-chart-${i + 1}`),
	...Array.from({ length: CHART_COLOR_COUNT }, (_, i) => `--llampart-chart-fill-${i + 1}`),
	'--llampart-chart-separator'
];
export function resolveChartPalette(): Record<string, string> {
	return Object.fromEntries([
		...chartPalette(CHART_COLOR_COUNT).flatMap((color, i) => [
			[`--llampart-chart-${i + 1}`, color],
			[`--llampart-chart-fill-${i + 1}`, color]
		]),
		['--llampart-chart-separator', 'rgb(255 255 255 / 0.25)']
	]);
}
