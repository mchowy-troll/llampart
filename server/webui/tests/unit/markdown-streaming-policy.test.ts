import { describe, expect, it } from 'vitest';
import { detectIncompleteMathBlock } from '$lib/markdown/markdown-streaming-policy';

describe('markdown-streaming-policy', () => {
	it('detects an unfinished standalone dollar display math block', () => {
		const result = detectIncompleteMathBlock('Before\n\n$$\n\\begin{aligned}\na &= b + c');

		expect(result).toEqual({
			delimiter: '$$',
			body: '\n\\begin{aligned}\na &= b + c',
			openingIndex: 8
		});
	});

	it('does not flag completed display math blocks', () => {
		expect(detectIncompleteMathBlock('$$\na = b\n$$')).toBeNull();
		expect(detectIncompleteMathBlock('\\[\na = b\n\\]')).toBeNull();
	});

	it.each([
		['Wynik $E=mc', '$', 6],
		['Suma \\[\\sum_', '\\[', 5]
	])('detects compact streaming math: %s', (markdown, delimiter, openingIndex) => {
		expect(detectIncompleteMathBlock(markdown)).toMatchObject({ delimiter, openingIndex });
	});

	it('ignores currency, literal delimiters and protected code', () => {
		expect(detectIncompleteMathBlock('Price is $19.99 and user$name is text.')).toBeNull();
		expect(detectIncompleteMathBlock('```latex\n$$\na = b\n```')).toBeNull();
		expect(detectIncompleteMathBlock('Use `$$` as text.')).toBeNull();
		expect(detectIncompleteMathBlock('\\$$\na = b')).toBeNull();
	});
});
