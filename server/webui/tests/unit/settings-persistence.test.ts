import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONFIG_LOCALSTORAGE_KEY,
	USER_OVERRIDES_LOCALSTORAGE_KEY,
	SETTING_CONFIG_DEFAULT,
	GLOBAL_CONFIG_STORAGE_DEFAULT
} from '$lib/constants';
import { config, settingsStore, SettingsPersistenceError } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { HealthCheckStatus } from '$lib/enums';
import { parseSettingsStorage } from '$lib/utils/settings-schema';
import { importApplicationSettings } from '$lib/utils/settings-import-export';
import type { MCPConnection } from '$lib/types';

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

function useStorage(fail: (key: string, value: string) => boolean = () => false) {
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (fail(key, value)) throw new DOMException('test quota', 'QuotaExceededError');
			storage.set(key, value);
		},
		removeItem: (key: string) => storage.delete(key)
	});
}
beforeEach(() => {
	storage.clear();
	useStorage();
	settingsStore.cancelPreview();
	settingsStore.config = { ...SETTING_CONFIG_DEFAULT };
	settingsStore.userOverrides.clear();
	serverStore.props = {
		default_generation_settings: { params: { temperature: 0.8 } }
	} as unknown as ApiLlamaCppServerProps;
	settingsStore.updateMultipleConfig({ temperature: 0.5 });
});
afterEach(() => {
	settingsStore.cancelPreview();
	mcpStore.clearAllHealthChecks();
	mcpStore.getConnections().clear();
	serverStore.props = null;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Settings persistence boundary', () => {
	it('restores absent keys rather than inventing saved values when the second write fails', () => {
		storage.delete(CONFIG_LOCALSTORAGE_KEY);
		storage.delete(USER_OVERRIDES_LOCALSTORAGE_KEY);
		const before = { ...config() };
		useStorage((key) => key === USER_OVERRIDES_LOCALSTORAGE_KEY);
		expect(() => settingsStore.updateConfig('fontSize', '18')).toThrow(SettingsPersistenceError);
		expect(config()).toEqual(before);
		expect(storage.has(CONFIG_LOCALSTORAGE_KEY)).toBe(false);
		expect(storage.has(USER_OVERRIDES_LOCALSTORAGE_KEY)).toBe(false);
	});
	it.each([CONFIG_LOCALSTORAGE_KEY, USER_OVERRIDES_LOCALSTORAGE_KEY])(
		'compensates failure at %s, retains draft and retries Save',
		(failedKey) => {
			const before = { ...config() };
			const disk = new Map(storage);
			const overrides = [...settingsStore.userOverrides];
			const session = settingsStore.beginPreview();
			const patch = { uiScale: '105', fontSize: '18', temperature: 0.8 };
			settingsStore.updatePreview(session, patch);
			useStorage((key) => key === failedKey);
			expect(() => settingsStore.commitPreview(session, patch)).toThrow(SettingsPersistenceError);
			expect(config()).toEqual(before);
			expect([...settingsStore.userOverrides]).toEqual(overrides);
			expect(storage).toEqual(disk);
			expect(settingsStore.isPreviewCurrent(session)).toBe(true);
			expect(settingsStore.appearanceConfig).toMatchObject({ uiScale: '105', fontSize: '18' });
			useStorage();
			expect(settingsStore.commitPreview(session, patch)).toEqual({ ok: true });
			expect(config()).toMatchObject(patch);
			expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toEqual(config());
			expect(JSON.parse(storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)!)).toEqual([]);
			settingsStore.initialize();
			expect(config()).toMatchObject(patch);
			expect([...settingsStore.userOverrides]).toEqual([]);
		}
	);

	it('explicitly reports failed compensation, keeps memory uncommitted and allows repair by retry', () => {
		const before = { ...config() };
		const oldRaw = storage.get(CONFIG_LOCALSTORAGE_KEY);
		const overrides = [...settingsStore.userOverrides];
		useStorage(
			(key, value) =>
				key === USER_OVERRIDES_LOCALSTORAGE_KEY ||
				(key === CONFIG_LOCALSTORAGE_KEY && value === oldRaw)
		);
		let failure: unknown;
		try {
			settingsStore.updateMultipleConfig({ uiScale: '110', temperature: 0.8 });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SettingsPersistenceError);
		expect(failure).toMatchObject({
			messageKey: 'settings.storageRollbackError',
			rollbackErrors: [CONFIG_LOCALSTORAGE_KEY]
		});
		expect(config()).toEqual(before);
		expect([...settingsStore.userOverrides]).toEqual(overrides);
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject({
			uiScale: '110',
			temperature: 0.8
		});
		expect(JSON.parse(storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)!)).toEqual(overrides);
		useStorage();
		settingsStore.updateMultipleConfig({ uiScale: '110', temperature: 0.8 });
		settingsStore.initialize();
		expect(config()).toMatchObject({ uiScale: '110', temperature: 0.8 });
		expect([...settingsStore.userOverrides]).toEqual([]);
	});

	it.each(['single', 'batch', 'parameter reset', 'clear overrides', 'props sync'] as const)(
		'does not publish a failed %s',
		(operation) => {
			const before = { ...config() },
				disk = new Map(storage),
				overrides = [...settingsStore.userOverrides];
			useStorage((key) => key === USER_OVERRIDES_LOCALSTORAGE_KEY);
			const actions = {
				single: () => settingsStore.updateConfig('temperature', 0.8),
				batch: () => settingsStore.updateMultipleConfig({ uiScale: '110', temperature: 0.8 }),
				'parameter reset': () => settingsStore.resetParameterToServerDefault('temperature'),
				'clear overrides': () => settingsStore.clearAllUserOverrides(),
				'props sync': () => settingsStore.syncWithServerDefaults()
			};
			expect(actions[operation]).toThrow(SettingsPersistenceError);
			expect(config()).toEqual(before);
			expect(storage).toEqual(disk);
			expect([...settingsStore.userOverrides]).toEqual(overrides);
		}
	);

	it.each([CONFIG_LOCALSTORAGE_KEY, USER_OVERRIDES_LOCALSTORAGE_KEY])(
		'full Reset failure at %s compensates auxiliary keys and permits retry',
		(failedKey) => {
			settingsStore.updateConfig('fontSize', '20');
			for (const key of Object.keys(GLOBAL_CONFIG_STORAGE_DEFAULT))
				storage.set(key, 'synthetic preference');
			const before = { ...config() },
				disk = new Map(storage),
				overrides = [...settingsStore.userOverrides];
			const session = settingsStore.beginPreview();
			useStorage((key) => key === failedKey);
			expect(() => settingsStore.resetConfig()).toThrow(SettingsPersistenceError);
			expect(config()).toEqual(before);
			expect(storage).toEqual(disk);
			expect([...settingsStore.userOverrides]).toEqual(overrides);
			expect(settingsStore.isPreviewCurrent(session)).toBe(true);
			useStorage();
			settingsStore.resetConfig();
			expect(config()).toEqual(SETTING_CONFIG_DEFAULT);
			settingsStore.initialize();
			expect(config()).toEqual(SETTING_CONFIG_DEFAULT);
		}
	);

	it.each(['add', 'edit', 'delete'] as const)(
		'MCP %s failure leaves list, connections, health and permission storage unchanged',
		(operation) => {
			mcpStore.addServer({ id: 'existing', url: 'http://synthetic.invalid/mcp', enabled: true });
			mcpStore.updateHealthCheck('existing', {
				status: HealthCheckStatus.ERROR,
				message: 'synthetic',
				logs: []
			});
			mcpStore.getConnections().set('existing', {
				serverName: 'existing',
				client: { close: vi.fn() }
			} as unknown as MCPConnection);
			storage.set('LlamaCppWebui.alwaysAllowedTools', '["synthetic"]');
			const before = { ...config() },
				disk = new Map(storage),
				connections = new Map(mcpStore.getConnections());
			const health = mcpStore.getHealthCheckState('existing');
			const clear = vi.spyOn(mcpStore, 'clearHealthCheck');
			useStorage((key) => key === USER_OVERRIDES_LOCALSTORAGE_KEY);
			const actions = {
				add: () => mcpStore.addServer({ id: 'new', url: 'http://new.invalid/mcp', enabled: true }),
				edit: () => mcpStore.updateServer('existing', { url: 'http://edited.invalid/mcp' }),
				delete: () => mcpStore.removeServer('existing')
			};
			expect(actions[operation]).toThrow(SettingsPersistenceError);
			expect(config()).toEqual(before);
			expect(storage).toEqual(disk);
			expect(mcpStore.getConnections()).toEqual(connections);
			expect(mcpStore.getHealthCheckState('existing')).toEqual(health);
			expect(clear).not.toHaveBeenCalled();
			useStorage();
			actions[operation]();
			const saved = config().mcpServers;
			settingsStore.initialize();
			expect(config().mcpServers).toBe(saved);
			expect(mcpStore.getServers()).toHaveLength(
				operation === 'add' ? 2 : operation === 'delete' ? 0 : 1
			);
		}
	);
});

