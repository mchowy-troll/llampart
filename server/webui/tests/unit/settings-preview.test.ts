import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONFIG_LOCALSTORAGE_KEY,
	SETTING_CONFIG_DEFAULT,
	GLOBAL_CONFIG_STORAGE_DEFAULT
} from '$lib/constants';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions
} from '$lib/utils/response-preferences';
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
	CUSTOM_FROSTED_GLASS_WALLPAPER_ID,
	DEFAULT_FROSTED_GLASS_WALLPAPER_ID,
	clearCustomFrostedGlassWallpaperSrc,
	getCustomFrostedGlassWallpaperSrc,
	getFrostedGlassWallpaper,
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

it('uses wallpaper 03 for first run, invalid values and reset without changing milkiness', () => {
	expect(DEFAULT_FROSTED_GLASS_WALLPAPER_ID).toBe('frosted-glass-03');
	expect(SETTING_CONFIG_DEFAULT.frostedGlassWallpaper).toBe('frosted-glass-03');
	expect(getFrostedGlassWallpaper('invalid').id).toBe('frosted-glass-03');
	settingsStore.updateConfig('frostedGlassWallpaper', 'frosted-glass-01');
	settingsStore.resetConfig();
	expect(config().frostedGlassWallpaper).toBe('frosted-glass-03');
	expect(config().frostedGlassMilkiness).toBe(75);
});

it.each(['frosted-glass-01', 'frosted-glass-02', 'frosted-glass-04', 'frosted-glass-05'])(
	'preserves the saved wallpaper %s on initialization',
	(id) => {
		settingsStore.updateConfig('frostedGlassWallpaper', id);
		settingsStore.initialize();
		expect(config().frostedGlassWallpaper).toBe(id);
	}
);

