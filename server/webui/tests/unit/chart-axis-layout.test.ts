import { expect, it } from 'vitest';
import { scaleBand } from 'd3-scale';
import { chartAxisLayout, axisLabelLines, categoryAxis } from '$lib/charts/chart-axis-layout';

const measure = (s: string) => [...s].reduce((n, c) => n + (c === 'W' ? 10 : 5), 0);
it('uses actual tick positions and thins dense categories, not their data', () => {
	const names = Array.from({ length: 20 }, (_, i) => `Regionalny sklep stacjonarny ${i}`);
	const scale = scaleBand().domain(names).range([0, 500]);
	const axis = categoryAxis(600, false, { left: 50, right: 50 }, 200, 10, measure);
	const ticks = axis.ticks(scale);
	expect(ticks.length).toBeGreaterThan(0);
	expect(ticks.length).toBeLessThan(names.length);
	expect(ticks[0]).toBe(names[0]);
	expect(ticks.at(-1)).toBe(names.at(-1));
	expect(ticks).toEqual(names.filter((name) => ticks.includes(name)));
	expect(scale.domain()).toEqual(names);
	expect(scale.range()).toEqual([0, 500]);
	for (const tick of ticks) {
		expect(axis.format(tick)).not.toContain('…');
		expect(axis.format(tick).split('\n').length).toBeLessThanOrEqual(2);
	}
});
it('never caps formatted numeric widths and reserves a second row in the bottom margin', () => {
	const metrics = { size: 10, category: 260, number: 170 };
	const first = chartAxisLayout(600, false, metrics, true, true, ['Sklep stacjonarny'], measure, 1);
	const two = chartAxisLayout(600, false, metrics, true, true, ['Sklep stacjonarny'], measure, 2);
	expect(first.numberWidth).toBeGreaterThanOrEqual(170);
	expect(first.padding.left).toBeGreaterThan(170);
	expect(two.padding.bottom).toBeGreaterThan(first.padding.bottom);
	for (const value of Object.values(two.padding)) {
		expect(Number.isFinite(value)).toBe(true);
		expect(value).toBeGreaterThan(0);
	}
	expect(two.padding.left + two.padding.right).toBeLessThan(600);
});
it('bounds the horizontal category gutter but gives real names two lines', () => {
	const names = ['Sklep stacjonarny w regionie mazowieckim'];
	const plan = chartAxisLayout(
		600,
		true,
		{ size: 10, category: measure(names[0]), number: 60 },
		false,
		true,
		names,
		measure
	);
	expect(plan.padding.left + plan.padding.right).toBeLessThan(600);
	expect(axisLabelLines(names[0], plan.categoryWidth, measure).join(' ')).toBe(names[0]);
});
