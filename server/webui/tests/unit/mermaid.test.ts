import { describe, expect, it } from 'vitest';
import { remark } from 'remark';
import {
	diagramType,
	MAX_DIAGRAM_SOURCE,
	MAX_DIAGRAM_LINES,
	DIAGRAM_TYPES
} from '$lib/diagrams/mermaid-policy';
import { diagramConfig } from '$lib/diagrams/mermaid-presentation';
import { diagramTitle, adjacentDiagramTitle } from '$lib/diagrams/diagram-title';
import { pngDimensions } from '$lib/diagrams/diagram-export';
import {
	scanMermaidFences,
	isMermaidNode,
	isClosedMermaidNode,
	preprocessMermaidMarkdown,
	withoutClosedMermaidFences
} from '$lib/markdown/mermaid-blocks';
import {
	detectIncompleteMermaidBlock,
	detectIncompleteMathBlock
} from '$lib/markdown/markdown-streaming-policy';
import { preprocessChartMarkdown, isChartNode } from '$lib/markdown/chart-blocks';
import { preprocessLaTeX } from '$lib/utils/latex-protection';

const font = {
	family: '"Llampart Barlow", "Llampart Inter"',
	size: 20,
	weight: '600',
	style: 'italic',
	color: 'rgb(20, 25, 30)'
};
const fence = (source: string, marker = '```') => `${marker}mermaid\n${source}\n${marker}`;
const parse = (source: string) => remark().parse(source).children;

describe('Mermaid source boundary', () => {
	it.each([...DIAGRAM_TYPES, 'graph'])('allows only supported header %s with Unicode', (type) => {
		expect(diagramType(`%% Łódź\n${type}\n A --> B`)).toBe(type === 'graph' ? 'flowchart' : type);
	});
	it.each(['pie', 'stateDiagram', 'flowchartEvil', 'sequenceDiagram', 'erDiagram'])(
		'rejects %s',
		(type) => expect(() => diagramType(type)).toThrow()
	);
	it.each([
		'%%{init: {"securityLevel":"loose"}}%%\nflowchart LR',
		'---\nconfig:\n securityLevel: loose\n---\nflowchart LR',
		'flowchart LR\nclick A callback',
		'flowchart LR\nclick A "https://evil.test"',
		'flowchart LR\nA[<img src=x onerror=alert(1)>]',
		'flowchart LR\nA[<script>alert(1)</script>]',
		'flowchart LR\nstyle A fill:red',
		'flowchart LR\nclassDef red fill:red',
		'flowchart LR\nA:::red',
		'flowchart LR\nA@{img:"/local.png"}',
		'mindmap\n root\n  ::icon(fa fa-home)',
		'flowchart LR\nA[https://evil.test]',
		'flowchart LR\nA[//evil.test/a]',
		'flowchart LR\nA[&#60;img&#62;]',
		'flowchart LR\nA[#60;script#62;]',
		'flowchart LR\nA[&lt;script&gt;]',
		'flowchart LR\nA[javascript:alert(1)]'
	])('rejects active/configuration/styled input %j before lazy loading', (source) =>
		expect(() => diagramType(source)).toThrow()
	);
	it('limits source and line complexity, without restricting dates and supported shapes', () => {
		expect(() => diagramType('flowchart LR\n' + 'a'.repeat(MAX_DIAGRAM_SOURCE))).toThrow();
		expect(() => diagramType('gantt\n' + '\n'.repeat(MAX_DIAGRAM_LINES))).toThrow();
		for (const source of [
			'gantt\n dateFormat YYYY-MM-DD\n Łódź :a, 2026-01-01, 30d',
			'flowchart LR\nA@{shape: diamond, label: "Decyzja"} --> B'
		])
			expect(() => diagramType(source)).not.toThrow();
	});
	it('does not confuse plain label words with active statements', () => {
		for (const source of [
			'flowchart LR\nA[Click the button] --> B',
			'stateDiagram-v2\nstate "Click Start" as Ready'
		])
			expect(() => diagramType(source)).not.toThrow();
		expect(() => diagramType('flowchart LR; A --> B; click A callback')).toThrow();
	});
});

