import { describe, expect, it } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';

async function renderMarkdown(markdown: string, disableMath = false) {
	const processor = await createMarkdownProcessor({ disableMath });
	const tree = processor.parse(markdown);
	const transformedTree = await processor.run(tree);

	return processor.stringify(transformedTree);
}

describe('markdown-runtime', () => {
	it('renders regular markdown without math plugins', async () => {
		const html = await renderMarkdown('Hello **world**.');

		expect(html).toContain('<strong dir="auto">world</strong>');
		expect(html).not.toContain('katex');
	});

	it('renders KaTeX output when math is enabled', async () => {
		const html = await renderMarkdown('Euler: $e^{i\\pi} + 1 = 0$.');

		expect(html).toContain('katex');
		expect(html).toContain('katex-mathml');
	});

	it('leaves math source as text when math is disabled', async () => {
		const html = await renderMarkdown('Euler: $e^{i\\pi} + 1 = 0$.', true);

		expect(html).toContain('$e^{i\\pi} + 1 = 0$');
		expect(html).not.toContain('katex');
	});

	it('does not add dir attributes inside KaTeX output', async () => {
		const html = await renderMarkdown(String.raw`$$
A =
\begin{pmatrix}
1 & 2 \\
3 & 4
\end{pmatrix}
$$`);

		const katexStart = html.indexOf('class="katex');
		const katexHtml = html.slice(katexStart);

		expect(katexStart).toBeGreaterThanOrEqual(0);
		expect(katexHtml).toContain('<mtable');
		expect(katexHtml).not.toContain('dir="auto"');
	});
});
