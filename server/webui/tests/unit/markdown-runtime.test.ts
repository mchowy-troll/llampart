import { describe, expect, it, vi } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';

async function renderMarkdown(markdown: string) {
	const processor = await createMarkdownProcessor({});
	const tree = processor.parse(markdown);
	const transformedTree = await processor.run(tree);

	return processor.stringify(transformedTree);
}

describe('markdown-runtime', () => {
	it('renders Markdown paragraphs, bold, lists, tables and code', async () => {
		const html = await renderMarkdown(
			'Hello **world**.\n\n- One\n- Two\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n\n```text\nsum $total\n```'
		);

		expect(html).toMatch(/<strong\b[^>]*>world<\/strong>/);
		for (const tag of ['p', 'ul', 'li', 'table', 'th', 'td', 'pre', 'code']) {
			expect(html).toMatch(new RegExp(`<${tag}\\b`));
		}
		expect(html).toContain('sum $total');
		expect(html).not.toContain('katex');
	});

	it('retains separate original TeX annotations for multiple displays and inline math', async () => {
		const first = String.raw`\newcommand{\vct}[1]{\mathbf{#1}}
\begin{aligned}
\vct{x}_{i+1} &= \frac{a_1}{b^2} \\
y &= \text{A\&B: 50\%}
\end{aligned}`;
		const second = String.raw`\sum_{n=1}^\infty \frac{1}{n^2}`;
		const html = await renderMarkdown(`Inline $x_i$.\n\n$$\n${first}\n$$\n\n$$\n${second}\n$$`);
		expect(html.match(/class="katex-display"/g)).toHaveLength(2);
		expect(html.match(/encoding="application\/x-tex"/g)).toHaveLength(3);
		// HTML encoding is decoded by annotation.textContent in the final DOM.
		expect(html).toContain(first.replaceAll('&', '&#x26;'));
		expect(html).toContain(second);
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
		} finally {
			warningLog.mockRestore();
			if (originalTrust) {
				Object.defineProperty(Object.prototype, 'trust', originalTrust);
			} else {
				Reflect.deleteProperty(Object.prototype, 'trust');
			}
		}
	});
});
