import type { Code } from 'mdast';
import {
	scanChartFences,
	preprocessChartMarkdown,
	withoutClosedChartFences,
	isClosedChartNode
} from './chart-blocks';

export const MERMAID_LANGUAGE = 'mermaid';
export const MAX_MESSAGE_DIAGRAMS = 8;
export const scanMermaidFences = (markdown: string) => scanChartFences(markdown, MERMAID_LANGUAGE);
export const preprocessMermaidMarkdown = (
	markdown: string,
	preprocess: (source: string) => string
) => preprocessChartMarkdown(markdown, preprocess, MERMAID_LANGUAGE);
export const withoutClosedMermaidFences = (markdown: string) =>
	withoutClosedChartFences(markdown, MERMAID_LANGUAGE);
export function isMermaidNode(node: unknown): node is Code {
	const candidate = node as Partial<Code> | null;
	return candidate?.type === 'code' && candidate.lang === MERMAID_LANGUAGE && !candidate.meta;
}
export const isClosedMermaidNode = (node: Code, markdown: string) =>
	isClosedChartNode(node, markdown, MERMAID_LANGUAGE);
