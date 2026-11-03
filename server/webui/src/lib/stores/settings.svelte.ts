/**
 * settingsStore - Application configuration and theme management
 *
 * This store manages all application settings including AI model parameters, UI preferences,
 * and theme configuration. It provides persistent storage through localStorage with reactive
 * state management using Svelte 5 runes.
 *
 * **Architecture & Relationships:**
 * - **settingsStore** (this class): Configuration state management
 *   - Manages AI model parameters (temperature, max tokens, etc.)
 *   - Handles theme switching and persistence
 *   - Provides localStorage synchronization
 *   - Offers reactive configuration access
 *
 * - **ChatService**: Reads model parameters for API requests
 * - **UI Components**: Subscribe to theme and configuration changes
 *
 * **Key Features:**
 * - **Model Parameters**: Temperature, max tokens, top-p, top-k, repeat penalty
 * - **Theme Management**: Registered theme selection and persistence
 * - **Persistence**: Automatic localStorage synchronization
 * - **Reactive State**: Svelte 5 runes for automatic UI updates
 * - **Default Handling**: Graceful fallback to defaults for missing settings
 * - **Batch Updates**: Efficient multi-setting updates
 * - **Reset Functionality**: Restore defaults for individual or all settings
 *
 * **Configuration Categories:**
 * - Generation parameters (temperature, tokens, sampling)
 * - UI preferences (theme, display options)
 * - System settings (model selection, prompts)
 * - Advanced options (seed, penalties, context handling)
 */

import { browser } from '$app/environment';
import { RESPONSE_PREFERENCES } from '$lib/utils/response-preferences';
import { SvelteSet } from 'svelte/reactivity';
import {
	APPEARANCE_SETTING_KEYS,
	CONFIG_LOCALSTORAGE_KEY,
	GLOBAL_CONFIG_STORAGE_DEFAULT,
	PROVIDER_CONNECTION_SETTING_KEYS,
	SETTING_CONFIG_DEFAULT,
	USER_OVERRIDES_LOCALSTORAGE_KEY
} from '$lib/constants';
import { API_PROVIDER_IDS, isApiProviderId } from '$lib/constants/api-providers';
import type { ApiProviderId } from '$lib/constants/api-providers';
import { ParameterSyncService } from '$lib/services/parameter-sync.service';
import { validateGatewayConnection } from '$lib/services/providers/provider-transport';
import { serverStore } from '$lib/stores/server.svelte';
import { normalizeThemeId, THEME_REGISTRY } from '$lib/themes/registry';
import type { ThemePreviewCommitResult, ThemeSettingsPreview } from '$lib/themes/types';
import { configToParameterRecord, getConfigValue, setConfigValue } from '$lib/utils/config-helpers';
import { normalizeFloatingPoint } from '$lib/utils/precision';
import {
	parseSettingsStorage,
	parseUserOverrides,
	serializeSettingsStorage,
	validateSettingsPatch
} from '$lib/utils/settings-schema';

/** localStorage has no multi-key transaction. A failed compensation is explicit. */
export class SettingsPersistenceError extends Error {
	readonly messageKey: string;
	constructor(
		readonly failedKey: string,
		cause: unknown,
		readonly rollbackErrors: readonly string[] = []
	) {
		super(
			rollbackErrors.length
				? 'Settings persistence failed and rollback was incomplete'
				: 'Settings could not be persisted',
			{ cause }
		);
		this.name = 'SettingsPersistenceError';
		this.messageKey = rollbackErrors.length
			? 'settings.storageRollbackError'
			: 'settings.storageSaveError';
	}
}

export type SettingsPreviewCommitResult =
	| { ok: true }
	| { ok: false; reason: 'stale' }
	| { ok: false; reason: 'conflict'; keys: string[] }
	| (Extract<ThemePreviewCommitResult, { ok: false }> & { reason: 'resource' });

class SettingsStore {
	/**
	 *
	 *
	 * State
	 *
	 *
	 */

	config = $state<SettingsConfigType>({ ...SETTING_CONFIG_DEFAULT });
	isInitialized = $state(false);
	userOverrides = new SvelteSet<string>();
	private preview = $state<Partial<SettingsConfigType>>({});
	private previewSession: symbol | undefined;
	private previewBaseline: SettingsConfigType | undefined;
	private previewResources: ThemeSettingsPreview[] = [];

