import { describe, expect, it } from 'vitest';
import { SseByteParser } from '$lib/utils/sse-byte-parser';

const encoder = new TextEncoder();

describe('SseByteParser', () => {
	it('counts complete raw UTF-8 bytes across split multibyte characters and chunks', () => {
		const raw = ': keepalive\r\ndata: {"text":"zażółć"}\r\n\r\n';
		const bytes = encoder.encode(raw);
		const multibyte = encoder.encode('ż');
		const splitAt = bytes.findIndex((byte, index) =>
			multibyte.every((part, offset) => bytes[index + offset] === part)
		);
		const parser = new SseByteParser();

		expect(parser.push(bytes.slice(0, splitAt + 1))).toEqual([]);
		const records = parser.push(bytes.slice(splitAt + 1));

		expect(records).toEqual([{ data: '{"text":"zażółć"}', bytesParsed: bytes.length }]);
		expect(records[0].bytesParsed).toBeGreaterThan(raw.length);
	});

	it('handles LF, CRLF, CR, comments, blank lines, and multiline data', () => {
		const parser = new SseByteParser();
		const raw = ':comment\rdata: first\r\ndata:second\n\n\r\ndata: last\r\r';
		const records = [...parser.push(encoder.encode(raw)), ...parser.finish()];

		expect(records.map((record) => record.data)).toEqual(['first\nsecond', null, 'last']);
		expect(records.at(-1)?.bytesParsed).toBe(encoder.encode(raw).length);
	});

	it('does not checkpoint an incomplete SSE event', () => {
		const parser = new SseByteParser();
		expect(parser.push(encoder.encode('data: partial\n'))).toEqual([]);
		expect(parser.push(encoder.encode('\n'))).toEqual([
			{ data: 'partial', bytesParsed: encoder.encode('data: partial\n\n').length }
		]);
	});

	it.each(['\n', '\r\n', '\r'])(
		'normalizes only opted-in historical llama-server errors, with exact offsets for %j',
		(newline) => {
			const first = `: ping${newline}${newline}`;
			const error = `error: {"code":400,"message":"zażółć","type":"invalid_request_error"}${newline}${newline}`;
			const done = `data: [DONE]${newline}${newline}`;
			const bytes = encoder.encode(first + error + done);
			const expected = [
				{ data: null, bytesParsed: encoder.encode(first).length },
				{
					data: '{"error":{"code":400,"message":"zażółć","type":"invalid_request_error"}}',
					bytesParsed: encoder.encode(first + error).length
				},
				{ data: '[DONE]', bytesParsed: bytes.length }
			];
			// Every possible split, including CRLF and inside multibyte UTF-8.
			for (let split = 0; split <= bytes.length; split++) {
				const parser = new SseByteParser(true);
				expect([
					...parser.push(bytes.slice(0, split)),
					...parser.push(bytes.slice(split)),
					...parser.finish()
				]).toEqual(expected);
			}
			const standard = new SseByteParser();
			expect([...standard.push(bytes), ...standard.finish()][1]).toEqual({
				data: null,
				bytesParsed: encoder.encode(first + error).length
			});
		}
	);
	it('preserves malformed historical error data for adapter rejection and does not leak it to the next record', () => {
		const parser = new SseByteParser(true);
		expect(
			parser.push(encoder.encode('error: {broken\n\ndata: [DONE]\n\n')).map((record) => record.data)
		).toEqual(['{"error":{broken}', '[DONE]']);
	});
});
