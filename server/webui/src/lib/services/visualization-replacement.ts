import type { Code, Root } from 'mdast';
import type { ChartSpec } from '$lib/charts/chart-schema';
import { diagramType, MAX_DIAGRAM_SOURCE, type DiagramType } from '$lib/diagrams/mermaid-policy';
import { MAX_CHART_SOURCE_BYTES } from '$lib/markdown/chart-blocks';
import type { MarkdownProcessor } from '$lib/markdown/markdown-runtime';
import type { VisualizationSource } from '$lib/types/visualization-source';

export type VisualizationReplacementInput = Readonly<{
	source: VisualizationSource;
	replacementFence: string;
}>;

export type VisualizationRendererInput = Readonly<
	| { kind: 'chart'; language: 'llampart-chart'; source: string; spec: ChartSpec }
	| { kind: 'diagram'; language: 'mermaid'; source: string; diagramType: DiagramType }
>;

/** Must render the supplied candidate and explicitly confirm success with true. */
export type ValidateVisualizationRenderer = (
	candidate: VisualizationRendererInput
) => Promise<boolean>;

declare const preparedReplacementBrand: unique symbol;
export type PreparedVisualizationReplacement = Readonly<{
	[preparedReplacementBrand]: true;
}>;

type ReplacementSnapshot = Readonly<
	Pick<
		VisualizationSource,
		| 'origin'
		| 'field'
		| 'conversationId'
		| 'messageId'
		| 'originalContent'
		| 'rawStart'
		| 'rawEnd'
		| 'exactOriginalFence'
	> & { newContent: string }
>;

// Only the exact handle issued after validation authorizes a write. Copies,
// serialized objects and TypeScript casts do not acquire this authorization.
const preparedSnapshots = new WeakMap<PreparedVisualizationReplacement, ReplacementSnapshot>();

/** @internal DatabaseService's bridge to the private, immutable snapshot. */
export function getPreparedVisualizationReplacement(
	prepared: PreparedVisualizationReplacement
): ReplacementSnapshot {
	const snapshot = preparedSnapshots.get(prepared);
	if (!snapshot) throw new Error('Invalid prepared visualization replacement');
	return snapshot;
}

function requireSourceLimit(source: string, kind: 'chart' | 'diagram') {
	const limit = kind === 'chart' ? MAX_CHART_SOURCE_BYTES : MAX_DIAGRAM_SOURCE;
	if (source.length > limit || new TextEncoder().encode(source).byteLength > limit)
		throw new Error('Visualization source exceeds its size limit');
}

/** Local syntax check only: the Markdown parser must also confirm the entire node. */
function inspectFence(fence: string, language: string) {
	const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)(?:\r\n|\r|\n)/.exec(fence);
	if (!opening || opening[3].trim() !== language)
		throw new Error('Invalid visualization opening fence');
	const closingStart = Math.max(fence.lastIndexOf('\n'), fence.lastIndexOf('\r')) + 1;
	const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(fence.slice(closingStart));
	if (
		closingStart < opening[0].length ||
		!closing ||
		closing[1][0] !== opening[2][0] ||
		closing[1].length < opening[2].length
	)
		throw new Error('Invalid or unclosed visualization fence');
	return { indentation: opening[1].length };
}

function requireFenceNode(
	processor: MarkdownProcessor,
	content: string,
	start: number,
	end: number,
	language: string,
	standalone = false
): Code {
	const { indentation } = inspectFence(content.slice(start, end), language);
	if (
		(start > 0 && content[start - 1] !== '\r' && content[start - 1] !== '\n') ||
		(end < content.length && content[end] !== '\r' && content[end] !== '\n')
	)
		throw new Error('Visualization range does not cover whole fence lines');
	const ast = processor.parse(content) as Root;
	const matches = ast.children.filter(
		(node): node is Code =>
			node.type === 'code' &&
			node.lang === language &&
			!node.meta &&
			node.position?.start.offset === start + indentation &&
			node.position?.end.offset === end
	);
	if (matches.length !== 1 || (standalone && ast.children.length !== 1))
		throw new Error('Visualization range is not exactly one top-level fenced block');
	return matches[0];
}

