import { describe, expect, it } from 'vitest';
import { ganttLayout, ganttPresentationSource, ganttTickIndices } from '$lib/diagrams/gantt-layout';
import {
	mindmapPresentationSource,
	statePresentationSource
} from '$lib/diagrams/mermaid-presentation';

const font = { family: 'Fira Sans', size: 16, weight: '400', style: 'normal', color: '#111111' };
const measure = (text: string) => text.length * 9;

const task = (name: string, start = '2026-10-01', end = '2026-10-16') => ({
	task: name,
	section: 'Przygotowanie',
	startTime: new Date(start),
	endTime: new Date(end)
});

describe('native Gantt presentation plan', () => {
	it('thins overlapping tick boxes without losing endpoints', () => {
		const boxes = [0, 30, 60, 90, 120].map((left) => ({ left, right: left + 38 }));
		const kept = ganttTickIndices(boxes, 8);
		expect(kept[0]).toBe(0);
		expect(kept.at(-1)).toBe(boxes.length - 1);
		for (let i = 1; i < kept.length; i++)
			expect(boxes[kept[i]].left - boxes[kept[i - 1]].right).toBeGreaterThanOrEqual(8);
	});
	it('reserves metric-based section and outside-label space before rendering', () => {
		const tasks = [task('Pełna i bardzo długa nazwa zadania dla klienta')];
		const original = structuredClone(tasks);
		const plan = ganttLayout(tasks, font, measure);
		for (const value of [plan.left, plan.right, plan.width])
			expect(Number.isFinite(value)).toBe(true);
		expect(plan.right).toBeGreaterThan(measure(tasks[0].task));
		expect(plan.left).toBeGreaterThan(measure(tasks[0].section));
		expect(plan.width - plan.left - plan.right).toBeGreaterThanOrEqual(1200);
		expect(tasks).toEqual(original);
	});
	it('avoids repeated year labels on a multi-year axis', () => {
		const years = ganttLayout([task('A', '2020-01-01', '2030-01-01')], font, measure);
		expect(years.format).toBe('%Y');
		expect(years.interval).toMatch(/^[1-9]\d*month$/);
		expect(parseInt(years.interval) % 12).toBe(0);
	});
	it('uses supported directives, keeps all schedule data and never edits stored source', () => {
		const source =
			'gantt\ntitle Harmonogram\naxisFormat %Y-%m-%d\ntickInterval 1day\ntodayMarker stroke:red\nsection Plan\nŁódź :a,2026-10-01,2d\nKoniec :milestone,after a,0d';
		const plan = ganttLayout([task('Łódź')], font, measure);
		const rendered = ganttPresentationSource(source, plan);
		expect(rendered).toContain('Łódź :a,2026-10-01,2d\nKoniec :milestone,after a,0d');
		expect(rendered).toContain('todayMarker off');
		expect(rendered).not.toContain('stroke:red');
		expect(rendered).not.toContain('title Harmonogram');
		expect(source).toContain('title Harmonogram');
		expect(source).toContain('todayMarker stroke:red');
	});
	it('bounds extreme measured labels and invalid parsed dates', () => {
		expect(() => ganttLayout([task('A')], font, () => 20000)).toThrow('limit');
		expect(() => ganttLayout([task('A', 'invalid')], font, measure)).toThrow('limit');
	});
});

it('normalizes a Mindmap root without changing stored source or branches, idempotently', () => {
	const source = '%% comment\nmindmap\n%% title: Strategia\nroot((Firma))\n  A\n    B((C))\n  D';
	const next = mindmapPresentationSource(source);
	expect(next).toContain('\nroot(Firma)\n');
	expect(next).toContain('\n  A\n    B((C))\n  D');
	expect(next).toContain('%% title: Strategia');
	expect(mindmapPresentationSource(next)).toBe(next);
	expect(source).toContain('root((Firma))');
});

it('preserves State transitions and label content in the render-local source', () => {
	const source =
		'stateDiagram-v2\nA --> B: Dane poprawne\nB --> C: Wynik\nC --> [*]: Akceptacja całego zamówienia\nA: Nazwa stanu';
	const rendered = statePresentationSource(source, measure);
	expect(rendered.replaceAll('<br/>', ' ')).toBe(source);
	expect(source).not.toContain('<br/>');
});
