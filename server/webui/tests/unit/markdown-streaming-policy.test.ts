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
