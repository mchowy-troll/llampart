import { ColorMode } from '$lib/enums/ui';
import { API_PROVIDER_IDS, DEFAULT_API_PROVIDER_ID } from './api-providers';
import { DEFAULT_FROSTED_GLASS_WALLPAPER_ID } from './frosted-glass-wallpapers';
import { TITLE_GENERATION } from './title-generation';
import { Monitor, Moon, Sparkles, Sun } from '@lucide/svelte';

export const SETTING_CONFIG_DEFAULT: Record<string, string | number | boolean | undefined> = {
	// Note: in order not to introduce breaking changes, please keep the same data type (number, string, etc) if you want to change the default value.
	// Do not use nested objects, keep it single level. Prefix the key if you need to group them.
	apiProvider: DEFAULT_API_PROVIDER_ID,
	serverBaseUrl: '',
	apiKey: '',
	llamaServerBaseUrl: '',
	llamaServerApiKey: '',
	openAiCompatibleBaseUrl: '',
	openAiCompatibleApiKey: '',
	systemMessage: '',
	showSystemMessage: false,
	theme: ColorMode.FROSTED_GLASS,
	frostedGlassWallpaper: DEFAULT_FROSTED_GLASS_WALLPAPER_ID,
	frostedGlassWallpaperMilky: true,
	interfaceLanguage: 'en',
	uiScale: '100',
	showThoughtInProgress: true,
	minimalAgenticIndicators: false,
	disableReasoningParsing: false,
	excludeReasoningFromContext: true,
	keepStatsVisible: false,
	showMessageStats: true,
	askForTitleConfirmation: false,
	titleGenerationUseFirstLine: false,
	titleGenerationUseLLM: true,
	titleGenerationPrompt: TITLE_GENERATION.DEFAULT_PROMPT,
	pasteLongTextToFileLen: 5000,
	copyTextAttachmentsAsPlainText: false,
	pdfAsImage: true,
	disableAutoScroll: false,
	renderUserContentAsMarkdown: true,
	alwaysShowSidebarOnDesktop: false,
	autoShowSidebarOnNewChat: true,
	sendOnEnter: true,
	autoMicOnEmpty: false,
	fullHeightCodeBlocks: false,
	showRawModelNames: false,
	showConversationTimestamps: true,
	conversationTimestampFormat: 'ddmmyyyy24',
	mcpServers: '[]',
	mcpServerUsageStats: '{}', // JSON object: { [serverId]: usageCount }
	agenticMaxTurns: 25,
	agenticMaxToolPreviewLines: 25,
	showToolCallInProgress: false,
	alwaysShowAgenticTurns: false,
	// sampling params: empty means "use server default"
	// the server / preset is the source of truth
	// empty values are shown as placeholders from /props in the UI
	// and are NOT sent in API requests, letting the server decide
	samplers: '',
	backend_sampling: false,
	temperature: undefined,
	dynatemp_range: undefined,
	dynatemp_exponent: undefined,
	top_k: undefined,
	top_p: undefined,
	min_p: undefined,
	xtc_probability: undefined,
	xtc_threshold: undefined,
	typ_p: undefined,
	repeat_last_n: undefined,
	repeat_penalty: undefined,
	presence_penalty: undefined,
	frequency_penalty: undefined,
	dry_multiplier: undefined,
	dry_base: undefined,
	dry_allowed_length: undefined,
	dry_penalty_last_n: undefined,
	max_tokens: undefined,
	custom: '', // custom json-stringified object
	preEncodeConversation: false,
	// experimental features
	pyInterpreterEnabled: false
};

export const PROVIDER_CONNECTION_SETTING_KEYS = {
	[API_PROVIDER_IDS.LLAMA_SERVER]: {
		serverBaseUrl: 'llamaServerBaseUrl',
		apiKey: 'llamaServerApiKey'
	},
	[API_PROVIDER_IDS.OPENAI_COMPATIBLE]: {
		serverBaseUrl: 'openAiCompatibleBaseUrl',
		apiKey: 'openAiCompatibleApiKey'
	}
} as const;

