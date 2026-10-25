import { describe, expect, it } from 'vitest';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import {
	escapeMarkdownHtml,
	renderMarkdownRenderedCodeBlockShell
} from '$lib/markdown/markdown-presentation';

describe('markdown-presentation', () => {
	it('escapes generated Markdown chrome attributes', () => {
		expect(escapeMarkdownHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
	});

	it('escapes raw code in the preview shell without changing rendered Markdown', async () => {
		const rawCode = '# Unsafe <raw>';
		const processor = await createMarkdownProcessor({ disableMath: true });
		const renderedMarkdown = processor.stringify(await processor.run(processor.parse(rawCode)));
		const html = renderMarkdownRenderedCodeBlockShell({
			codeId: 'code-1',
			language: 'markdown',
			previewMarkdownLabel: 'Preview Markdown',
			rawCode,
			renderedMarkdown
		});

		expect(html).toContain('data-raw-code="# Unsafe &lt;raw&gt;"');
		expect(html).toContain(renderedMarkdown);
		expect(html).not.toContain('<raw>');
	});
});
