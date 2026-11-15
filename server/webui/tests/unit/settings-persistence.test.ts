import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONFIG_LOCALSTORAGE_KEY,
	USER_OVERRIDES_LOCALSTORAGE_KEY,
	SETTING_CONFIG_DEFAULT,
	GLOBAL_CONFIG_STORAGE_DEFAULT
} from '$lib/constants';
import { config, settingsStore, SettingsPersistenceError } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/backend.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { HealthCheckStatus } from '$lib/enums';
import { ParameterSyncService } from '$lib/services/parameter-sync.service';
import { parseSettingsStorage } from '$lib/utils/settings-schema';
import { importApplicationSettings } from '$lib/utils/settings-import-export';
import type { MCPConnection } from '$lib/types';

vi.mock('$app/env', () => ({ browser: true }));
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

// Compensation and reload below exercise a Map-backed storage, not browser atomicity.
describe('Settings persistence boundary with mock storage', () => {
	it.each([null, JSON.stringify({ responsePrefCharts: true, responsePrefDiagrams: true })])(
		'keeps committed and Settings draft capabilities ON for fresh/legacy storage: %s',
		(raw) => {
			if (raw === null) storage.delete(CONFIG_LOCALSTORAGE_KEY);
			else storage.set(CONFIG_LOCALSTORAGE_KEY, raw);
			settingsStore.initialize();
			expect(config()).toMatchObject({ chartsEnabled: true, diagramsEnabled: true });
			const session = settingsStore.beginPreview();
			const draft = { ...config() };
			expect(draft).toMatchObject({ chartsEnabled: true, diagramsEnabled: true });
			expect(settingsStore.getPreviewChanges(session, draft)).toEqual({});
			expect(settingsStore.commitPreview(session, draft)).toEqual({ ok: true });
			settingsStore.initialize();
			expect(config()).toMatchObject({ chartsEnabled: true, diagramsEnabled: true });
		}
	);
	it('capabilities apply only on Save, not draft or Cancel; preferences remain independent', () => {
		settingsStore.updateMultipleConfig({ responsePrefCharts: true, responsePrefDiagrams: true });
		const patch = { chartsEnabled: false, diagramsEnabled: false };
		let session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, patch);
		expect(config()).toMatchObject({ chartsEnabled: true, diagramsEnabled: true });
		settingsStore.cancelPreview(session);
		expect(config()).toMatchObject({ chartsEnabled: true, diagramsEnabled: true });
		session = settingsStore.beginPreview();
		expect(settingsStore.commitPreview(session, patch)).toEqual({ ok: true });
		expect(config()).toMatchObject({
			...patch,
			responsePrefCharts: true,
			responsePrefDiagrams: true
		});
		settingsStore.initialize();
		expect(config()).toMatchObject(patch);
		expect(ParameterSyncService.canSyncParameter('chartsEnabled')).toBe(false);
		expect(ParameterSyncService.canSyncParameter('diagramsEnabled')).toBe(false);
	});
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
			const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
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
			expect(JSON.parse(storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)!)).toEqual([
				'uiScale',
				'fontSize'
			]);
			settingsStore.initialize();
			expect(config()).toMatchObject(patch);
			expect([...settingsStore.userOverrides]).toEqual(['uiScale', 'fontSize']);
			expect(fetch).not.toHaveBeenCalled();
		}
	);

	it.each(['parameter reset', 'clear overrides', 'props sync'] as const)(
		'does not publish a failed %s',
		(operation) => {
			const before = { ...config() },
				disk = new Map(storage),
				overrides = [...settingsStore.userOverrides];
			useStorage((key) => key === USER_OVERRIDES_LOCALSTORAGE_KEY);
			const actions = {
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
			settingsStore.updatePreview(session, { uiScale: '110' });
			useStorage((key) => key === failedKey);
			expect(() => settingsStore.resetConfig()).toThrow(SettingsPersistenceError);
			expect(config()).toEqual(before);
			expect(storage).toEqual(disk);
			expect([...settingsStore.userOverrides]).toEqual(overrides);
			expect(settingsStore.isPreviewCurrent(session)).toBe(true);
			expect(settingsStore.appearanceConfig.uiScale).toBe('110');
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

describe('import uses the Settings persistence boundary (AUD-001)', () => {
	const patch = { fontSize: '18', temperature: 0.9 };
	const file = JSON.stringify({
		type: 'llampart-settings-export',
		formatVersion: 1,
		app: 'llampart',
		settings: patch,
		userOverrides: ['theme']
	});
	const snapshot = () => ({
		config: { ...config() },
		overrides: [...settingsStore.userOverrides],
		rawConfig: storage.get(CONFIG_LOCALSTORAGE_KEY),
		rawOverrides: storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)
	});
	function importFailure() {
		let failure: unknown;
		try {
			importApplicationSettings(file);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SettingsPersistenceError);
		return failure as SettingsPersistenceError;
	}
	it('publishes only after persistence and retains existing data, exclusions and MCP state', () => {
		settingsStore.updateMultipleConfig({
			serverBaseUrl: 'http://synthetic.invalid',
			apiKey: 'synthetic-secret',
			mcpServers: '[{"id":"kept","url":"http://mcp.invalid/mcp"}]',
			agenticMaxTurns: 19
		});
		// Flat historical fields and non-exportable overrides already loaded in the store.
		settingsStore.config = { ...config(), historicalFlag: 'keep' };
		settingsStore.userOverrides.add('mcpServers');
		settingsStore.userOverrides.add('agenticMaxTurns');
		const close = vi.fn();
		mcpStore.getConnections().set('kept', {
			serverName: 'kept',
			client: { close }
		} as unknown as MCPConnection);
		const connection = mcpStore.getConnections().get('kept');
		mcpStore.updateHealthCheck('kept', {
			status: HealthCheckStatus.ERROR,
			message: 'synthetic',
			logs: []
		});
		const health = mcpStore.getHealthCheckState('kept');
		storage.set('unrelated-tools', '["keep"]');
		const before = snapshot();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => {
				expect(config()).toEqual(before.config);
				expect([...settingsStore.userOverrides]).toEqual(before.overrides);
				storage.set(key, value);
			}
		});
		importApplicationSettings(file);
		expect(config()).toEqual({ ...before.config, ...patch });
		expect([...settingsStore.userOverrides]).toEqual(['mcpServers', 'agenticMaxTurns', 'theme']);
		expect(storage.get('unrelated-tools')).toBe('["keep"]');
		expect(mcpStore.getConnections().get('kept')).toBe(connection);
		expect(mcpStore.getHealthCheckState('kept')).toEqual(health);
		expect(close).not.toHaveBeenCalled();
		useStorage();
		const imported = snapshot();
		settingsStore.initialize();
		expect(snapshot()).toEqual(imported);
	});
	it('uses file overrides, not current /props inference, including after Save and subsequent sync', () => {
		serverStore.props = {
			default_generation_settings: { params: { temperature: 0.8 } },
			ui_settings: { systemMessage: 'server prompt' }
		} as unknown as ApiLlamaCppServerProps;
		const session = settingsStore.beginPreview();
		const draft = { ...config(), uiScale: '105' };
		importApplicationSettings(
			JSON.stringify({
				type: 'llampart-settings-export',
				formatVersion: 1,
				settings: { temperature: 0.8, systemMessage: 'imported prompt' },
				userOverrides: ['temperature', 'systemMessage']
			})
		);
		expect([...settingsStore.userOverrides]).toEqual(['temperature', 'systemMessage']);
		expect(settingsStore.commitPreview(session, draft)).toEqual({ ok: true });
		expect([...settingsStore.userOverrides]).toEqual(['temperature', 'systemMessage', 'uiScale']);
		settingsStore.initialize();
		expect([...settingsStore.userOverrides]).toEqual(['temperature', 'systemMessage', 'uiScale']);
		// Synchronization still owns its established policy: an equal sampling
		// override is redundant, while an explicit imported UI override survives.
		settingsStore.syncWithServerDefaults();
		expect([...settingsStore.userOverrides]).toEqual(['systemMessage', 'uiScale']);
		expect(config()).toMatchObject({
			temperature: 0.8,
			systemMessage: 'imported prompt',
			uiScale: '105'
		});
	});
	it.each([
		['second write', USER_OVERRIDES_LOCALSTORAGE_KEY],
		['snapshot read', USER_OVERRIDES_LOCALSTORAGE_KEY],
		['verification read', CONFIG_LOCALSTORAGE_KEY],
		['mismatched readback', CONFIG_LOCALSTORAGE_KEY],
		['second mismatched readback', USER_OVERRIDES_LOCALSTORAGE_KEY]
	])(
		'compensates %s, preserves memory/disk/draft, reinitializes and retries',
		(mode, failedKey) => {
			const before = snapshot();
			const session = settingsStore.beginPreview();
			settingsStore.updatePreview(session, { uiScale: '105' });
			let reads = 0;
			let injected = false;
			vi.stubGlobal('localStorage', {
				getItem: (key: string) => {
					reads++;
					if (
						(mode === 'snapshot read' && reads === 2) ||
						(mode === 'verification read' && reads === 3)
					)
						throw new Error('synthetic read failure');
					return storage.get(key) ?? null;
				},
				setItem: (key: string, value: string) => {
					if (!injected && key === failedKey) {
						injected = true;
						if (mode.includes('write')) throw new DOMException('test quota', 'QuotaExceededError');
						if (mode.includes('mismatched')) {
							storage.set(key, 'synthetic corrupt readback');
							return;
						}
					}
					storage.set(key, value);
				},
				removeItem: (key: string) => storage.delete(key)
			});
			const failure = importFailure();
			expect(failure).toMatchObject({
				failedKey,
				message: 'Settings could not be persisted',
				messageKey: 'settings.storageSaveError',
				rollbackErrors: []
			});
			expect(failure.cause).toBeInstanceOf(Error);
			expect((failure.cause as Error).message).toBe(
				mode.includes('write')
					? 'test quota'
					: mode.includes('readback')
						? 'Storage verification failed'
						: 'synthetic read failure'
			);
			expect(snapshot()).toEqual(before);
			expect(settingsStore.isPreviewCurrent(session)).toBe(true);
			expect(settingsStore.appearanceConfig.uiScale).toBe('105');
			useStorage();
			settingsStore.initialize();
			expect(snapshot()).toEqual(before);
			importApplicationSettings(file);
			expect(config()).toMatchObject(patch);
			expect([...settingsStore.userOverrides]).toEqual(['theme']);
			const imported = snapshot();
			settingsStore.initialize();
			expect(snapshot()).toEqual(imported);
		}
	);
	it('reports incomplete compensation without publishing memory; reload sees actual disk, retry repairs it', () => {
		const before = snapshot();
		useStorage(
			(key, value) =>
				key === USER_OVERRIDES_LOCALSTORAGE_KEY ||
				(key === CONFIG_LOCALSTORAGE_KEY && value === before.rawConfig)
		);
		const failure = importFailure();
		expect(failure).toMatchObject({
			failedKey: USER_OVERRIDES_LOCALSTORAGE_KEY,
			message: 'Settings persistence failed and rollback was incomplete',
			messageKey: 'settings.storageRollbackError',
			rollbackErrors: [CONFIG_LOCALSTORAGE_KEY]
		});
		expect(config()).toEqual(before.config);
		expect([...settingsStore.userOverrides]).toEqual(before.overrides);
		expect(storage.get(USER_OVERRIDES_LOCALSTORAGE_KEY)).toBe(before.rawOverrides);
		expect(storage.get(CONFIG_LOCALSTORAGE_KEY)).not.toBe(before.rawConfig);
		expect(parseSettingsStorage(storage.get(CONFIG_LOCALSTORAGE_KEY)!)).toEqual({
			...before.config,
			...patch
		});
		useStorage();
		// A reload cannot pretend that failed compensation restored the old disk.
		settingsStore.initialize();
		expect(config()).toEqual({ ...before.config, ...patch });
		expect([...settingsStore.userOverrides]).toEqual(before.overrides);
		importApplicationSettings(file);
		const imported = snapshot();
		settingsStore.initialize();
		expect(snapshot()).toEqual(imported);
		expect([...settingsStore.userOverrides]).toEqual(['theme']);
	});
});

describe('first-run defaults', () => {
	it('fills absent storage from central defaults', () => {
		storage.delete(CONFIG_LOCALSTORAGE_KEY);
		settingsStore.initialize();
		expect(config()).toEqual(SETTING_CONFIG_DEFAULT);
	});
});
