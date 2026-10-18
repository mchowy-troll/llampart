import { describe, expect, it } from 'vitest';
import { remark } from 'remark';
import {
	diagramType,
	MAX_DIAGRAM_SOURCE,
	MAX_DIAGRAM_LINES,
	MAX_DIAGRAM_EDGES,
	DIAGRAM_TYPES
} from '$lib/diagrams/mermaid-policy';
import { MAX_MESSAGE_DIAGRAMS } from '$lib/markdown/mermaid-blocks';
import {
	diagramConfig,
	diagramTypography,
	diagramFill,
	diagramInk,
	diagramLuminance
} from '$lib/diagrams/mermaid-presentation';
import { diagramTitle, adjacentDiagramTitle } from '$lib/diagrams/diagram-title';
import { chartPalette } from '$lib/themes/frosted-glass/chart-palette';
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
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';

const font = {
	family: '"Llampart Crimson Text"',
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
	it.each([
		'pie',
		'xychart-beta',
		'classDiagram',
		'stateDiagram',
		'journey',
		'gitGraph',
		'flowchartEvil',
		'sequenceDiagram',
		'erDiagram'
	])('rejects %s', (type) => expect(() => diagramType(type)).toThrow());
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
		expect(() => diagramType('gantt\n' + '\n'.repeat(1201))).toThrow();
		for (const source of [
			'gantt\n dateFormat YYYY-MM-DD\n Łódź :a, 2026-01-01, 30d',
			'flowchart LR\nA@{shape: diamond, label: "Decyzja"} --> B'
		])
			expect(() => diagramType(source)).not.toThrow();
	});
	it('keeps the format instruction short and independent of preferences', () => {
		expect(MERMAID_INSTRUCTIONS.length).toBeLessThan(1600);
		DIAGRAM_TYPES.forEach((type) => expect(MERMAID_INSTRUCTIONS).toContain(type));
		expect(MERMAID_INSTRUCTIONS).toContain(`${MAX_MESSAGE_DIAGRAMS} diagrams`);
		expect(MERMAID_INSTRUCTIONS).toContain(`${MAX_DIAGRAM_SOURCE / 1024} KiB`);
		expect(MERMAID_INSTRUCTIONS).toContain(`${MAX_DIAGRAM_LINES} lines`);
		expect(MERMAID_INSTRUCTIONS).toContain(`${MAX_DIAGRAM_EDGES} edges`);
		expect(MERMAID_INSTRUCTIONS).toContain('Markdown table or text');
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
		for (let end = 1; end < body.length; end++) {
			const partial = `${marker}mermaid\n${body.slice(0, end)}`;
			const node = parse(partial)[0];
			expect(isMermaidNode(node) && isClosedMermaidNode(node, partial)).toBe(false);
			expect(detectIncompleteMermaidBlock(partial)?.code).toBe(body.slice(0, end));
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

describe('shared presentation and bounded exports', () => {
	it('uses the deterministic chart palette for every theme slot, with contrasting labels', () => {
		const config = diagramConfig(font);
		const palette = chartPalette();
		expect(config.themeVariables.THEME_COLOR_LIMIT).toBe(9);
		palette.forEach((color, i) => {
			expect(config.themeVariables[`cScale${i}`]).toBe(diagramFill(color));
			expect(config.themeVariables[`cScaleInv${i}`]).toBe(color);
			expect(config.themeVariables[`cScaleLabel${i}`]).toBe(diagramInk(diagramFill(color)));
			const l1 = diagramLuminance(diagramFill(color)),
				l2 = diagramLuminance(diagramInk(diagramFill(color)));
			expect((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toBeGreaterThanOrEqual(4.5);
		});
		expect(diagramConfig(font)).toEqual(config);
		expect(config).toMatchObject({
			securityLevel: 'strict',
			htmlLabels: false,
			layout: 'elk',
			flowchart: { curve: 'rounded' }
		});
		expect(config).not.toHaveProperty('sequence');
		expect(config).not.toHaveProperty('er');
		expect(config.themeCSS).not.toContain('paint-order:stroke');
		expect(config.themeVariables.edgeLabelBackground).toBe('transparent');
	});
	it('scales layout spacing and padding before rendering for all diagram families', () => {
		const small = diagramConfig({ ...font, size: 16 }),
			large = diagramConfig({ ...font, size: 24 });
		const spacing = (config: ReturnType<typeof diagramConfig>) => [
			config.flowchart?.rankSpacing,
			config.state?.padding,
			config.gantt?.barGap,
			config.mindmap?.padding
		];
		spacing(large).forEach((value, i) => {
			expect(value).toBeTypeOf('number');
			expect(value).toBeGreaterThan(Number(spacing(small)[i]));
		});
		expect(small.flowchart?.nodeSpacing).toBeGreaterThanOrEqual(56);
	});
	it('passes actual family, weight, style and px size to layout, not only post-render CSS', () => {
		const config = diagramConfig(font);
		expect(config.fontFamily).toBe(font.family);
		expect(config.fontSize).toBe(20);
		expect(config.gantt).toMatchObject({ fontSize: 20, sectionFontSize: 20 });
		expect(config.themeCSS).toContain('font-weight:600');
		expect(config.themeCSS).toContain('font-style:italic');
		expect(diagramConfig({ ...font, size: 16 })).not.toEqual(config);
		expect(diagramTypography).toBeTypeOf('function');
	});
	it('keeps normal PNGs 2x and bounds large canvases by both area and dimension', () => {
		expect(pngDimensions(600, 400)).toEqual({ width: 1200, height: 800 });
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
	it('does not treat the next statement as an empty native/comment title', () => {
		expect(diagramTitle('flowchart LR\naccTitle:\nA --> B')).toBeUndefined();
		expect(diagramTitle('flowchart LR\n%% title:\nA --> B')).toBeUndefined();
	});
	it('reads only adjacent Markdown headings and bold-only titles as text', () => {
		for (const heading of ['### Cykl **zamówienia**', '**Plan `wdrożenia`**'])
			expect(adjacentDiagramTitle(parse(heading)[0])).toMatch(/Cykl zamówienia|Plan wdrożenia/);
		for (const prose of ['Zwykły akapit', '**Plan** i dalsze wyjaśnienie', '```text\nTytuł\n```'])
			expect(adjacentDiagramTitle(parse(prose)[0])).toBeUndefined();
		expect(adjacentDiagramTitle(undefined)).toBeUndefined();
	});
	it.each(DIAGRAM_TYPES)(
		'reads a plain title comment for %s without changing the grammar',
		(type) => {
			expect(diagramTitle(`${type}\n %% title: Przepływ żądania LLM\nA --> B`)).toBe(
				'Przepływ żądania LLM'
			);
		}
	);
	it('supports native titles, precedence and an absent-title fallback', () => {
		expect(diagramTitle('gantt\n title Plan wdrożenia')).toBe('Plan wdrożenia');
		expect(diagramTitle('flowchart LR\n accTitle: Komunikacja\n %% title: Inny')).toBe(
			'Komunikacja'
		);
		expect(diagramTitle('flowchart LR\n %% title: Łódź — 東京')).toBe('Łódź — 東京');
		expect(diagramTitle('flowchart LR\nA[title is not metadata] --> B')).toBeUndefined();
		expect(diagramTitle('mindmap\nroot((llampart))')).toBeUndefined();
	});
});
