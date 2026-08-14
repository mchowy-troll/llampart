import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { importApplicationSettings } from '$lib/utils/settings-import-export';
import { settingsStore } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';

const storage = new Map<string, string>();

beforeEach(() => {
	storage.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key)
	});
});

describe('settings runtime schema', () => {
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

	it('rejects invalid backend settings before reset or sync mutates state', () => {
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
			expect(() => settingsStore.forceSyncWithServerDefaults()).toThrow(
				/showThoughtInProgress|top_p/
			);
			expect(settingsStore.config).toEqual(beforeConfig);
			expect([...settingsStore.userOverrides]).toEqual(beforeOverrides);
			expect(storage).toEqual(beforeStorage);
		} finally {
			settingsStore.config = originalConfig;
			settingsStore.userOverrides.clear();
			for (const key of originalOverrides) settingsStore.userOverrides.add(key);
			serverStore.props = originalProps;
		}
	});
});