	/** Only the appearance runtime reads this overlay. Persistence always uses config. */
	get appearanceConfig(): SettingsConfigType {
		return { ...this.config, ...validateSettingsPatch(this.preview, this.config) };
	}

	beginPreview(): symbol {
		this.cancelPreview();
		this.previewSession = Symbol('settings-preview');
		this.previewBaseline = { ...this.config };
		this.previewResources = Object.values(THEME_REGISTRY).flatMap((theme) =>
			theme.beginSettingsPreview ? [theme.beginSettingsPreview()] : []
		);
		return this.previewSession;
	}

	isPreviewCurrent(session: symbol): boolean {
		return this.previewSession === session;
	}

	updatePreview(session: symbol, updates: Partial<SettingsConfigType>): void {
		if (!this.isPreviewCurrent(session)) return;
		const patch = Object.fromEntries(
			Object.entries(updates).filter(([key]) => APPEARANCE_SETTING_KEYS.includes(key))
		);
		this.preview = {
			...this.preview,
			...validateSettingsPatch(patch, this.appearanceConfig)
		};
	}

	/** Three-way field diff: an untouched snapshot is never a write. All settings
	 * values are scalar (structured settings such as MCP are serialized strings).
	 * Called before form numeric conversion so opening Settings cannot dirty fields.
	 */
	getPreviewChanges(
		session: symbol,
		draft: Partial<SettingsConfigType>
	): Partial<SettingsConfigType> {
		if (!this.isPreviewCurrent(session) || !this.previewBaseline) return {};
		return Object.fromEntries(
			Object.entries(draft).filter(([key, value]) => !Object.is(value, this.previewBaseline![key]))
		);
	}

	commitPreview(
		session: symbol,
		updates: Partial<SettingsConfigType>,
		/** Connection read-set captured before async validation, never the whole config. */
		expected: Partial<SettingsConfigType> = {}
	): SettingsPreviewCommitResult {
		if (!this.isPreviewCurrent(session)) return { ok: false, reason: 'stale' };
		const changes = this.getPreviewChanges(session, updates);
		const patch = validateSettingsPatch(changes, this.config);
		const conflicts = new SvelteSet(
			Object.keys(patch).filter(
				(key) =>
					!Object.is(this.config[key], this.previewBaseline![key]) &&
					!Object.is(this.config[key], patch[key])
			)
		);
		if ('fontFamily' in changes || 'fontVariant' in changes) {
			for (const key of ['fontFamily', 'fontVariant']) {
				if (
					!Object.is(this.config[key], this.previewBaseline![key]) &&
					!Object.is(this.config[key], patch[key])
				)
					conflicts.add(key);
			}
		}
		for (const [key, value] of Object.entries(expected)) {
			if (!Object.is(this.config[key], value)) conflicts.add(key);
		}
		// Detect conflicts before touching theme-owned resources. No silent same-field
		// overwrite: the user must close/reopen Settings against the current values.
		if (conflicts.size) return { ok: false, reason: 'conflict', keys: [...conflicts] };
		const next = this.prepareUpdate(patch);
		// Only the Settings form's changed profiles/active selection need preflight.
		// Import, Reset and immediate MCP writes retain their independent contracts.
		for (const provider of Object.values(API_PROVIDER_IDS)) {
			const keys = this.getConnectionKeys(provider);
			if (
				keys.serverBaseUrl in patch ||
				keys.apiKey in patch ||
				(('apiProvider' in patch || 'serverBaseUrl' in patch || 'apiKey' in patch) &&
					next.config.apiProvider === provider)
			) {
				validateGatewayConnection(
					provider,
					String(next.config[keys.serverBaseUrl] ?? ''),
					String(next.config[keys.apiKey] ?? '')
				);
			}
		}
		// A local choice must survive the first /props response, even when no
		// server defaults existed at Save time. Persist through the usual writer.
		for (const key of Object.keys(patch))
			if (APPEARANCE_SETTING_KEYS.includes(key)) next.overrides.add(key);
		while (this.previewResources.length) {
			const result = this.previewResources[0].commit(this.config);
			if (!result.ok) {
				const recovery = validateSettingsPatch(result.configPatch, this.config);
				// Preserve the established resource recovery policy. Assets are not
				// participants in configuration/overrides compensation.
				if (Object.entries(recovery).some(([key, value]) => this.config[key] !== value))
					this.updateMultipleConfig(recovery);
				this.updatePreview(session, recovery);
				return { ...result, configPatch: recovery, reason: 'resource' };
			}
			// A resource has already committed even if config subsequently fails.
			// Retrying Save must not attempt to commit its ended preview again.
			this.previewResources.shift();
		}
		try {
			this.commitState(next.config, next.overrides);
		} catch (error) {
			// Assets have their established independent commit policy. Reopen only
			// their preview sessions against the actual stored resources, not old bytes.
			this.previewResources = Object.values(THEME_REGISTRY).flatMap((theme) =>
				theme.beginSettingsPreview ? [theme.beginSettingsPreview()] : []
			);
			throw error;
		}
		this.cancelPreview(session);
		return { ok: true };
	}

