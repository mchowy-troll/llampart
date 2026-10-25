import { afterEach, describe, expect, it, vi } from 'vitest';
import { embeddedSvgFonts } from '$lib/utils/svg-fonts';

class Face {
	style: {
		fontFamily: string;
		fontStyle: string;
		fontWeight: string;
		cssText: string;
		getPropertyValue: (key: string) => string;
	};
	parentStyleSheet = { href: 'http://localhost/app.css' };
	constructor(weight: string, style: string, subset: string) {
		const url = `/fonts/test-${subset}-${weight}-${style}.woff2`;
		this.style = {
			fontFamily: 'Test Font',
			fontStyle: style,
			fontWeight: weight,
			cssText: `font-family:"Test Font";font-style:${style};font-weight:${weight};src:url("${url}")`,
			getPropertyValue: () => `url("${url}")`
		};
	}
}
afterEach(() => vi.unstubAllGlobals());
function fixture(rules: Face[], weight = '700', style = 'normal', bytes = 4) {
	vi.stubGlobal('CSSFontFaceRule', Face);
	vi.stubGlobal('document', { styleSheets: [{ cssRules: rules }], baseURI: 'http://localhost/' });
	vi.stubGlobal('location', { origin: 'http://localhost' });
	vi.stubGlobal('getComputedStyle', () => ({ fontWeight: weight, fontStyle: style }));
	const fetch = vi.fn(async () => ({
		ok: true,
		arrayBuffer: async () => new Uint8Array(bytes).buffer
	}));
	vi.stubGlobal('fetch', fetch);
	return { fetch, source: { querySelectorAll: () => [] } as unknown as HTMLElement };
}
describe('local chart font embedding', () => {
	it('preserves Vite-inlined local faces without network requests', async () => {
		const face = new Face('400', 'normal', 'latin');
		const data = 'data:font/woff2;base64,AQIDBA==';
		face.style.cssText = `font-family:"Test Font";font-style:normal;font-weight:400;src:url("${data}")`;
		face.style.getPropertyValue = () => `url("${data}")`;
		const { source, fetch } = fixture([face], '400');
		const css = await embeddedSvgFonts('Test Font', source);
		expect(css).toContain(data);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('embeds used normal, bold and variable faces, including text in open shadow roots', async () => {
		const { fetch } = fixture(
			['normal', 'bold', '600 800', '900'].map((weight) => new Face(weight, 'normal', 'latin')),
			'400'
		);
		const text = { weight: '700' };
		const host = { shadowRoot: { querySelectorAll: () => [text] } };
		const source = { querySelectorAll: () => [host] };
		vi.stubGlobal('getComputedStyle', (node: unknown) => ({
			fontWeight: node === text ? '700' : '400',
			fontStyle: 'normal'
		}));
		const css = await embeddedSvgFonts('Test Font', source as unknown as HTMLElement);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(css.match(/@font-face/g)).toHaveLength(3);
		for (const weight of ['normal', 'bold', '600 800'])
			expect(css).toContain(`font-weight:${weight}`);
		expect(css).not.toContain('font-weight:900');
		expect(css).toContain('data:font/woff2;base64,');
		expect(css).not.toContain('/fonts/');
	});
	it('filters unused faces before the export limit and retains both used subsets', async () => {
		const rules = Array.from({ length: 13 }, (_, i) => new Face('700', 'italic', String(i)));
		rules.push(new Face('700', 'normal', 'latin'), new Face('700', 'normal', 'latin-ext'));
		const { fetch, source } = fixture(rules);
		const css = await embeddedSvgFonts('"Test Font",sans-serif', source);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(css.match(/@font-face/g)).toHaveLength(2);
		expect(css).toContain('data:font/woff2;base64,');
		expect(css).toContain('font-weight:700');
		expect(css).not.toContain('italic');
	});
	it('keeps the 12 face and 4 MiB limits', async () => {
		let { source } = fixture(
			Array.from({ length: 13 }, (_, i) => new Face('700', 'normal', String(i)))
		);
		await expect(embeddedSvgFonts('Test Font', source)).rejects.toThrow(
			'Font face embedding limit'
		);
		({ source } = fixture(
			[new Face('700', 'normal', 'latin')],
			'700',
			'normal',
			4 * 1024 * 1024 + 1
		));
		await expect(embeddedSvgFonts('Test Font', source)).rejects.toThrow('Font embedding limit');
	});
});
