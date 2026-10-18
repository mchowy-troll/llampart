import type { Code } from 'mdast';

export const CHART_LANGUAGE = 'llampart-chart';
export const MAX_MESSAGE_CHARTS = 8;
export const MAX_CHART_SOURCE_BYTES = 128 * 1024;

/** Lightweight fence bookkeeping only; it never parses chart JSON. */
export function scanChartFences(markdown: string, language = CHART_LANGUAGE) {
	let count = 0;
	const ranges: { start: number; end: number }[] = [];
	let open: { marker: string; language: string; openingIndex: number; bodyIndex: number } | null =
		null;
	for (const line of markdown.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)\n?/gm)) {
		if (!open) {
			open = {
				marker: line[1],
				language: line[2].trim(),
				openingIndex: line.index,
				bodyIndex: line.index + line[0].length
			};
			if (open.language === language) count++;
		} else if (
			line[1][0] === open.marker[0] &&
			line[1].length >= open.marker.length &&
			!line[2].trim()
		) {
			if (open.language === language)
				ranges.push({ start: open.openingIndex, end: line.index + line[0].length });
			open = null;
		}
	}
	return {
		count,
		ranges,
		pending:
			open?.language === language
				? {
						language,
						openingIndex: open.openingIndex,
						code: markdown.slice(open.bodyIndex)
					}
				: null
	};
}

/** Preserve chart JSON byte-for-byte through the legacy math preprocessor (also for ~ fences). */
export function preprocessChartMarkdown(
	markdown: string,
	preprocess: (source: string) => string,
	language = CHART_LANGUAGE
): string {
	const { ranges } = scanChartFences(markdown, language);
	if (!ranges.length) return preprocess(markdown);
	let prefix = 'LLAMPARTCHARTSOURCE';
	while (markdown.includes(prefix)) prefix += 'X';
	let masked = '',
		offset = 0;
	const entries = ranges.map(({ start, end }, index) => {
		const source = markdown.slice(start, end);
		const token = `${prefix}${index}END` + '\n'.repeat((source.match(/\n/g) || []).length);
		masked += markdown.slice(offset, start) + token;
		offset = end;
		return { source, token };
	});
	let result = preprocess(masked + markdown.slice(offset));
	for (const { source, token } of entries) result = result.replace(token, () => source);
	return result;
}

/** Offset-preserving mask for streaming math detection, not a JSON parser. */
export function withoutClosedChartFences(markdown: string, language = CHART_LANGUAGE): string {
	let result = '',
		offset = 0;
	for (const { start, end } of scanChartFences(markdown, language).ranges) {
		result += markdown.slice(offset, start) + markdown.slice(start, end).replace(/[^\r\n]/g, ' ');
		offset = end;
	}
	return result + markdown.slice(offset);
}

export function isChartNode(node: unknown): node is Code {
	if (!node || typeof node !== 'object') return false;
	const candidate = node as Partial<Code>;
	return candidate.type === 'code' && candidate.lang === CHART_LANGUAGE && !candidate.meta;
}

/** MDAST also accepts EOF-terminated fences. Charts require an explicit closing fence. */
export function isClosedChartNode(
	node: Code,
	markdown: string,
	language = CHART_LANGUAGE
): boolean {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start == null || end == null) return false;
	const source = markdown.slice(start, end);
	const opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/.exec(source);
	if (!opening) return false;
	if (opening[2].trim() !== language) return false;
	const lastLine = source.slice(source.lastIndexOf('\n') + 1);
	return new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`).test(lastLine);
}
