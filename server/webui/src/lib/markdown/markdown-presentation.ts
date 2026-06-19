/**
 * Markdown presentation policy owner.
 *
 * This module centralizes generated Markdown chrome: wrapper classes, DOM selectors,
 * action icons and small helper functions used around rendered Markdown blocks.
 * Parser/runtime ownership stays in markdown-runtime.ts; component orchestration stays
 * in MarkdownContent.svelte. CSS remains with MarkdownContent until a separate visual
 * audit moves it safely.
 */
import {
	CODE_BLOCK_ACTIONS_CLASS,
	CODE_BLOCK_HEADER_CLASS,
	CODE_BLOCK_WRAPPER_CLASS,
	CODE_LANGUAGE_CLASS,
	COPY_CODE_BTN_CLASS,
	PREVIEW_CODE_BTN_CLASS,
	RELATIVE_CLASS
} from '$lib/constants';

export type MarkdownCodeNode = { type: 'code'; lang?: string; value?: string };

export type MarkdownCodeInfo = {
	rawCode: string;
	language: string;
};

export type MarkdownRenderedCodeBlockOptions = {
	codeId: string;
	language: string;
	previewMarkdownLabel: string;
	rawCode: string;
	renderedMarkdown: string;
};

export const MARKDOWN_CODE_LANGUAGES = new Set(['md', 'markdown', 'mdown', 'mkdn', 'mkd']);

export const MARKDOWN_RENDERED_CODE_BLOCK_CLASS = 'markdown-rendered-code-block';
export const MARKDOWN_RENDERED_CODE_CONTENT_CLASS = 'markdown-rendered-code-content';
export const MARKDOWN_RENDERED_CODE_SCROLL_CONTAINER_CLASS =
	'markdown-rendered-code-scroll-container';
export const MARKDOWN_RENDERED_CODE_PREVIEW_BUTTON_CLASS =
	'llampart-markdown-rendered-code-preview-btn';

export const TABLE_BLOCK_CLASS = 'table-block';
export const TABLE_ACTIONS_CLASS = 'table-actions';
export const TABLE_WRAPPER_CLASS = 'table-wrapper';
export const TABLE_CELL_CONTENT_CLASS = 'table-cell-content';
export const TABLE_PREVIEW_BUTTON_CLASS = 'table-preview-button';

export const MARKDOWN_PRESENTATION_SELECTORS = {
	codeBlockWrapper: `.${CODE_BLOCK_WRAPPER_CLASS}`,
	copyCodeButton: `.${COPY_CODE_BTN_CLASS}`,
	previewCodeButton: `.${PREVIEW_CODE_BTN_CLASS}`,
	codeLanguage: `.${CODE_LANGUAGE_CLASS}`,
	markdownRenderedCodeContent: `.${MARKDOWN_RENDERED_CODE_CONTENT_CLASS}`,
	tableBlock: `.${TABLE_BLOCK_CLASS}`,
	tablePreviewButton: `.${TABLE_PREVIEW_BUTTON_CLASS}`,
	tableActions: `.${TABLE_ACTIONS_CLASS}`,
	tableWrapperTable: `.${TABLE_WRAPPER_CLASS} table`,
	hiddenCodeWithId: 'code[data-code-id][hidden]'
} as const;

export const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

export const MARKDOWN_PREVIEW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;

export const CODE_PREVIEW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye lucide-eye-icon"><path d="M2.062 12.345a1 1 0 0 1 0-.69C3.5 7.73 7.36 5 12 5s8.5 2.73 9.938 6.655a1 1 0 0 1 0 .69C20.5 16.27 16.64 19 12 19s-8.5-2.73-9.938-6.655"/><circle cx="12" cy="12" r="3"/></svg>`;

/**
 * Presentation-owned escaping for generated Markdown chrome.
 * This is intentionally local to generated wrappers/actions, not a parser/runtime rule.
 */
