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

	it('does not flag completed standalone dollar display math blocks', () => {
		expect(detectIncompleteMathBlock('$$\na = b\n$$')).toBeNull();
	});

	it('detects an unfinished bracket display math block', () => {
		const result = detectIncompleteMathBlock('Intro\n\\[\na = b');

		expect(result).toEqual({
			delimiter: '\\[',
			body: '\na = b',
			openingIndex: 6
		});
	});

	it('does not flag completed bracket display math blocks', () => {
		expect(detectIncompleteMathBlock('\\[\na = b\n\\]')).toBeNull();
	});

	it.each([
		['Wzór: $$\\int_', '$$', 6],
		['Wynik $E=mc', '$', 6],
		['Pole \\(A=\\pi', '\\(', 5],
		['Suma \\[\\sum_', '\\[', 5]
	])('detects compact streaming math: %s', (markdown, delimiter, openingIndex) => {
		expect(detectIncompleteMathBlock(markdown)).toMatchObject({ delimiter, openingIndex });
	});

	it.each([
		'Wzór: $$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$',
		'Wynik $E=mc^2$ i \\(A=\\pi r^2\\).',
		'Suma \\[x+y\\] i cena $5.99',
		'Cena $5.99, druga $10.00. `\\(x` oraz `$$\\int_`.'
	])('leaves completed math, code and currency to their existing renderers: %s', (markdown) => {
		expect(detectIncompleteMathBlock(markdown)).toBeNull();
	});

	it('ignores currency and inline dollar text', () => {
		expect(detectIncompleteMathBlock('Price is $19.99 and user$name is text.')).toBeNull();
		expect(detectIncompleteMathBlock('This is not standalone $$ math')).toBeNull();
	});

	it('ignores math-looking delimiters inside fenced and inline code', () => {
		expect(detectIncompleteMathBlock('```latex\n$$\na = b\n```')).toBeNull();
		expect(detectIncompleteMathBlock('Use `$$` as text.')).toBeNull();
	});

	it('ignores escaped standalone delimiters', () => {
		expect(detectIncompleteMathBlock('\\$$\na = b')).toBeNull();
		expect(detectIncompleteMathBlock('\\\\[\na = b')).toBeNull();
	});
});