	cancelPreview(session?: symbol): void {
		if (session !== undefined && !this.isPreviewCurrent(session)) return;
		for (const resource of this.previewResources) resource.cancel();
		this.previewResources = [];
		this.preview = {};
		this.previewSession = undefined;
		this.previewBaseline = undefined;
	}

	/**
	 *
	 *
	 * Utilities (private helpers)
	 *
	 *
	 */

	/**
	 * Helper method to get server defaults with null safety
	 * Centralizes the pattern of getting and extracting server defaults
	 */
	private getServerDefaults(): Record<string, string | number | boolean> {
		const serverParams = serverStore.defaultParams;
		const webuiSettings = serverStore.webuiSettings;
		return ParameterSyncService.extractServerDefaults(serverParams, webuiSettings);
	}

	private normalizeProviderId(providerId: unknown): ApiProviderId {
		return isApiProviderId(providerId) ? providerId : API_PROVIDER_IDS.LLAMA_SERVER;
	}

	private getConnectionKeys(providerId: unknown) {
		return PROVIDER_CONNECTION_SETTING_KEYS[this.normalizeProviderId(providerId)];
	}

	private normalizeConfigValue(key: string, value: unknown): unknown {
		return key === 'theme' ? normalizeThemeId(value) : value;
	}

	private withSyncedProviderConnection(
		config: SettingsConfigType,
		updatedKeys: Set<string> = new Set()
	): SettingsConfigType {
		const next = { ...config };
		const activeProvider = this.normalizeProviderId(next.apiProvider);
		const activeKeys = this.getConnectionKeys(activeProvider);

		for (const providerId of Object.values(API_PROVIDER_IDS)) {
			const keys = this.getConnectionKeys(providerId);

			if (next[keys.serverBaseUrl] === undefined) {
				next[keys.serverBaseUrl] = '';
			}

			if (next[keys.apiKey] === undefined) {
				next[keys.apiKey] = '';
			}
		}

		if (updatedKeys.has('serverBaseUrl')) {
			next[activeKeys.serverBaseUrl] = next.serverBaseUrl;
		}

		if (updatedKeys.has('apiKey')) {
			next[activeKeys.apiKey] = next.apiKey;
		}

		next.theme = normalizeThemeId(next.theme);

		// Migration from the previously shared connection fields: preserve the current
		// provider's address/key in its provider-owned profile without copying one
		// provider's values into another when only apiProvider changes.
		if (!updatedKeys.has('apiProvider')) {
			if (
				!String(next[activeKeys.serverBaseUrl] ?? '').trim() &&
				String(next.serverBaseUrl ?? '').trim()
			) {
				next[activeKeys.serverBaseUrl] = next.serverBaseUrl;
			}

			if (!String(next[activeKeys.apiKey] ?? '').trim() && String(next.apiKey ?? '').trim()) {
				next[activeKeys.apiKey] = next.apiKey;
			}
		}

		next.serverBaseUrl = next[activeKeys.serverBaseUrl];
		next.apiKey = next[activeKeys.apiKey];

		return next;
	}

