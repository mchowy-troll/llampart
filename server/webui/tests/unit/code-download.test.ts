import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Element, Root } from 'hast';
import { codeFileFormat, codeFilename, downloadCodeFromAction } from '$lib/markdown/code-download';
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

	it.each([
		['python py', 'py'],
		['javascript js', 'js'],
		['typescript ts', 'ts'],
		['html', 'html'],
		['css', 'css'],
		['json', 'json'],
		['bash sh shell', 'sh'],
		['sql', 'sql'],
		['yaml yml', 'yml'],
		['markdown md mdown mkdn mkd', 'md'],
		['xml', 'xml'],
		['rust rs', 'rs'],
		['go', 'go'],
		['java', 'java'],
		['c', 'c'],
		['cpp c++', 'cpp'],
		['csharp cs', 'cs'],
		['php', 'php'],
		['ruby rb', 'rb'],
		['swift', 'swift'],
		['kotlin kt', 'kt']
	])('maps %s to a safe format', (aliases, extension) => {
		for (const alias of aliases.split(' ')) {
			expect(codeFileFormat(` ${alias.toUpperCase()} `)).toEqual({
				label: extension.toUpperCase(),
				extension: `.${extension}`
			});
		}
	});

	it.each([undefined, '', 'unknown', '../../evil', 'constructor', '__proto__'])(
		'falls back to TXT for %s',
		(language) => {
			expect(codeFileFormat(language)).toEqual({ label: 'TXT', extension: '.txt' });
		}
	);

	it.each([1, 2, 100, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'bounds the filename index %s',
		(index) => {
			expect(codeFilename('python', index)).toBe(
				`code-block-${Number.isSafeInteger(index) && index > 0 ? index : 1}.py`
			);
		}
	);

	it('renders a format button immediately before copy for each ordinary code block', async () => {
		const processor = await createMarkdownProcessor({ disableMath: true });
		const tree = (await processor.run(
			processor.parse(
				'```python\nprint("Łódź")\n```\n\n```html\n<b>HTML</b>\n```\n\n```unknown\nraw\n```'
			)
		)) as Root;
		const actions = elements(tree, 'div').filter((node) =>
			(node.properties.className as string[])?.includes('code-block-actions')
		);
		expect(actions).toHaveLength(3);
		for (const [index, node] of actions.entries()) {
			const buttons = elements(node, 'button');
			expect(buttons[0].properties.className).toEqual(['download-code-btn']);
			expect(buttons[0].properties.type).toBe('button');
			expect(text(buttons[0])).toBe(['PY', 'HTML', 'TXT'][index]);
			expect(buttons[1].properties.className).toEqual(['copy-code-btn']);
		}
	});

	it('renders download before copy in the special Markdown shell', () => {
		const html = renderMarkdownRenderedCodeBlockShell({
			codeId: 'code-1',
			language: 'md',
			rawCode: '# Łódź',
			renderedMarkdown: '<h1>Łódź</h1>',
			previewMarkdownLabel: 'Preview'
		});
		expect(html.indexOf('download-code-btn')).toBeLessThan(html.indexOf('copy-code-btn'));
		expect(html).toContain('type="button">MD</button>');
	});

	it('downloads only the selected highlighted block, multiline UTF-8, without header/UI; numbers within the message', async () => {
		const processor = await createMarkdownProcessor({ disableMath: true });
		const tree = (await processor.run(
			processor.parse(
				'```js\nconst first = 1;\n```\n\n```python\n# Zażółć gęślą jaźń\nprint("Łódź 😀 <tag> &")\n\n```'
			)
		)) as Root;
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
