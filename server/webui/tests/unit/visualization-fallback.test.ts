import { describe, expect, it } from 'vitest';
import { chartSourceTitle } from '$lib/charts/chart-title';
import { CHART_LIMITS } from '$lib/charts/chart-schema';

describe('visualization fallback source titles', () => {
	it('reads a trimmed Unicode title as text from complete but schema-invalid JSON', () => {
		const source = '{"title":"  Łódź <img>  ","type":"unsupported"}';
		expect(chartSourceTitle(source)).toBe('Łódź <img>');
	});
	it.each(Array.from({ length: 0x20 }, (_, code) => code))(
		'rejects an embedded control character with code %i',
		(code) => {
			const source = JSON.stringify({ title: `Sales${String.fromCharCode(code)}report` });
			expect(chartSourceTitle(source)).toBeUndefined();
		}
	);
	it.each([
		'{"title":"partial',
		'[]',
		'null',
		'{"title":12}',
		'{"title":"\\n"}',
		JSON.stringify({ title: 'x'.repeat(121) }),
		'x'.repeat(CHART_LIMITS.sourceBytes + 1)
	])('does not guess or accept an unbounded title', (source) => {
		expect(chartSourceTitle(source)).toBeUndefined();
	});
});
