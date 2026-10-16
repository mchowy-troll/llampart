import { describe, expect, it } from 'vitest';
import {
	STATIC_CHART_POINTS,
	HOVER_CHART_POINTS,
	showStaticChartPoints
} from '$lib/charts/chart-points';

describe('persistent Line/Area dots', () => {
	it('are larger than before but smaller than the unchanged hover points', () => {
		expect(STATIC_CHART_POINTS.r).toBeGreaterThan(2.5);
		expect(STATIC_CHART_POINTS.r).toBeLessThan(HOVER_CHART_POINTS.r);
		expect(HOVER_CHART_POINTS).toEqual({ r: 4.5, strokeWidth: 2, stroke: 'white' });
	});
	it('have no ring, halo or white outline', () => {
		expect(STATIC_CHART_POINTS).toEqual({ r: 3.25, stroke: 'none', strokeWidth: 0 });
	});
	it.each([1, 3, 40])('keeps dots for %i rows', (rows) =>
		expect(showStaticChartPoints(rows)).toBe(true)
	);
	it.each([41, 500])('avoids persistent-dot clutter for %i rows', (rows) =>
		expect(showStaticChartPoints(rows)).toBe(false)
	);
});
