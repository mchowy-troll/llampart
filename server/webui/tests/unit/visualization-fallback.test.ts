import { describe, expect, it } from 'vitest';
import { chartSourceTitle } from '$lib/charts/chart-title';
import { CHART_LIMITS } from '$lib/charts/chart-schema';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import { t, INTERFACE_LANGUAGES } from '$lib/i18n';

describe('visualization fallback source titles', () => {
	it('reads a title from complete but schema-invalid JSON without changing source', () => {
		const source = '{"title":"  Łódź <img>  ","type":"unsupported"}';
		expect(chartSourceTitle(source)).toBe('Łódź <img>');
		expect(source).toBe('{"title":"  Łódź <img>  ","type":"unsupported"}');
	});
	it.each(Array.from({ length: 0x20 }, (_, code) => code))(
		'rejects an embedded control character with code %i',
		(code) => {
			const source = JSON.stringify({ title: `Sales${String.fromCharCode(code)}report` });
			expect(chartSourceTitle(source)).toBeUndefined();
		}
	);
	it('accepts and trims a valid Unicode title', () => {
		expect(chartSourceTitle(JSON.stringify({ title: '  Łódź — sprzedaż  ' }))).toBe(
			'Łódź — sprzedaż'
		);
	});
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
	it('keeps chart instructions aligned with enforced limits', () => {
		for (const limit of [
			`${CHART_LIMITS.series} series`,
			`${CHART_LIMITS.points} rows`,
			`${CHART_LIMITS.slices} for donut`,
			`${CHART_LIMITS.perMessage} charts`,
			`${CHART_LIMITS.sourceBytes / 1024} KiB`
		])
			expect(CHART_INSTRUCTIONS).toContain(limit);
		expect(CHART_INSTRUCTIONS).toContain('Markdown table or text');
	});
	it.each(INTERFACE_LANGUAGES)('provides all fallback and connection actions in %s', (language) => {
		for (const key of [
			'common.showCode',
			'common.copyCode',
			'diagrams.invalid',
			'charts.invalid',
			'server.connectionUnavailableHelp',
			'server.refreshPage',
			'server.connectionSettings',
			'server.authenticationRequired'
		])
			expect(t(key, language)).not.toBe(key);
	});
});
