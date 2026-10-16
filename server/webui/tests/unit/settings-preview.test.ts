import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_LOCALSTORAGE_KEY, SETTING_CONFIG_DEFAULT } from '$lib/constants';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import {
	exportApplicationSettings,
	importApplicationSettings
} from '$lib/utils/settings-import-export';
import {
	parseSettingsConfig,
	parseSettingsStorage,
	serializeSettingsStorage,
	validateSettingsPatch
} from '$lib/utils/settings-schema';
import {
	CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY,
	clearCustomFrostedGlassWallpaperSrc,
	getCustomFrostedGlassWallpaperSrc,
	setCustomFrostedGlassWallpaperSrc
} from '$lib/themes/frosted-glass/wallpapers';

vi.mock('$app/environment', () => ({ browser: true }));
const storage = vi.hoisted(() => {
	const values = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	});
	return values;
});
const originalConfig = { ...settingsStore.config };
const originalProps = serverStore.props;
const originalOverrides = [...settingsStore.userOverrides];

beforeEach(() => {
	storage.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key)
	});
	settingsStore.cancelPreview();
	settingsStore.config = { ...SETTING_CONFIG_DEFAULT };
	settingsStore.userOverrides.clear();
	serverStore.props = null;
	settingsStore.updateMultipleConfig({ ...SETTING_CONFIG_DEFAULT });
});

afterEach(() => {
	settingsStore.cancelPreview();
	settingsStore.config = { ...originalConfig };
	serverStore.props = originalProps;
	settingsStore.userOverrides.clear();
	for (const key of originalOverrides) settingsStore.userOverrides.add(key);
	vi.unstubAllGlobals();
});

