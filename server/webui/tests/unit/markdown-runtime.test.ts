import { describe, expect, it, vi } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { rehypeWrapTables } from '$lib/markdown/wrap-tables';
import type { Root } from 'hast';

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
		// Cached processor output remains free of interactive DOM or localized labels.
		expect(html).not.toContain('math-actions');
		expect(html).not.toContain('<button');
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

	it('adds exactly CSV → Copy → Preview and stays idempotent', async () => {
		const markdown = '| Name | Value |\n| :--- | ---: |\n| A | 1 |';
		const processor = await createMarkdownProcessor({ disableMath: true });
		const tree = (await processor.run(processor.parse(markdown))) as Root;
		const html = processor.stringify(tree);
		rehypeWrapTables()(tree);
		expect(processor.stringify(tree)).toBe(html);

		expect(html.match(/class="table-block"/g)).toHaveLength(1);
		expect(html.match(/<button /g)).toHaveLength(3);
		expect([...html.matchAll(/class="(table-[\w-]+-button)"/g)].map((match) => match[1])).toEqual([
			'table-csv-button',
			'table-copy-button',
			'table-preview-button'
		]);
		expect(html).toContain('>CSV</button>');
		expect(html.match(/class="table-cell-content"/g)).toHaveLength(4);
	});
});
