import { describe, expect, it } from 'vitest';
import {
	chartPalette,
	CHART_BASE_COLORS,
	resolveChartPalette
} from '$lib/themes/frosted-glass/chart-palette';
import { frostedGlassTheme } from '$lib/themes/frosted-glass';
import { FROSTED_GLASS_CONFIG_DEFAULT } from '$lib/themes/frosted-glass/config';

const base = [
	'#0066FF',
	'#00A3A3',
	'#00C853',
	'#AEEA00',
	'#FF6D00',
	'#FF1744',
	'#D500F9',
	'#651FFF',
	'#263238'
];
// Independent sRGB -> OKLab check of the generated (not user-fixed) colors.
function oklab(hex: string) {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	const [l, m, s] = [
		0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
		0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
		0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
	].map(Math.cbrt);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}
describe('fixed chart color wheel', () => {
	it('keeps generated colors chromatic and perceptually separated, especially adjacent ones', () => {
		const points = chartPalette(20).map(oklab);
		const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
		for (let i = 9; i < points.length; i++) {
			expect(Math.hypot(points[i][1], points[i][2])).toBeGreaterThanOrEqual(0.13);
			expect(Math.min(...points.slice(0, i).map((p) => distance(p, points[i])))).toBeGreaterThan(
				0.1
			);
			expect(distance(points[i - 1], points[i])).toBeGreaterThan(0.16);
		}
	});
	it('uses the exact approved nine colors in order', () => {
		expect(CHART_BASE_COLORS).toEqual(base);
		expect(chartPalette()).toEqual(base);
		expect(chartPalette(5)).toEqual(base.slice(0, 5));
		expect(chartPalette(5).at(0)).toBe('#0066FF');
		expect(chartPalette(5).at(-1)).toBe('#FF6D00');
	});
	it.each([
		[10, '#b89eff'],
		[15, '#00c1fe'],
		[20, '#00cdb4']
	] as const)('extends to %i without cycling or changing any prefix', (count, last) => {
		const colors = chartPalette(count);
		expect(colors).toHaveLength(count);
		expect(new Set(colors).size).toBe(count);
		expect(colors.slice(0, 9)).toEqual(base);
		expect(colors.at(-1)).toMatch(/^#[0-9a-f]{6}$/);
		expect(colors.at(-1)).toBe(last);
		expect(base).not.toContain(colors.at(-1));
		expect(colors).toEqual(chartPalette(20).slice(0, count));
	});
	it('is deterministic and protects cached colors from caller mutation', () => {
		const before = chartPalette(20);
		chartPalette(20).reverse();
		expect(chartPalette(20)).toEqual(before);
		expect(chartPalette(9)).toEqual(base);
	});
	it('keeps data tokens identical while the theme wallpaper changes', () => {
		const a = frostedGlassTheme.resolveRuntime(
			{ ...FROSTED_GLASS_CONFIG_DEFAULT, frostedGlassWallpaper: 'frosted-glass-01' } as Parameters<
				typeof frostedGlassTheme.resolveRuntime
			>[0],
			0
		);
		const b = frostedGlassTheme.resolveRuntime(
			{ ...FROSTED_GLASS_CONFIG_DEFAULT, frostedGlassWallpaper: 'frosted-glass-02' } as Parameters<
				typeof frostedGlassTheme.resolveRuntime
			>[0],
			0
		);
		expect(a.styles['--llampart-theme-wallpaper']).not.toEqual(
			b.styles['--llampart-theme-wallpaper']
		);
		for (const [key, value] of Object.entries(resolveChartPalette())) {
			expect(a.styles[key as keyof typeof a.styles]).toBe(value);
			expect(b.styles[key as keyof typeof b.styles]).toBe(value);
		}
	});
	it('resolves every category token without changing base or fill colors', () => {
		const tokens = resolveChartPalette();
		chartPalette(20).forEach((color, i) => {
			expect(tokens[`--llampart-chart-${i + 1}`]).toBe(color);
			expect(tokens[`--llampart-chart-fill-${i + 1}`]).toBe(color);
		});
	});
});