describe('settings preview through the real store', () => {
	it('keeps server-default synchronization stable instead of replacing its reactive dependency', () => {
		serverStore.props = {
			default_generation_settings: { params: { temperature: 0.8, top_p: 0.95 } },
			ui_settings: { fontFamily: 'crimson-text', fontVariant: '500' }
		} as unknown as ApiLlamaCppServerProps;
		const committed = settingsStore.config;
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { uiScale: '110' });
		settingsStore.syncWithServerDefaults();
		expect(settingsStore.config).toBe(committed);
		expect(config()).toMatchObject({ fontFamily: 'crimson-text', fontVariant: '400' });
		settingsStore.syncWithServerDefaults();
		expect(settingsStore.config).toBe(committed);
		expect(settingsStore.appearanceConfig.uiScale).toBe('110');
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject({
			uiScale: '100',
			fontFamily: 'crimson-text',
			fontVariant: '400'
		});
	});

	it('previews every appearance field without changing config(), storage or overrides', () => {
		const before = new Map(storage);
		const committed = { ...config() };
		const overrides = [...settingsStore.userOverrides];
		const session = settingsStore.beginPreview();
		const appearance = {
			theme: 'frosted-glass',
			uiScale: '110',
			fontFamily: 'crimson-text',
			fontVariant: '500',
			fontSize: '20',
			frostedGlassWallpaper: 'frosted-glass-05',
			frostedGlassMilkiness: 12,
			frostedGlassOpaque: true
		};
		settingsStore.updatePreview(session, { ...appearance, serverBaseUrl: 'http://not-previewed' });
		expect(settingsStore.appearanceConfig).toMatchObject({ ...appearance, fontVariant: '400' });
		expect(settingsStore.appearanceConfig.serverBaseUrl).toBe(committed.serverBaseUrl);
		expect(config()).toEqual(committed);
		expect(storage).toEqual(before);
		expect([...settingsStore.userOverrides]).toEqual(overrides);
	});

	it('cancels without undoing independent updates or persisting the overlay', () => {
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, {
			uiScale: '110',
			fontFamily: 'merriweather',
			fontVariant: '700',
			fontSize: '18'
		});
		settingsStore.updateConfig('showMessageStats', !config().showMessageStats);
		settingsStore.updateMultipleConfig({ keepStatsVisible: true });
		const saved = parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!);
		expect(saved).toMatchObject({
			uiScale: '100',
			fontFamily: 'default',
			fontSize: 'default',
			fontVariant: '400',
			keepStatsVisible: true
		});
		settingsStore.cancelPreview(session);
		expect(settingsStore.appearanceConfig).toEqual(config());
		expect(config()).toEqual(saved);
		const reopened = settingsStore.beginPreview();
		expect(settingsStore.appearanceConfig.uiScale).toBe('100');
		settingsStore.cancelPreview(reopened);
	});

	it('commits the whole form once, ends preview and survives a reload', () => {
		const session = settingsStore.beginPreview();
		const patch = {
			uiScale: '105',
			fontFamily: 'frank-ruhl-libre',
			fontSize: '16',
			fontVariant: '600',
			keepStatsVisible: true
		};
		settingsStore.updatePreview(session, patch);
		expect(settingsStore.commitPreview(session, patch)).toBe(true);
		expect(settingsStore.isPreviewCurrent(session)).toBe(false);
		expect(config()).toMatchObject(patch);
		settingsStore.initialize();
		expect(config()).toMatchObject(patch);
		expect(settingsStore.appearanceConfig).toEqual(config());
	});

	it('does not partially commit an invalid form and keeps its preview available for correction', () => {
		const before = new Map(storage);
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { uiScale: '110' });
		expect(() => settingsStore.commitPreview(session, { uiScale: '110', top_p: 2 })).toThrow(
			/top_p/
		);
		expect(storage).toEqual(before);
		expect(config().uiScale).toBe('100');
		expect(settingsStore.appearanceConfig.uiScale).toBe('110');
		expect(settingsStore.isPreviewCurrent(session)).toBe(true);
		settingsStore.cancelPreview(session);
		expect(settingsStore.appearanceConfig.uiScale).toBe('100');
	});

	it('invalidates old sessions on cancel, reopening and confirmed reset', () => {
		const old = settingsStore.beginPreview();
		settingsStore.updatePreview(old, { uiScale: '110' });
		const current = settingsStore.beginPreview();
		expect(settingsStore.commitPreview(old, { uiScale: '110' })).toBe(false);
		settingsStore.cancelPreview(old);
		expect(settingsStore.isPreviewCurrent(current)).toBe(true);
		settingsStore.updatePreview(current, { uiScale: '105' });
		settingsStore.forceSyncWithServerDefaults();
		expect(settingsStore.isPreviewCurrent(current)).toBe(false);
		expect(settingsStore.appearanceConfig).toEqual(config());
		expect(settingsStore.commitPreview(current, { uiScale: '105' })).toBe(false);
		settingsStore.resetConfig();
		expect(config()).toEqual(SETTING_CONFIG_DEFAULT);
	});

	it('stages custom wallpaper replacement and deletion until commit', () => {
		const original = 'data:image/png;base64,b3JpZ2luYWw=';
		const replacement = 'data:image/png;base64,bmV3';
		setCustomFrostedGlassWallpaperSrc(original);
		const session = settingsStore.beginPreview();
		setCustomFrostedGlassWallpaperSrc(replacement);
		expect(getCustomFrostedGlassWallpaperSrc()).toBe(replacement);
		expect(storage.get(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY)).toBe(original);
		settingsStore.cancelPreview(session);
		expect(getCustomFrostedGlassWallpaperSrc()).toBe(original);
		const next = settingsStore.beginPreview();
		clearCustomFrostedGlassWallpaperSrc();
		expect(getCustomFrostedGlassWallpaperSrc()).toBeUndefined();
		expect(storage.get(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY)).toBe(original);
		settingsStore.commitPreview(next, {});
		expect(storage.has(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY)).toBe(false);
	});

	it('exports only committed configuration while a different font is previewed', async () => {
		settingsStore.updateMultipleConfig({ fontFamily: 'merriweather', fontVariant: '700' });
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { fontFamily: 'crimson-text', fontSize: '19' });
		let exported: Blob | undefined;
		const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			exported = blob as Blob;
			return 'blob:settings-preview';
		});
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.stubGlobal('document', {
			createElement: () => ({ click: vi.fn() }),
			body: { appendChild: vi.fn(), removeChild: vi.fn() }
		});
		try {
			exportApplicationSettings();
			expect(JSON.parse(await exported!.text()).settings).toMatchObject({
				fontFamily: 'merriweather',
				fontVariant: '700'
			});
		} finally {
			create.mockRestore();
			revoke.mockRestore();
		}
	});
});

