/**
 * Markdown streaming presentation policy owner.
 *
 * This module contains lightweight detectors for structured content that is not
 * complete yet during token streaming. The final Markdown/KaTeX runtime remains
 * the owner of completed rendering; these helpers only decide whether the UI
 * should show a neutral pending state for the current unstable tail.
 */
import { CODE_BLOCK_REGEXP } from '$lib/constants/latex-protection';

export type IncompleteMathDelimiter = '$$' | '\\[';

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
 * Detects an unfinished display math block at the streaming tail.
 *
 * The detector is intentionally conservative:
 * - only standalone `$$` or `\[` display-math delimiters count;
 * - complete fenced/inline code is ignored;
 * - escaped delimiters are ignored;
 * - completed display math returns null.
 */
export function detectIncompleteMathBlock(markdown: string): IncompleteMathBlock | null {
	if (!markdown.includes('$$') && !markdown.includes('\\[')) {
		return null;
	}

	const maskedMarkdown = preserveOffsetsWithoutCode(markdown);
	let pendingDollarOpeningIndex: number | null = null;
	let pendingBracketOpeningIndex: number | null = null;

	for (let index = 0; index < maskedMarkdown.length; index++) {
		if (
			maskedMarkdown.startsWith('$$', index) &&
			!isEscaped(maskedMarkdown, index) &&
			isStandaloneDelimiter(maskedMarkdown, index, 2)
		) {
			pendingDollarOpeningIndex = pendingDollarOpeningIndex === null ? index : null;
			index += 1;
			continue;
		}

		if (
			maskedMarkdown.startsWith('\\[', index) &&
			!isEscaped(maskedMarkdown, index) &&
			isStandaloneDelimiter(maskedMarkdown, index, 2)
		) {
			pendingBracketOpeningIndex = index;
			index += 1;
			continue;
		}

		if (
			pendingBracketOpeningIndex !== null &&
			maskedMarkdown.startsWith('\\]', index) &&
			!isEscaped(maskedMarkdown, index) &&
			isStandaloneDelimiter(maskedMarkdown, index, 2)
		) {
			pendingBracketOpeningIndex = null;
			index += 1;
		}
	}

	if (pendingDollarOpeningIndex !== null) {
		return {
			delimiter: '$$',
			body: markdown.slice(pendingDollarOpeningIndex + 2),
			openingIndex: pendingDollarOpeningIndex
		};
	}

	if (pendingBracketOpeningIndex !== null) {
		return {
			delimiter: '\\[',
			body: markdown.slice(pendingBracketOpeningIndex + 2),
			openingIndex: pendingBracketOpeningIndex
		};
	}

	return null;
}
