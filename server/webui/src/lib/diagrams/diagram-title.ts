/** Comments work in all four grammars, including Mindmap (which has no accTitle).
 * Also respect native accessible/Gantt titles without enabling frontmatter.
 * Never guess a title from node labels.
 */
export function diagramTitle(source: string): string | undefined {
	const accessible = /^[\t ]*accTitle[\t ]*:[\t ]*([^\r\n]+)$/im.exec(source)?.[1];
	const comment = /^[\t ]*%%[\t ]*title[\t ]*:[\t ]*([^\r\n]+)$/im.exec(source)?.[1];
	const gantt = /^\s*(?:%%[^\n]*\n\s*)*gantt\b/.test(source)
		? /^[\t ]*title[\t ]+([^\r\n]+)$/im.exec(source)?.[1]
		: undefined;
	return (accessible || comment || gantt)?.trim() || undefined;
}

/** Use only an adjacent heading or bold-only title, never arbitrary prose. */
export function adjacentDiagramTitle(node: unknown): string | undefined {
	const value = node as { type?: string; children?: unknown[] } | undefined;
	if (!value) return;
	const heading = value.type === 'heading';
	const bold =
		value.type === 'paragraph' &&
		value.children?.length === 1 &&
		(value.children[0] as { type?: string }).type === 'strong';
	if (!heading && !bold) return;
	function text(node: unknown): string {
		const part = node as { type?: string; value?: string; children?: unknown[] };
		return part.type === 'text' || part.type === 'inlineCode'
			? part.value || ''
			: (part.children || []).map(text).join('');
	}
	return text(value).trim() || undefined;
}
