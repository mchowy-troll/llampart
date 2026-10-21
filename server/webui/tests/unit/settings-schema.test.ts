import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONFIG_LOCALSTORAGE_KEY,
	SETTING_CONFIG_DEFAULT,
	USER_OVERRIDES_LOCALSTORAGE_KEY
} from '$lib/constants';
import {
	parseSettingsConfig,
	parseSettingsStorage,
	parseUserOverrides,
	serializeSettingsStorage,
	validateSettingsPatch
} from '$lib/utils/settings-schema';
import {
	exportApplicationSettings,
	importApplicationSettings
} from '$lib/utils/settings-import-export';
import { settingsStore } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { RESPONSE_PREFERENCES } from '$lib/utils/response-preferences';
import { getDictionary, INTERFACE_LANGUAGES } from '$lib/i18n';
import { applyTypography, FONT_FAMILIES } from '$lib/utils/typography';
import {
	CUSTOM_FROSTED_GLASS_WALLPAPER_ID,
	CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY
} from '$lib/themes/frosted-glass/wallpapers';
import {
	ALWAYS_ALLOWED_TOOLS_LOCALSTORAGE_KEY,
	DISABLED_TOOL_KEYS_LOCALSTORAGE_KEY,
	DISABLED_TOOLS_LOCALSTORAGE_KEY,
	MCP_DEFAULT_ENABLED_LOCALSTORAGE_KEY
} from '$lib/constants/localstorage-keys';

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

afterEach(() => {
	vi.unstubAllGlobals();
});

beforeEach(() => {
	storage.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key)
	});
	settingsStore.initialize();
});

