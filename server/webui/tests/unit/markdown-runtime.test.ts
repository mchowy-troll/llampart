import { describe, expect, it, vi } from 'vitest';
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

	it('keeps untrusted LaTeX links and HTML extensions disabled with a polluted prototype', async () => {
		const originalTrust = Object.getOwnPropertyDescriptor(Object.prototype, 'trust');
		const expectedWarning =
			"LaTeX-incompatible input and strict mode is set to 'warn': HTML extension is disabled on strict mode [htmlExtension]";
		const originalWarn = console.warn;
		const warningLog = vi.spyOn(console, 'warn').mockImplementation((...args) => {
			if (args.length !== 1 || args[0] !== expectedWarning) originalWarn(...args);
		});

		try {
			Object.defineProperty(Object.prototype, 'trust', {
				configurable: true,
				writable: true,
				value: true
			});
			const html = await renderMarkdown(
				String.raw`$\href{https://untrusted.test/}{link} + \htmlClass{untrusted-class}{x} + \includegraphics{https://untrusted.test/image.png}$`
			);

			expect(html).toContain('katex-mathml');
			expect(html).not.toContain('katex-error');
			expect(html).not.toContain('<a ');
			expect(html).not.toContain('<img ');
			expect(html).not.toMatch(/class="[^"]*untrusted-class/);
			expect(warningLog).toHaveBeenCalledExactlyOnceWith(expectedWarning);
		} finally {
			warningLog.mockRestore();
			if (originalTrust) {
				Object.defineProperty(Object.prototype, 'trust', originalTrust);
			} else {
				Reflect.deleteProperty(Object.prototype, 'trust');
			}
		}
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

	it('adds copy and preview actions to tables', async () => {
		const markdown = '| Name | Value |\n| :--- | ---: |\n| A | 1 |';
		const html = await renderMarkdown(markdown, true);

		expect(html).toContain('class="table-copy-button"');
		expect(html).toContain('class="table-preview-button"');
		expect(html.indexOf('table-copy-button')).toBeLessThan(html.indexOf('table-preview-button'));
	});
});