	constructor() {
		if (browser) {
			this.initialize();
		}
	}

	/**
	 *
	 *
	 * Lifecycle
	 *
	 *
	 */

	/**
	 * Initialize the settings store by loading from localStorage
	 */
	initialize() {
		try {
			this.cancelPreview();
			this.loadConfig();
			this.isInitialized = true;
		} catch (error) {
			console.error('Failed to initialize settings store:', error);
		}
	}

	/**
	 * Load configuration from localStorage
	 * Returns default values for missing keys to prevent breaking changes
	 */
	private loadConfig() {
		if (!browser) return;

		try {
			const savedConfig = parseSettingsStorage(localStorage.getItem(CONFIG_LOCALSTORAGE_KEY));
			this.config = this.withSyncedProviderConnection(savedConfig);
		} catch (error) {
			console.warn('Failed to parse config from localStorage, using defaults:', error);
			this.config = this.withSyncedProviderConnection({ ...SETTING_CONFIG_DEFAULT });
		}

		try {
			this.userOverrides.clear();
			for (const key of parseUserOverrides(localStorage.getItem(USER_OVERRIDES_LOCALSTORAGE_KEY))) {
				this.userOverrides.add(key);
			}
		} catch (error) {
			console.warn('Failed to parse user overrides from localStorage:', error);
			this.userOverrides.clear();
		}
		// Normalize the retired standalone theme key only through the common writer,
		// after loading overrides. Failure must not be mistaken for a parse failure.
		if (localStorage.getItem('theme') !== null)
			this.commitState(this.config, this.userOverrides, { theme: null });
	}

	/**
	 *
	 *
	 * Config Updates
	 *
	 *
	 */

	/**
	 * Update a specific configuration setting
	 * @param key - The configuration key to update
	 * @param value - The new value for the configuration key
	 */
	updateConfig<K extends keyof SettingsConfigType>(key: K, value: SettingsConfigType[K]): void {
		const updates = validateSettingsPatch({ [key]: value }, this.config);
		if (!(key in updates)) throw new Error(`Unknown setting ${String(key)}`);
		this.updateMultipleConfig(updates);
	}

	/**
	 * Update multiple configuration settings at once
	 * @param updates - Object containing the configuration updates
	 */
	private prepareUpdate(updates: Partial<SettingsConfigType>) {
		const validatedUpdates = validateSettingsPatch(
			updates,
			this.config
		) as Partial<SettingsConfigType>;
		const config = this.withSyncedProviderConnection(
			{
				...this.config,
				...validatedUpdates
			} as SettingsConfigType,
			new Set(Object.keys(validatedUpdates))
		);

		const propsDefaults = this.getServerDefaults();
		const overrides = new SvelteSet(this.userOverrides);

		for (const [key, value] of Object.entries(validatedUpdates)) {
			if (ParameterSyncService.canSyncParameter(key)) {
				const propsDefault = propsDefaults[key];

				if (propsDefault !== undefined) {
					const normalizedValue = normalizeFloatingPoint(value);
					const normalizedDefault = normalizeFloatingPoint(propsDefault);

					if (normalizedValue === normalizedDefault) {
						overrides.delete(key);
					} else {
						overrides.add(key);
					}
				}
			}
		}

		return { config, overrides };
	}

	updateMultipleConfig(updates: Partial<SettingsConfigType>): void {
		const next = this.prepareUpdate(updates);
		this.commitState(next.config, next.overrides);
	}

	/** Import is a partial committed update, not a form snapshot. The file's
	 * overrides replace the exportable overrides, rather than being inferred from
	 * the currently connected server's defaults. Keep active preview baselines:
	 * independent draft edits survive, conflicting edits cannot undo the import. */
	commitImportedSettings(updates: Partial<SettingsConfigType>, overrides: Iterable<string>): void {
		const patch = validateSettingsPatch(updates, this.config);
		const next = this.withSyncedProviderConnection(
			{ ...this.config, ...patch } as SettingsConfigType,
			new Set(Object.keys(patch))
		);
		this.commitState(next, new Set(overrides));
	}