describe('settings JSON import/export compatibility', () => {
	const newSettings = {
		...Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }, index) => [key, index % 2 === 0])),
		uiScale: '105',
		fontFamily: 'merriweather',
		fontVariant: '700',
		fontSize: '18',
		frostedGlassMilkiness: 27,
		frostedGlassOpaque: true
	};
	const groups = ['responsePreferences', 'interfaceScale', 'typography', 'frostedGlass'];
	const importPatch = (settings: Record<string, unknown>, userOverrides?: unknown) => {
		// Standalone file fixtures must initialize the authoritative in-memory state,
		// just as opening the application does before a user imports settings.
		settingsStore.initialize();
		return importApplicationSettings(
			JSON.stringify({
				type: 'llampart-settings-export',
				formatVersion: 1,
				settings,
				userOverrides
			})
		);
	};
	const savedConfig = () => parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!);
	async function exportFile() {
		let blob: Blob | undefined;
		const originalDocument = globalThis.document;
		const link = { href: '', download: '', click: vi.fn() };
		const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
			blob = value as Blob;
			return 'blob:settings-regression';
		});
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.stubGlobal('document', {
			createElement: () => link,
			body: { appendChild: vi.fn(), removeChild: vi.fn() }
		});
		try {
			exportApplicationSettings();
			expect(link.click).toHaveBeenCalledOnce();
			expect(link.download).toMatch(/^llampart-settings-\d{4}-\d{2}-\d{2}\.json$/);
			expect(blob!.type).toBe('application/json');
			const text = await blob!.text();
			return { text, data: JSON.parse(text) };
		} finally {
			create.mockRestore();
			revoke.mockRestore();
			vi.stubGlobal('document', originalDocument);
		}
	}

	it.each([false, true])(
		'round-trips all current fields, with preference inversion=%s',
		async (invert) => {
			const preferences = Object.fromEntries(
				RESPONSE_PREFERENCES.map(({ key }, index) => [key, (index % 2 === 0) !== invert])
			);
			const values = {
				...SETTING_CONFIG_DEFAULT,
				...newSettings,
				...preferences,
				systemMessage: 'Keep me'
			};
			storage.set(CONFIG_LOCALSTORAGE_KEY, serializeSettingsStorage(values));
			storage.set(USER_OVERRIDES_LOCALSTORAGE_KEY, '["systemMessage","theme"]');
			const { data, text } = await exportFile();
			expect(Object.keys(data).sort()).toEqual([
				'app',
				'exportedAt',
				'formatVersion',
				'settings',
				'type',
				'userOverrides'
			]);
			expect(data).toMatchObject({
				type: 'llampart-settings-export',
				formatVersion: 1,
				app: 'llampart'
			});
			expect(data.settings).toMatchObject({ ...newSettings, ...preferences });
			for (const { key } of RESPONSE_PREFERENCES) expect(data.settings[key]).toBeTypeOf('boolean');
			storage.clear();
			settingsStore.initialize();
			expect(importApplicationSettings(text)).toEqual({ missingSettingsGroups: [] });
			expect(savedConfig()).toEqual(parseSettingsStorage(serializeSettingsStorage(values)));
			expect(JSON.parse(storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)!)).toEqual(data.userOverrides);
			const reexport = await exportFile();
			expect(reexport.data.settings).toEqual(data.settings);
			expect(reexport.data.userOverrides).toEqual(data.userOverrides);
		}
	);

	it('imports an older file successfully without resetting any absent new settings', () => {
		storage.set(
			CONFIG_LOCALSTORAGE_KEY,
			serializeSettingsStorage({ ...SETTING_CONFIG_DEFAULT, ...newSettings })
		);
		expect(
			importPatch({ systemMessage: 'Imported prompt', showMessageStats: false, temperature: 0.3 })
		).toEqual({ missingSettingsGroups: groups });
		expect(savedConfig()).toMatchObject({
			...newSettings,
			systemMessage: 'Imported prompt',
			showMessageStats: false,
			temperature: 0.3
		});
	});

	it.each([
		{
			name: 'both legacy default sentinels',
			font: { fontFamily: 'default', fontVariant: '400', fontSize: 'default' },
			effective: { fontFamily: 'merriweather', fontVariant: '400', fontSize: '13' }
		},
		{
			name: 'historical variant sentinel',
			font: { fontFamily: 'default', fontVariant: 'default', fontSize: 'default' },
			effective: { fontFamily: 'merriweather', fontVariant: '400', fontSize: '13' }
		},
		{
			name: 'historical variant sentinel with explicit family and size',
			font: { fontFamily: 'merriweather', fontVariant: 'default', fontSize: '18' },
			effective: { fontFamily: 'merriweather', fontVariant: '400', fontSize: '18' }
		},
		{
			name: 'explicit family, weight and size',
			font: { fontFamily: 'fira-sans', fontVariant: '600', fontSize: '18' },
			effective: { fontFamily: 'fira-sans', fontVariant: '600', fontSize: '18' }
		},
		{
			name: 'explicit non-default Merriweather weight and size',
			font: { fontFamily: 'merriweather', fontVariant: '700', fontSize: '16' },
			effective: { fontFamily: 'merriweather', fontVariant: '700', fontSize: '16' }
		},
		{
			name: 'default family with explicit size',
			font: { fontFamily: 'default', fontVariant: '400', fontSize: '18' },
			effective: { fontFamily: 'merriweather', fontVariant: '400', fontSize: '18' }
		},
		{
			name: 'explicit family and weight with default size',
			font: { fontFamily: 'fira-sans', fontVariant: '600', fontSize: 'default' },
			effective: { fontFamily: 'fira-sans', fontVariant: '600', fontSize: '13' }
		}
	])('keeps version-1 typography backward compatible: $name', async ({ font, effective }) => {
		const storedFont = {
			...font,
			fontVariant:
				font.fontVariant === 'default' ? SETTING_CONFIG_DEFAULT.fontVariant : font.fontVariant
		};
		const originalConfig = { ...settingsStore.config };
		const originalOverrides = [...settingsStore.userOverrides];
		const expectImportedTypography = () => {
			// Family/size sentinels survive import/export; the historical variant
			// follows the existing variant normalization boundary to a concrete weight.
			expect(JSON.parse(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject(storedFont);
			expect(savedConfig()).toMatchObject(storedFont);
			expect(settingsStore.config).toMatchObject(storedFont);
			const properties = new Map<string, string>();
			const root = {
				dataset: {} as Record<string, string>,
				style: {
					setProperty: (key: string, value: string) => properties.set(key, value),
					removeProperty: (key: string) => properties.delete(key)
				}
			} as unknown as HTMLElement;
			const cleanup = applyTypography(root, settingsStore.config);
			try {
				expect(root.dataset.llampartFont).toBe(effective.fontFamily);
				expect(properties.get('--llampart-font-family')).toBe(
					`"${FONT_FAMILIES[effective.fontFamily as keyof typeof FONT_FAMILIES]}"`
				);
				expect(properties.get('--llampart-font-weight')).toBe(effective.fontVariant);
				expect(properties.get('--llampart-text-unit')).toBe(`${effective.fontSize}px`);
			} finally {
				cleanup();
			}
		};
		try {
			// A literal old export, not regenerated with today's factory defaults.
			// Import over contrasting preferences to prove that present default keys
			// are applied rather than treated as missing fields.
			storage.set(
				CONFIG_LOCALSTORAGE_KEY,
				serializeSettingsStorage({
					...SETTING_CONFIG_DEFAULT,
					fontFamily: 'crimson-text',
					fontVariant: '600',
					fontSize: '20'
				})
			);
			importPatch(font);
			expectImportedTypography();
			settingsStore.initialize();
			expectImportedTypography();
			const { data, text } = await exportFile();
			expect(data).toMatchObject({
				type: 'llampart-settings-export',
				formatVersion: 1,
				app: 'llampart',
				settings: storedFont
			});
			settingsStore.updateMultipleConfig({
				fontFamily: 'crimson-text',
				fontVariant: '600',
				fontSize: '20'
			});
			importApplicationSettings(text);
			settingsStore.initialize();
			expectImportedTypography();
		} finally {
			settingsStore.config = originalConfig;
			settingsStore.userOverrides.clear();
			for (const key of originalOverrides) settingsStore.userOverrides.add(key);
		}
	});

	it('reports only incomplete groups in a partial file and preserves absent fields', () => {
		storage.set(
			CONFIG_LOCALSTORAGE_KEY,
			serializeSettingsStorage({ ...SETTING_CONFIG_DEFAULT, ...newSettings })
		);
		const patch = { ...newSettings, uiScale: '90', fontSize: '20', frostedGlassOpaque: false };
		const partial: Record<string, unknown> = { ...patch };
		delete partial.responsePrefCharts;
		delete partial.fontFamily;
		delete partial.frostedGlassMilkiness;
		expect(importPatch(partial)).toEqual({
			missingSettingsGroups: ['responsePreferences', 'typography', 'frostedGlass']
		});
		expect(savedConfig()).toMatchObject(patch);
	});

	it.each([
		...RESPONSE_PREFERENCES.map(({ key }) => [key, 'responsePreferences']),
		['uiScale', 'interfaceScale'],
		['fontFamily', 'typography'],
		['fontVariant', 'typography'],
		['fontSize', 'typography'],
		['frostedGlassMilkiness', 'frostedGlass'],
		['frostedGlassOpaque', 'frostedGlass']
	])('detects a missing %s before defaults or font normalization can fill it', (key, group) => {
		const partial: Record<string, unknown> = { ...newSettings };
		delete partial[key];
		expect(importPatch(partial)).toEqual({ missingSettingsGroups: [group] });
	});

	it('counts false, zero, empty strings and default values as present keys', () => {
		expect(
			importPatch({
				...SETTING_CONFIG_DEFAULT,
				fontFamily: '',
				fontVariant: '',
				frostedGlassMilkiness: 0
			})
		).toEqual({ missingSettingsGroups: [] });
		expect(savedConfig()).toMatchObject({
			fontFamily: 'default',
			fontVariant: '400',
			frostedGlassMilkiness: 0,
			frostedGlassOpaque: false
		});
	});

	it.each(['llama-server', 'vllm', 'openai-compatible'])(
		'preserves exclusions for %s and retains the existing active-provider selection rule',
		async (apiProvider) => {
			const excluded = {
				serverBaseUrl: 'http://shared.invalid',
				apiKey: 'shared-secret',
				llamaServerBaseUrl: 'http://llama.invalid',
				llamaServerApiKey: 'llama-secret',
				vllmBaseUrl: 'http://vllm.invalid',
				vllmApiKey: 'vllm-secret',
				openAiCompatibleBaseUrl: 'http://openai.invalid',
				openAiCompatibleApiKey: 'openai-secret',
				titleGenerationPrompt: 'private template',
				mcpServers: '[{"id":"private"}]',
				mcpServerUsageStats: '{"private":4}',
				agenticMaxTurns: 17,
				agenticMaxToolPreviewLines: 11,
				showToolCallInProgress: true,
				alwaysShowAgenticTurns: true
			};
			const separateStorage = {
				[MCP_DEFAULT_ENABLED_LOCALSTORAGE_KEY]: 'false',
				[DISABLED_TOOLS_LOCALSTORAGE_KEY]: '["tool"]',
				[DISABLED_TOOL_KEYS_LOCALSTORAGE_KEY]: '["server/tool"]',
				[ALWAYS_ALLOWED_TOOLS_LOCALSTORAGE_KEY]: '["allowed"]',
				[CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY]: 'data:image/png;base64,cHJpdmF0ZQ=='
			};
			for (const [key, value] of Object.entries(separateStorage)) storage.set(key, value);
			storage.set(
				CONFIG_LOCALSTORAGE_KEY,
				serializeSettingsStorage({
					...SETTING_CONFIG_DEFAULT,
					...excluded,
					apiProvider,
					frostedGlassWallpaper: CUSTOM_FROSTED_GLASS_WALLPAPER_ID
				})
			);
			storage.set(USER_OVERRIDES_LOCALSTORAGE_KEY, '["agenticMaxTurns","temperature"]');
			const { data, text } = await exportFile();
			expect(data.settings.apiProvider).toBe(apiProvider);
			expect(data.settings.frostedGlassWallpaper).toBe(CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
			for (const key of Object.keys(excluded)) expect(data.settings).not.toHaveProperty(key);
			for (const key of Object.keys(separateStorage)) expect(data.settings).not.toHaveProperty(key);
			expect(text).not.toContain(separateStorage[CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY]);
			expect(data.userOverrides).toEqual(['temperature']);
			const injected = Object.fromEntries(
				Object.keys(excluded).map((key) => [key, { invalid: 'ignored' }])
			);
			// Provider selection is exportable; connection profiles and old protocols are not.
			storage.set(
				CONFIG_LOCALSTORAGE_KEY,
				serializeSettingsStorage({ ...savedConfig(), apiProvider: 'llama-server' })
			);
			importPatch(
				{
					...data.settings,
					...injected,
					openAiCompatibleProtocol: 'responses',
					vllmProtocol: 'responses'
				},
				['theme', 'apiKey', 'agenticMaxTurns', 'unknown', 4]
			);
			const activeProfile = {
				'llama-server': ['http://llama.invalid', 'llama-secret'],
				vllm: ['http://vllm.invalid', 'vllm-secret'],
				'openai-compatible': ['http://openai.invalid', 'openai-secret']
			}[apiProvider]!;
			// Real browser initialization and commits project aliases from the active
			// profile; the excluded provider-owned profiles themselves stay unchanged.
			expect(savedConfig()).toMatchObject({
				...excluded,
				apiProvider,
				serverBaseUrl: activeProfile[0],
				apiKey: activeProfile[1]
			});
			expect(savedConfig()).not.toHaveProperty('vllmProtocol');
			expect(savedConfig()).not.toHaveProperty('openAiCompatibleProtocol');
			expect(JSON.parse(storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)!)).toEqual([
				'agenticMaxTurns',
				'theme'
			]);
			for (const [key, value] of Object.entries(separateStorage))
				expect(storage.get(key)).toBe(value);
		}
	);

	it.each<[string, unknown]>([
		...RESPONSE_PREFERENCES.map(({ key }): [string, unknown] => [key, 'false']),
		['uiScale', '120'],
		['uiScale', 100],
		['fontFamily', null],
		['fontVariant', false],
		['fontSize', '99'],
		['frostedGlassMilkiness', -1],
		['frostedGlassMilkiness', 101],
		['frostedGlassMilkiness', 0.5],
		['frostedGlassOpaque', 0]
	])('rejects invalid %s=%j without writing either storage entry', (key, value) => {
		storage.set(
			CONFIG_LOCALSTORAGE_KEY,
			serializeSettingsStorage({ ...SETTING_CONFIG_DEFAULT, ...newSettings })
		);
		storage.set(USER_OVERRIDES_LOCALSTORAGE_KEY, '["temperature"]');
		const before = new Map(storage);
		expect(() =>
			importPatch({ systemMessage: 'Must not be saved', [key as string]: value }, ['theme'])
		).toThrow(String(key));
		expect(storage).toEqual(before);
	});

	it.each([
		'{broken',
		'null',
		'[]',
		'{"type":"llampart-conversations","formatVersion":1,"settings":{}}',
		'{"type":"llampart-settings-export","formatVersion":2,"settings":{}}',
		'{"type":"llampart-settings-export","formatVersion":1,"settings":[]}'
	])('keeps rejecting invalid files atomically: %s', (text) => {
		const before = new Map(storage);
		expect(() => importApplicationSettings(text)).toThrow();
		expect(storage).toEqual(before);
	});

	it.each(INTERFACE_LANGUAGES)(
		'includes native warning text and all four section labels in %s',
		(language) => {
			// Read the actual language dictionary: a fallback translation must not hide a missing key.
			const settings = getDictionary(language).settings as Record<string, unknown>;
			expect(settings.fontDefault).toMatch(/^\{font\} \(.+\)$/);
			expect(settings.fontVariantDefault).toMatch(/^\{variant\} \(.+\)$/);
			expect(settings.fontSizeDefault).toMatch(/^\{size\} px \(.+\)$/);
			const messages = settings.importExport as Record<string, unknown>;
			expect(messages.olderSettingsFile).toBeTypeOf('string');
			expect(messages.olderSettingsFile).toContain('{sections}');
			const labels = messages.olderSettingsSections as Record<string, string>;
			expect(Object.keys(labels)).toEqual(groups);
			for (const group of groups) expect(labels[group].length).toBeGreaterThan(0);
		}
	);
});

