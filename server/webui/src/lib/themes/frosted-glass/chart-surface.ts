import { resolveChartPalette } from './chart-palette';

/** Local data tokens also reach portaled tooltips and non-glass themes.
 * Glass surfaces continue to react to theme/preview CSS; data colors do not. */
export function applyChartPalette(_node: HTMLElement, update: (styles: string) => void) {
	update(
		Object.entries(resolveChartPalette())
			.map(([key, value]) => `${key}:${value}`)
			.join(';')
	);
}