it('resets milkiness to 75 and persists it without changing the slider semantics', () => {
	settingsStore.updateConfig('frostedGlassMilkiness', 23);
	expect(config().frostedGlassMilkiness).toBe(23);
	settingsStore.resetParameterToServerDefault('frostedGlassMilkiness');
	expect(config().frostedGlassMilkiness).toBe(75);
	expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!).frostedGlassMilkiness).toBe(
		75
	);
	settingsStore.updateConfig('frostedGlassMilkiness', 50);
	settingsStore.resetConfig();
	expect(config().frostedGlassMilkiness).toBe(75);
});

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
	it.each(['add', 'edit', 'remove'] as const)(
		'preserves immediate MCP %s through main Save and reload',
		(operation) => {
			if (operation !== 'add')
				mcpStore.addServer({
					id: 'mcp-test',
					url: 'http://mock.invalid/mcp',
					enabled: true,
					headers: 'X-Test: kept'
				});
			const session = settingsStore.beginPreview();
			const draft = { ...config() };
			if (operation === 'add')
				mcpStore.addServer({
					id: 'mcp-test',
					url: 'http://mock.invalid/mcp',
					enabled: true,
					headers: 'X-Test: kept'
				});
			if (operation === 'edit')
				mcpStore.updateServer('mcp-test', {
					url: 'http://edited.invalid/mcp',
					headers: 'X-Test: edited'
				});
			if (operation === 'remove') mcpStore.removeServer('mcp-test');
			const latest = config().mcpServers;
			expect(settingsStore.getPreviewChanges(session, draft)).toEqual({});
			expect(settingsStore.commitPreview(session, draft)).toEqual({ ok: true });
			expect(config().mcpServers).toBe(latest);
			settingsStore.initialize();
			expect(config().mcpServers).toBe(latest);
			expect(mcpStore.getServers()).toHaveLength(operation === 'remove' ? 0 : 1);
			if (operation === 'edit')
				expect(mcpStore.getServers()[0]).toMatchObject({
					id: 'mcp-test',
					url: 'http://edited.invalid/mcp',
					headers: 'X-Test: edited'
				});
		}
	);
	it('merges independent appearance edits with MCP additions without dirtying the opening snapshot', () => {
		const session = settingsStore.beginPreview();
		const draft = { ...config(), fontFamily: 'fira-sans', fontVariant: '700', uiScale: '105' };
		settingsStore.updatePreview(session, draft);
		mcpStore.addServer({ id: 'new', url: 'http://mock.invalid/mcp', enabled: true });
		expect(Object.keys(settingsStore.getPreviewChanges(session, draft)).sort()).toEqual([
			'fontFamily',
			'fontVariant',
			'uiScale'
		]);
		expect(
			settingsStore.commitPreview(session, settingsStore.getPreviewChanges(session, draft))
		).toEqual({ ok: true });
		settingsStore.initialize();
		expect(config()).toMatchObject({
			fontFamily: 'fira-sans',
			fontVariant: '700',
			uiScale: '105'
		});
		expect(mcpStore.getServers()[0].id).toBe('new');
	});
	it('Cancel/close discards only appearance preview, not immediate MCP writes', () => {
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { uiScale: '110' });
		mcpStore.addServer({ id: 'new', url: 'http://mock.invalid/mcp', enabled: true });
		settingsStore.cancelPreview(session);
		settingsStore.initialize();
		expect(config().uiScale).toBe('100');
		expect(mcpStore.getServers()[0].id).toBe('new');
	});
	it('preserves MCP updates arriving while Save awaits validation', async () => {
		const session = settingsStore.beginPreview();
		const patch = settingsStore.getPreviewChanges(session, { ...config(), uiScale: '105' });
		let validated!: () => void;
		const validation = new Promise<void>((resolve) => {
			validated = resolve;
		});
		const save = async () => {
			await validation;
			return settingsStore.commitPreview(session, patch);
		};
		const pending = save();
		mcpStore.addServer({ id: 'during-validation', url: 'http://mock.invalid/mcp', enabled: true });
		validated();
		expect(await pending).toEqual({ ok: true });
		settingsStore.initialize();
		expect(config().uiScale).toBe('105');
		expect(mcpStore.getServers()[0].id).toBe('during-validation');
	});
	it('rejects same-field conflicts before committing config or appearance assets', () => {
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { uiScale: '110' });
		settingsStore.updateConfig('uiScale', '105');
		expect(settingsStore.commitPreview(session, { uiScale: '110' })).toEqual({
			ok: false,
			reason: 'conflict',
			keys: ['uiScale']
		});
		expect(config().uiScale).toBe('105');
		expect(settingsStore.isPreviewCurrent(session)).toBe(true);
		expect(settingsStore.appearanceConfig.uiScale).toBe('110');
	});
	it('rejects changed connection read-set after async validation without losing MCP', () => {
		const session = settingsStore.beginPreview();
		const expected = {
			apiProvider: config().apiProvider,
			llamaServerBaseUrl: config().llamaServerBaseUrl
		};
		settingsStore.updateConfig('llamaServerBaseUrl', 'http://changed.invalid');
		mcpStore.addServer({ id: 'new', url: 'http://mock.invalid/mcp', enabled: true });
		expect(settingsStore.commitPreview(session, { uiScale: '105' }, expected)).toMatchObject({
			ok: false,
			reason: 'conflict'
		});
		expect(config().uiScale).toBe('100');
		expect(mcpStore.getServers()[0].id).toBe('new');
	});
	it('keeps provider profiles and MCP across settings import and ordinary Save', () => {
		mcpStore.addServer({
			id: 'kept',
			url: 'http://mock.invalid/mcp',
			enabled: true,
			headers: 'X-Key: kept'
		});
		settingsStore.updateMultipleConfig({
			serverBaseUrl: 'http://saved.invalid',
			apiKey: 'kept',
			vllmBaseUrl: 'http://vllm.invalid',
			vllmApiKey: 'kept-vllm'
		});
		const mcp = config().mcpServers;
		const session = settingsStore.beginPreview();
		const draft = { ...config(), uiScale: '105' };
		importApplicationSettings(
			JSON.stringify({
				type: 'llampart-settings-export',
				formatVersion: 1,
				settings: { fontSize: '18', mcpServers: '[]', apiKey: 'discarded' }
			})
		);
		expect(
			settingsStore.commitPreview(session, settingsStore.getPreviewChanges(session, draft))
		).toEqual({ ok: true });
		settingsStore.initialize();
		expect(config()).toMatchObject({
			mcpServers: mcp,
			serverBaseUrl: 'http://saved.invalid',
			apiKey: 'kept',
			vllmBaseUrl: 'http://vllm.invalid',
			vllmApiKey: 'kept-vllm',
			fontSize: '18',
			uiScale: '105'
		});
	});
	it.each(['Save', 'Cancel'])(
		'does not let a conflicting old draft %s undo an import or immediate MCP update',
		(action) => {
			const session = settingsStore.beginPreview();
			const draft = { ...config(), fontSize: '20', uiScale: '105' };
			settingsStore.updatePreview(session, draft);
			mcpStore.addServer({ id: 'after-open', url: 'http://synthetic.invalid/mcp', enabled: true });
			importApplicationSettings(
				JSON.stringify({
					type: 'llampart-settings-export',
					formatVersion: 1,
					settings: { fontSize: '18' }
				})
			);
			const imported = { ...config() };
			if (action === 'Save') {
				expect(settingsStore.commitPreview(session, draft)).toEqual({
					ok: false,
					reason: 'conflict',
					keys: ['fontSize']
				});
				expect(settingsStore.isPreviewCurrent(session)).toBe(true);
			}
			settingsStore.cancelPreview(session);
			expect(config()).toEqual(imported);
			settingsStore.initialize();
			expect(config()).toEqual(imported);
			expect(mcpStore.getServers()[0].id).toBe('after-open');
		}
	);
	it('fully resets every central configuration field, MCP, profiles and overrides; preserves assets and reload defaults', () => {
		serverStore.props = {
			default_generation_settings: { params: { temperature: 0.8, backend_sampling: true } },
			ui_settings: { showMessageStats: false }
		} as unknown as ApiLlamaCppServerProps;
		settingsStore.updateMultipleConfig({
			temperature: 0.2,
			backend_sampling: false,
			showMessageStats: true,
			serverBaseUrl: 'http://saved.test',
			apiKey: 'saved-key',
			openAiCompatibleBaseUrl: 'https://openai.test/v1',
			openAiCompatibleApiKey: 'openai-key',
			vllmBaseUrl: 'http://vllm.test',
			vllmApiKey: 'vllm-key',
			responsePrefCharts: true,
			uiScale: '105',
			fontFamily: 'merriweather',
			fontVariant: '700',
			fontSize: '18',
			frostedGlassWallpaper: CUSTOM_FROSTED_GLASS_WALLPAPER_ID,
			frostedGlassMilkiness: 12,
			frostedGlassOpaque: true,
			custom: '{"seed":42}'
		});
		settingsStore.updateMultipleConfig({
			interfaceLanguage: 'pl',
			sendOnEnter: false,
			agenticMaxTurns: 42,
			mcpServers: '[{"id":"reset","enabled":true,"url":"http://mock.invalid/mcp"}]'
		});
		const image = 'data:image/png;base64,b3JpZ2luYWw=';
		setCustomFrostedGlassWallpaperSrc(image);
		storage.set('unrelated-conversations-sentinel', 'untouched-history');
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { uiScale: '110' });
		settingsStore.resetConfig();
		expect(config()).toEqual(SETTING_CONFIG_DEFAULT);
		expect(mcpStore.getServers()).toEqual([]);
		expect(settingsStore.isPreviewCurrent(session)).toBe(false);
		expect([...settingsStore.userOverrides]).toEqual([]);
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toEqual(config());
		const committed = { ...config() };
		settingsStore.initialize();
		expect(config()).toEqual(committed);
		expect(storage.get(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY)).toBe(image);
		expect(storage.get('unrelated-conversations-sentinel')).toBe('untouched-history');
		const refreshed = settingsStore.beginPreview();
		expect(settingsStore.appearanceConfig).toEqual(config());
		expect(settingsStore.commitPreview(refreshed, { showMessageStats: true })).toEqual({
			ok: true
		});
	});
	it('uses only the new source server defaults after full Reset, never invalid boolean sentinels', () => {
		settingsStore.updateConfig('serverBaseUrl', 'http://discarded.invalid');
		settingsStore.resetConfig();
		serverStore.clear();
		serverStore.props = {
			default_generation_settings: { params: { temperature: 0.8, backend_sampling: true } }
		} as unknown as ApiLlamaCppServerProps;
		settingsStore.syncWithServerDefaults();
		expect(config().temperature).toBeUndefined();
		expect(config().backend_sampling).toBe(true);
		expect([...settingsStore.userOverrides]).toEqual([]);
		settingsStore.initialize();
		expect(config().backend_sampling).toBe(true);
	});
	it('resets centrally registered global tool permissions and new-chat defaults without clearing unrelated data', () => {
		for (const key of Object.keys(GLOBAL_CONFIG_STORAGE_DEFAULT)) storage.set(key, 'custom');
		storage.set('LlamaCppWebui.resumableStreams', 'unrelated');
		settingsStore.resetConfig();
		for (const [key, value] of Object.entries(GLOBAL_CONFIG_STORAGE_DEFAULT))
			expect(storage.get(key) ?? null).toBe(value);
		expect(storage.get('LlamaCppWebui.resumableStreams')).toBe('unrelated');
	});
	it('keeps config, overrides and preview intact when confirmed Reset cannot be persisted', () => {
		settingsStore.updateConfig('uiScale', '105');
		const before = { ...config() };
		const overrides = [...settingsStore.userOverrides];
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, { uiScale: '110' });
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: () => {
				throw new Error('storage failure');
			},
			removeItem: () => {}
		});
		expect(() => settingsStore.resetConfig()).toThrow('Settings could not be persisted');
		expect(config()).toEqual(before);
		expect([...settingsStore.userOverrides]).toEqual(overrides);
		expect(settingsStore.isPreviewCurrent(session)).toBe(true);
		expect(settingsStore.appearanceConfig.uiScale).toBe('110');
	});
	it('does not inherit response preferences from provider UI defaults', () => {
		serverStore.props = {
			ui_settings: { responsePrefCharts: true, responsePrefTables: false }
		} as unknown as ApiLlamaCppServerProps;
		settingsStore.updateMultipleConfig({ responsePrefTables: true });
		settingsStore.syncWithServerDefaults();
		expect(config()).toMatchObject({ responsePrefCharts: false, responsePrefTables: true });
		settingsStore.resetConfig();
		expect(config()).toMatchObject({ responsePrefCharts: false, responsePrefTables: false });
	});
	it('keeps response preferences draft-only until Save, supports Cancel, reload and Reset', () => {
		const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));
		const before = new Map(storage);
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, all);
		expect(buildResponsePreferenceInstructions(config())).toBe('');
		expect(storage).toEqual(before);
		settingsStore.cancelPreview(session);
		expect(buildResponsePreferenceInstructions(config())).toBe('');
		const saved = settingsStore.beginPreview();
		expect(settingsStore.commitPreview(saved, all)).toEqual({ ok: true });
		expect(config()).toMatchObject(all);
		settingsStore.initialize();
		expect(config()).toMatchObject(all);
		settingsStore.resetConfig();
		for (const { key } of RESPONSE_PREFERENCES) expect(config()[key]).toBe(false);
	});

	it('exports/imports all nine committed preferences, rejects malformed imports atomically', async () => {
		const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));
		settingsStore.updateMultipleConfig(all);
		let exported: Blob | undefined;
		const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			exported = blob as Blob;
			return 'blob:response-preferences';
		});
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.stubGlobal('document', {
			createElement: () => ({ click: vi.fn() }),
			body: { appendChild: vi.fn(), removeChild: vi.fn() }
		});
		try {
			exportApplicationSettings();
			const text = await exported!.text();
			expect(JSON.parse(text).settings).toMatchObject(all);
			settingsStore.resetConfig();
			importApplicationSettings(text);
			settingsStore.initialize();
			expect(config()).toMatchObject(all);
			const before = new Map(storage);
			expect(() =>
				importApplicationSettings(
					JSON.stringify({
						type: 'llampart-settings-export',
						formatVersion: 1,
						settings: { responsePrefTables: 'yes' }
					})
				)
			).toThrow('responsePrefTables');
			expect(storage).toEqual(before);
		} finally {
			create.mockRestore();
			revoke.mockRestore();
		}
	});
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
			fontFamily: 'merriweather',
			fontSize: '13',
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

	it('commits changed form fields once, ends preview and survives a reload', () => {
		const session = settingsStore.beginPreview();
		const patch = {
			uiScale: '105',
			fontFamily: 'frank-ruhl-libre',
			fontSize: '16',
			fontVariant: '600',
			keepStatsVisible: true
		};
		settingsStore.updatePreview(session, patch);
		expect(settingsStore.commitPreview(session, patch)).toEqual({ ok: true });
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
		expect(settingsStore.commitPreview(old, { uiScale: '110' })).toEqual({
			ok: false,
			reason: 'stale'
		});
		settingsStore.cancelPreview(old);
		expect(settingsStore.isPreviewCurrent(current)).toBe(true);
		settingsStore.updatePreview(current, { uiScale: '105' });
		settingsStore.resetConfig();
		expect(settingsStore.isPreviewCurrent(current)).toBe(false);
		expect(settingsStore.appearanceConfig).toEqual(config());
		expect(settingsStore.commitPreview(current, { uiScale: '105' })).toEqual({
			ok: false,
			reason: 'stale'
		});
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

	it('successfully replaces a custom wallpaper with delete-before-write and reloads it', () => {
		const key = CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY;
		setCustomFrostedGlassWallpaperSrc('data:image/png;base64,b2xk');
		settingsStore.updateConfig('frostedGlassWallpaper', CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
		const session = settingsStore.beginPreview();
		const image = 'data:image/png;base64,bmV3';
		setCustomFrostedGlassWallpaperSrc(image);
		const order: string[] = [];
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => storage.get(k) ?? null,
			removeItem: (k: string) => {
				if (k === key) order.push('remove');
				storage.delete(k);
			},
			setItem: (k: string, value: string) => {
				if (k === key) {
					order.push('write');
					expect(storage.has(key)).toBe(false);
				}
				storage.set(k, value);
			}
		});
		expect(settingsStore.commitPreview(session, { keepStatsVisible: true })).toEqual({ ok: true });
		expect(order).toEqual(['remove', 'write']);
		expect(settingsStore.isPreviewCurrent(session)).toBe(false);
		settingsStore.initialize();
		expect(config().keepStatsVisible).toBe(true);
		expect(getCustomFrostedGlassWallpaperSrc()).toBe(image);
	});

	it.each(['quota', 'throw', 'verification'])(
		'reports %s failure, accepts loss of the old image, preserves unrelated drafts and retries',
		(mode) => {
			const key = CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY;
			setCustomFrostedGlassWallpaperSrc('data:image/png;base64,b2xk');
			settingsStore.updateConfig('frostedGlassWallpaper', CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
			const before = { ...config() };
			const session = settingsStore.beginPreview();
			setCustomFrostedGlassWallpaperSrc('data:image/png;base64,bmV3');
			settingsStore.updatePreview(session, { uiScale: '110' });
			const setItem = (k: string, value: string) => storage.set(k, value);
			vi.stubGlobal('localStorage', {
				getItem: (k: string) => storage.get(k) ?? null,
				removeItem: (k: string) => storage.delete(k),
				setItem: (k: string, value: string) => {
					if (k !== key) return setItem(k, value);
					expect(storage.has(key)).toBe(false);
					if (mode === 'quota') throw new DOMException('quota', 'QuotaExceededError');
					if (mode === 'throw') throw new Error('storage failure');
					storage.set(k, 'data:image/png;base64,d3Jvbmc=');
				}
			});
			const fallback = { frostedGlassWallpaper: DEFAULT_FROSTED_GLASS_WALLPAPER_ID };
			expect(
				settingsStore.commitPreview(session, { uiScale: '110', keepStatsVisible: true })
			).toEqual({
				ok: false,
				reason: 'resource',
				messageKey: 'settings.frostedGlassWallpaperSaveError',
				configPatch: fallback
			});
			expect(storage.has(key)).toBe(false);
			expect(getCustomFrostedGlassWallpaperSrc()).toBeUndefined();
			expect(config()).toEqual({ ...before, ...fallback });
			expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toEqual(config());
			expect(settingsStore.appearanceConfig.uiScale).toBe('110');
			expect(settingsStore.isPreviewCurrent(session)).toBe(true);
			expect(
				getFrostedGlassWallpaper(settingsStore.appearanceConfig.frostedGlassWallpaper).id
			).toBe(DEFAULT_FROSTED_GLASS_WALLPAPER_ID);

			// Cancel/reload must not restore a failed image or save unrelated drafts.
			settingsStore.cancelPreview(session);
			settingsStore.initialize();
			expect(config()).toEqual({ ...before, ...fallback });
			expect(getCustomFrostedGlassWallpaperSrc()).toBeUndefined();
			vi.stubGlobal('localStorage', {
				getItem: (k: string) => storage.get(k) ?? null,
				setItem,
				removeItem: (k: string) => storage.delete(k)
			});
			const retry = settingsStore.beginPreview();
			const image = 'data:image/png;base64,cmV0cnk=';
			setCustomFrostedGlassWallpaperSrc(image);
			expect(
				settingsStore.commitPreview(retry, {
					frostedGlassWallpaper: CUSTOM_FROSTED_GLASS_WALLPAPER_ID,
					keepStatsVisible: true
				})
			).toEqual({ ok: true });
			expect(getCustomFrostedGlassWallpaperSrc()).toBe(image);
			expect(config().keepStatsVisible).toBe(true);
		}
	);

	it('keeps a committed bundled selection when a new custom upload fails', () => {
		settingsStore.updateConfig('frostedGlassWallpaper', 'frosted-glass-03');
		const session = settingsStore.beginPreview();
		setCustomFrostedGlassWallpaperSrc('data:image/png;base64,bmV3');
		const savedConfig = storage.get(CONFIG_LOCALSTORAGE_KEY);
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => storage.get(k) ?? null,
			removeItem: (k: string) => storage.delete(k),
			setItem: () => {
				throw new Error('storage unavailable');
			}
		});
		expect(settingsStore.commitPreview(session, { keepStatsVisible: true })).toMatchObject({
			ok: false,
			reason: 'resource',
			configPatch: { frostedGlassWallpaper: 'frosted-glass-03' }
		});
		expect(storage.get(CONFIG_LOCALSTORAGE_KEY)).toBe(savedConfig);
		expect(config().frostedGlassWallpaper).toBe('frosted-glass-03');
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
