import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Element, Root } from 'hast';
import { downloadCodeFromAction } from '$lib/markdown/code-download';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { renderMarkdownRenderedCodeBlockShell } from '$lib/markdown/markdown-presentation';

function elements(node: Root | Element, tag: string): Element[] {
	return node.children.flatMap((child) =>
		child.type !== 'element'
			? []
			: [...(child.tagName === tag ? [child] : []), ...elements(child, tag)]
	);
}

function text(node: Element): string {
	return node.children
		.map((child) =>
			child.type === 'text' ? child.value : child.type === 'element' ? text(child) : ''
		)
		.join('');
}

describe('code downloads', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('downloads the selected highlighted block as UTF-8 without header/UI', async () => {
		const processor = await createMarkdownProcessor({ disableMath: true });
		const tree = (await processor.run(
			processor.parse(
				'```js\nconst first = 1;\n```\n\n```python\n# Zażółć gęślą jaźń\nprint("Łódź 😀 <tag> &")\n\n```'
			)
		)) as Root;
		expect(
			elements(tree, 'button').filter((node) =>
				(node.properties.className as string[])?.includes('download-code-btn')
			)
		).toHaveLength(2);
		const codes = elements(tree, 'code');
		const wrappers = codes.map((code, index) => ({
			textContent: `HEADER PY COPY DOWNLOAD ${text(code)}`,
			querySelector: (selector: string) =>
				selector === 'code[data-code-id]'
					? { dataset: {}, textContent: text(code) }
					: { textContent: ['js', 'python'][index] }
		}));
		const container = { querySelectorAll: () => wrappers } as unknown as HTMLElement;
		const blobs: Blob[] = [];
		const anchors: { download: string; click: () => void }[] = [];
		vi.stubGlobal('URL', {
			createObjectURL: (blob: Blob) => {
				blobs.push(blob);
				return 'blob:code';
			},
			revokeObjectURL: vi.fn()
		});
		vi.stubGlobal('document', {
			createElement: () => {
				const anchor = { download: '', click: vi.fn() };
				anchors.push(anchor);
				return anchor;
			},
			body: { appendChild: vi.fn(), removeChild: vi.fn() }
		});
		for (const wrapper of wrappers)
			downloadCodeFromAction({ closest: () => wrapper } as unknown as HTMLElement, container);
		expect(anchors.map((anchor) => anchor.download)).toEqual([
			'code-block-1.js',
			'code-block-2.py'
		]);
		expect(await blobs[0].text()).toBe('const first = 1;\n');
		const expected = '# Zażółć gęślą jaźń\nprint("Łódź 😀 <tag> &")\n\n';
		expect(await blobs[1].text()).toBe(expected);
		expect(new Uint8Array(await blobs[1].arrayBuffer())).toEqual(
			new TextEncoder().encode(expected)
		);
		expect(blobs[1].type).toBe('text/plain;charset=utf-8');
	});

	it('uses hidden raw Markdown rather than the rendered preview', () => {
		expect(
			renderMarkdownRenderedCodeBlockShell({
				codeId: 'code-1',
				language: 'md',
				rawCode: '# Źródło\n\n**bold**',
				renderedMarkdown: '<h1>Źródło</h1><p><strong>bold</strong></p>',
				previewMarkdownLabel: 'Preview'
			})
		).toContain('download-code-btn');
		const wrapper = {
			querySelector: (selector: string) =>
				selector === 'code[data-code-id]'
					? { dataset: { rawCode: '# Źródło\n\n**bold**' }, textContent: '' }
					: { textContent: 'markdown' }
		};
		const createObjectURL = vi.fn(() => 'blob:md');
		vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
		vi.stubGlobal('document', {
			createElement: () => ({ click: vi.fn() }),
			body: { appendChild: vi.fn(), removeChild: vi.fn() }
		});
		downloadCodeFromAction(
			{ closest: () => wrapper } as unknown as HTMLElement,
			{ querySelectorAll: () => [wrapper] } as unknown as HTMLElement
		);
		expect(createObjectURL).toHaveBeenCalledOnce();
		return expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].text()).resolves.toBe(
			'# Źródło\n\n**bold**'
		);
	});
});
