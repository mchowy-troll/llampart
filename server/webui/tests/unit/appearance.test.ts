import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import { materialAlpha, resolveGlassMaterials } from '$lib/themes/frosted-glass/materials';
import { frostedGlassTheme } from '$lib/themes/frosted-glass';
import { getThemeOptions } from '$lib/themes/registry';
import {
	applyTypography,
	FONT_FAMILIES,
	FONT_SIZES,
	getFontVariants,
	normalizeUiScalePreset
} from '$lib/utils/typography';
import {
	averageWallpaperColor,
	FALLBACK_WALLPAPER_ACCENT,
	resolveWallpaperAccent,
	WALLPAPER_ACCENT_EVENT
} from '$lib/themes/frosted-glass/wallpaper-accent';
import {
	parseSettingsConfig,
	parseSettingsStorage,
	serializeSettingsStorage,
	validateSettingsPatch
} from '$lib/utils/settings-schema';

const defaults = { ...SETTING_CONFIG_DEFAULT } as SettingsConfigType;

describe('appearance settings and material palette', () => {
	it('defaults to 75 while retaining the existing material curve and filters', () => {
		expect(defaults).toMatchObject({
			frostedGlassMilkiness: 75,
			frostedGlassOpaque: false,
			fontFamily: 'default',
			fontVariant: '400',
			uiScale: '100'
		});
		const styles = resolveGlassMaterials({ ...defaults, frostedGlassMilkiness: 50 });
		for (const [name, percent] of [
			['white-140', 14],
			['white-130', 13],
			['white-340', 34],
			['grey-290', 29]
		]) {
			expect(styles[`--llampart-glass-${name}`]).toContain('var(--llampart-frosted-glass-accent)');
			expect(styles[`--llampart-glass-${name}`]).toContain(` ${percent}%, transparent)`);
		}
		expect(styles['--llampart-glass-filter-18-116']).toBe('blur(18px) saturate(116%)');
	});

	it('increases only surface alpha monotonically across the full scale', () => {
		for (const alpha of [0.035, 0.13, 0.14, 0.2, 0.34, 0.46, 0.72, 0.96]) {
			expect(materialAlpha(alpha, 0)).toBeCloseTo(alpha / 4);
			expect(materialAlpha(alpha, 50)).toBe(alpha);
			expect(materialAlpha(alpha, 100)).toBeCloseTo(Math.max(0.92, alpha));
			for (let level = 1; level <= 100; level++)
				expect(materialAlpha(alpha, level)).toBeGreaterThanOrEqual(materialAlpha(alpha, level - 1));
		}
		expect(materialAlpha(0.14, NaN)).toBe(0.14);
	});

	it('makes the shared palette opaque and tinted without opacity on children', () => {
		const config = { ...defaults, frostedGlassMilkiness: 23 };
		const before = resolveGlassMaterials(config);
		const opaque = resolveGlassMaterials({ ...config, frostedGlassOpaque: true });
		for (const [key, value] of Object.entries(opaque)) {
			expect(key).not.toMatch(/text|foreground|opacity|shadow|fade|wallpaper/);
			if (key.includes('-filter-')) expect(value).toBe('none');
			else
				expect(value).toMatch(
					/^color-mix\(in srgb, var\(--llampart-frosted-glass-accent\) [\d.]+%, white\)$/
				);
		}
		expect(opaque['--llampart-glass-grey-290']).not.toBe(opaque['--llampart-glass-grey-340']);
		expect(config.frostedGlassMilkiness).toBe(23);
		expect(resolveGlassMaterials({ ...config, frostedGlassOpaque: false })).toEqual(before);
	});

	it('registers every runtime material property for theme cleanup and keeps theme options', () => {
		const runtime = frostedGlassTheme.resolveRuntime(defaults, 0);
		for (const name of Object.keys(runtime.styles))
			expect(frostedGlassTheme.ownedStyleProperties).toContain(name);
		expect(getThemeOptions().map((theme) => theme.value)).toContain('frosted-glass');
		expect(runtime.classes).toContain('has-frosted-glass-wallpaper-milk');
	});

	it.each(['90', '95', '100', '105', '110'])(
		'retains the exact %s%% scale through schema and runtime',
		(value) => {
			expect(validateSettingsPatch({ uiScale: value })).toEqual({ uiScale: value });
			expect(normalizeUiScalePreset(value)).toBe(value);
		}
	);

	it('ignores the retired wallpaper setting while retaining legacy wallpapers and unrelated settings', () => {
		const config = parseSettingsConfig({
			frostedGlassWallpaperMilky: false,
			frostedGlassWallpaper: 'frosted-glass-05',
			futureSetting: true,
			uiScale: '90'
		});
		expect(config).not.toHaveProperty('frostedGlassWallpaperMilky');
		expect(config).toMatchObject({
			frostedGlassWallpaper: 'frosted-glass-05',
			futureSetting: true,
			frostedGlassMilkiness: 75,
			frostedGlassOpaque: false,
			uiScale: '90'
		});
	});

	it('round-trips the new settings and rejects invalid values', () => {
		const patch = {
			frostedGlassMilkiness: 37,
			frostedGlassOpaque: true,
			fontFamily: 'crimson-text',
			fontVariant: '400',
			uiScale: '105'
		};
		expect(parseSettingsStorage(serializeSettingsStorage({ ...defaults, ...patch }))).toMatchObject(
			patch
		);
		for (const invalid of [
			{ frostedGlassMilkiness: -1 },
			{ frostedGlassMilkiness: 101 },
			{ frostedGlassMilkiness: 0.5 },
			{ frostedGlassOpaque: 'true' },
			{ fontFamily: {} },
			{ fontVariant: {} },
			{ uiScale: '97' }
		])
			expect(() => validateSettingsPatch(invalid)).toThrow(/Invalid value/);
	});
});