	/** Single owner of config, overrides and auxiliary Reset keys (not wallpaper assets).
	 * Stage/validate first, persist synchronously, then publish memory. External
	 * tabs may observe intermediate writes: compensation is not browser atomicity. */
	private commitState(
		config: SettingsConfigType,
		overrides: Iterable<string>,
		extraWrites: Record<string, string | null> = {},
		publishInPlace = false
	): void {
		const keys = [...overrides];
		this.persistWrites({
			...extraWrites,
			[CONFIG_LOCALSTORAGE_KEY]: serializeSettingsStorage(config),
			[USER_OVERRIDES_LOCALSTORAGE_KEY]: JSON.stringify(keys)
		});
		if (publishInPlace) Object.assign(this.config, config);
		else this.config = config;
		for (const key of this.userOverrides) if (!keys.includes(key)) this.userOverrides.delete(key);
		for (const key of keys) if (!this.userOverrides.has(key)) this.userOverrides.add(key);
	}

	private persistWrites(writes: Record<string, string | null>): void {
		if (!browser) return;
		const previous: Record<string, string | null> = {};
		const attempted: string[] = [];
		let failedKey = '';
		const write = (key: string, value: string | null) => {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
			if (localStorage.getItem(key) !== value) throw new Error('Storage verification failed');
		};
		try {
			for (const key of Object.keys(writes)) {
				failedKey = key;
				previous[key] = localStorage.getItem(key);
			}
			for (const [key, value] of Object.entries(writes)) {
				failedKey = key;
				attempted.push(key);
				write(key, value);
			}
		} catch (error) {
			const rollbackErrors: string[] = [];
			for (const key of attempted.reverse()) {
				const value = previous[key];
				try {
					// A native setItem failure leaves its key intact; avoid a needless
					// compensating write when storage is already at the old value.
					if (localStorage.getItem(key) !== value) write(key, value);
				} catch {
					rollbackErrors.push(key);
				}
			}
			throw new SettingsPersistenceError(failedKey, error, rollbackErrors);
		}
	}

	/**
	 *
	 *
	 * Reset
	 *
	 *
	 */

	/**
	 * Reset all settings to defaults
	 */
	resetAll() {
		this.resetConfig();
	}

	/**
	 * Reset a parameter to server default (or webui default if no server default)
	 */
	resetParameterToServerDefault(key: string): void {
		const webuiSettings = serverStore.webuiSettings;
		const validatedWebuiSettings = webuiSettings
			? validateSettingsPatch(webuiSettings, this.config)
			: {};
		const serverDefaults = validateSettingsPatch(this.getServerDefaults(), this.config);
		let resetValue: SettingsConfigValue;
		let hasResetValue = false;

		if (key in validatedWebuiSettings) {
			// UI setting from admin config: write actual value
			resetValue = this.normalizeConfigValue(
				key,
				validatedWebuiSettings[key]
			) as SettingsConfigValue;
			hasResetValue = true;
		} else if (serverDefaults[key] !== undefined) {
			// Numeric sampling parameters may be omitted; booleans need real values.
			resetValue =
				typeof getConfigValue(SETTING_CONFIG_DEFAULT, key) === 'boolean' ? serverDefaults[key] : '';
			hasResetValue = true;
		} else if (key in SETTING_CONFIG_DEFAULT) {
			resetValue = getConfigValue(SETTING_CONFIG_DEFAULT, key);
			hasResetValue = true;
		}

		let next = this.config;
		if (hasResetValue) {
			const updates = validateSettingsPatch({ [key]: resetValue }, this.config);
			next = { ...this.config, ...updates } as SettingsConfigType;
		}
		this.commitState(
			next,
			[...this.userOverrides].filter((value) => value !== key)
		);
	}

	/**
	 *
	 *
	 * Server Sync
	 *
	 *
	 */

