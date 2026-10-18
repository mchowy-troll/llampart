import { downloadTextFile } from '$lib/utils/download';
import {
	getCodeInfoFromActionTarget,
	MARKDOWN_CODE_LANGUAGES,
	MARKDOWN_PRESENTATION_SELECTORS
} from './markdown-presentation';

const EXTENSIONS = new Map<string, string>([
	...[
		'python py:py',
		'javascript js:js',
		'typescript ts:ts',
		'html:html',
		'css:css',
		'json:json',
		'bash sh shell:sh',
		'sql:sql',
		'yaml yml:yml',
		'xml:xml',
		'rust rs:rs',
		'go:go',
		'java:java',
		'c:c',
		'cpp c++:cpp',
		'csharp cs:cs',
		'php:php',
		'ruby rb:rb',
		'swift:swift',
		'kotlin kt:kt'
	].flatMap((entry) => {
		const [aliases, extension] = entry.split(':');
		return aliases.split(' ').map((alias): [string, string] => [alias, extension]);
	}),
	...Array.from(MARKDOWN_CODE_LANGUAGES, (alias): [string, string] => [alias, 'md'])
]);

export function codeFileFormat(language?: string) {
	const extension = EXTENSIONS.get(language?.trim().toLowerCase() ?? '') ?? 'txt';
	return { label: extension.toUpperCase(), extension: `.${extension}` };
}

export function codeFilename(language: string, index: number): string {
	const number = Number.isSafeInteger(index) && index > 0 ? index : 1;
	return `code-block-${number}${codeFileFormat(language).extension}`;
}

/** Read only this wrapper's source, never its header or rendered preview. */
export function downloadCodeFromAction(target: HTMLElement, container: HTMLElement): void {
	const info = getCodeInfoFromActionTarget(target);
	const wrapper = target.closest(MARKDOWN_PRESENTATION_SELECTORS.codeBlockWrapper);
	if (!info || !wrapper) return;
	const wrappers = Array.from(
		container.querySelectorAll(MARKDOWN_PRESENTATION_SELECTORS.codeBlockWrapper)
	);
	const index = wrappers.indexOf(wrapper);
	if (index < 0) return;
	downloadTextFile(
		info.rawCode,
		'text/plain;charset=utf-8',
		codeFilename(info.language, index + 1)
	);
}
