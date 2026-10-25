import { describe, expect, it } from 'vitest';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import {
	isChartNode,
	isClosedChartNode,
	preprocessChartMarkdown,
	withoutClosedChartFences
} from '$lib/markdown/chart-blocks';
import { preprocessLaTeX } from '$lib/utils/latex-protection';
import { parseChart } from '$lib/charts/chart-schema';
import { detectIncompleteChartBlock } from '$lib/markdown/markdown-streaming-policy';
import { withChartInstructions, CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';

const json =
	'{"type":"line","xKey":"x","series":[{"key":"y","label":"Y"}],"data":[{"x":"a","y":2}]}';
const fence = '```llampart-chart\n' + json + '\n```';
const parse = (source: string) => remark().use(remarkGfm).parse(source).children;
describe('native Markdown chart classification', () => {
	it.each(['```', '~~~~'])('preserves literal JSON/math characters in %s fences', (marker) => {
		const source = `${marker}llampart-chart\n${JSON.stringify({ title: '$5 \\ce{x} \\(y\\) $$ <<CODE_BLOCK_0>> LLAMPARTCHARTSOURCE0END' })}\n${marker}\n`;
		const mixed = '$x^2$\n\n' + source + '\n> Quote\n\n$z^2$';
		const normalized = preprocessChartMarkdown(mixed, preprocessLaTeX);
		expect(normalized).toContain(source);
		expect(normalized).toContain('> Quote');
		expect(withoutClosedChartFences(mixed)).not.toContain('\\ce{x}');
		expect(withoutClosedChartFences(mixed).length).toBe(mixed.length);
	});
	it('keeps chart/table/paragraph/code order without rewriting original Markdown', () => {
		const source = `Before\n\n${fence}\n\n| X | Y |\n|---|---|\n| a | b |\n\n${fence}\n\n\`\`\`json\n{}\n\`\`\`\n\nAfter`;
		expect(parse(source).map((node) => (isChartNode(node) ? 'chart' : node.type))).toEqual([
			'paragraph',
			'chart',
			'table',
			'chart',
			'code',
			'paragraph'
		]);
		for (const node of parse(source).filter(isChartNode))
			expect(isClosedChartNode(node, source)).toBe(true);
	});
	it.each(['```', '~~~~'])(
		'renders only explicitly closed %s fences, even with complete JSON',
		(marker) => {
			for (const code of ['', json.slice(0, 20), json]) {
				const source = `${marker}llampart-chart\n${code}`;
				const node = parse(source)[0];
				expect(isChartNode(node) && isClosedChartNode(node, source)).toBe(false);
				expect(detectIncompleteChartBlock(source)?.code).toBe(code);
			}
			const source = `${marker}llampart-chart\n${json}\n${marker}`;
			const node = parse(source)[0];
			expect(isChartNode(node) && isClosedChartNode(node, source)).toBe(true);
			expect(detectIncompleteChartBlock(source)).toBeNull();
			expect(parse(source + '\n\nContinuation')[0].position).toEqual(node.position);
		}
	);
	it('classifies invalid data for a safe source fallback, not an empty chart', () => {
		const source = '```llampart-chart\n{"type":"evil"}\n```';
		const node = parse(source)[0];
		expect(isChartNode(node)).toBe(true);
		if (isChartNode(node)) expect(parseChart(node.value).success).toBe(false);
		expect(parse('```js\nconst a=1\n```').some(isChartNode)).toBe(false);
	});
	it('adds request-local guidance without mutation, role changes or duplicate instructions', () => {
		const original = [
			{ role: 'system', content: 'User system prompt' },
			{ role: 'developer', content: 'Developer rule' },
			{ role: 'user', content: 'Question' }
		] as ApiChatMessageData[];
		const snapshot = structuredClone(original);
		const next = withChartInstructions(original);
		expect(original).toEqual(snapshot);
		expect(next.map((message) => message.role)).toEqual(original.map((message) => message.role));
		expect(next[0].content).toContain(CHART_INSTRUCTIONS);
		expect(next[0].content).toContain(original[0].content);
		expect(next.slice(1)).toEqual(original.slice(1));
		expect(withChartInstructions(next)).toEqual(next);
		expect(withChartInstructions(original.slice(1))[0]).toEqual({
			role: 'system',
			content: CHART_INSTRUCTIONS
		});
	});
});
