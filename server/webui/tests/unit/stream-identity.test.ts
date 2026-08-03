import { describe, expect, it } from 'vitest';
import { buildStreamRequestUrl, createStreamIdentity } from '$lib/utils/stream-identity';

describe('resumable stream identity', () => {
	it.each([
		'plain-model',
		'ggml-org/model',
		'org/repo/model',
		'model:name',
		'model name',
		'model?variant'
	])('keeps model %s out of URL path segments', (model) => {
		const identity = createStreamIdentity('conversation/one', model, 'request/one');
		const url = buildStreamRequestUrl('http://localhost:8080/v1/stream', identity, 17);
		const parsed = new URL(url);

		expect(parsed.pathname).toBe('/v1/stream');
		expect(parsed.searchParams.get('conv_id')).toBe(identity);
		expect(parsed.searchParams.get('from')).toBe('17');
		expect(new URLSearchParams(identity).get('model')).toBe(model);
	});

	it('omits the replay offset for an explicit stop request', () => {
		const identity = createStreamIdentity('conversation/one', 'org/repo/model', 'request/one');
		const parsed = new URL(buildStreamRequestUrl('http://localhost:8080/v1/stream', identity));

		expect(parsed.pathname).toBe('/v1/stream');
		expect(parsed.searchParams.get('conv_id')).toBe(identity);
		expect(parsed.searchParams.has('from')).toBe(false);
	});
});
