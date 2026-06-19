import { describe, expect, it } from 'vitest';
import {
	MARKDOWN_RENDERED_CODE_BLOCK_CLASS,
	MARKDOWN_RENDERED_CODE_PREVIEW_BUTTON_CLASS,
	escapeMarkdownHtml,
	isMarkdownCodeNode,
	renderMarkdownRenderedCodeBlockShell
} from '$lib/markdown/markdown-presentation';

describe('markdown-presentation', () => {
	it('detects Markdown fenced code aliases as renderable Markdown code nodes', () => {
		expect(isMarkdownCodeNode({ type: 'code', lang: 'md', value: '# Title' })).toBe(true);
		expect(isMarkdownCodeNode({ type: 'code', lang: 'markdown', value: '# Title' })).toBe(true);
		expect(isMarkdownCodeNode({ type: 'code', lang: 'mkdn', value: '# Title' })).toBe(true);
	});

	it('does not treat non-Markdown code blocks as Markdown presentation blocks', () => {
		expect(isMarkdownCodeNode({ type: 'code', lang: 'ts', value: 'const x = 1;' })).toBe(false);
		expect(isMarkdownCodeNode({ type: 'paragraph', value: '# Title' })).toBe(false);
		expect(isMarkdownCodeNode({ type: 'code', value: '# Title' })).toBe(false);
	});

	it('escapes generated Markdown chrome attributes', () => {
		expect(escapeMarkdownHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
	});

	it('renders the Markdown-code preview shell without changing inner rendered Markdown', () => {
		const html = renderMarkdownRenderedCodeBlockShell({
			codeId: 'code-1',
			language: 'markdown',
			previewMarkdownLabel: 'Preview Markdown',
			rawCode: '# Unsafe <raw>',
			renderedMarkdown: '<h1>Unsafe <raw></h1>'
		});

		expect(html).toContain(
			`class="code-block-wrapper ${MARKDOWN_RENDERED_CODE_BLOCK_CLASS} relative"`
		);
		expect(html).toContain(MARKDOWN_RENDERED_CODE_PREVIEW_BUTTON_CLASS);
		expect(html).toContain('data-raw-code="# Unsafe &lt;raw&gt;"');
		expect(html).toContain('<h1>Unsafe <raw></h1>');
	});
});
