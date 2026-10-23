/**
 * Markdown streaming presentation policy owner.
 *
 * This module contains lightweight detectors for structured content that is not
 * complete yet during token streaming. The final Markdown/KaTeX runtime remains
 * the owner of completed rendering; these helpers only decide whether the UI
 * should show a neutral pending state for the current unstable tail.
 */
import { CODE_BLOCK_REGEXP } from '$lib/constants/latex-protection';
import type { IncompleteCodeBlock } from '$lib/utils/code';
import { scanChartFences } from './chart-blocks';
import { scanMermaidFences } from './mermaid-blocks';

export function detectIncompleteMermaidBlock(markdown: string): IncompleteCodeBlock | null {
	return scanMermaidFences(markdown).pending;
}

/** A small fence scanner; unlike the legacy code helper it accepts hyphenated info strings. */
export function detectIncompleteChartBlock(markdown: string): IncompleteCodeBlock | null {
	return scanChartFences(markdown).pending;
}

export type IncompleteMathDelimiter = '$$' | '\\[' | '$' | '\\(';

export type IncompleteMathBlock = {
	delimiter: IncompleteMathDelimiter;
	body: string;
	openingIndex: number;
};

function preserveOffsetsWithoutCode(markdown: string): string {
	return markdown.replace(CODE_BLOCK_REGEXP, (match) => match.replace(/[^\n]/g, ' '));
}

function isEscaped(markdown: string, index: number): boolean {
	let backslashCount = 0;
	let currentIndex = index - 1;

	while (currentIndex >= 0 && markdown[currentIndex] === '\\') {
		backslashCount += 1;
		currentIndex -= 1;
	}

	return backslashCount % 2 === 1;
}

function isLinePrefixWhitespace(markdown: string, index: number): boolean {
	const lineStart = markdown.lastIndexOf('\n', index - 1) + 1;
	return markdown.slice(lineStart, index).trim() === '';
}

function isLineSuffixWhitespace(markdown: string, indexAfterDelimiter: number): boolean {
	const lineEndIndex = markdown.indexOf('\n', indexAfterDelimiter);
	const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;

	return markdown.slice(indexAfterDelimiter, lineEnd).trim() === '';
}

function isStandaloneDelimiter(markdown: string, index: number, delimiterLength: number): boolean {
	return (
		isLinePrefixWhitespace(markdown, index) &&
		isLineSuffixWhitespace(markdown, index + delimiterLength)
	);
}

/**
 * Detects an unfinished math expression at the streaming tail.
 *
 * The detector is intentionally conservative:
 * - standalone or compact display delimiters and non-currency inline openers count;
 * - complete fenced/inline code is ignored;
 * - escaped delimiters are ignored;
 * - completed display math returns null.
 */
export function detectIncompleteMathBlock(markdown: string): IncompleteMathBlock | null {
	if (!markdown.includes('$') && !markdown.includes('\\[') && !markdown.includes('\\(')) {
		return null;
	}

	const maskedMarkdown = preserveOffsetsWithoutCode(markdown);
	let pending: IncompleteMathBlock | null = null;

	for (let index = 0; index < maskedMarkdown.length; index++) {
		if (isEscaped(maskedMarkdown, index)) continue;
		if (pending) {
			const closing =
				pending.delimiter === '\\['
					? '\\]'
					: pending.delimiter === '\\('
						? '\\)'
						: pending.delimiter;
			if (maskedMarkdown.startsWith(closing, index)) {
				pending = null;
				index += closing.length - 1;
			}
			continue;
		}
		let delimiter: IncompleteMathDelimiter | null = null;
		if (maskedMarkdown.startsWith('$$', index)) {
			if (
				isStandaloneDelimiter(maskedMarkdown, index, 2) ||
				/\S/.test(maskedMarkdown[index + 2] ?? '')
			)
				delimiter = '$$';
			else index++;
		} else if (maskedMarkdown.startsWith('\\[', index)) {
			delimiter = '\\[';
		} else if (maskedMarkdown.startsWith('\\(', index)) {
			delimiter = '\\(';
		} else if (
			maskedMarkdown[index] === '$' &&
			!/[A-Za-z0-9_$-]/.test(maskedMarkdown[index - 1] ?? '') &&
			/[^\s\d$]/.test(maskedMarkdown[index + 1] ?? '')
		) {
			delimiter = '$';
		}
		if (delimiter) {
			pending = { delimiter, body: markdown.slice(index + delimiter.length), openingIndex: index };
			index += delimiter.length - 1;
		}
	}

	return pending;
}
