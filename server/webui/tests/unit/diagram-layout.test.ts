import { describe, expect, it, vi } from 'vitest';
import { ganttLayout, ganttPresentationSource, ganttTickIndices } from '$lib/diagrams/gantt-layout';
import { diagramGroupColors, paintDiagramGroups } from '$lib/diagrams/diagram-groups';
import { CHART_BASE_COLORS } from '$lib/themes/frosted-glass/chart-palette';
import {
	mindmapPresentationSource,
	statePresentationSource,
	finishMindmapPresentation,
	edgeLabelTypography,
	flowchartSectionPresentation,
	stateSectionPresentation,
	diagramConfig
} from '$lib/diagrams/mermaid-presentation';
import { VISUALIZATION_LABEL_SIZE } from '$lib/utils/visualization-typography';

const font = { family: 'Fira Sans', size: 16, weight: '400', style: 'normal', color: '#111111' };
const measure = (text: string) => text.length * 9;

it('rounds only Flowchart groups and aligns bold horizontal titles without changing node bounds', () => {
	const radius = vi.fn();
	const weight = vi.fn();
	const transform = vi.fn();
	const rect = {
		setAttribute: radius,
		x: { baseVal: { value: 20 } },
		y: { baseVal: { value: 30 } }
	};
	const label = {
		querySelectorAll: () => [{ style: { setProperty: weight } }],
		getBBox: () => ({ x: -5, y: -10 }),
		setAttribute: transform
	};
	const svg = {
		querySelectorAll: vi.fn(() => [
			{ querySelector: (s: string) => (s === ':scope > rect' ? rect : label) }
		])
	};
	flowchartSectionPresentation(svg as unknown as SVGSVGElement, font);
	expect(svg.querySelectorAll).toHaveBeenCalledWith('g.cluster');
	expect(radius.mock.calls).toEqual([
		['rx', '8'],
		['ry', '8']
	]);
	expect(weight).toHaveBeenCalledWith('font-weight', '700', 'important');
	expect(transform).toHaveBeenCalledWith('transform', 'translate(41,52)');
	expect(diagramConfig(font).themeCSS).toContain('.node rect{rx:8px;ry:8px;');
});

it('keeps Gantt bar/milestone geometry at the pre-increment size', () => {
	const old = diagramConfig({ ...font, size: 9.6, labelSize: 9.6 }).gantt!;
	const next = diagramConfig({ ...font, size: 10.6, labelSize: 9.6 }).gantt!;
	expect(next.fontSize).toBe(10.6);
	for (const key of ['barHeight', 'barGap', 'topPadding'] as const)
		expect(next[key]).toBe(old[key]);
});

it('shares the existing donut size and scopes the edge override away from nodes and clusters', () => {
	expect(VISUALIZATION_LABEL_SIZE).toBe('calc(var(--llampart-text-unit, 1rem) * 0.8)');
	for (const size of [9.6, 12.8, 18]) {
		expect(edgeLabelTypography('llampart-diagram-1', size)).toBe(
			`#llampart-diagram-1 .edgeLabel text,#llampart-diagram-1 .edgeLabel tspan{font-size:${size}px!important}`
		);
	}
});

it('removes only the dedicated Mindmap node underline, not node shapes or branches', () => {
	const remove = vi.fn();
	const querySelectorAll = vi.fn((selector: string) =>
		selector === '.mindmap-node > line.node-line-' ? [{ remove }] : []
	);
	finishMindmapPresentation({ querySelectorAll } as unknown as SVGSVGElement);
	expect(remove).toHaveBeenCalledOnce();
	expect(querySelectorAll).toHaveBeenCalledTimes(1);
});
const task = (name: string, start = '2026-10-01', end = '2026-10-16') => ({
	task: name,
	section: 'Przygotowanie',
	startTime: new Date(start),
	endTime: new Date(end)
});

describe('native Gantt presentation plan', () => {
	it('thins real tick boxes at month/year boundaries, retaining the endpoints', () => {
		// Text, not calendar arithmetic, decides whether 31.07 / 01.08 fit.
		const boxes = [0, 30, 60, 90, 120].map((left) => ({ left, right: left + 38 }));
		expect(ganttTickIndices(boxes, 8)).toEqual([0, 2, 4]);
		expect(ganttTickIndices([], 8)).toEqual([]);
		expect(ganttTickIndices([{ left: 0, right: 38 }], 8)).toEqual([0]);
		expect(
			ganttTickIndices(
				[
					{ left: 0, right: 38 },
					{ left: 46, right: 84 }
				],
				8
			)
		).toEqual([0, 1]);
	});
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

it('uses a single flowchart-like surface and measured, theme-colored composite titles', () => {
	const fill = vi.fn();
	const transform = vi.fn();
	const radius = vi.fn();
	const outer = {
		classList: { contains: () => false },
		style: { fill: '', stroke: '' },
		setAttribute: radius,
		x: { baseVal: { value: 20 } },
		y: { baseVal: { value: 30 } },
		width: { baseVal: { value: 200 } }
	};
	const inner = { classList: { contains: () => true }, style: { fill: '', stroke: '' } };
	const label = {
		querySelector: () => ({
			getBBox: () => ({ x: -5, y: -10, width: 100 }),
			querySelector: () => null
		}),
		getBBox: () => ({ x: -5, y: -10, width: 100 }),
		querySelectorAll: () => [{ style: { setProperty: fill } }],
		setAttribute: transform
	};
	const group = {
		id: 'render-dark',
		classList: { contains: () => true },
		querySelectorAll: vi.fn(() => [outer, inner]),
		querySelector: (selector: string) => (selector.includes('rect.outer') ? outer : label)
	};
	const svg = { querySelectorAll: (selector: string) => (selector === 'g.node' ? [] : [group]) };
	paintDiagramGroups(svg as unknown as SVGSVGElement, 'render', new Map([['dark', '#263238']]));
	expect(group.querySelectorAll).toHaveBeenCalledWith(
		':scope > g > rect.outer,:scope > rect.inner'
	);
	expect(outer.style).toEqual({ fill: '#2632380C', stroke: '#26323866' });
	expect(inner.style).toEqual({ fill: 'none', stroke: 'none' });
	stateSectionPresentation(svg as unknown as SVGSVGElement, font);
	expect(fill).toHaveBeenCalledWith('fill', font.color, 'important');
	expect(fill).toHaveBeenCalledWith('font-weight', '700', 'important');
	expect(transform).toHaveBeenCalledWith('transform', 'translate(41,52)');
	expect(radius.mock.calls).toEqual([
		['rx', '8'],
		['ry', '8']
	]);
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