/** Validate on demand, before any transaction; failures reject without issuing a handle. */
export async function prepareVisualizationReplacement(
	input: VisualizationReplacementInput,
	validateRenderer: ValidateVisualizationRenderer
): Promise<PreparedVisualizationReplacement> {
	// Snapshot every input primitive before the first await, including the original
	// renderer source. Never read the caller's objects again after yielding.
	const {
		origin,
		field,
		conversationId,
		messageId,
		kind,
		language,
		originalContent,
		rawStart,
		rawEnd,
		exactOriginalFence,
		source: originalSource
	} = input.source;
	const { replacementFence } = input;
	if (
		origin !== 'assistant-message-content' ||
		field !== 'content' ||
		typeof conversationId !== 'string' ||
		!conversationId.trim() ||
		typeof messageId !== 'string' ||
		!messageId.trim() ||
		!(
			(kind === 'chart' && language === 'llampart-chart') ||
			(kind === 'diagram' && language === 'mermaid')
		) ||
		typeof originalContent !== 'string' ||
		typeof exactOriginalFence !== 'string' ||
		typeof originalSource !== 'string' ||
		typeof replacementFence !== 'string' ||
		typeof validateRenderer !== 'function'
	)
		throw new Error('Invalid visualization replacement input');
	const sourceLimit = kind === 'chart' ? MAX_CHART_SOURCE_BYTES : MAX_DIAGRAM_SOURCE;
	const maxFenceLength = sourceLimit + 1024;
	if (exactOriginalFence.length > maxFenceLength || replacementFence.length > maxFenceLength) {
		throw new Error('Visualization fence exceeds its size limit');
	}
	if (
		!Number.isInteger(rawStart) ||
		!Number.isInteger(rawEnd) ||
		rawStart < 0 ||
		rawEnd <= rawStart ||
		rawEnd > originalContent.length ||
		originalContent.slice(rawStart, rawEnd) !== exactOriginalFence
	)
		throw new Error('Invalid original visualization range');
	requireSourceLimit(originalSource, kind);
	inspectFence(exactOriginalFence, language);
	inspectFence(replacementFence, language);

	const { createMarkdownProcessor } = await import('$lib/markdown/markdown-runtime');
	const processor = await createMarkdownProcessor({});
	const originalNode = requireFenceNode(processor, originalContent, rawStart, rawEnd, language);
	if (originalNode.value !== originalSource)
		throw new Error('Original visualization source does not match its descriptor');
	const replacementNode = requireFenceNode(
		processor,
		replacementFence,
		0,
		replacementFence.length,
		language,
		true
	);
	requireSourceLimit(replacementNode.value, kind);
	const newContent =
		originalContent.slice(0, rawStart) + replacementFence + originalContent.slice(rawEnd);
	// A standalone fence must also remain the intended top-level node in its real
	// surrounding Markdown (for example, indentation must not attach it to a list).
	const insertedNode = requireFenceNode(
		processor,
		newContent,
		rawStart,
		rawStart + replacementFence.length,
		language
	);
	if (insertedNode.value !== replacementNode.value)
		throw new Error('Replacement source changes in the surrounding Markdown');

	let candidate: VisualizationRendererInput;
	if (kind === 'chart') {
		const { parseChart } = await import('$lib/charts/chart-schema');
		const result = parseChart(replacementNode.value);
		if (!result.success) throw new Error('Invalid replacement chart');
		candidate = Object.freeze({
			kind,
			language: 'llampart-chart',
			source: replacementNode.value,
			spec: result.spec
		});
	} else {
		candidate = Object.freeze({
			kind,
			language: 'mermaid',
			source: replacementNode.value,
			diagramType: diagramType(replacementNode.value)
		});
	}
	// JSON/schema or policy validation is never a substitute for a real renderer.
	if ((await validateRenderer(candidate)) !== true)
		throw new Error('Renderer did not confirm visualization replacement');

	const snapshot: ReplacementSnapshot = Object.freeze({
		origin,
		field,
		conversationId,
		messageId,
		originalContent,
		rawStart,
		rawEnd,
		exactOriginalFence,
		newContent
	});
	const prepared = Object.freeze({}) as PreparedVisualizationReplacement;
	preparedSnapshots.set(prepared, snapshot);
	return prepared;
}