describe('local typography', () => {
	function rootFixture() {
		const values = new Map<string, string>();
		const root = {
			dataset: {} as Record<string, string>,
			style: {
				setProperty: (key: string, value: string) => values.set(key, value),
				removeProperty: (key: string) => values.delete(key)
			}
		} as unknown as HTMLElement;
		return { root, values };
	}

	it('does not override default or monospace typography', () => {
		const { root, values } = rootFixture();
		applyTypography(root, { ...defaults, fontVariant: '700' });
		expect(values.size).toBe(0);
		expect(root.dataset).toEqual({});
	});
	it('scales fixed-pixel captions relative to rem and updates on resize without changing root size', () => {
		const { root, values } = rootFixture();
		let rem = '12px';
		const addEventListener = vi.fn(),
			removeEventListener = vi.fn();
		vi.stubGlobal('window', { addEventListener, removeEventListener });
		vi.stubGlobal('getComputedStyle', () => ({ fontSize: rem }));
		try {
			const cleanup = applyTypography(root, { ...defaults, fontSize: '18' });
			expect(values.get('--llampart-fixed-text-scale')).toBe('1.5');
			rem = '16px';
			addEventListener.mock.calls[0][1]();
			expect(values.get('--llampart-fixed-text-scale')).toBe('1.125');
			expect(values.get('--llampart-text-unit')).toBe('18px');
			cleanup();
			expect(removeEventListener).toHaveBeenCalledWith('resize', addEventListener.mock.calls[0][1]);
			expect(values.size).toBe(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it.each(['merriweather', 'frank-ruhl-libre'])(
		'uses real %s weights with hierarchy and cleans up',
		(fontFamily) => {
			for (const { value: fontVariant } of getFontVariants(fontFamily)) {
				const { root, values } = rootFixture();
				const cleanup = applyTypography(root, { ...defaults, fontFamily, fontVariant });
				const base = Number(values.get('--llampart-font-weight'));
				const medium = Number(values.get('--llampart-font-medium'));
				const semibold = Number(values.get('--llampart-font-semibold'));
				const bold = Number(values.get('--llampart-font-bold'));
				expect(base).toBe(Number(fontVariant));
				expect(medium).toBeGreaterThan(base);
				expect(semibold).toBeGreaterThan(medium);
				expect(bold).toBeGreaterThan(semibold);
				expect(bold).toBeLessThanOrEqual(900);
				expect([...values.keys()].some((key) => key.includes('mono'))).toBe(false);
				cleanup();
				expect(values.size).toBe(0);
				expect(root.dataset).toEqual({});
			}
		}
	);

	it('offers only real new-family weights and normalizes unsupported Crimson weights', () => {
		expect(Object.keys(FONT_FAMILIES)).toEqual([
			'default',
			'merriweather',
			'frank-ruhl-libre',
			'crimson-text',
			'libre-caslon-condensed',
			'fira-sans'
		]);
		expect(getFontVariants('crimson-text').map((item) => item.value)).toEqual([
			'400',
			'600',
			'700'
		]);
		for (const fontVariant of ['400', '500', '400-italic']) {
			const { root, values } = rootFixture();
			const cleanup = applyTypography(root, {
				...defaults,
				fontFamily: 'crimson-text',
				fontVariant
			});
			expect(values.get('--llampart-font-weight')).toBe('400');
			expect(values.get('--llampart-font-medium')).toBe('600');
			expect(values.get('--llampart-font-bold')).toBe('700');
			expect(values.get('--llampart-font-style')).toBe('normal');
			cleanup();
			expect(values.size).toBe(0);
		}
		expect(
			parseSettingsConfig({ fontFamily: 'crimson-text', fontVariant: '500' }).fontVariant
		).toBe('400');
		expect(
			parseSettingsConfig({ fontFamily: 'merriweather', fontVariant: '400-italic' }).fontVariant
		).toBe('400');
	});

	it('limits user widths with one percentage rule, without changing the 72rem AI container', () => {
		const read = (path: string) =>
			readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
		const tokens = read('lib/styles/tokens.css');
		expect(tokens).toContain('--llampart-chat-message-max-width: 72rem');
		expect(tokens).toContain('--llampart-chat-user-message-min-width: 50%');
		expect(tokens).toContain('--llampart-chat-user-message-max-width: 75%');
		const rule = read('app.css').match(/\.llampart-user-message-width\s*\{([^}]+)\}/)![1];
		expect(rule).toContain('width: fit-content');
		expect(rule).toContain('min-width: var(--llampart-chat-user-message-min-width)');
		expect(rule).toContain('max-width: var(--llampart-chat-user-message-max-width)');
		expect(rule).not.toContain('!important');
		const component = read('lib/components/app/chat/ChatMessages/ChatMessageUser.svelte');
		expect(component).not.toMatch(/w-fit|min-w-48|w-full llampart-user-message-width/);
	});

	it('renders the wallpaper directly without global overlay pseudo-elements', () => {
		const css = readFileSync(
			new URL('../../src/lib/themes/frosted-glass/global.css', import.meta.url),
			'utf8'
		);
		expect(css).toContain('background-image: var(--llampart-theme-wallpaper)');
		expect(css).not.toMatch(/#llampart-theme-preload-background::(?:before|after)/);
	});

	it('keeps the composer wallpaper fade without the retired white overlay', () => {
		const css = readFileSync(
			new URL('../../src/lib/themes/frosted-glass/composer.css', import.meta.url),
			'utf8'
		);
		expect(css).toContain('.llampart-composer-fade-curtain::before');
		expect(css).toContain('background-image: var(--llampart-theme-wallpaper)');
		expect(css).toContain('mask-image: linear-gradient(');
		expect(css).not.toContain('.llampart-composer-fade-curtain::after');
	});

	it('averages wallpaper colors with alpha weighting and a safe empty fallback', () => {
		expect(averageWallpaperColor(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]))).toBe(
			'#800080'
		);
		expect(averageWallpaperColor(new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]))).toBe(
			'#0000ff'
		);
		expect(averageWallpaperColor(new Uint8ClampedArray())).toBe(FALLBACK_WALLPAPER_ACCENT);
	});

	it('limits a tiny extreme-color outlier without shifting the dominant material color', () => {
		const pixels = new Uint8ClampedArray(100 * 4);
		for (let i = 0; i < 100; i++)
			pixels.set(i === 0 ? [255, 0, 255, 255] : [120, 140, 160, 255], i * 4);
		expect(averageWallpaperColor(pixels)).toBe('#788ca0');
	});

	it.each(['decode', 'context', 'pixels'])(
		'uses a cached neutral fallback after %s failure',
		(failure) => {
			const images: { onload: () => void; onerror: () => void }[] = [];
			const readPixels = vi.fn(() => {
				throw new Error('tainted canvas');
			});
			vi.stubGlobal(
				'Image',
				class {
					onload = () => {};
					onerror = () => {};
					src = '';
					constructor() {
						images.push(this);
					}
				}
			);
			vi.stubGlobal('document', {
				createElement: () => ({
					getContext: () =>
						failure === 'context' ? null : { drawImage: vi.fn(), getImageData: readPixels }
				})
			});
			try {
				const wallpaper = { id: `failure-${failure}`, labelKey: '', src: '/missing.jpg' };
				expect(resolveWallpaperAccent(wallpaper)).toBe(FALLBACK_WALLPAPER_ACCENT);
				if (failure === 'decode') images[0].onerror();
				else images[0].onload();
				expect(resolveWallpaperAccent(wallpaper)).toBe(FALLBACK_WALLPAPER_ACCENT);
				expect(readPixels).toHaveBeenCalledTimes(failure === 'pixels' ? 1 : 0);
			} finally {
				vi.unstubAllGlobals();
			}
		}
	);

	it('samples once per image, refreshes custom accents, and ignores stale image loads', () => {
		const images: { onload: () => void; src: string }[] = [];
		let pixels = new Uint8ClampedArray([30, 80, 160, 255]);
		const dispatch = vi.fn();
		vi.stubGlobal(
			'Image',
			class {
				onload = () => {};
				src = '';
				constructor() {
					images.push(this);
				}
			}
		);
		vi.stubGlobal('document', {
			createElement: () => ({
				getContext: () => ({
					drawImage: vi.fn(),
					getImageData: () => ({ data: pixels })
				})
			})
		});
		vi.stubGlobal(
			'CustomEvent',
			class {
				constructor(public type: string) {}
			}
		);
		vi.stubGlobal('dispatchEvent', dispatch);
		try {
			const wallpaper = { id: 'test-custom', labelKey: '', src: 'data:first' };
			expect(resolveWallpaperAccent(wallpaper)).toBe(FALLBACK_WALLPAPER_ACCENT);
			images[0].onload();
			expect(resolveWallpaperAccent(wallpaper)).toBe('#1e50a0');
			expect(images).toHaveLength(1);
			expect(dispatch.mock.calls[0][0].type).toBe(WALLPAPER_ACCENT_EVENT);
			resolveWallpaperAccent({ ...wallpaper, src: 'data:second' });
			const latest = { ...wallpaper, src: 'data:third' };
			resolveWallpaperAccent(latest);
			images[1].onload();
			expect(resolveWallpaperAccent(latest)).toBe(FALLBACK_WALLPAPER_ACCENT);
			pixels = new Uint8ClampedArray([180, 100, 20, 255]);
			images[2].onload();
			expect(resolveWallpaperAccent(latest)).toBe('#b46414');
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it.each([0, 50, 100])('retains the wallpaper tint at milkiness %s', (frostedGlassMilkiness) => {
		for (const [key, value] of Object.entries(
			resolveGlassMaterials({ ...defaults, frostedGlassMilkiness })
		))
			if (!key.includes('-filter-'))
				expect(value).toContain('var(--llampart-frosted-glass-accent)');
	});

	it('ships real local WOFF2 faces and OFL licenses without runtime CDN CSS', () => {
		const dir = new URL('../../static/fonts/', import.meta.url);
		const files = readdirSync(dir).filter((name) => name.endsWith('.woff2'));
		expect(files).toHaveLength(38);
		const css =
			readFileSync(new URL('../../src/lib/styles/typography.css', import.meta.url), 'utf8') +
			readFileSync(new URL('../../src/lib/styles/local-fonts.css', import.meta.url), 'utf8');
		expect(css).not.toMatch(/https?:|@import/);
		for (const file of files) {
			expect(readFileSync(new URL(file, dir)).subarray(0, 4).toString()).toBe('wOF2');
			expect(css).toContain(`/fonts/${file}`);
		}
		const sources = JSON.parse(readFileSync(new URL('sources.json', dir), 'utf8')) as {
			file: string;
			bytes: number;
			sha256: string;
			url: string;
		}[];
		expect(sources).toHaveLength(32);
		for (const source of sources) {
			const data = readFileSync(new URL(source.file, dir));
			expect(data.length).toBe(source.bytes);
			expect(createHash('sha256').update(data).digest('hex')).toBe(source.sha256);
			expect(source.url).toMatch(/^https:\/\/fonts.gstatic.com\//);
		}
		for (const family of Object.keys(FONT_FAMILIES).filter((id) => id !== 'default'))
			expect(readFileSync(new URL(`${family}-OFL.txt`, dir), 'utf8')).toMatch(
				/SIL OPEN FONT LICENSE Version 1.1/i
			);
	});
	it.each(FONT_SIZES)('applies %s px without touching root rem or family', (fontSize) => {
		const { root, values } = rootFixture();
		const cleanup = applyTypography(root, { ...defaults, fontSize });
		expect(values.get('--llampart-text-unit')).toBe(`${fontSize}px`);
		expect(values.size).toBe(1);
		cleanup();
		expect(values.size).toBe(0);
		expect(parseSettingsStorage(serializeSettingsStorage({ ...defaults, fontSize })).fontSize).toBe(
			fontSize
		);
	});
	it.each(['11', '21', '100', '105', '16px', 16, NaN])(
		'rejects invalid font size %s and falls back on storage load',
		(fontSize) => {
			expect(() => validateSettingsPatch({ fontSize })).toThrow();
			expect(parseSettingsConfig({ fontSize, temperature: 0.3 })).toMatchObject({
				fontSize: 'default',
				temperature: 0.3
			});
		}
	);
});