describe('settings runtime schema', () => {
	it('resets appearance through the actual store to canonical defaults', () => {
		const before = { ...settingsStore.config };
		try {
			settingsStore.updateMultipleConfig({
				fontFamily: 'crimson-text',
				fontVariant: '500',
				fontSize: '20',
				uiScale: '110',
				frostedGlassMilkiness: 12,
				frostedGlassOpaque: true
			});
			expect(settingsStore.config.fontVariant).toBe('400');
			settingsStore.resetConfig();
			expect(settingsStore.config).toMatchObject({
				fontFamily: 'merriweather',
				fontSize: '13',
				fontVariant: '400',
				uiScale: '100',
				frostedGlassMilkiness: 75,
				frostedGlassOpaque: false
			});
			expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject({
				fontFamily: 'merriweather',
				fontVariant: '400'
			});
		} finally {
			settingsStore.config = before;
		}
	});
	it.each([
		{ fontFamily: 'merriweather', fontVariant: '700' },
		{ fontFamily: 'frank-ruhl-libre', fontVariant: '600' },
		{ fontFamily: 'crimson-text', fontVariant: '600' },
		{ fontFamily: 'libre-caslon-condensed', fontVariant: '500' },
		{ fontFamily: 'fira-sans', fontVariant: '700' }
	])('exports and imports $fontFamily appearance without losing saved milkiness', async (font) => {
		const appearance = {
			...font,
			fontSize: '18',
			uiScale: '95',
			frostedGlassMilkiness: 27,
			frostedGlassOpaque: true,
			frostedGlassWallpaper: 'frosted-glass-01'
		};
		storage.set(
			CONFIG_LOCALSTORAGE_KEY,
			serializeSettingsStorage({ ...SETTING_CONFIG_DEFAULT, ...appearance })
		);
		let exported: Blob | undefined;
		const createUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			exported = blob as Blob;
			return 'blob:appearance-test';
		});
		const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.stubGlobal('document', {
			createElement: () => ({ click: vi.fn() }),
			body: { appendChild: vi.fn(), removeChild: vi.fn() }
		});
		try {
			exportApplicationSettings();
			const text = await exported!.text();
			expect(JSON.parse(text).settings).toMatchObject(appearance);
			storage.clear();
			importApplicationSettings(text);
			expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject(appearance);
		} finally {
			createUrl.mockRestore();
			revokeUrl.mockRestore();
			vi.unstubAllGlobals();
		}
	});
	it.each(['dm-serif-display', 'inter', 'open-sans', 'instrument-serif', 'unknown-retired-font'])(
		'migrates %s independently through storage, strict parsing, import and export',
		async (fontFamily) => {
			const legacy = {
				fontFamily,
				fontVariant: '400-italic',
				uiScale: '105',
				frostedGlassMilkiness: 23,
				frostedGlassWallpaperMilky: true,
				systemMessage: 'Keep my prompt',
				temperature: 0.35
			};
			const expected = {
				fontFamily: 'default',
				fontVariant: '400',
				uiScale: '105',
				frostedGlassMilkiness: 23,
				systemMessage: 'Keep my prompt',
				temperature: 0.35
			};
			expect(parseSettingsConfig(legacy, { rejectInvalidKnown: true })).toMatchObject(expected);
			storage.set(CONFIG_LOCALSTORAGE_KEY, JSON.stringify(legacy));
			expect(parseSettingsStorage(JSON.stringify(legacy))).toMatchObject(expected);
			let blob: Blob | undefined;
			const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
				blob = value as Blob;
				return 'blob:test';
			});
			const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
			vi.stubGlobal('document', {
				createElement: () => ({ click: vi.fn() }),
				body: { appendChild: vi.fn(), removeChild: vi.fn() }
			});
			try {
				exportApplicationSettings();
				expect(JSON.parse(await blob!.text()).settings).toMatchObject(expected);
				importApplicationSettings(
					JSON.stringify({ type: 'llampart-settings-export', formatVersion: 1, settings: legacy })
				);
				const stored = JSON.parse(storage.get(CONFIG_LOCALSTORAGE_KEY)!);
				expect(stored).toMatchObject(expected);
				expect(stored).not.toHaveProperty('frostedGlassWallpaperMilky');
			} finally {
				create.mockRestore();
				revoke.mockRestore();
				vi.unstubAllGlobals();
			}
		}
	);

	it.each(['400-italic', '999', '300', '800'])(
		'normalizes unsupported base weight %s without dropping other values',
		(fontVariant) => {
			expect(
				parseSettingsConfig({ fontFamily: 'crimson-text', fontVariant, uiScale: '95' })
			).toMatchObject({ fontFamily: 'crimson-text', fontVariant: '400', uiScale: '95' });
			expect(validateSettingsPatch({ fontFamily: 'crimson-text', fontVariant })).toMatchObject({
				fontFamily: 'crimson-text',
				fontVariant: '400'
			});
		}
	);
	it('validates known keys while retaining flat primitive extension keys', () => {
		const parsed = parseSettingsConfig({
			showThoughtInProgress: 'true',
			uiScale: '999',
			apiProvider: 'unknown',
			futureSetting: 'preserved'
		});
		expect(parsed.showThoughtInProgress).toBe(SETTING_CONFIG_DEFAULT.showThoughtInProgress);
		expect(parsed.uiScale).toBe(SETTING_CONFIG_DEFAULT.uiScale);
		expect(parsed.apiProvider).toBe(SETTING_CONFIG_DEFAULT.apiProvider);
		expect(parsed.futureSetting).toBe('preserved');
	});

	it('migrates legacy flat storage and rejects unsupported storage versions', () => {
		const legacy = parseSettingsStorage(
			JSON.stringify({ uiScale: '90', temperature: '', futureFlag: true })
		);
		expect(legacy).toMatchObject({ uiScale: '90', temperature: '', futureFlag: true });
		expect(JSON.parse(serializeSettingsStorage(legacy))).toMatchObject({
			__llampartSettingsVersion: 1,
			uiScale: '90'
		});
		expect(() => parseSettingsStorage(JSON.stringify({ __llampartSettingsVersion: 99 }))).toThrow(
			/version/i
		);
	});

	it('parses overrides independently and keeps only syncable known keys', () => {
		expect(parseUserOverrides('["temperature","theme",3]')).toEqual(['temperature', 'theme']);
		expect(parseUserOverrides('{broken')).toEqual([]);
	});

	it('does not partially write an import containing an invalid known value', () => {
		storage.set(CONFIG_LOCALSTORAGE_KEY, serializeSettingsStorage({ ...SETTING_CONFIG_DEFAULT }));
		storage.set(USER_OVERRIDES_LOCALSTORAGE_KEY, '["temperature"]');
		const before = new Map(storage);

		expect(() =>
			importApplicationSettings(
				JSON.stringify({
					type: 'llampart-settings-export',
					formatVersion: 1,
					app: 'llampart',
					exportedAt: new Date().toISOString(),
					settings: { showThoughtInProgress: 'true' }
				})
			)
		).toThrow(/showThoughtInProgress/);
		expect(storage).toEqual(before);
	});

	it('accepts shipped numeric defaults and inclusive probability boundaries', () => {
		expect(
			validateSettingsPatch({
				temperature: 0.8,
				dynatemp_range: 0,
				dynatemp_exponent: 1,
				top_k: 40,
				top_p: 0,
				min_p: 1,
				xtc_probability: 0,
				xtc_threshold: 1,
				typ_p: 1,
				repeat_last_n: 64,
				repeat_penalty: 1,
				dry_multiplier: 0,
				dry_base: 1.75,
				dry_allowed_length: 2,
				dry_penalty_last_n: -1,
				max_tokens: -1,
				presence_penalty: -2,
				frequency_penalty: 2
			})
		).toMatchObject({
			top_p: 0,
			min_p: 1,
			dry_penalty_last_n: -1,
			max_tokens: -1,
			presence_penalty: -2,
			frequency_penalty: 2
		});
	});

	it('rejects out-of-range probabilities and invalid integer parameters', () => {
		for (const [key, value] of [
			['top_p', -0.01],
			['min_p', 1.01],
			['xtc_probability', 2],
			['xtc_threshold', -1],
			['typ_p', 1.1],
			['temperature', -0.1],
			['dynatemp_range', -0.1],
			['dynatemp_exponent', -0.1],
			['top_k', 1.5],
			['repeat_last_n', -2],
			['repeat_penalty', -0.1],
			['dry_multiplier', -0.1],
			['dry_base', -0.1],
			['dry_allowed_length', 0.5],
			['dry_penalty_last_n', -2],
			['max_tokens', -2],
			['presence_penalty', -2.01],
			['frequency_penalty', 2.01],
			['pasteLongTextToFileLen', 1.5]
		] as const) {
			expect(() => validateSettingsPatch({ [key]: value }), key).toThrow(key);
		}
	});

	it('rejects invalid values atomically through the actual settings store update path', () => {
		const before = { ...settingsStore.config };

		try {
			expect(() =>
				settingsStore.updateMultipleConfig({ temperature: 0.5, top_p: Infinity })
			).toThrow(/top_p/);
			expect(settingsStore.config).toEqual(before);
			expect(() => settingsStore.updateConfig('top_p', 1.01)).toThrow(/top_p/);
			expect(() => settingsStore.updateConfig('presence_penalty', -2.01)).toThrow(
				/presence_penalty/
			);
			expect(settingsStore.config).toEqual(before);
		} finally {
			settingsStore.config = before;
		}
	});

	it('rejects invalid backend parameter reset/sync but permits full configuration Reset', () => {
		const originalConfig = { ...settingsStore.config };
		const originalOverrides = [...settingsStore.userOverrides];
		const originalProps = serverStore.props;
		settingsStore.config = { ...settingsStore.config, top_p: 0.75, showThoughtInProgress: true };
		settingsStore.userOverrides.clear();
		settingsStore.userOverrides.add('top_p');
		settingsStore.userOverrides.add('showThoughtInProgress');
		serverStore.props = {
			default_generation_settings: { params: { top_p: 2 } },
			ui_settings: { showThoughtInProgress: 'true' }
		} as unknown as ApiLlamaCppServerProps;
		const beforeConfig = { ...settingsStore.config };
		const beforeOverrides = [...settingsStore.userOverrides];
		const beforeStorage = new Map(storage);

		try {
			expect(() => settingsStore.resetParameterToServerDefault('showThoughtInProgress')).toThrow(
				/showThoughtInProgress|top_p/
			);
			expect(() => settingsStore.syncWithServerDefaults()).toThrow(/showThoughtInProgress|top_p/);
			expect(settingsStore.config).toEqual(beforeConfig);
			expect([...settingsStore.userOverrides]).toEqual(beforeOverrides);
			expect(storage).toEqual(beforeStorage);
			// Full Reset discards the old connection, so its invalid /props must not
			// prevent restoration of central, correctly typed defaults.
			settingsStore.resetConfig();
			expect(settingsStore.config).toEqual(SETTING_CONFIG_DEFAULT);
			expect([...settingsStore.userOverrides]).toEqual([]);
		} finally {
			settingsStore.config = originalConfig;
			settingsStore.userOverrides.clear();
			for (const key of originalOverrides) settingsStore.userOverrides.add(key);
			serverStore.props = originalProps;
		}
	});
});
