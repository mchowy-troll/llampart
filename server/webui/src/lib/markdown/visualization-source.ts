import type { Code, Root } from 'mdast';
import type { MessageContentSource, VisualizationSource } from '$lib/types/visualization-source';
import { isChartNode } from './chart-blocks';
import { isMermaidNode } from './mermaid-blocks';

function lineStart(content: string, offset: number): number {
	return Math.max(content.lastIndexOf('\n', offset - 1), content.lastIndexOf('\r', offset - 1)) + 1;
}

/** Inspect only the lines identified by the original parser, never scan for source text. */
function closedFenceRange(content: string, node: Code) {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (
		start == null ||
		end == null ||
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		start < 0 ||
		end <= start ||
		end > content.length
	)
		return null;

	const rawStart = start === 0 ? 0 : lineStart(content, start);
	const openingLine = /^[^\r\n]*/.exec(content.slice(rawStart))![0];
	const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(openingLine);
	if (
		!opening ||
		start !== rawStart + opening[1].length ||
		opening[3].trim() !== node.lang ||
		node.meta
	)
		return null;

	const openingEnd = rawStart + openingLine.length;
	const eol = /^(?:\r\n|\r|\n)/.exec(content.slice(openingEnd));
	if (!eol) return null;
	const closingStart = lineStart(content, end);
	if (closingStart < openingEnd + eol[0].length) return null;
	// The range ends at the closing line's end, including spaces/tabs but not its EOL.
	if (end < content.length && content[end] !== '\r' && content[end] !== '\n') return null;
	const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(content.slice(closingStart, end));
	if (!closing || closing[1][0] !== opening[2][0] || closing[1].length < opening[2].length)
		return null;

	return { rawStart, rawEnd: end };
}

function topLevelCode(ast: Root) {
	return ast.children.flatMap((node, index) => (node.type === 'code' ? [{ node, index }] : []));
}

/**
 * Called only on demand with both trees from the existing Markdown processor.
 * The normalized index identifies a renderer, never an original string offset.
 */
export function locateVisualizationSource({
	originalContent,
	normalizedContent,
	originalAst,
	normalizedAst,
	sourceContext,
	nodeIndex,
	kind,
	source
}: {
	originalContent: string;
	normalizedContent: string;
	originalAst: Root;
	normalizedAst: Root;
	sourceContext: MessageContentSource;
	nodeIndex: number;
	kind: 'chart' | 'diagram';
	source: string;
}): VisualizationSource | null {
	const original = topLevelCode(originalAst);
	const normalized = topLevelCode(normalizedAst);
	// Compare all top-level code nodes, including ordinary code: normalization must
	// not insert, drop, reorder or change code on either side of the selected node.
	if (original.length !== normalized.length) return null;
	let selected = -1;
	let originalEnd = -1;
	let normalizedEnd = -1;
	for (let i = 0; i < original.length; i++) {
		const a = original[i].node;
		const b = normalized[i].node;
		if (a.lang !== b.lang || a.meta !== b.meta || a.value !== b.value) return null;
		const aStart = a.position?.start.offset;
		const aEnd = a.position?.end.offset;
		const bStart = b.position?.start.offset;
		const bEnd = b.position?.end.offset;
		if (
			aStart == null ||
			aEnd == null ||
			bStart == null ||
			bEnd == null ||
			aStart <= originalEnd ||
			bStart <= normalizedEnd ||
			aEnd <= aStart ||
			bEnd <= bStart
		)
			return null;
		originalEnd = aEnd;
		normalizedEnd = bEnd;
		if (normalized[i].index === nodeIndex) selected = i;
	}
	if (selected < 0) return null;
	const node = original[selected].node;
	const renderedNode = normalized[selected].node;
	const visualization =
		kind === 'chart' && isChartNode(node) && isChartNode(renderedNode)
			? { kind: 'chart' as const, language: 'llampart-chart' as const }
			: kind === 'diagram' && isMermaidNode(node) && isMermaidNode(renderedNode)
				? { kind: 'diagram' as const, language: 'mermaid' as const }
				: null;
	if (!visualization || node.value !== source || renderedNode.value !== source) return null;
	const range = closedFenceRange(originalContent, node);
	if (!range || !closedFenceRange(normalizedContent, renderedNode)) return null;
	const exactOriginalFence = originalContent.slice(range.rawStart, range.rawEnd);
	return Object.freeze({
		origin: sourceContext.origin,
		conversationId: sourceContext.conversationId,
		messageId: sourceContext.messageId,
		field: sourceContext.field,
		originalContent,
		...range,
		exactOriginalFence,
		...visualization,
		source: node.value
	});
}