describe('MDAST fences and streaming/KaTeX isolation', () => {
	it.each(['```', '~~~~'])('requires an explicit closing %s fence', (marker) => {
		const body = 'flowchart LR\n A[Łódź $$ \\ce{x} \\(y\\)] --> B';
		const complete = fence(body, marker);
		for (const code of ['', 'flowchart LR\n A[', body]) {
			const partial = `${marker}mermaid\n${code}`;
			const node = parse(partial)[0];
			expect(isMermaidNode(node) && isClosedMermaidNode(node, partial)).toBe(false);
			expect(detectIncompleteMermaidBlock(partial)?.code).toBe(code);
		}
		const node = parse(complete)[0];
		expect(isMermaidNode(node) && isClosedMermaidNode(node, complete)).toBe(true);
		expect(detectIncompleteMermaidBlock(complete)).toBeNull();
		expect(parse(complete + '\n\nMore')[0].position).toEqual(node.position);
	});
	it('preserves literal Mermaid through math preprocessing alongside charts', () => {
		const diagram = fence('flowchart LR\n A[\\[\n$$\n\\ce{x}\\]] --> B', '~~~~');
		const chart = '```llampart-chart\n{"title":"$5 \\ce{x}"}\n```';
		const source = '$x^2$\n\n' + diagram + '\n\n' + chart;
		const normalized = preprocessMermaidMarkdown(source, (text) =>
			preprocessChartMarkdown(text, preprocessLaTeX)
		);
		expect(normalized).toContain(diagram);
		expect(normalized).toContain(chart);
		expect(parse(normalized).filter(isChartNode)).toHaveLength(1);
		expect(withoutClosedMermaidFences(source)).toHaveLength(source.length);
		expect(detectIncompleteMathBlock(withoutClosedMermaidFences(source))).toBeNull();
	});
	it('counts multiple diagrams and ignores Mermaid inside other code fences', () => {
		const block = fence('flowchart LR\nA --> B');
		const source = block + '\n\n' + block + '\n\n````text\n' + block + '\n````';
		expect(scanMermaidFences(source).count).toBe(2);
		expect(parse(source).filter(isMermaidNode)).toHaveLength(2);
		expect(parse('```mermaid extra\nflowchart LR\n```').some(isMermaidNode)).toBe(false);
	});
});

describe('Mermaid rendering safeguards', () => {
	it('disables active HTML in the engine configuration', () => {
		expect(diagramConfig(font)).toMatchObject({
			securityLevel: 'strict',
			htmlLabels: false
		});
	});
	it('bounds large canvases by both area and dimension', () => {
		for (const [w, h] of [
			[100000, 100],
			[100000, 100000],
			[1, 100000]
		]) {
			const result = pngDimensions(w, h);
			expect(result.width).toBeLessThanOrEqual(8192);
			expect(result.height).toBeLessThanOrEqual(8192);
			expect(result.width * result.height).toBeLessThanOrEqual(16_000_000);
		}
		expect(() => pngDimensions(NaN, 1)).toThrow();
	});
});

describe('diagram frame titles', () => {
	it('reads only adjacent Markdown headings and bold-only titles as text', () => {
		for (const heading of ['### Cykl **zamówienia**', '**Plan `wdrożenia`**'])
			expect(adjacentDiagramTitle(parse(heading)[0])).toMatch(/Cykl zamówienia|Plan wdrożenia/);
		for (const prose of ['Zwykły akapit', '**Plan** i dalsze wyjaśnienie', '```text\nTytuł\n```'])
			expect(adjacentDiagramTitle(parse(prose)[0])).toBeUndefined();
		expect(adjacentDiagramTitle(undefined)).toBeUndefined();
	});
	it('supports native titles, precedence and an absent-title fallback', () => {
		expect(diagramTitle('gantt\n title Plan wdrożenia')).toBe('Plan wdrożenia');
		expect(diagramTitle('flowchart LR\n accTitle: Komunikacja\n %% title: Inny')).toBe(
			'Komunikacja'
		);
		expect(diagramTitle('flowchart LR\n %% title: Łódź — 東京')).toBe('Łódź — 東京');
		expect(diagramTitle('flowchart LR\nA[title is not metadata] --> B')).toBeUndefined();
		expect(diagramTitle('flowchart LR\naccTitle:\nA --> B')).toBeUndefined();
		expect(diagramTitle('flowchart LR\n%% title:\nA --> B')).toBeUndefined();
	});
});
