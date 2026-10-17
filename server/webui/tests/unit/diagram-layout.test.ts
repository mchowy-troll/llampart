import { describe, expect, it, vi } from 'vitest';
import { ganttLayout, ganttPresentationSource } from '$lib/diagrams/gantt-layout';
import { diagramGroupColors, paintDiagramGroups } from '$lib/diagrams/diagram-groups';
import { CHART_BASE_COLORS } from '$lib/themes/frosted-glass/chart-palette';
import {
	mindmapPresentationSource,
	statePresentationSource,
	softenMindmapBranches
} from '$lib/diagrams/mermaid-presentation';

const font = { family: 'Fira Sans', size: 16, weight: '400', style: 'normal', color: '#111111' };
const measure = (text: string) => text.length * 9;

it('removes only the dedicated Mindmap node underline, not node shapes or branches', () => {
	const remove = vi.fn();
	const querySelectorAll = vi.fn((selector: string) =>
		selector === '.mindmap-node > line.node-line-' ? [{ remove }] : []
	);
	softenMindmapBranches({ querySelectorAll } as unknown as SVGSVGElement);
	expect(remove).toHaveBeenCalledOnce();
	expect(querySelectorAll).toHaveBeenCalledWith('path.edge[class*="edge-depth-"]');
});
const task = (name: string, start = '2026-10-01', end = '2026-10-16') => ({
	task: name,
	section: 'Przygotowanie',
	startTime: new Date(start),
	endTime: new Date(end)
});

describe('native Gantt presentation plan', () => {
	it('reserves metric-based section and outside-label space before rendering', () => {
		const normal = ganttLayout([task('Analiza')], font, measure);
		const long = ganttLayout(
			[task('Pełna i bardzo długa nazwa zadania dla klienta')],
			font,
			measure
		);
		expect(long.right).toBeGreaterThan(normal.right);
		expect(long.left).toBeGreaterThan(measure('Przygotowanie'));
		expect(long.width - long.left - long.right).toBeGreaterThanOrEqual(1200);
	});
	it('adapts short, monthly and multi-year axes to font metrics', () => {
		const short = ganttLayout([task('A')], font, measure);
		const months = ganttLayout([task('A', '2026-01-01', '2027-06-30')], font, measure);
		const years = ganttLayout([task('A', '2020-01-01', '2030-01-01')], font, measure);
		expect(short.format).toBe('%d.%m');
		expect(months.format).toBe('%m.%Y');
		expect(years.format).toBe('%Y');
		expect(short.interval).toMatch(/^\d+(day|week)$/);
		expect(years.interval).toMatch(/^\d+month$/);
		expect(parseInt(years.interval) % 12).toBe(0);
		expect(ganttLayout([task('A')], font, (s) => measure(s) * 3).interval).not.toBe(short.interval);
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

it.each(['root((Firma))', 'root[Firma]', 'root(Firma)', 'root{{Firma}}', 'Firma'])(
	'uses a native rounded root before layout, changing no branches: %s',
	(root) => {
		const source = `%% comment\nmindmap\n%% title: Strategia\n${root}\n  A\n    B((C))\n  D`;
		const next = mindmapPresentationSource(source);
		expect(next).toContain(root === 'Firma' ? '\n(Firma)\n' : '\nroot(Firma)\n');
		expect(next).toContain('\n  A\n    B((C))\n  D');
		expect(next).toContain('%% title: Strategia');
		expect(mindmapPresentationSource(next)).toBe(next);
	}
);

it('balances plain multiword state transitions before native edge layout', () => {
	const source =
		'stateDiagram-v2\nA --> B: Dane poprawne\nB --> C: Wynik\nC --> [*]: Akceptacja całego zamówienia\nA: Nazwa stanu';
	const rendered = statePresentationSource(source, measure);
	expect(rendered).toContain('A --> B: Dane<br/>poprawne');
	expect(rendered).toContain('B --> C: Wynik');
	expect(rendered).toContain('A: Nazwa stanu');
	expect(rendered).toContain('C --> [*]: Akceptacja<br/>całego zamówienia');
	expect(source).not.toContain('<br/>');
});

it('distinguishes decisions using the adjacent palette slot, never inferred label roles', () => {
	const colors = diagramGroupColors([
		{ id: 'a', domId: 'a', shape: 'diamond' },
		{ id: 'b', domId: 'b', shape: 'squareRect' }
	]);
	expect(colors.get('a')).toBe(CHART_BASE_COLORS[1]);
	expect(colors.has('b')).toBe(false);
});

it('keeps composite-state titles legible on the darkest palette fill', () => {
	const fill = vi.fn();
	const group = {
		id: 'render-dark',
		classList: { contains: () => true },
		querySelectorAll: (selector: string) =>
			selector === 'rect' ? [] : [{ style: { setProperty: fill } }]
	};
	const svg = { querySelectorAll: (selector: string) => (selector === 'g.node' ? [] : [group]) };
	paintDiagramGroups(svg as unknown as SVGSVGElement, 'render', new Map([['dark', '#263238']]));
	expect(fill).toHaveBeenCalledWith('fill', '#ffffff', 'important');
});

it('colors only explicit parser groups, deterministically in shared palette order', () => {
	const nodes = [
		{ id: 'client', isGroup: true },
		{ id: 'server', isGroup: true },
		{ id: 'A', domId: 'flowchart-A-0', parentId: 'client' },
		{ id: 'B', domId: 'flowchart-B-1', parentId: 'server' },
		{ id: 'error', domId: 'flowchart-error-2' }
	];
	const colors = diagramGroupColors(nodes);
	expect(colors.get('flowchart-A-0')).toBe(CHART_BASE_COLORS[0]);
	expect(colors.get('flowchart-B-1')).toBe(CHART_BASE_COLORS[1]);
	expect(colors.has('flowchart-error-2')).toBe(false);
	expect(diagramGroupColors(nodes)).toEqual(colors);
});
