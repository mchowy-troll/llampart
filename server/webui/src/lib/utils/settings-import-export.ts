import {
	CONFIG_LOCALSTORAGE_KEY,
	SETTING_CONFIG_DEFAULT,
	USER_OVERRIDES_LOCALSTORAGE_KEY
} from '$lib/constants';
import type { SettingsConfigValue } from '$lib/types';

const SETTINGS_EXPORT_TYPE = 'llampart-settings-export';
const SETTINGS_EXPORT_FORMAT_VERSION = 1;

const EXCLUDED_CONFIG_KEYS = new Set([
	// Connection and secrets
	'serverBaseUrl',
	'apiKey',
	'llamaServerBaseUrl',
	'llamaServerApiKey',
	'openAiCompatibleBaseUrl',
	'openAiCompatibleApiKey',
	// Hidden internal title-generation prompt template
	'titleGenerationPrompt',
	// MCP servers, MCP section settings and MCP usage metadata
	'mcpServers',
	'mcpServerUsageStats',
	'agenticMaxTurns',
	'agenticMaxToolPreviewLines',
	'showToolCallInProgress',
	'alwaysShowAgenticTurns'
]);

const EXPORTABLE_CONFIG_KEYS = Object.keys(SETTING_CONFIG_DEFAULT).filter(
	(key) => !EXCLUDED_CONFIG_KEYS.has(key)
);
const EXPORTABLE_CONFIG_KEY_SET = new Set(EXPORTABLE_CONFIG_KEYS);

type ExportableSettings = Record<string, SettingsConfigValue>;

type SettingsExportFile = {
	type: typeof SETTINGS_EXPORT_TYPE;
	formatVersion: typeof SETTINGS_EXPORT_FORMAT_VERSION;
	app: 'llampart';
	exportedAt: string;
	settings: ExportableSettings;
	userOverrides?: string[];
};

function readJsonObject(value: string | null): Record<string, unknown> {
	if (!value) return {};

	const parsed = JSON.parse(value);

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}

	return parsed as Record<string, unknown>;
}

function isSettingsConfigValue(value: unknown): value is SettingsConfigValue {
	return (
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

function getStoredConfig(): Record<string, unknown> {
	return readJsonObject(localStorage.getItem(CONFIG_LOCALSTORAGE_KEY));
}

function getStoredUserOverrides(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(USER_OVERRIDES_LOCALSTORAGE_KEY) || '[]');

		if (!Array.isArray(parsed)) return [];

		return parsed.filter((key): key is string => typeof key === 'string');
	} catch {
		return [];
	}
}

function getExportableSettings(): ExportableSettings {
	const storedConfig = getStoredConfig();
	const settings: ExportableSettings = {};

	for (const key of EXPORTABLE_CONFIG_KEYS) {
		const value = storedConfig[key];

		if (isSettingsConfigValue(value)) {
			settings[key] = value;
		}
	}

	return settings;
}

export function exportApplicationSettings(): void {
	const exportFile: SettingsExportFile = {
		type: SETTINGS_EXPORT_TYPE,
		formatVersion: SETTINGS_EXPORT_FORMAT_VERSION,
		app: 'llampart',
		exportedAt: new Date().toISOString(),
		settings: getExportableSettings(),
		userOverrides: getStoredUserOverrides().filter((key) => EXPORTABLE_CONFIG_KEY_SET.has(key))
	};

	const blob = new Blob([JSON.stringify(exportFile, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	const date = new Date().toISOString().split('T')[0];

	link.href = url;
	link.download = `llampart-settings-${date}.json`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export function importApplicationSettings(fileText: string): void {
	const parsed = JSON.parse(fileText) as Partial<SettingsExportFile>;

	if (
		!parsed ||
		parsed.type !== SETTINGS_EXPORT_TYPE ||
		parsed.formatVersion !== SETTINGS_EXPORT_FORMAT_VERSION ||
		!parsed.settings ||
		typeof parsed.settings !== 'object' ||
		Array.isArray(parsed.settings)
	) {
		throw new Error('Invalid settings export file');
	}

	const currentConfig = getStoredConfig();
	const importedSettings: ExportableSettings = {};

	for (const [key, value] of Object.entries(parsed.settings)) {
		if (!EXPORTABLE_CONFIG_KEY_SET.has(key) || !isSettingsConfigValue(value)) continue;

		importedSettings[key] = value;
	}

	localStorage.setItem(
		CONFIG_LOCALSTORAGE_KEY,
		JSON.stringify({ ...currentConfig, ...importedSettings })
	);

	const importedOverrides = Array.isArray(parsed.userOverrides)
		? parsed.userOverrides.filter(
				(key): key is string => typeof key === 'string' && EXPORTABLE_CONFIG_KEY_SET.has(key)
			)
		: [];
	const existingOverrides = getStoredUserOverrides().filter(
		(key) => !EXPORTABLE_CONFIG_KEY_SET.has(key)
	);
	const nextOverrides = [...new Set([...existingOverrides, ...importedOverrides])];

	localStorage.setItem(USER_OVERRIDES_LOCALSTORAGE_KEY, JSON.stringify(nextOverrides));
}
