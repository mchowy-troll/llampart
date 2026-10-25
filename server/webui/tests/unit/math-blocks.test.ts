import { describe, expect, it } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { isClosedMathNode, markIncompleteMath } from '$lib/markdown/math-blocks';
import { preprocessLaTeX } from '$lib/utils/latex-protection';
import type { Root } from 'mdast';
import type { Root as HastRoot } from 'hast';

describe('closed display math stability', () => {
	it('accepts an explicitly closed normalized display', async () => {
		const normalized = preprocessLaTeX(String.raw`\[x_1\]`);
		const processor = await createMarkdownProcessor({});
		const root = processor.parse(normalized) as Root;

		expect(isClosedMathNode(root.children[0], normalized)).toBe(true);
	});

	it('does not treat EOF or a shorter fence as a closed display', async () => {
		const processor = await createMarkdownProcessor({});
		for (const source of ['$$\nx_1', '$$$\nx_1\n$$']) {
			const root = processor.parse(source) as Root;
			expect(isClosedMathNode(root.children[0], source)).toBe(false);
		}
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
});