	/**
	 * Initialize settings with props defaults when server properties are first loaded
	 * This sets up the default values from /props endpoint
	 */
	syncWithServerDefaults(): void {
		const webuiSettings = serverStore.webuiSettings;
		const validatedWebuiSettings = webuiSettings
			? validateSettingsPatch(webuiSettings, this.config)
			: {};
		const propsDefaults = validateSettingsPatch(this.getServerDefaults(), this.config);
		if (Object.keys(propsDefaults).length === 0) return;
		const next = { ...this.config };
		const overrides = new SvelteSet(this.userOverrides);

		for (const [key, propsValue] of Object.entries(propsDefaults)) {
			// Numeric sampling defaults stay omitted. Boolean server parameters cannot
			// use that sentinel: adopt the current source's actual typed default.
			if (
				!overrides.has(key) &&
				key in (serverStore.defaultParams ?? {}) &&
				typeof getConfigValue(SETTING_CONFIG_DEFAULT, key) === 'boolean'
			)
				setConfigValue(next, key, propsValue);
			const currentValue = getConfigValue(next, key);

			const normalizedCurrent = normalizeFloatingPoint(currentValue);
			const normalizedDefault = normalizeFloatingPoint(this.normalizeConfigValue(key, propsValue));

			// Equal sampling defaults are redundant; explicit local appearance choices
			// remain user-owned even when a server happens to advertise the same value.
			if (normalizedCurrent === normalizedDefault && !APPEARANCE_SETTING_KEYS.includes(key)) {
				overrides.delete(key);
			}
		}

		// webui settings need actual values in config (no placeholder mechanism),
		// so write them for non-overridden keys
		if (webuiSettings) {
			for (const [key, value] of Object.entries(validatedWebuiSettings)) {
				// Response rules belong to the user, not the currently connected provider.
				if (RESPONSE_PREFERENCES.some((preference) => preference.key === key)) continue;
				if (!overrides.has(key) && value !== undefined) {
					setConfigValue(next, key, this.normalizeConfigValue(key, value));
				}
			}
		}

		// /props synchronization runs in a reactive effect. Preserve config identity
		// and unchanged dependencies, but publish nothing until persistence succeeds.
		this.commitState(next, overrides, {}, true);
	}

	/** Full global configuration reset. Central defaults include every theme and
	 * future schema field. Do not import /props from the connection being discarded:
	 * empty numeric defaults defer to the new source; its normal sync owns /props.
	 * Separate wallpaper bytes and conversation/IndexedDB data are not configuration.
	 */
	resetConfig(): void {
		const committed = this.withSyncedProviderConnection(
			validateSettingsPatch(SETTING_CONFIG_DEFAULT) as SettingsConfigType
		);
		this.commitState(committed, [], GLOBAL_CONFIG_STORAGE_DEFAULT);
		this.cancelPreview();
	}

	/**
	 *
	 *
	 * Utilities
	 *
	 *
	 */

	/**
	 * Get a specific configuration value
	 * @param key - The configuration key to get
	 * @returns The configuration value
	 */
	getConfig<K extends keyof SettingsConfigType>(key: K): SettingsConfigType[K] {
		return this.config[key];
	}

	/**
	 * Get the entire configuration object
	 * @returns The complete configuration object
	 */
	getAllConfig(): SettingsConfigType {
		return { ...this.config };
	}

	canSyncParameter(key: string): boolean {
		return ParameterSyncService.canSyncParameter(key);
	}

	/**
	 * Get parameter information including source for a specific parameter
	 */
	getParameterInfo(key: string) {
		const propsDefaults = this.getServerDefaults();
		const currentValue = getConfigValue(this.config, key);

		return ParameterSyncService.getParameterInfo(
			key,
			currentValue ?? '',
			propsDefaults,
			this.userOverrides
		);
	}

	/**
	 * Get diff between current settings and server defaults
	 */
	getParameterDiff() {
		const serverDefaults = this.getServerDefaults();
		if (Object.keys(serverDefaults).length === 0) return {};

		const configAsRecord = configToParameterRecord(
			this.config,
			ParameterSyncService.getSyncableParameterKeys()
		);

		return ParameterSyncService.createParameterDiff(configAsRecord, serverDefaults);
	}

	/**
	 * Clear all user overrides (for debugging)
	 */
	clearAllUserOverrides(): void {
		this.commitState(this.config, []);
	}
}

export const settingsStore = new SettingsStore();

export const config = () => settingsStore.config;
export const isInitialized = () => settingsStore.isInitialized;