describe('factory typography without migration of user choices', () => {
	it('fills missing values from central defaults on fresh load and Reset', () => {
		storage.delete(CONFIG_LOCALSTORAGE_KEY);
		settingsStore.initialize();
		expect(config()).toMatchObject({
			fontFamily: 'merriweather',
			fontVariant: '400',
			fontSize: '13',
			interfaceLanguage: 'en',
			uiScale: '100',
			theme: 'frosted-glass',
			frostedGlassWallpaper: 'frosted-glass-03',
			frostedGlassMilkiness: 75
		});
		settingsStore.resetConfig();
		settingsStore.initialize();
		expect(config()).toEqual(SETTING_CONFIG_DEFAULT);
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toEqual(config());
	});
	it.each([
		{ fontFamily: 'default', fontSize: 'default', fontVariant: '400' },
		{ fontFamily: 'fira-sans', fontSize: '18', fontVariant: '600' }
	])('preserves explicitly stored/imported $fontFamily preferences', (font) => {
		storage.set(CONFIG_LOCALSTORAGE_KEY, JSON.stringify(font));
		settingsStore.initialize();
		expect(config()).toMatchObject(font);
		importApplicationSettings(
			JSON.stringify({ type: 'llampart-settings-export', formatVersion: 1, settings: font })
		);
		settingsStore.initialize();
		expect(config()).toMatchObject(font);
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toMatchObject(font);
	});
});
