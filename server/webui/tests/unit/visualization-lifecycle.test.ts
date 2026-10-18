import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChart } from '$lib/charts/chart-schema';
import { diagramType } from '$lib/diagrams/mermaid-policy';

const markdown = readFileSync(
	new URL('../fixtures/visualization-lifecycle.md', import.meta.url),
	'utf8'
);
const charts = [...markdown.matchAll(/```llampart-chart\n([\s\S]*?)```/g)].map((m) => m[1]);
const diagrams = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);

describe('visualization lifecycle regression sources', () => {
	it('accepts all four original chart payloads without weakening the schema', () => {
		expect(charts.map((source) => parseChart(source).success)).toEqual([true, true, true, true]);
		for (const source of charts) {
			expect(parseChart(JSON.stringify({ ...JSON.parse(source), unexpected: true })).success).toBe(
				false
			);
		}
	});

	it('accepts all four original Mermaid sources without allowing active directives', () => {
		expect(diagrams.map(diagramType)).toEqual(['flowchart', 'stateDiagram-v2', 'mindmap', 'gantt']);
		for (const source of diagrams) {
			expect(() => diagramType(source + '\nclick node "https://example.test"')).toThrow();
		}
	});
});