describe('contextual font normalization through store entry points', () => {
	function expectFont(family: string, variant: string) {
		const expected = { fontFamily: family, fontVariant: variant };
		expect(config()).toMatchObject(expected);
		expect(settingsStore.getAllConfig()).toMatchObject(expected);
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject(expected);
		expect(parseSettingsStorage(serializeSettingsStorage(config()))).toMatchObject(expected);
	}

	it('normalizes unsupported Crimson Text weights before assigning state', () => {
		settingsStore.updateConfig('fontFamily', 'crimson-text');
		settingsStore.updateConfig('fontVariant', '500');
		expectFont('crimson-text', '400');
		settingsStore.updateMultipleConfig({ fontVariant: '500' });
		expectFont('crimson-text', '400');
		settingsStore.updateMultipleConfig({ fontFamily: 'crimson-text', fontVariant: '500' });
		expectFont('crimson-text', '400');
	});

	it('preserves supported weights, including family-only changes', () => {
		settingsStore.updateMultipleConfig({ fontFamily: 'merriweather', fontVariant: '700' });
		expectFont('merriweather', '700');
		settingsStore.updateConfig('fontFamily', 'frank-ruhl-libre');
		expectFont('frank-ruhl-libre', '700');
		settingsStore.updateConfig('fontVariant', '600');
		expectFont('frank-ruhl-libre', '600');
		settingsStore.updateConfig('fontFamily', 'crimson-text');
		expectFont('crimson-text', '600');
	});

	it('uses the supplied effective family for standalone patches and previews', () => {
		expect(validateSettingsPatch({ fontVariant: '500' }, { fontFamily: 'crimson-text' })).toEqual({
			fontVariant: '400'
		});
		expect(
			validateSettingsPatch(
				{ fontFamily: 'frank-ruhl-libre' },
				{ fontFamily: 'merriweather', fontVariant: '700' }
			)
		).toMatchObject({ fontVariant: '700' });
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { fontFamily: 'crimson-text' });
		settingsStore.updatePreview(session, { fontVariant: '500' });
		expect(settingsStore.appearanceConfig.fontVariant).toBe('400');
	});

	it('normalizes partial imports using the saved family and preserves supported family-only weights', () => {
		const importPatch = (settings: Record<string, unknown>) => {
			importApplicationSettings(
				JSON.stringify({ type: 'llampart-settings-export', formatVersion: 1, settings })
			);
			settingsStore.initialize();
		};
		settingsStore.updateConfig('fontFamily', 'crimson-text');
		importPatch({ fontVariant: '500' });
		expectFont('crimson-text', '400');
		importPatch({ fontFamily: 'merriweather', fontVariant: '700' });
		importPatch({ fontFamily: 'frank-ruhl-libre' });
		expectFont('frank-ruhl-libre', '700');
	});

	it.each(['dm-serif-display', 'inter', 'open-sans', 'instrument-serif', 'unknown'])(
		'migrates %s and rejects invalid types atomically',
		(family) => {
			expect(parseSettingsConfig({ fontFamily: family, fontVariant: '700' }).fontFamily).toBe(
				'default'
			);
			settingsStore.updateMultipleConfig({ fontFamily: family, fontVariant: '700' });
			expectFont('default', '400');
			const before = { ...config() };
			const saved = new Map(storage);
			expect(() => settingsStore.updateConfig('fontVariant', NaN as unknown as string)).toThrow(
				/fontVariant/
			);
			expect(() =>
				settingsStore.updateMultipleConfig({
					fontFamily: 'merriweather',
					fontVariant: false as unknown as string
				})
			).toThrow(/fontVariant/);
			expect(config()).toEqual(before);
			expect(storage).toEqual(saved);
		}
	);
});
