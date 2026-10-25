import { describe, expect, it } from 'vitest';
import { buildStreamRequestUrl, createStreamIdentity } from '$lib/utils/stream-identity';

describe('resumable stream identity', () => {
	it('encodes model names safely and isolates conversations and operations', () => {
		const model = 'org/repo/model name:variant?x=1&y=2';
		const identity = createStreamIdentity('conversation/one', model, 'request/one');
		const url = buildStreamRequestUrl('http://localhost:8080/v1/stream', identity, 17);
		const parsed = new URL(url);

		expect(parsed.pathname).toBe('/v1/stream');
		expect(parsed.searchParams.get('conv_id')).toBe(identity);
		expect(parsed.searchParams.get('from')).toBe('17');
		expect(Object.fromEntries(new URLSearchParams(identity))).toEqual({
			conversation: 'conversation/one',
			model,
			request: 'request/one'
		});
		expect(createStreamIdentity('conversation/two', model, 'request/one')).not.toBe(identity);
		expect(createStreamIdentity('conversation/one', model, 'request/two')).not.toBe(identity);
	});

	it('omits the replay offset for an explicit stop request', () => {
		const identity = createStreamIdentity('conversation/one', 'org/repo/model', 'request/one');
		const parsed = new URL(buildStreamRequestUrl('http://localhost:8080/v1/stream', identity));

		expect(parsed.pathname).toBe('/v1/stream');
		expect(parsed.searchParams.get('conv_id')).toBe(identity);
		expect(parsed.searchParams.has('from')).toBe(false);
	});
});
