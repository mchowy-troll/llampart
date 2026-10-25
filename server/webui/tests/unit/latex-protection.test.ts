import { describe, it, expect } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { hasRenderableMath, preprocessLaTeX } from '$lib/utils/latex-protection';

describe('preprocessLaTeX', () => {
	it('converts inline \\( ... \\) to $...$', () => {
		const input = String.raw`Group \(\mathrm{GL}_2(\mathbb{F}_7)\) over \(\mathbb{F}_7\).`;

		expect(preprocessLaTeX(input)).toBe(
			String.raw`Group $\mathrm{GL}_2(\mathbb{F}_7)$ over $\mathbb{F}_7$.`
		);
	});

	it('keeps normalized display math and adjacent text inside a quote', async () => {
		const processor = await createMarkdownProcessor({});
		const tree = processor.parse(preprocessLaTeX('> $$x^2$$\n> Dalej.'));
		const html = processor.stringify(await processor.run(tree));

		expect(html).toMatch(/<blockquote\b[^>]*>[\s\S]*class="katex-display"/);
		expect(html).toMatch(/<p\b[^>]*>Dalej\.<\/p>\s*<\/blockquote>/);
	});

	it('escapes non-math dollars while preserving real math', () => {
		const input =
			'Values: $10, $3.99, $2,000, 50$, user$name, total_$value. Math: $x + 1$, $100x$.';

		expect(preprocessLaTeX(input)).toBe(
			'Values: \\$10, \\$3.99, \\$2,000, 50\\$, user\\$name, total_\\$value. Math: $x + 1$, $100x$.'
		);
	});

	it('preserves literal dollars and LaTeX delimiters in inline and fenced code', () => {
		const input = 'Inline `sum $total; \\(x\\)`\n\n```tex\n\\[x\\]\n$$y$$\n\\(z\\)\n```';

		expect(preprocessLaTeX(input)).toBe(input);
	});
});

describe('hasRenderableMath', () => {
	it('rejects plain text, currency, identifier dollars and escaped delimiters', () => {
		expect(hasRenderableMath('This is plain text with no math.')).toBe(false);
		expect(hasRenderableMath('Values: $10, $3.99, $2,000, 50$, user$name, total_$value.')).toBe(
			false
		);
		expect(hasRenderableMath(String.raw`Definitions\\(also called macros)`)).toBe(false);
	});

	it('detects inline and display math with dollar and backslash delimiters', () => {
		expect(hasRenderableMath('Pythagorean: $a^2 + b^2 = c^2$.')).toBe(true);
		expect(hasRenderableMath('Before\n$$\n\\int_0^1 x^2\\,dx\n$$\nAfter')).toBe(true);
		expect(hasRenderableMath(String.raw`Inline \(x^2\) and display \[y^2\]`)).toBe(true);
	});

	it('ignores protected code but detects math outside it', () => {
		expect(hasRenderableMath('```latex\n$x^2$\n```\nAnd `$y^2$` inline code')).toBe(false);
		expect(hasRenderableMath('```latex\n$x^2$\n```\nBut $y^2$ renders.')).toBe(true);
	});
});
