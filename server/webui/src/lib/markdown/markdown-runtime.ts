import { remark } from 'remark';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import { all as lowlightAll } from 'lowlight';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { FileTypeText } from '$lib/enums/files';
import { rehypeRestoreTableHtml } from '$lib/markdown/table-html-restorer';
import { rehypeEnhanceLinks } from '$lib/markdown/enhance-links';
import { rehypeEnhanceCodeBlocks } from '$lib/markdown/enhance-code-blocks';
import { rehypeResolveAttachmentImages } from '$lib/markdown/resolve-attachment-images';
import { rehypeRtlSupport } from '$lib/markdown/rehype-rtl-support';
import { rehypeWrapTables } from '$lib/markdown/wrap-tables';
import { remarkLiteralHtml } from '$lib/markdown/literal-html';
import type { DatabaseMessageExtra } from '$lib/types/database';

export type MarkdownProcessor = {
	parse(markdown: string): unknown;
	run(tree: unknown): Promise<unknown> | unknown;
	stringify(tree: unknown): string;
};

export type MarkdownProcessorOptions = {
	attachments?: DatabaseMessageExtra[];
	disableMath?: boolean;
};

export function createMarkdownProcessor({
	attachments,
	disableMath = false
}: MarkdownProcessorOptions): MarkdownProcessor {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let proc: any = remark().use(remarkGfm); // GitHub Flavored Markdown

	if (!disableMath) {
		proc = proc.use(remarkMath); // Parse $inline$ and $$block$$ math
	}

	proc = proc
		.use(remarkBreaks) // Convert line breaks to <br>
		.use(remarkLiteralHtml) // Treat raw HTML as literal text with preserved indentation
		.use(remarkRehype); // Convert Markdown AST to rehype

	if (!disableMath) {
		proc = proc.use(rehypeKatex); // Render math using KaTeX
	}

	return proc
		.use(rehypeHighlight, {
			languages: lowlightAll,
			aliases: { [FileTypeText.XML]: [FileTypeText.SVELTE, FileTypeText.VUE] }
		}) // Add syntax highlighting
		.use(rehypeRestoreTableHtml) // Restore limited HTML (e.g., <br>, <ul>) inside Markdown tables
		.use(rehypeWrapTables) // Wrap tables in a scroll container without changing table markup
		.use(rehypeEnhanceLinks) // Add target="_blank" to links
		.use(rehypeEnhanceCodeBlocks) // Wrap code blocks with header and actions
		.use(rehypeResolveAttachmentImages, { attachments })
		.use(rehypeRtlSupport) // Add bidirectional text support
		.use(rehypeStringify, { allowDangerousHtml: true }) as MarkdownProcessor; // Convert to HTML string
}
