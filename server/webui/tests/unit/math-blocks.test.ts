import { describe, expect, it } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { isClosedMathNode, markIncompleteMath } from '$lib/markdown/math-blocks';
import { preprocessLaTeX } from '$lib/utils/latex-protection';
import type { Root } from 'mdast';
import type { Root as HastRoot } from 'hast';

describe('closed display math stability', () => {
	it.each([String.raw`\[x_1\]`, '$$x_1$$', '$$\nx_1\n$$', '$$$\nx_1\n$$$'])(
		'accepts an explicitly closed normalized display: %s',
		async (source) => {
			const normalized = preprocessLaTeX(source);
			const processor = await createMarkdownProcessor({});
			const root = processor.parse(normalized) as Root;
			expect(isClosedMathNode(root.children[0], normalized)).toBe(true);
		}
	);
	it('does not treat EOF, inline math, prose or a shorter fence as a closed display', async () => {
		const processor = await createMarkdownProcessor({});
		for (const source of ['$$\nx_1', '$x_1$', 'Text', '$$$\nx_1\n$$']) {
			const root = processor.parse(source) as Root;
			expect(isClosedMathNode(root.children[0], source)).toBe(false);
		}
		expect(isClosedMathNode(null, '')).toBe(false);
	});
	it('marks only the unfinished occurrence even when identical sources repeat', async () => {
		const source = '$$\nx_i\n$$\n\n$$\nx_i';
		const processor = await createMarkdownProcessor({});
		const mdast = processor.parse(source);
		const root = (await processor.run(mdast)) as HastRoot;
		markIncompleteMath(root, mdast, source);
		const html = processor.stringify(root);
		expect(html.match(/class="katex-display"/g)).toHaveLength(2);
		expect(html.match(/data-math-incomplete/g)).toHaveLength(1);
		expect(html.indexOf('data-math-incomplete')).toBeGreaterThan(html.indexOf('application/x-tex'));
	});
	it('recognizes closed math inside a blockquote', async () => {
		const source = '> $$\n> x_1\n> $$';
		const processor = await createMarkdownProcessor({});
		const mdast = processor.parse(source) as Root;
		const quote = mdast.children[0];
		expect(quote.type).toBe('blockquote');
		if (quote.type === 'blockquote') expect(isClosedMathNode(quote.children[0], source)).toBe(true);
	});
});
