import { expect, it } from 'vitest';
import { scaleBand } from 'd3-scale';
import { chartAxisLayout, axisLabelLines, categoryAxis } from '$lib/charts/chart-axis-layout';

const measure = (s: string) => [...s].reduce((n, c) => n + (c === 'W' ? 10 : 5), 0);
it('keeps full text that fits, regardless of character count', () => {
	const text = 'Bardzo długa nazwa kategorii mieszcząca się w swoim slocie';
	expect(axisLabelLines(text, measure(text), measure)).toEqual([text]);
});
it('wraps at words into no more than two rows before any ellipsis', () => {
	expect(axisLabelLines('Regionalny sklep stacjonarny', 100, measure)).toEqual([
		'Regionalny sklep',
		'stacjonarny'
	]);
	expect(axisLabelLines('WWWWWW', 30, measure)).toEqual([]);
});
it('uses actual tick positions and thins dense categories, not their data', () => {
	const names = Array.from({ length: 20 }, (_, i) => `Regionalny sklep stacjonarny ${i}`);
	const scale = scaleBand().domain(names).range([0, 500]);
	const axis = categoryAxis(600, false, { left: 50, right: 50 }, 200, 10, measure);
	const ticks = axis.ticks(scale);
	expect(ticks.length).toBeLessThan(names.length);
	expect(scale.domain()).toEqual(names);
	for (const tick of ticks) {
		expect(axis.format(tick)).not.toContain('…');
		expect(axis.format(tick).split('\n').length).toBeLessThanOrEqual(2);
	}
});
it('retains short labels, handles resize and font metric changes', () => {
	const names = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze'];
	const axis = categoryAxis(600, false, { left: 50, right: 50 }, 200, 10, measure);
	expect(axis.ticks(scaleBand().domain(names).range([0, 500]))).toEqual(names);
	for (const value of names) expect(axis.format(value)).toBe(value);
	const large = categoryAxis(300, false, { left: 50, right: 50 }, 100, 20, (s) => measure(s) * 3);
	expect(large.ticks(scaleBand().domain(names).range([0, 200])).length).toBeLessThan(names.length);
});
it('never caps formatted numeric widths and reserves a second row in the bottom margin', () => {
	const metrics = { size: 10, category: 260, number: 170 };
	const first = chartAxisLayout(600, false, metrics, true, true, ['Sklep stacjonarny'], measure, 1);
	const two = chartAxisLayout(600, false, metrics, true, true, ['Sklep stacjonarny'], measure, 2);
	expect(first.numberWidth).toBeGreaterThanOrEqual(170);
	expect(first.padding.left).toBeGreaterThan(170);
	expect(two.padding.bottom - first.padding.bottom).toBe(15);
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
	expect(plan.padding.left).toBeLessThan(300);
	expect(axisLabelLines(names[0], plan.categoryWidth, measure).join(' ')).toBe(names[0]);
});
