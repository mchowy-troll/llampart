<script lang="ts">
	import {
		FONT_SIZES,
		resolveFontFamily,
		resolveFontSize,
		getFontVariants,
		normalizeFontVariant
	} from '$lib/utils/typography';
	import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
	import {
		Settings,
		Code,
		Monitor,
		Database,
		MessageSquare,
		SlidersHorizontal,
		Wrench,
		AlertTriangle
	} from '@lucide/svelte';
	import ChatSettingsFooter from '$lib/components/app/chat/ChatSettings/ChatSettingsFooter.svelte';
	import ChatSettingsImportExportTab from '$lib/components/app/chat/ChatSettings/ChatSettingsImportExportTab.svelte';
	import ChatSettingsToolsTab from '$lib/components/app/chat/ChatSettings/ChatSettingsToolsTab.svelte';
	import ChatSettingsFields from '$lib/components/app/chat/ChatSettings/ChatSettingsFields.svelte';
	import ResponsePreferencesPreview from './ResponsePreferencesPreview.svelte';
	import { RESPONSE_PREFERENCES } from '$lib/utils/response-preferences';
	import McpLogo from '$lib/components/app/mcp/McpLogo.svelte';
	import McpServersSettings from '$lib/components/app/mcp/McpServersSettings.svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { config, settingsStore, SettingsPersistenceError } from '$lib/stores/settings.svelte';
	import {
		SETTINGS_SECTION_TITLES,
		type SettingsSectionTitle,
		NUMERIC_FIELDS,
		POSITIVE_INTEGER_FIELDS,
		SETTINGS_KEYS,
		API_PROVIDER_OPTIONS,
		PROVIDER_CONNECTION_SETTING_KEYS
	} from '$lib/constants';
	import { getApiProviderCapabilities } from '$lib/services/providers';
	import {
		API_PROVIDER_IDS,
		isApiProviderId,
		type ApiProviderId
	} from '$lib/constants/api-providers';
	import { SettingsFieldType } from '$lib/enums/settings';
	import type { Component } from 'svelte';
	import { onDestroy, untrack } from 'svelte';
	import type { ProviderCapabilityKey } from '$lib/types/provider';
	import { t } from '$lib/i18n';
	import { INTERFACE_LANGUAGES, INTERFACE_LANGUAGE_NAMES } from '$lib/i18n/types';
	import { CAPABILITY_FEATURES } from '$lib/services/providers/provider-capabilities';
	import { normalizeGatewaySource } from '$lib/services/providers/provider-transport';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { getThemeOptions } from '$lib/themes/registry';
	import { getThemeSettingsPanel } from '$lib/themes/ui-registry';

	interface Props {
		onSave?: () => void;
		initialSection?: SettingsSectionTitle;
		active?: boolean;
	}

	let { onSave, initialSection, active = true }: Props = $props();
	const languageCollator = new Intl.Collator('pl', { sensitivity: 'base' });
	const INTERFACE_LANGUAGE_OPTIONS = INTERFACE_LANGUAGES.map((value) => ({
		value,
		label: INTERFACE_LANGUAGE_NAMES[value]
	})).sort(
		(a, b) =>
			languageCollator.compare(a.label, b.label) ||
			(a.value < b.value ? -1 : a.value > b.value ? 1 : 0)
	);
	const THEME_OPTIONS = getThemeOptions().map((option) => ({
		...option,
		label: t(option.labelKey)
	}));
	const API_PROVIDER_SELECT_OPTIONS = API_PROVIDER_OPTIONS.map((option) => ({ ...option }));

	const CONVERSATION_TIMESTAMP_FORMAT_OPTIONS = [
		{ value: 'ddmmyyyy24', label: '31.01.2026 20:00' },
		{ value: 'mmddyyyy12', label: '01.31.2026 08:00 p.m.' }
	];

	function getSectionLabel(title: SettingsSectionTitle): string {
		switch (title) {
			case SETTINGS_SECTION_TITLES.GENERAL:
				return t('settings.sectionGeneral');
			case SETTINGS_SECTION_TITLES.APPEARANCE:
				return t('settings.sectionAppearance');
			case SETTINGS_SECTION_TITLES.CHAT:
				return t('settings.sectionChat');
			case SETTINGS_SECTION_TITLES.MODEL:
				return t('settings.sectionModel');
			case SETTINGS_SECTION_TITLES.MCP:
				return t('settings.sectionMcp');
			case SETTINGS_SECTION_TITLES.TOOLS:
				return t('settings.sectionTools');
			case SETTINGS_SECTION_TITLES.DATA:
				return t('settings.sectionData');
			case SETTINGS_SECTION_TITLES.ADVANCED:
				return t('settings.sectionAdvanced');
			default:
				return title;
		}
	}

	/**
	 * Settings metadata is the source of truth for both content and layout hints.
	 * Keeping layout near the group definitions makes future settings easier to add safely.
	 */
	type SettingsSectionConfig = {
		fields: SettingsFieldConfig[];
		groups?: SettingsFieldGroup[];
		icon: Component;
		title: SettingsSectionTitle;
		requiredProviderCapabilities?: ProviderCapabilityKey[];
		visibleForProviders?: ApiProviderId[];
	};

	function normalizeProviderId(providerId: unknown) {
		return isApiProviderId(providerId) ? providerId : API_PROVIDER_IDS.LLAMA_SERVER;
	}

	function getConnectionKeys(providerId: unknown) {
		return PROVIDER_CONNECTION_SETTING_KEYS[normalizeProviderId(providerId)];
	}

	let settingSections: SettingsSectionConfig[] = $derived([
		{
			title: SETTINGS_SECTION_TITLES.GENERAL,
			icon: Settings,
			fields: [],
			groups: [
				{
					id: 'connection',
					title: t('settings.groupConnection'),
					layout: 'three-column',
					fields: [
						{
							key: SETTINGS_KEYS.API_PROVIDER,
							order: 1,
							label: t('settings.fieldApiProvider'),
							type: SettingsFieldType.SELECT,
							options: API_PROVIDER_SELECT_OPTIONS
						},
						{
							key: SETTINGS_KEYS.SERVER_BASE_URL,
							order: 2,
							label: t('settings.fieldServerAddress'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.API_KEY,
							order: 3,
							label: t('settings.fieldApiKey'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'system-message',
					title: t('settings.groupSystemMessage'),
					fields: [
						{
							key: SETTINGS_KEYS.SYSTEM_MESSAGE,
							order: 1,
							label: t('settings.fieldSystemMessage'),
							type: SettingsFieldType.TEXTAREA
						}
					],
					fullWidth: true
				},
				{
					id: 'response-preferences',
					title: t('settings.groupResponsePreferences'),
					description: t('settings.responsePreferencesDescription'),
					fullWidth: true,
					subgroups: [
						{
							id: 'formatting',
							title: t('settings.responsePreferencesFormatting'),
							keys: RESPONSE_PREFERENCES.slice(0, 5).map(({ key }) => key)
						},
						{
							id: 'style',
							title: t('settings.responsePreferencesStyle'),
							keys: RESPONSE_PREFERENCES.slice(5).map(({ key }) => key)
						}
					],
					fields: [
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_NO_HEADINGS,
							order: 1,
							label: t('settings.responsePrefNoHeadings'),
							help: t('settings.responsePrefNoHeadingsHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_TABLES,
							order: 2,
							label: t('settings.responsePrefTables'),
							help: t('settings.responsePrefTablesHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_CHARTS,
							order: 3,
							label: t('settings.responsePrefCharts'),
							help: t('settings.responsePrefChartsHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_DIAGRAMS,
							order: 4,
							label: t('settings.responsePrefDiagrams'),
							help: t('settings.responsePrefDiagramsHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_NO_DECORATIONS,
							order: 5,
							label: t('settings.responsePrefNoDecorations'),
							help: t('settings.responsePrefNoDecorationsHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_CONCISE,
							order: 6,
							label: t('settings.responsePrefConcise'),
							help: t('settings.responsePrefConciseHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_EXAMPLES,
							order: 7,
							label: t('settings.responsePrefExamples'),
							help: t('settings.responsePrefExamplesHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_STEPS,
							order: 8,
							label: t('settings.responsePrefSteps'),
							help: t('settings.responsePrefStepsHelp'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RESPONSE_PREF_USER_LANGUAGE,
							order: 9,
							label: t('settings.responsePrefUserLanguage'),
							help: t('settings.responsePrefUserLanguageHelp'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				}
			]
		},
		{
			title: SETTINGS_SECTION_TITLES.APPEARANCE,
			icon: Monitor,
			fields: [],
			groups: [
				{
					id: 'interface',
					title: t('settings.groupInterface'),
					layout: 'three-column',
					fullWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.INTERFACE_LANGUAGE,
							order: 1,
							label: t('settings.fieldInterfaceLanguage'),
							type: SettingsFieldType.SELECT,
							options: INTERFACE_LANGUAGE_OPTIONS
						},
						{
							key: SETTINGS_KEYS.THEME,
							order: 2,
							label: t('settings.fieldTheme'),
							type: SettingsFieldType.SELECT,
							options: THEME_OPTIONS
						},
						{
							key: SETTINGS_KEYS.UI_SCALE,
							order: 3,
							label: t('settings.fieldUiScale'),
							type: SettingsFieldType.RANGE,
							min: 90,
							max: 110,
							step: 5,
							unit: '%'
						}
					]
				},
				{
					id: 'typography',
					title: t('settings.groupTypography'),
					layout: 'three-column',
					fillMode: 'row',
					fullWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.FONT_FAMILY,
							order: 1,
							label: t('settings.fieldFontFamily'),
							type: SettingsFieldType.SELECT,
							options: [
								{ value: 'merriweather', label: 'Merriweather' },
								{ value: 'frank-ruhl-libre', label: 'Frank Ruhl Libre' },
								{ value: 'crimson-text', label: 'Crimson Text' },
								{ value: 'libre-caslon-condensed', label: 'Libre Caslon Condensed' },
								{ value: 'fira-sans', label: 'Fira Sans' }
							].map((option) => ({
								...option,
								label:
									option.value === SETTING_CONFIG_DEFAULT.fontFamily
										? t('settings.fontDefault').replace('{font}', option.label)
										: option.label
							}))
						},
						{
							key: SETTINGS_KEYS.FONT_VARIANT,
							order: 2,
							label: t('settings.fieldFontVariant'),
							type: SettingsFieldType.SELECT,
							options: fontVariantOptions(SETTING_CONFIG_DEFAULT.fontFamily)
						},
						{
							key: SETTINGS_KEYS.FONT_SIZE,
							order: 3,
							label: t('settings.fieldFontSize'),
							type: SettingsFieldType.SELECT,
							options: FONT_SIZES.map((value) => ({
								value,
								label:
									value === SETTING_CONFIG_DEFAULT.fontSize
										? t('settings.fontSizeDefault').replace('{size}', value)
										: `${value} px`
							}))
						}
					]
				},
				{
					id: 'sidebar',
					title: t('settings.groupSidebar'),
					fullWidth: true,
					layout: 'sidebar',
					fields: [
						{
							key: SETTINGS_KEYS.ALWAYS_SHOW_SIDEBAR_ON_DESKTOP,
							order: 1,
							label: t('settings.fieldAlwaysShowSidebarOnDesktop'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AUTO_SHOW_SIDEBAR_ON_NEW_CHAT,
							order: 2,
							label: t('settings.fieldAutoShowSidebarOnNewChat'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.COMPACT_SIDEBAR,
							order: 3,
							label: t('settings.fieldCompactSidebar'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_CONVERSATION_TIMESTAMPS,
							order: 4,
							label: t('settings.fieldShowConversationTimestamps'),
							type: SettingsFieldType.CHECKBOX,
							help: t('settings.sidebarTimestampCombinedHelp'),
							cluster: 'sidebar-timestamp'
						},
						{
							key: SETTINGS_KEYS.CONVERSATION_TIMESTAMP_FORMAT,
							order: 5,
							label: t('settings.fieldChooseConversationTimestampFormat'),
							type: SettingsFieldType.SELECT,
							cluster: 'sidebar-timestamp',
							hideHelp: true,
							options: CONVERSATION_TIMESTAMP_FORMAT_OPTIONS
						}
					]
				},
				{
					id: 'message-display',
					title: t('settings.groupMessageDisplay'),
					layout: 'two-column',
					fields: [
						{
							key: SETTINGS_KEYS.SHOW_MESSAGE_STATS,
							order: 1,
							label: t('settings.fieldShowMessageGenerationStatistics'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_COMPOSER_STATS,
							order: 2,
							label: t('settings.fieldShowComposerGenerationStats'),
							type: SettingsFieldType.CHECKBOX,
							requiredProviderCapabilities: ['supportsPromptProgress']
						},
						{
							key: SETTINGS_KEYS.KEEP_STATS_VISIBLE,
							order: 3,
							label: t('settings.fieldKeepStatsVisibleAfterGeneration'),
							type: SettingsFieldType.CHECKBOX,
							requiredProviderCapabilities: ['supportsPromptProgress'],
							visibleWhen: (currentConfig: SettingsConfigType) =>
								currentConfig.showComposerStats !== false
						},
						{
							key: SETTINGS_KEYS.MINIMAL_AGENTIC_INDICATORS,
							order: 4,
							label: t('settings.fieldMinimalAgenticIndicators'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_THOUGHT_IN_PROGRESS,
							order: 5,
							label: t('settings.fieldShowThoughtInProgress'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RENDER_REASONING_CONTENT_AS_MARKDOWN,
							order: 6,
							label: t('settings.fieldRenderReasoningContentAsMarkdown'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RENDER_USER_CONTENT_AS_MARKDOWN,
							order: 7,
							label: t('settings.fieldRenderUserContentAsMarkdown'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.DISABLE_AUTO_SCROLL,
							order: 8,
							label: t('settings.fieldDisableAutomaticScroll'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_RAW_MODEL_NAMES,
							order: 9,
							label: t('settings.fieldShowRawModelNames'),
							type: SettingsFieldType.CHECKBOX
						}
					],
					fullWidth: true
				}
			]
		},
		{
			title: SETTINGS_SECTION_TITLES.CHAT,
			icon: MessageSquare,
			fields: [],
			groups: [
				{
					id: 'input',
					title: t('settings.groupInput'),
					layout: 'two-column',
					fields: [
						{
							key: SETTINGS_KEYS.SEND_ON_ENTER,
							order: 1,
							label: t('settings.fieldSendMessageOnEnter'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AUTO_MIC_ON_EMPTY,
							order: 2,
							label: t('settings.fieldShowMicrophoneOnEmptyInput'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true
						}
					],
					fullWidth: true
				},
				{
					id: 'conversation-titles',
					title: t('settings.groupConversationTitles'),
					layout: 'two-column',
					fields: [
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_USE_LLM,
							order: 1,
							label: t('settings.fieldUseLLMToGenerateConversationTitle'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true
						},
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_USE_FIRST_LINE,
							order: 2,
							label: t('settings.fieldUseFirstNonEmptyLineForConversationTitle'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.ASK_FOR_TITLE_CONFIRMATION,
							order: 3,
							label: t('settings.fieldAskConfirmationBeforeChangingConversationTitle'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				},
				{
					id: 'attachments-files',
					title: t('settings.groupAttachmentsFiles'),
					layout: 'attachments-files',
					fields: [
						{
							key: SETTINGS_KEYS.COPY_TEXT_ATTACHMENTS_AS_PLAIN_TEXT,
							order: 1,
							label: t('settings.fieldCopyTextAttachmentsAsPlainText'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.PASTE_LONG_TEXT_TO_FILE_LEN,
							order: 2,
							label: t('settings.fieldPasteLongTextToFileLength'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.PDF_AS_IMAGE,
							order: 3,
							label: t('settings.fieldParsePdfAsImage'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				}
			]
		},
		{
			title: SETTINGS_SECTION_TITLES.MODEL,
			icon: SlidersHorizontal,
			fields: [],
			groups: [
				{
					id: 'basic-generation',
					layout: 'three-column',
					title: t('settings.groupBasicGeneration'),
					fields: [
						{
							key: SETTINGS_KEYS.TEMPERATURE,
							order: 1,
							label: t('settings.fieldTemperature'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.TOP_K,
							order: 2,
							label: t('settings.fieldTopK'),
							type: SettingsFieldType.INPUT,
							requiredProviderCapabilities: ['supportsTopK']
						},
						{
							key: SETTINGS_KEYS.TOP_P,
							order: 3,
							label: t('settings.fieldTopP'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.MIN_P,
							order: 4,
							label: t('settings.fieldMinP'),
							type: SettingsFieldType.INPUT,
							requiredProviderCapabilities: ['supportsMinP']
						},
						{
							key: SETTINGS_KEYS.TYP_P,
							order: 5,
							label: t('settings.fieldTypicalP'),
							type: SettingsFieldType.INPUT,
							requiredProviderCapabilities: ['supportsTypicalP']
						},
						{
							key: SETTINGS_KEYS.MAX_TOKENS,
							order: 6,
							label: t('settings.fieldMaxTokens'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'dynamic-temperature',
					layout: 'three-column',
					title: t('settings.groupDynamicTemperature'),
					requiredProviderCapabilities: ['supportsDynamicTemperature'],
					fields: [
						{
							key: SETTINGS_KEYS.DYNATEMP_RANGE,
							order: 1,
							label: t('settings.fieldDynamicTemperatureRange'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DYNATEMP_EXPONENT,
							order: 2,
							label: t('settings.fieldDynamicTemperatureExponent'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'xtc',
					layout: 'three-column',
					title: t('settings.groupXtc'),
					requiredProviderCapabilities: ['supportsXtc'],
					fields: [
						{
							key: SETTINGS_KEYS.XTC_PROBABILITY,
							order: 1,
							label: t('settings.fieldXtcProbability'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.XTC_THRESHOLD,
							order: 2,
							label: t('settings.fieldXtcThreshold'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'sampler-order',
					layout: 'three-column',
					title: t('settings.groupSamplerOrder'),
					requiredProviderCapabilities: ['supportsSamplerOrder'],
					fields: [
						{
							key: SETTINGS_KEYS.SAMPLERS,
							order: 1,
							label: t('settings.fieldSamplers'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.BACKEND_SAMPLING,
							order: 2,
							label: t('settings.fieldBackendSampling'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				},
				{
					id: 'repetition',
					layout: 'three-column',
					title: t('settings.groupRepetition'),
					requiredProviderCapabilities: ['supportsRepeatPenalty'],
					fields: [
						{
							key: SETTINGS_KEYS.REPEAT_LAST_N,
							order: 1,
							label: t('settings.fieldRepeatLastN'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.REPEAT_PENALTY,
							order: 2,
							label: t('settings.fieldRepeatPenalty'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'presence-frequency',
					layout: 'three-column',
					title: t('settings.groupPresenceFrequency'),
					fields: [
						{
							key: SETTINGS_KEYS.PRESENCE_PENALTY,
							order: 1,
							label: t('settings.fieldPresencePenalty'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.FREQUENCY_PENALTY,
							order: 2,
							label: t('settings.fieldFrequencyPenalty'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'dry-penalty',
					layout: 'three-column',
					fillMode: 'row',
					title: t('settings.groupDryPenalty'),
					requiredProviderCapabilities: ['supportsDryPenalty'],
					fields: [
						{
							key: SETTINGS_KEYS.DRY_MULTIPLIER,
							order: 1,
							label: t('settings.fieldDryMultiplier'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DRY_BASE,
							order: 2,
							label: t('settings.fieldDryBase'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DRY_ALLOWED_LENGTH,
							order: 3,
							label: t('settings.fieldDryAllowedLength'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DRY_PENALTY_LAST_N,
							order: 4,
							label: t('settings.fieldDryPenaltyLastN'),
							type: SettingsFieldType.INPUT
						}
					]
				}
			]
		},
		{
			title: SETTINGS_SECTION_TITLES.MCP,
			requiredProviderCapabilities: ['supportsOpenAiToolCalls'],
			icon: McpLogo,
			fields: [],
			groups: [
				{
					id: 'agentic-behavior',
					title: t('settings.groupAgenticBehavior'),
					halfWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.ALWAYS_SHOW_AGENTIC_TURNS,
							order: 1,
							label: t('settings.fieldAlwaysShowAgenticTurnsInConversation'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AGENTIC_MAX_TURNS,
							order: 2,
							label: t('settings.fieldAgenticLoopMaxTurns'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'tool-preview',
					title: t('settings.groupToolPreview'),
					halfWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.SHOW_TOOL_CALL_IN_PROGRESS,
							order: 1,
							label: t('settings.fieldShowToolCallInProgress'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AGENTIC_MAX_TOOL_PREVIEW_LINES,
							order: 2,
							label: t('settings.fieldMaxLinesPerToolPreview'),
							type: SettingsFieldType.INPUT
						}
					]
				}
			]
		},
		{
			title: SETTINGS_SECTION_TITLES.TOOLS,
			requiredProviderCapabilities: ['supportsOpenAiToolCalls'],
			icon: Wrench,
			fields: []
		},
		{
			title: SETTINGS_SECTION_TITLES.DATA,
			icon: Database,
			fields: []
		},
		{
			title: SETTINGS_SECTION_TITLES.ADVANCED,
			icon: Code,
			fields: [],
			groups: [
				{
					id: 'reasoning',
					title: t('settings.groupReasoning'),
					layout: 'two-column',
					fields: [
						{
							key: SETTINGS_KEYS.EXCLUDE_REASONING_FROM_CONTEXT,
							order: 1,
							label: t('settings.fieldStripThinkingFromMessageHistory'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				},
				{
					id: 'performance-cache',
					requiredProviderCapabilities: ['supportsPreEncode'],
					title: t('settings.groupPerformanceCache'),
					layout: 'two-column',
					fields: [
						{
							key: SETTINGS_KEYS.PRE_ENCODE_CONVERSATION,
							order: 1,
							label: t('settings.fieldPreFillKvCacheAfterResponse'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				},
				{
					id: 'custom-parameters',
					requiredProviderCapabilities: ['supportsCustomJsonPayload'],
					title: t('settings.groupCustomParameters'),
					fields: [
						{
							key: SETTINGS_KEYS.CUSTOM,
							order: 1,
							label: t('settings.fieldCustomJson'),
							type: SettingsFieldType.TEXTAREA
						}
					],
					fullWidth: true
				}
			]
		}
	]);

	let activeSection = $derived<SettingsSectionTitle>(
		initialSection ?? SETTINGS_SECTION_TITLES.GENERAL
	);
	let localConfig: SettingsConfigType = $state({ ...config() });
	// Project historical sentinels for display only: opening Settings must not
	// dirty the form or rewrite saved preferences. New choices use concrete IDs.
	let displayedConfig = $derived({
		...localConfig,
		fontFamily: resolveFontFamily(localConfig.fontFamily),
		fontVariant: normalizeFontVariant(localConfig.fontFamily, localConfig.fontVariant),
		fontSize: resolveFontSize(localConfig.fontSize)
	});
	let previewSession: symbol | undefined;

	function cancelPreview() {
		if (previewSession) settingsStore.cancelPreview(previewSession);
		previewSession = undefined;
	}

	$effect(() => {
		const isActive = active;
		untrack(() => {
			if (isActive) reset();
			else cancelPreview();
		});
	});
	onDestroy(cancelPreview);
	let ThemeSettingsPanel = $derived(getThemeSettingsPanel(localConfig.theme));
	let activeConnectionKeys = $derived(getConnectionKeys(localConfig.apiProvider));
	let providerCapabilities = $derived(
		getApiProviderCapabilities(String(localConfig.apiProvider ?? ''))
	);
	let settingsWarningDialogOpen = $state(false);
	let settingsWarningDialogTitle = $state('');
	let settingsWarningDialogMessage = $state('');

	function supportsRequiredCapabilities(capabilities?: ProviderCapabilityKey[]): boolean {
		return (
			!capabilities ||
			capabilities.every((capability) => {
				const feature = CAPABILITY_FEATURES[capability];
				const snapshot = settingsCapabilitySnapshot();
				if (feature && snapshot && snapshot.features[feature]?.state === 'unsupported')
					return false;
				return providerCapabilities[capability] === true;
			})
		);
	}

	function settingsCapabilitySnapshot() {
		const snapshot = modelsStore.capabilitySnapshot;
		const providerId = normalizeProviderId(localConfig.apiProvider);
		const keys = getConnectionKeys(providerId);
		try {
			return snapshot?.providerId === providerId &&
				snapshot.serverBaseUrl ===
					normalizeGatewaySource(providerId, String(localConfig[keys.serverBaseUrl] ?? ''))
						.baseUrl &&
				String(localConfig[keys.apiKey] ?? '') === String(config().apiKey ?? '')
				? snapshot
				: null;
		} catch {
			return null;
		}
	}

	function supportsVisibleForProviders(providers?: ApiProviderId[]): boolean {
		return !providers || providers.includes(normalizeProviderId(localConfig.apiProvider));
	}

	function getProviderScopedField(field: SettingsFieldConfig): SettingsFieldConfig {
		const feature = field.requiredProviderCapabilities
			?.map((key: ProviderCapabilityKey) => CAPABILITY_FEATURES[key])
			.find(Boolean);
		if (
			feature &&
			normalizeProviderId(localConfig.apiProvider) !== API_PROVIDER_IDS.LLAMA_SERVER &&
			settingsCapabilitySnapshot()?.features[feature]?.state !== 'supported'
		)
			field = {
				...field,
				isExperimental: true,
				help: `${t('settings.capabilityUnknown')} ${field.help ?? ''}`
			};
		if (field.key === SETTINGS_KEYS.SERVER_BASE_URL) {
			return { ...field, key: activeConnectionKeys.serverBaseUrl };
		}

		if (field.key === SETTINGS_KEYS.API_KEY) {
			return { ...field, key: activeConnectionKeys.apiKey };
		}

		return field;
	}

	function fontVariantOptions(family: unknown) {
		return getFontVariants(family).map((option) => ({
			...option,
			label:
				resolveFontFamily(family) === SETTING_CONFIG_DEFAULT.fontFamily &&
				option.value === SETTING_CONFIG_DEFAULT.fontVariant
					? t('settings.fontVariantDefault').replace('{variant}', option.label)
					: option.label
		}));
	}

	function getVisibleFields(fields: SettingsFieldConfig[]): SettingsFieldConfig[] {
		return fields
			.filter((field) => supportsVisibleForProviders(field.visibleForProviders))
			.filter((field) => supportsRequiredCapabilities(field.requiredProviderCapabilities))
			.filter((field) => field.visibleWhen?.(localConfig) ?? true)
			.map((field) =>
				field.key === SETTINGS_KEYS.FONT_VARIANT
					? {
							...field,
							options: fontVariantOptions(localConfig.fontFamily)
						}
					: field
			)
			.map(getProviderScopedField);
	}

	function getVisibleGroups(groups: SettingsFieldGroup[] = []): SettingsFieldGroup[] {
		return groups
			.filter((group) => supportsVisibleForProviders(group.visibleForProviders))
			.filter((group) => supportsRequiredCapabilities(group.requiredProviderCapabilities))
			.map((group) => ({ ...group, fields: getVisibleFields(group.fields) }))
			.filter((group) => group.fields.length > 0);
	}

	let visibleSettingSections = $derived(
		settingSections
			.filter((section) => supportsVisibleForProviders(section.visibleForProviders))
			.filter((section) => supportsRequiredCapabilities(section.requiredProviderCapabilities))
	);

	let currentSection = $derived(
		visibleSettingSections.find((section) => section.title === activeSection) ||
			visibleSettingSections[0] ||
			settingSections[0]
	);

	$effect(() => {
		if (
			initialSection &&
			visibleSettingSections.some((section) => section.title === initialSection)
		) {
			activeSection = initialSection;
		}
	});

	$effect(() => {
		if (!visibleSettingSections.some((section) => section.title === activeSection)) {
			activeSection = visibleSettingSections[0]?.title ?? SETTINGS_SECTION_TITLES.GENERAL;
		}
	});

	function getCurrentGroups(): SettingsFieldGroup[] {
		if (currentSection.groups?.length) {
			return getVisibleGroups(currentSection.groups);
		}

		const visibleFields = getVisibleFields(currentSection.fields);
		if (!visibleFields.length) {
			return [];
		}

		return [
			{
				id: `${currentSection.title}-fields`,
				fields: visibleFields,
				fullWidth: true,
				framed: false
			}
		];
	}

	function handleThemeChange(newTheme: string) {
		handleConfigChange(SETTINGS_KEYS.THEME, newTheme);
	}

	function handleConfigChange(key: string, value: string | boolean | number) {
		const nextConfig = { ...localConfig, [key]: value };
		if (key === SETTINGS_KEYS.FONT_FAMILY || key === SETTINGS_KEYS.FONT_VARIANT) {
			// Editing a projected legacy selection makes the chosen family concrete,
			// so all its real weights are selectable without migrating untouched data.
			nextConfig.fontFamily = resolveFontFamily(nextConfig.fontFamily);
			nextConfig.fontVariant = normalizeFontVariant(nextConfig.fontFamily, nextConfig.fontVariant);
		}

		if (key === SETTINGS_KEYS.API_PROVIDER) {
			const nextConnectionKeys = getConnectionKeys(value);
			nextConfig[SETTINGS_KEYS.SERVER_BASE_URL] =
				nextConfig[nextConnectionKeys.serverBaseUrl] ?? '';
			nextConfig[SETTINGS_KEYS.API_KEY] = nextConfig[nextConnectionKeys.apiKey] ?? '';
		}

		if (key === SETTINGS_KEYS.SHOW_THOUGHT_IN_PROGRESS && value === true) {
			nextConfig[SETTINGS_KEYS.MINIMAL_AGENTIC_INDICATORS] = false;
		}

		if (key === SETTINGS_KEYS.MINIMAL_AGENTIC_INDICATORS && value === true) {
			nextConfig[SETTINGS_KEYS.SHOW_THOUGHT_IN_PROGRESS] = false;
		}

		localConfig = nextConfig;
		if (previewSession) {
			settingsStore.updatePreview(previewSession, {
				[key]: nextConfig[key],
				...(key === SETTINGS_KEYS.FONT_FAMILY || key === SETTINGS_KEYS.FONT_VARIANT
					? { fontFamily: nextConfig.fontFamily, fontVariant: nextConfig.fontVariant }
					: {})
			});
		}
	}

	function handleReset() {
		reset();
	}

	function showSettingsWarning(
		message: string,
		title = t('settings.settingsValidationDialogTitle')
	) {
		settingsWarningDialogTitle = title;
		settingsWarningDialogMessage = message;
		settingsWarningDialogOpen = true;
	}

	function handleSave() {
		const session = previewSession;
		if (!active || !session || !settingsStore.isPreviewCurrent(session)) return;
		if (localConfig.custom && typeof localConfig.custom === 'string' && localConfig.custom.trim()) {
			try {
				JSON.parse(localConfig.custom);
			} catch (error) {
				showSettingsWarning(t('settings.invalidJsonCustomParameters'));
				console.error(error);
				return;
			}
		}

		// Diff before normalization: the form snapshot is not application state.
		const processedConfig = settingsStore.getPreviewChanges(session, localConfig);
		// These aliases are projections of provider-owned profile fields, not edits.
		delete processedConfig.serverBaseUrl;
		delete processedConfig.apiKey;

		for (const field of NUMERIC_FIELDS) {
			if (processedConfig[field] !== undefined && processedConfig[field] !== '') {
				const numValue = Number(processedConfig[field]);
				if (!isNaN(numValue)) {
					if ((POSITIVE_INTEGER_FIELDS as readonly string[]).includes(field)) {
						processedConfig[field] = Math.max(1, Math.round(numValue));
					} else {
						processedConfig[field] = numValue;
					}
				} else {
					showSettingsWarning(
						`${t('settings.invalidNumericValueFor')} ${field}. ${t('settings.enterValidNumber')}`
					);
					return;
				}
			}
		}

		try {
			const result = settingsStore.commitPreview(session, processedConfig);
			if (!result.ok) {
				if (result.reason === 'resource') {
					localConfig = { ...localConfig, ...result.configPatch };
					showSettingsWarning(t(result.messageKey));
				}
				if (result.reason === 'conflict')
					showSettingsWarning(t('settings.concurrentSettingsConflict'));
				return;
			}
			previewSession = undefined;
		} catch (error) {
			showSettingsWarning(
				error instanceof SettingsPersistenceError
					? t(error.messageKey)
					: error instanceof Error
						? error.message
						: t('settings.enterValidNumber')
			);
			return;
		}
		onSave?.();
	}

	export function reset() {
		cancelPreview();
		localConfig = { ...config() };
		if (active) previewSession = settingsStore.beginPreview();
	}
</script>

<div class="flex min-h-0 flex-1 flex-row overflow-hidden">
	<!-- Settings Sidebar -->
	<div class="w-60 shrink-0 border-r border-border/30 p-5 lg:w-64">
		<nav class="space-y-1 py-2">
			{#each visibleSettingSections as section (section.title)}
				<button
					class="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent {activeSection ===
					section.title
						? 'bg-accent text-accent-foreground'
						: 'text-muted-foreground'}"
					onclick={() => (activeSection = section.title)}
				>
					<section.icon class="h-4 w-4 shrink-0" />

					<span class="ml-1">{getSectionLabel(section.title)}</span>
				</button>
			{/each}
		</nav>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		<ScrollArea class="min-h-0 flex-1">
			<div class="flex min-h-full flex-col gap-6 p-6">
				<div class="mb-6 flex items-center gap-2 border-b border-border/30 pb-6">
					<currentSection.icon class="h-5 w-5" />

					<h3 class="text-lg font-semibold">{getSectionLabel(currentSection.title)}</h3>
				</div>

				{#if currentSection.title === SETTINGS_SECTION_TITLES.DATA}
					<div class="columns-1 gap-4">
						<ChatSettingsImportExportTab />
					</div>
				{:else if currentSection.title === SETTINGS_SECTION_TITLES.TOOLS}
					<div class="columns-1 gap-4">
						<ChatSettingsToolsTab />
					</div>
				{:else}
					<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
						{#each getCurrentGroups() as group (group.id)}
							{#if currentSection.title === SETTINGS_SECTION_TITLES.APPEARANCE && group.id === 'typography' && ThemeSettingsPanel}
								<ThemeSettingsPanel config={localConfig} onConfigChange={handleConfigChange} />
							{/if}

							{@const groupSpanClass = group.halfWidth ? '' : 'lg:col-span-2'}
							{#if group.framed === false}
								<div class={groupSpanClass}>
									<ChatSettingsFields
										fields={group.fields}
										layout={group.layout}
										fillMode={group.fillMode}
										subgroups={group.subgroups}
										localConfig={displayedConfig}
										onConfigChange={handleConfigChange}
										onThemeChange={handleThemeChange}
									/>
								</div>
							{:else}
								<section
									data-settings-group={group.id}
									class={['rounded-2xl border border-border bg-background p-4', groupSpanClass]
										.filter(Boolean)
										.join(' ')}
								>
									{#if group.title || group.description}
										<div class="mb-4 border-b border-border/30 pb-3">
											{#if group.title}
												<h4 class="text-sm font-semibold">{group.title}</h4>
											{/if}

											{#if group.description}
												<p class="mt-1 text-xs text-muted-foreground">{group.description}</p>
											{/if}
										</div>
									{/if}

									<ChatSettingsFields
										fields={group.fields}
										layout={group.layout}
										fillMode={group.fillMode}
										subgroups={group.subgroups}
										localConfig={displayedConfig}
										onConfigChange={handleConfigChange}
										onThemeChange={handleThemeChange}
									/>
									{#if group.id === 'response-preferences'}
										<ResponsePreferencesPreview {localConfig} />
									{/if}
								</section>
							{/if}
						{/each}

						{#if currentSection.title === SETTINGS_SECTION_TITLES.MCP}
							<section class="rounded-2xl border border-border bg-background p-4 lg:col-span-2">
								<McpServersSettings />
							</section>
						{/if}
					</div>
				{/if}
			</div>
		</ScrollArea>
		<div class="px-6 py-4">
			<div class="border-t border-border/30 pt-6">
				<p class="text-xs text-muted-foreground">{t('settings.savedInLocalStorage')}</p>
			</div>
		</div>
	</div>
</div>

<ChatSettingsFooter onReset={handleReset} onSave={handleSave} />

<AlertDialog.Root bind:open={settingsWarningDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title class="flex items-center gap-2">
				<AlertTriangle class="h-5 w-5 text-amber-500" />
				{settingsWarningDialogTitle}
			</AlertDialog.Title>
			<AlertDialog.Description>{settingsWarningDialogMessage}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Action onclick={() => (settingsWarningDialogOpen = false)}>
				{t('common.close')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	/* Use the existing row-fill renderer; fit columns to the actual panel width,
	   not the window (a tablet's settings panel is much narrower than its viewport). */
	section[data-settings-group='typography'] > :global(.grid) {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
	}
	section[data-settings-group='typography'] > :global(.grid > div) {
		min-width: 0;
	}
</style>
