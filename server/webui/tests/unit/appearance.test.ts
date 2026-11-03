import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import { resolveGlassMaterials } from '$lib/themes/frosted-glass/materials';
import { frostedGlassTheme } from '$lib/themes/frosted-glass';
import {
	FROSTED_GLASS_WALLPAPERS,
	getFrostedGlassWallpaperThumbnailSrc
} from '$lib/themes/frosted-glass/wallpapers';
import { getThemeOptions } from '$lib/themes/registry';
import { applyTypography, getFontVariants, normalizeUiScalePreset } from '$lib/utils/typography';
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
	it('pairs all five original JPEGs with small, independent WebP thumbnails', () => {
		expect(FROSTED_GLASS_WALLPAPERS).toHaveLength(5);
		const paths = FROSTED_GLASS_WALLPAPERS.map(({ src }) => {
			const thumbnail = getFrostedGlassWallpaperThumbnailSrc(src);
			expect(thumbnail).toBe(
				src
					.replace('/frosted-glass/frosted-glass-', '/frosted-glass/thumbnails/frosted-glass-')
					.replace('.jpg', '.webp')
			);
			const original = new URL(`../../static${src}`, import.meta.url);
			const file = new URL(`../../static${thumbnail}`, import.meta.url);
			const bytes = readFileSync(file);
			expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
			expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
			expect(bytes.length).toBeLessThan(20_000);
			expect(bytes.length).toBeLessThan(statSync(original).size);
			return thumbnail;
		});
		expect(new Set(paths).size).toBe(5);
		expect(
			getFrostedGlassWallpaperThumbnailSrc('/wallpapers/frosted-glass/frosted-glass-06.jpg')
		).toBe('/wallpapers/frosted-glass/thumbnails/frosted-glass-06.webp');
	});
	it('disables surface transparency and filters reversibly without opacity on children', () => {
		const config = { ...defaults, frostedGlassMilkiness: 23 };
		const before = resolveGlassMaterials(config);
		const opaque = resolveGlassMaterials({ ...config, frostedGlassOpaque: true });
		for (const [key, value] of Object.entries(opaque)) {
			expect(key).not.toMatch(/text|foreground|opacity|shadow|fade|wallpaper/);
			if (key.includes('-filter-')) expect(value).toBe('none');
			else expect(value).not.toContain('transparent');
		}
		expect(config.frostedGlassMilkiness).toBe(23);
		expect(resolveGlassMaterials({ ...config, frostedGlassOpaque: false })).toEqual(before);
	});

	it('registers every runtime material property for theme cleanup and keeps theme options', () => {
		const runtime = frostedGlassTheme.resolveRuntime(defaults, 0);
		for (const name of Object.keys(runtime.styles))
			expect(frostedGlassTheme.ownedStyleProperties).toContain(name);
		expect(getThemeOptions().map((theme) => theme.value)).toContain('frosted-glass');
	});

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
			fontSize: '18',
			uiScale: '105'
		};
		expect(parseSettingsStorage(serializeSettingsStorage({ ...defaults, ...patch }))).toMatchObject(
			patch
		);
		expect(normalizeUiScalePreset(patch.uiScale)).toBe(patch.uiScale);
		for (const invalid of [
			{ frostedGlassMilkiness: -1 },
			{ frostedGlassMilkiness: 101 },
			{ frostedGlassMilkiness: 0.5 },
			{ frostedGlassOpaque: 'true' },
			{ fontFamily: {} },
			{ fontVariant: {} },
			{ fontSize: '16px' },
			{ uiScale: '97' }
		])
			expect(() => validateSettingsPatch(invalid)).toThrow(/Invalid value/);
		expect(parseSettingsConfig({ fontSize: '16px', temperature: 0.3 })).toMatchObject({
			fontSize: defaults.fontSize,
			temperature: 0.3
		});
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

	it('resolves both default sentinels to factory typography without touching monospace', () => {
		const { root, values } = rootFixture();
		applyTypography(root, {
			...defaults,
			fontFamily: 'default',
			fontSize: 'default',
			fontVariant: '700'
		});
		expect(values.get('--llampart-font-weight')).toBe(SETTING_CONFIG_DEFAULT.fontVariant);
		expect(values.get('--llampart-text-unit')).toBe(`${SETTING_CONFIG_DEFAULT.fontSize}px`);
		expect(root.dataset.llampartFont).toBe(SETTING_CONFIG_DEFAULT.fontFamily);
		expect(getFontVariants('default')).toEqual(getFontVariants('merriweather'));
		expect([...values.keys()].some((key) => key.includes('mono'))).toBe(false);
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
			expect(values.has('font-size')).toBe(false);
			expect([...values.keys()].some((key) => key.includes('mono'))).toBe(false);
			cleanup();
			expect(removeEventListener).toHaveBeenCalledWith('resize', addEventListener.mock.calls[0][1]);
			expect(values.size).toBe(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('normalizes an unsupported font weight consistently in storage and runtime and cleans up', () => {
		const config = parseSettingsConfig({ fontFamily: 'crimson-text', fontVariant: '500' });
		const { root, values } = rootFixture();
		const cleanup = applyTypography(root, { ...config, fontVariant: '500' });
		expect(getFontVariants(config.fontFamily).map(({ value }) => value)).toContain(
			config.fontVariant
		);
		expect(values.get('--llampart-font-weight')).toBe(config.fontVariant);
		cleanup();
		expect(values.size).toBe(0);
		expect(root.dataset).toEqual({});
	});

	it('averages wallpaper colors with alpha weighting and a safe empty fallback', () => {
		const blue = averageWallpaperColor(new Uint8ClampedArray([0, 0, 255, 255]));
		expect(averageWallpaperColor(new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]))).toBe(blue);
		expect(averageWallpaperColor(new Uint8ClampedArray())).toBe(FALLBACK_WALLPAPER_ACCENT);
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
			const first = resolveWallpaperAccent(wallpaper);
			expect(first).not.toBe(FALLBACK_WALLPAPER_ACCENT);
			expect(images).toHaveLength(1);
			expect(dispatch.mock.calls[0][0].type).toBe(WALLPAPER_ACCENT_EVENT);
			resolveWallpaperAccent({ ...wallpaper, src: 'data:second' });
			const latest = { ...wallpaper, src: 'data:third' };
			resolveWallpaperAccent(latest);
			images[1].onload();
			expect(resolveWallpaperAccent(latest)).toBe(FALLBACK_WALLPAPER_ACCENT);
			pixels = new Uint8ClampedArray([180, 100, 20, 255]);
			images[2].onload();
			expect(resolveWallpaperAccent(latest)).not.toBe(FALLBACK_WALLPAPER_ACCENT);
			expect(resolveWallpaperAccent(latest)).not.toBe(first);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('does not load typography CSS from an external CDN', () => {
		const css =
			readFileSync(new URL('../../src/lib/styles/typography.css', import.meta.url), 'utf8') +
			readFileSync(new URL('../../src/lib/styles/local-fonts.css', import.meta.url), 'utf8');
		expect(css).not.toMatch(/https?:|@import/);
	});
});