export const SETTING_CONFIG_INFO: Record<string, string> = {
	apiProvider: 'settings.info.apiProvider',
	serverBaseUrl: 'settings.info.serverBaseUrl',
	apiKey: 'settings.info.apiKey',
	llamaServerBaseUrl: 'settings.info.llamaServerBaseUrl',
	llamaServerApiKey: 'settings.info.llamaServerApiKey',
	openAiCompatibleBaseUrl: 'settings.info.openAiCompatibleBaseUrl',
	openAiCompatibleApiKey: 'settings.info.openAiCompatibleApiKey',
	systemMessage: 'settings.info.systemMessage',
	showSystemMessage: 'settings.info.showSystemMessage',
	theme: 'settings.info.theme',
	frostedGlassWallpaper: 'settings.info.frostedGlassWallpaper',
	frostedGlassWallpaperMilky: 'settings.info.frostedGlassWallpaperMilk',
	interfaceLanguage: 'settings.info.interfaceLanguage',
	uiScale: 'settings.info.uiScale',
	pasteLongTextToFileLen: 'settings.info.pasteLongTextToFileLen',
	copyTextAttachmentsAsPlainText: 'settings.info.copyTextAttachmentsAsPlainText',
	samplers: 'settings.info.samplers',
	backend_sampling: 'settings.info.backendSampling',
	temperature: 'settings.info.temperature',
	dynatemp_range: 'settings.info.dynatempRange',
	dynatemp_exponent: 'settings.info.dynatempExponent',
	top_k: 'settings.info.topK',
	top_p: 'settings.info.topP',
	min_p: 'settings.info.minP',
	xtc_probability: 'settings.info.xtcProbability',
	xtc_threshold: 'settings.info.xtcThreshold',
	typ_p: 'settings.info.typicalP',
	repeat_last_n: 'settings.info.repeatLastN',
	repeat_penalty: 'settings.info.repeatPenalty',
	presence_penalty: 'settings.info.presencePenalty',
	frequency_penalty: 'settings.info.frequencyPenalty',
	dry_multiplier: 'settings.info.dryMultiplier',
	dry_base: 'settings.info.dryBase',
	dry_allowed_length: 'settings.info.dryAllowedLength',
	dry_penalty_last_n: 'settings.info.dryPenaltyLastN',
	max_tokens: 'settings.info.maxTokens',
	custom: 'settings.info.custom',
	showThoughtInProgress: 'settings.info.showThoughtInProgress',
	minimalAgenticIndicators: 'settings.info.minimalAgenticIndicators',
	disableReasoningParsing: 'settings.info.disableReasoningParsing',
	excludeReasoningFromContext: 'settings.info.excludeReasoningFromContext',
	keepStatsVisible: 'settings.info.keepStatsVisible',
	showMessageStats: 'settings.info.showMessageStats',
	askForTitleConfirmation: 'settings.info.askForTitleConfirmation',
	titleGenerationUseFirstLine: 'settings.info.titleGenerationUseFirstLine',
	titleGenerationUseLLM: 'settings.info.titleGenerationUseLLM',
	titleGenerationPrompt: 'settings.info.titleGenerationPrompt',
	pdfAsImage: 'settings.info.pdfAsImage',
	disableAutoScroll: 'settings.info.disableAutoScroll',
	renderUserContentAsMarkdown: 'settings.info.renderUserContentAsMarkdown',
	alwaysShowSidebarOnDesktop: 'settings.info.alwaysShowSidebarOnDesktop',
	autoShowSidebarOnNewChat: 'settings.info.autoShowSidebarOnNewChat',
	sendOnEnter: 'settings.info.sendOnEnter',
	autoMicOnEmpty: 'settings.info.autoMicOnEmpty',
	fullHeightCodeBlocks: 'settings.info.fullHeightCodeBlocks',
	showRawModelNames: 'settings.info.showRawModelNames',
	showConversationTimestamps: 'settings.info.showConversationTimestamps',
	conversationTimestampFormat: 'settings.info.conversationTimestampFormat',
	mcpServers: 'settings.info.mcpServers',
	mcpServerUsageStats: 'settings.info.mcpServerUsageStats',
	agenticMaxTurns: 'settings.info.agenticMaxTurns',
	agenticMaxToolPreviewLines: 'settings.info.agenticMaxToolPreviewLines',
	showToolCallInProgress: 'settings.info.showToolCallInProgress',
	alwaysShowAgenticTurns: 'settings.info.alwaysShowAgenticTurns',
	pyInterpreterEnabled: 'settings.info.pyInterpreterEnabled',
	preEncodeConversation: 'settings.info.preEncodeConversation'
};

export const SETTINGS_COLOR_MODES_CONFIG = [
	{ value: ColorMode.SYSTEM, label: 'System', icon: Monitor },
	{ value: ColorMode.LIGHT, label: 'Light', icon: Sun },
	{ value: ColorMode.DARK, label: 'Dark', icon: Moon },
	{ value: ColorMode.FROSTED_GLASS, label: 'Frosted Glass', icon: Sparkles }
];
