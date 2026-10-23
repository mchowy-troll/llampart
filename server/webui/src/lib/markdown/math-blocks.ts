import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

/** Only an explicitly closed display can be stable before the next paragraph.
 * remark-math also accepts EOF as an implicit closing fence, so node.type alone
 * is not enough. Positions refer to normalized Markdown, before rehype-katex.
 */
export function isClosedMathNode(node: unknown, markdown: string): boolean {
	const math = node as {
		type?: string;
		position?: { start?: { offset?: number }; end?: { offset?: number } };
	} | null;
	const start = math?.position?.start?.offset;
	const end = math?.position?.end?.offset;
	if (math?.type !== 'math' || start == null || end == null) return false;
	const lines = markdown.slice(start, end).trimEnd().split('\n');
	const opening = /^\${2,}/.exec(lines[0])?.[0];
	const closing = /^(?:\s*>\s*)*\s*(\${2,})\s*$/.exec(lines.at(-1)!)?.[1];
	return !!opening && lines.length > 1 && !!closing && closing.length >= opening.length;
}

/** EOF is legal to remark-math, but must not expose an active visualization.
 * Pair by parser source/occurrence, never by visual text or a message-wide index.
 * This also covers nested lists/quotes and rendered Markdown code fences.
 */
export function markIncompleteMath(root: Root, mdast: unknown, markdown: string) {
	const completed = new Map<string, boolean[]>();
	function collect(node: unknown) {
		const math = node as { type?: string; value?: string; children?: unknown[] };
		if (math.type === 'math' && typeof math.value === 'string') {
			const occurrences = completed.get(math.value) ?? [];
			occurrences.push(isClosedMathNode(node, markdown));
			completed.set(math.value, occurrences);
		}
		for (const child of math.children ?? []) collect(child);
	}
	collect(mdast);
	if (![...completed.values()].some((occurrences) => occurrences.includes(false))) return;
	visit(root, 'element', (node: Element) => {
		if (
			!Array.isArray(node.properties.className) ||
			!node.properties.className.includes('katex-display')
		)
			return;
		let source = '';
		visit(node, 'element', (child: Element) => {
			if (child.tagName === 'annotation' && child.properties.encoding === 'application/x-tex') {
				source = child.children
					.filter((text) => text.type === 'text')
					.map((text) => text.value)
					.join('');
			}
		});
		if (completed.get(source)?.shift() === false) node.properties.dataMathIncomplete = true;
	});
}
