import { z } from 'zod';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { THEME_REGISTRY } from '$lib/themes/registry';
import type { SettingsConfigType, SettingsConfigValue } from '$lib/types/settings';

export const SETTINGS_STORAGE_VERSION_KEY = '__llampartSettingsVersion';
export const SETTINGS_STORAGE_VERSION = 1;

const primitiveSettingSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const optionalSamplingNumber = z.union([z.number().finite(), z.literal('')]).optional();
const optionalNumber = (schema: z.ZodNumber) => z.union([schema, z.literal('')]).optional();

const knownSettingsShape: Record<string, z.ZodType<SettingsConfigValue>> = {};
for (const [key, value] of Object.entries(SETTING_CONFIG_DEFAULT)) {
	if (value === undefined) knownSettingsShape[key] = optionalSamplingNumber;
	else if (typeof value === 'boolean') knownSettingsShape[key] = z.boolean();
	else if (typeof value === 'number') knownSettingsShape[key] = z.number().finite();
	else knownSettingsShape[key] = z.string();
}

Object.assign(knownSettingsShape, {
	apiProvider: z.enum([API_PROVIDER_IDS.LLAMA_SERVER, API_PROVIDER_IDS.OPENAI_COMPATIBLE]),
	theme: z.enum(Object.keys(THEME_REGISTRY) as [string, ...string[]]),
	interfaceLanguage: z.enum(['en', 'pl', 'de', 'fr', 'it', 'es']),
	uiScale: z.enum(['90', '100', '110']),
	conversationTimestampFormat: z.enum(['ddmmyyyy24', 'mmddyyyy12']),
	agenticMaxTurns: z.number().int().min(1),
	agenticMaxToolPreviewLines: z.number().int().min(1),
	pasteLongTextToFileLen: z.number().finite().int().min(0),
	temperature: optionalNumber(z.number().finite().min(0)),
	dynatemp_range: optionalNumber(z.number().finite().min(0)),
	dynatemp_exponent: optionalNumber(z.number().finite().min(0)),
	top_k: optionalNumber(z.number().finite().int().min(0)),
	top_p: optionalNumber(z.number().finite().min(0).max(1)),
	min_p: optionalNumber(z.number().finite().min(0).max(1)),
	xtc_probability: optionalNumber(z.number().finite().min(0).max(1)),
	xtc_threshold: optionalNumber(z.number().finite().min(0).max(1)),
	typ_p: optionalNumber(z.number().finite().min(0).max(1)),
	repeat_last_n: optionalNumber(z.number().finite().int().min(-1)),
	repeat_penalty: optionalNumber(z.number().finite().min(0)),
	presence_penalty: optionalNumber(z.number().finite().min(-2).max(2)),
	frequency_penalty: optionalNumber(z.number().finite().min(-2).max(2)),
	dry_multiplier: optionalNumber(z.number().finite().min(0)),
	dry_base: optionalNumber(z.number().finite().min(0)),
	dry_allowed_length: optionalNumber(z.number().finite().int().min(0)),
	dry_penalty_last_n: optionalNumber(z.number().finite().int().min(-1)),
	max_tokens: optionalNumber(z.number().finite().int().min(-1))
});

const settingsSchema = z.object(knownSettingsShape).partial().catchall(primitiveSettingSchema);
const syncableSettingKeys = new Set([
	'temperature',
	'top_k',
	'top_p',
	'min_p',
	'dynatemp_range',
	'dynatemp_exponent',
	'xtc_probability',
	'xtc_threshold',
	'typ_p',
	'repeat_last_n',
	'repeat_penalty',
	'presence_penalty',
	'frequency_penalty',
	'dry_multiplier',
	'dry_base',
	'dry_allowed_length',
	'dry_penalty_last_n',
	'max_tokens',
	'samplers',
	'backend_sampling',
	'pasteLongTextToFileLen',
	'pdfAsImage',
	'showThoughtInProgress',
	'minimalAgenticIndicators',
	'keepStatsVisible',
	'showMessageStats',
	'askForTitleConfirmation',
	'titleGenerationUseFirstLine',
	'disableAutoScroll',
	'renderUserContentAsMarkdown',
	'renderReasoningContentAsMarkdown',
	'autoMicOnEmpty',
	'pyInterpreterEnabled',
	'fullHeightCodeBlocks',
	'systemMessage',
	'showSystemMessage',
	'theme',
	'copyTextAttachmentsAsPlainText',
	'alwaysShowSidebarOnDesktop',
	'autoShowSidebarOnNewChat',
	'showRawModelNames',
	'mcpServers',
	'agenticMaxTurns',
	'agenticMaxToolPreviewLines',
	'showToolCallInProgress',
	'alwaysShowAgenticTurns',
	'excludeReasoningFromContext',
	'sendOnEnter'
]);

function readObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

export function parseSettingsConfig(
	value: unknown,
	options: { rejectInvalidKnown?: boolean } = {}
): SettingsConfigType {
	const input = readObject(value);
	const validInput: Record<string, SettingsConfigValue> = {};
	for (const [key, candidate] of Object.entries(input)) {
		if (key === SETTINGS_STORAGE_VERSION_KEY) continue;
		const schema = knownSettingsShape[key] ?? primitiveSettingSchema;
		const result = schema.safeParse(candidate);
		if (result.success) validInput[key] = result.data;
		else if (options.rejectInvalidKnown && key in knownSettingsShape) {
			throw new Error(`Invalid value for setting ${key}`);
		}
	}

	return settingsSchema.parse({ ...SETTING_CONFIG_DEFAULT, ...validInput }) as SettingsConfigType;
}

export function parseSettingsStorage(raw: string | null): SettingsConfigType {
	if (!raw) return { ...SETTING_CONFIG_DEFAULT };
	const parsed = readObject(JSON.parse(raw));
	const version = parsed[SETTINGS_STORAGE_VERSION_KEY];
	if (version !== undefined && version !== SETTINGS_STORAGE_VERSION) {
		throw new Error(`Unsupported settings storage version: ${String(version)}`);
	}
	return parseSettingsConfig(parsed);
}

export function serializeSettingsStorage(config: SettingsConfigType): string {
	return JSON.stringify({ [SETTINGS_STORAGE_VERSION_KEY]: SETTINGS_STORAGE_VERSION, ...config });
}

export function parseUserOverrides(raw: string | null): string[] {
	try {
		const parsed: unknown = JSON.parse(raw || '[]');
		if (!Array.isArray(parsed)) return [];
		return [
			...new Set(
				parsed.filter(
					(key): key is string => typeof key === 'string' && syncableSettingKeys.has(key)
				)
			)
		];
	} catch {
		return [];
	}
}

export function validateSettingsPatch(value: unknown): Record<string, SettingsConfigValue> {
	const input = readObject(value);
	const result: Record<string, SettingsConfigValue> = {};
	for (const [key, candidate] of Object.entries(input)) {
		const schema = knownSettingsShape[key];
		if (!schema) continue;
		const parsed = schema.safeParse(candidate);
		if (!parsed.success) throw new Error(`Invalid value for setting ${key}`);
		result[key] = parsed.data;
	}
	return result;
}