export function escapeMarkdownHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function isMarkdownCodeNode(node: unknown): node is MarkdownCodeNode {
	const candidate = node as { type?: string; lang?: string };
	const lang = candidate.lang?.toLowerCase();

	return candidate.type === 'code' && Boolean(lang && MARKDOWN_CODE_LANGUAGES.has(lang));
}

export function renderMarkdownRenderedCodeBlockShell({
	codeId,
	language,
	previewMarkdownLabel,
	rawCode,
	renderedMarkdown
}: MarkdownRenderedCodeBlockOptions): string {
	const escapedCodeId = escapeMarkdownHtml(codeId);
	const escapedLanguage = escapeMarkdownHtml(language);
	const escapedPreviewMarkdownLabel = escapeMarkdownHtml(previewMarkdownLabel);
	const escapedRawCode = escapeMarkdownHtml(rawCode);

	return `<div class="${CODE_BLOCK_WRAPPER_CLASS} ${MARKDOWN_RENDERED_CODE_BLOCK_CLASS} ${RELATIVE_CLASS}"><div class="${CODE_BLOCK_HEADER_CLASS}"><span class="${CODE_LANGUAGE_CLASS}">${escapedLanguage}</span><div class="${CODE_BLOCK_ACTIONS_CLASS}"><button class="${COPY_CODE_BTN_CLASS}" data-code-id="${escapedCodeId}" title="Copy code" type="button"><span>${COPY_ICON_SVG}</span></button><button class="${PREVIEW_CODE_BTN_CLASS} ${MARKDOWN_RENDERED_CODE_PREVIEW_BUTTON_CLASS}" data-code-id="${escapedCodeId}" title="${escapedPreviewMarkdownLabel}" aria-label="${escapedPreviewMarkdownLabel}" type="button"><span>${MARKDOWN_PREVIEW_ICON_SVG}</span></button></div></div><div class="${MARKDOWN_RENDERED_CODE_CONTENT_CLASS} ${MARKDOWN_RENDERED_CODE_SCROLL_CONTAINER_CLASS}"><code data-code-id="${escapedCodeId}" data-raw-code="${escapedRawCode}" hidden></code>${renderedMarkdown}</div></div>`;
}

const MARKDOWN_RENDERED_PREVIEW_OMITTED_SELECTORS = [
	MARKDOWN_PRESENTATION_SELECTORS.hiddenCodeWithId,
	`.${CODE_BLOCK_ACTIONS_CLASS}`,
	MARKDOWN_PRESENTATION_SELECTORS.tableActions
].join(', ');

export function buildMarkdownRenderedPreviewHtml(wrapper: HTMLElement): string | null {
	const content = wrapper.querySelector<HTMLElement>(
		MARKDOWN_PRESENTATION_SELECTORS.markdownRenderedCodeContent
	);

	if (!content) return null;

	const clone = content.cloneNode(true) as HTMLElement;

	clone.querySelectorAll(MARKDOWN_RENDERED_PREVIEW_OMITTED_SELECTORS).forEach((node) => {
		node.remove();
	});

	const bodyHtml = clone.innerHTML.trim();

	return bodyHtml || null;
}

export function getCodeInfoFromActionTarget(target: HTMLElement): MarkdownCodeInfo | null {
	const wrapper = target.closest(MARKDOWN_PRESENTATION_SELECTORS.codeBlockWrapper);

	if (!wrapper) {
		console.error('No wrapper found');
		return null;
	}

	const codeElement = wrapper.querySelector<HTMLElement>('code[data-code-id]');
	const rawCode = codeElement?.dataset.rawCode ?? codeElement?.textContent;

	if (rawCode == null) {
		console.error('No code content found in wrapper');
		return null;
	}

	const languageLabel = wrapper.querySelector<HTMLElement>(
		MARKDOWN_PRESENTATION_SELECTORS.codeLanguage
	);
	const language = languageLabel?.textContent?.trim() || 'text';

	return { rawCode, language };
}
