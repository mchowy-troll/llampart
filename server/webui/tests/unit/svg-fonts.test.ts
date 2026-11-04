import { afterEach, describe, expect, it, vi } from 'vitest';
import { embeddedSvgFonts } from '$lib/utils/svg-fonts';

class Face {
	parentStyleSheet = { href: 'http://localhost/app.css' };
	style;
	constructor(weight = '400', style = 'normal', range = 'U+0000-00FF', family = 'Test Font') {
		const src = `url("/fonts/${family}-${weight}-${style}-${range}.woff2")`;
		this.style = {
			fontFamily: family,
			fontWeight: weight,
			fontStyle: style,
			cssText: `font-family:"${family}";font-style:${style};font-weight:${weight};unicode-range:${range};src:${src}`,
			getPropertyValue: (key: string) =>
				key === 'src' ? src : key === 'unicode-range' ? range : ''
		};
	}
}

function text(value = 'A', weight = '400', style = 'normal', family = 'Test Font') {
	return {
		nodeName: 'text',
		childNodes: [{ nodeType: 3, textContent: value }],
		fontWeight: weight,
		fontStyle: style,
		fontFamily: family
	};
}

function fixture(rules: Face[], texts = [text()], bytes = 4) {
	vi.stubGlobal('CSSFontFaceRule', Face);
	vi.stubGlobal('document', { styleSheets: [{ cssRules: rules }], baseURI: 'http://localhost/' });
	vi.stubGlobal('location', { origin: 'http://localhost' });
	vi.stubGlobal('getComputedStyle', (node: unknown) => node);
	const fetch = vi.fn(async () => ({
		ok: true,
		arrayBuffer: async () => new Uint8Array(bytes).buffer
	}));
	vi.stubGlobal('fetch', fetch);
	return {
		fetch,
		source: { childNodes: [], querySelectorAll: () => texts } as unknown as HTMLElement
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('local SVG font embedding', () => {
	it('preserves Vite-inlined faces without network requests', async () => {
		const face = new Face();
		const data = 'data:font/woff2;base64,AQIDBA==';
		const original = face.style.getPropertyValue;
		face.style.cssText = face.style.cssText.replace(/url\([^)]+\)/, `url("${data}")`);
		face.style.getPropertyValue = (key) => (key === 'src' ? `url("${data}")` : original(key));
		const { source, fetch } = fixture([face]);
		expect(await embeddedSvgFonts('Test Font', source)).toContain(data);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('selects actual alphabets, styles and local fallback weights before the limit', async () => {
		const rules = [new Face('300 900'), new Face('300 900', 'normal', 'U+0400-045F')];
		for (const style of ['normal', 'italic'])
			for (const weight of ['400', '700'])
				rules.push(new Face(weight, style, 'U+0370-03FF', 'Greek'));
		for (let i = 0; i < 20; i++)
			rules.push(new Face('900', 'italic', `U+${(0x600 + i).toString(16)}`));
		const { source, fetch } = fixture(rules, [
			text('AБα', '600', 'normal', 'Test Font, Greek'),
			text('α', '700', 'italic', 'Test Font, Greek')
		]);
		const css = await embeddedSvgFonts('Test Font, Greek', source);
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(css.match(/@font-face/g)).toHaveLength(4);
		expect(css).toContain('font-weight:700');
		expect(css).toContain('font-style:italic');
		expect(css).not.toContain('/fonts/');
	});
	it('includes used text in open shadow roots but not unused fallback families', async () => {
		const host = {
			nodeName: 'DIV',
			childNodes: [],
			shadowRoot: { querySelectorAll: () => [text('Б', '700')] }
		};
		const { source, fetch } = fixture([
			new Face('300 900'),
			new Face('300 900', 'normal', 'U+0400-045F'),
			new Face('100 900', 'normal', 'U+0000-045F', 'Fallback')
		]);
		source.querySelectorAll = (() => [host]) as unknown as typeof source.querySelectorAll;
		const css = await embeddedSvgFonts('Test Font, Fallback', source);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(css).toContain('U+0400-045F');
		expect(css).not.toContain('Fallback');
	});
	it('uses CSS static matching for 400–500 and heavier fallback requests', async () => {
		for (const [requested, expected] of [
			['450', '500'],
			['600', '700'],
			['900', '700']
		]) {
			const { source } = fixture(
				['400', '500', '700'].map((w) => new Face(w)),
				[text('A', requested)]
			);
			const css = await embeddedSvgFonts('Test Font', source);
			expect(css.match(/@font-face/g)).toHaveLength(1);
			expect(css).toContain(`font-weight:${expected}`);
		}
	});
	it('keeps the 12 face and 4 MiB limits', async () => {
		let { source } = fixture(
			Array.from({ length: 13 }, (_, i) => new Face('400', 'normal', `U+${(65 + i).toString(16)}`)),
			[text('ABCDEFGHIJKLM')]
		);
		await expect(embeddedSvgFonts('Test Font', source)).rejects.toThrow(
			'Font face embedding limit'
		);
		({ source } = fixture([new Face()], [text()], 4 * 1024 * 1024 + 1));
		await expect(embeddedSvgFonts('Test Font', source)).rejects.toThrow('Font embedding limit');
	});
	it('accepts the exporter’s text scope without embedding toolbar-only weights', async () => {
		const { source, fetch } = fixture([new Face('400'), new Face('500')], [text('Toolbar', '500')]);
		const plot = { childNodes: [], querySelectorAll: () => [text('A')] } as unknown as Element;
		const css = await embeddedSvgFonts('Test Font', source, [plot]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(css).toContain('font-weight:400');
		expect(css).not.toContain('font-weight:500');
	});
});
