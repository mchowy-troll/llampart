<script lang="ts">
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
	import {
		ChatSettingsFooter,
		ChatSettingsImportExportTab,
		ChatSettingsToolsTab,
		ChatSettingsFrostedGlassWallpaper,
		ChatSettingsFields,
		McpLogo,
		McpServersSettings
	} from '$lib/components/app';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import {
		SETTINGS_SECTION_TITLES,
		type SettingsSectionTitle,
		NUMERIC_FIELDS,
		POSITIVE_INTEGER_FIELDS,
		SETTINGS_COLOR_MODES_CONFIG,
		SETTINGS_KEYS,
		API_PROVIDER_OPTIONS,
		PROVIDER_CONNECTION_SETTING_KEYS
	} from '$lib/constants';
	import { validateConnectionSettings } from '$lib/utils';
	import { getApiProviderCapabilities } from '$lib/services/providers';
	import {
		API_PROVIDER_IDS,
		isApiProviderId,
		type ApiProviderId
	} from '$lib/constants/api-providers';
	import { setMode } from 'mode-watcher';
	import { ColorMode } from '$lib/enums/ui';
	import { SettingsFieldType } from '$lib/enums/settings';
	import type { Component } from 'svelte';
	import type { ProviderCapabilityKey } from '$lib/types/provider';
	import { t } from '$lib/i18n';

	interface Props {
		onSave?: () => void;
		initialSection?: SettingsSectionTitle;
	}

	let { onSave, initialSection }: Props = $props();
	const INTERFACE_LANGUAGE_OPTIONS = [
		{ value: 'en', label: 'English' },
		{ value: 'pl', label: 'Polski' },
		{ value: 'de', label: 'Deutsch' },
		{ value: 'fr', label: 'Français' },
		{ value: 'it', label: 'Italiano' },
		{ value: 'es', label: 'Español' }
	];
	function getThemeLabel(theme: ColorMode): string {
		switch (theme) {
			case ColorMode.SYSTEM:
				return t('settings.themeSystem');
			case ColorMode.LIGHT:
				return t('settings.themeLight');
			case ColorMode.DARK:
				return t('settings.themeDark');
			case ColorMode.FROSTED_GLASS:
				return t('settings.themeFrostedGlass');
		}
	}

	type ModeWatcherColorMode = 'system' | 'light' | 'dark';

	function getModeWatcherColorMode(theme: string): ModeWatcherColorMode {
		return theme === ColorMode.FROSTED_GLASS ? ColorMode.LIGHT : (theme as ModeWatcherColorMode);
	}

	const THEME_OPTIONS = SETTINGS_COLOR_MODES_CONFIG.map((option) => ({
		...option,
		label: getThemeLabel(option.value)
	}));
	const API_PROVIDER_SELECT_OPTIONS = API_PROVIDER_OPTIONS.map((option) => ({ ...option }));

	const UI_SCALE_OPTIONS = [
		{ value: '90', label: '90%' },
		{ value: '100', label: '100%' },
		{ value: '110', label: '110%' }
	];

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

	const settingSections: SettingsSectionConfig[] = [
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
							label: t('settings.fieldApiProvider'),
							type: SettingsFieldType.SELECT,
							options: API_PROVIDER_SELECT_OPTIONS
						},
						{
							key: SETTINGS_KEYS.SERVER_BASE_URL,
							label: t('settings.fieldServerAddress'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.API_KEY,
							label: t('settings.fieldApiKey'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DISABLE_OPENAI_COMPATIBLE_TOOLS,
							label: t('settings.fieldDisableOpenAiCompatibleTools'),
							type: SettingsFieldType.CHECKBOX,
							visibleForProviders: [API_PROVIDER_IDS.OPENAI_COMPATIBLE]
						}
					]
				},
				{
					id: 'system-message',
					title: t('settings.groupSystemMessage'),
					fields: [
						{
							key: SETTINGS_KEYS.SYSTEM_MESSAGE,
							label: t('settings.fieldSystemMessage'),
							type: SettingsFieldType.TEXTAREA
						}
					],
					fullWidth: true
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
					layout: 'two-column',
					halfWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.THEME,
							label: t('settings.fieldTheme'),
							type: SettingsFieldType.SELECT,
							options: THEME_OPTIONS
						},
						{
							key: SETTINGS_KEYS.UI_SCALE,
							label: t('settings.fieldUiScale'),
							type: SettingsFieldType.SELECT,
							options: UI_SCALE_OPTIONS
						},
						{
							key: SETTINGS_KEYS.INTERFACE_LANGUAGE,
							label: t('settings.fieldInterfaceLanguage'),
							type: SettingsFieldType.SELECT,
							options: INTERFACE_LANGUAGE_OPTIONS
						}
					]
				},
				{
					id: 'sidebar',
					title: t('settings.groupSidebar'),
					halfWidth: true,
					layout: 'sidebar',
					fields: [
						{
							key: SETTINGS_KEYS.ALWAYS_SHOW_SIDEBAR_ON_DESKTOP,
							label: t('settings.fieldAlwaysShowSidebarOnDesktop'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AUTO_SHOW_SIDEBAR_ON_NEW_CHAT,
							label: t('settings.fieldAutoShowSidebarOnNewChat'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.COMPACT_SIDEBAR,
							label: t('settings.fieldCompactSidebar'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_CONVERSATION_TIMESTAMPS,
							label: t('settings.fieldShowConversationTimestamps'),
							type: SettingsFieldType.CHECKBOX,
							help: t('settings.sidebarTimestampCombinedHelp'),
							cluster: 'sidebar-timestamp'
						},
						{
							key: SETTINGS_KEYS.CONVERSATION_TIMESTAMP_FORMAT,
							label: t('settings.fieldChooseConversationTimestampFormat'),
							type: SettingsFieldType.SELECT,
							layout: 'sidebar-nested',
							cluster: 'sidebar-timestamp',
							hideHelp: true,
							options: CONVERSATION_TIMESTAMP_FORMAT_OPTIONS
						}
					]
				},
				{
					id: 'message-display',
					title: t('settings.groupMessageDisplay'),
					layout: 'message-display',
					fields: [
						{
							key: SETTINGS_KEYS.SHOW_MESSAGE_STATS,
							label: t('settings.fieldShowMessageGenerationStatistics'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.SHOW_THOUGHT_IN_PROGRESS,
							label: t('settings.fieldShowThoughtInProgress'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.MINIMAL_AGENTIC_INDICATORS,
							label: t('settings.fieldMinimalAgenticIndicators'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.KEEP_STATS_VISIBLE,
							label: t('settings.fieldKeepStatsVisibleAfterGeneration'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.RENDER_USER_CONTENT_AS_MARKDOWN,
							label: t('settings.fieldRenderUserContentAsMarkdown'),
							type: SettingsFieldType.CHECKBOX,
							column: 'right'
						},
						{
							key: SETTINGS_KEYS.RENDER_REASONING_CONTENT_AS_MARKDOWN,
							label: t('settings.fieldRenderReasoningContentAsMarkdown'),
							type: SettingsFieldType.CHECKBOX,
							column: 'right'
						},
						{
							key: SETTINGS_KEYS.DISABLE_AUTO_SCROLL,
							label: t('settings.fieldDisableAutomaticScroll'),
							type: SettingsFieldType.CHECKBOX,
							column: 'right'
						},
						{
							key: SETTINGS_KEYS.FULL_HEIGHT_CODE_BLOCKS,
							label: t('settings.fieldUseFullHeightCodeBlocks'),
							type: SettingsFieldType.CHECKBOX,
							column: 'right'
						},
						{
							key: SETTINGS_KEYS.SHOW_RAW_MODEL_NAMES,
							label: t('settings.fieldShowRawModelNames'),
							type: SettingsFieldType.CHECKBOX,
							column: 'right'
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
							label: t('settings.fieldSendMessageOnEnter'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.AUTO_MIC_ON_EMPTY,
							label: t('settings.fieldShowMicrophoneOnEmptyInput'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true,
							column: 'right'
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
							key: SETTINGS_KEYS.ASK_FOR_TITLE_CONFIRMATION,
							label: t('settings.fieldAskConfirmationBeforeChangingConversationTitle'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_USE_FIRST_LINE,
							label: t('settings.fieldUseFirstNonEmptyLineForConversationTitle'),
							type: SettingsFieldType.CHECKBOX,
							column: 'right'
						},
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_USE_LLM,
							label: t('settings.fieldUseLLMToGenerateConversationTitle'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true,
							column: 'left'
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
							label: t('settings.fieldCopyTextAttachmentsAsPlainText'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
						},
						{
							key: SETTINGS_KEYS.PASTE_LONG_TEXT_TO_FILE_LEN,
							label: t('settings.fieldPasteLongTextToFileLength'),
							type: SettingsFieldType.INPUT,
							column: 'right'
						},
						{
							key: SETTINGS_KEYS.PDF_AS_IMAGE,
							label: t('settings.fieldParsePdfAsImage'),
							type: SettingsFieldType.CHECKBOX,
							column: 'left'
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
							label: t('settings.fieldTemperature'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.TOP_K,
							label: t('settings.fieldTopK'),
							type: SettingsFieldType.INPUT,
							requiredProviderCapabilities: ['supportsTopK']
						},
						{
							key: SETTINGS_KEYS.TOP_P,
							label: t('settings.fieldTopP'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.MIN_P,
							label: t('settings.fieldMinP'),
							type: SettingsFieldType.INPUT,
							requiredProviderCapabilities: ['supportsMinP']
						},
						{
							key: SETTINGS_KEYS.TYP_P,
							label: t('settings.fieldTypicalP'),
							type: SettingsFieldType.INPUT,
							requiredProviderCapabilities: ['supportsTypicalP']
						},
						{
							key: SETTINGS_KEYS.MAX_TOKENS,
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
							label: t('settings.fieldDynamicTemperatureRange'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DYNATEMP_EXPONENT,
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
							label: t('settings.fieldXtcProbability'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.XTC_THRESHOLD,
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
							label: t('settings.fieldSamplers'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.BACKEND_SAMPLING,
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
							label: t('settings.fieldRepeatLastN'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.REPEAT_PENALTY,
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
							label: t('settings.fieldPresencePenalty'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.FREQUENCY_PENALTY,
							label: t('settings.fieldFrequencyPenalty'),
							type: SettingsFieldType.INPUT
						}
					]
				},
				{
					id: 'dry-penalty',
					layout: 'three-column',
					title: t('settings.groupDryPenalty'),
					requiredProviderCapabilities: ['supportsDryPenalty'],
					fields: [
						{
							key: SETTINGS_KEYS.DRY_MULTIPLIER,
							label: t('settings.fieldDryMultiplier'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DRY_BASE,
							label: t('settings.fieldDryBase'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DRY_ALLOWED_LENGTH,
							label: t('settings.fieldDryAllowedLength'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.DRY_PENALTY_LAST_N,
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
							label: t('settings.fieldAlwaysShowAgenticTurnsInConversation'),
							type: SettingsFieldType.CHECKBOX,
							layout: 'compact-peer-checkbox'
						},
						{
							key: SETTINGS_KEYS.AGENTIC_MAX_TURNS,
							label: t('settings.fieldAgenticLoopMaxTurns'),
							type: SettingsFieldType.INPUT,
							layout: 'aligned-mcp-number'
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
							label: t('settings.fieldShowToolCallInProgress'),
							type: SettingsFieldType.CHECKBOX,
							layout: 'compact-peer-checkbox'
						},
						{
							key: SETTINGS_KEYS.AGENTIC_MAX_TOOL_PREVIEW_LINES,
							label: t('settings.fieldMaxLinesPerToolPreview'),
							type: SettingsFieldType.INPUT,
							layout: 'aligned-mcp-number'
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
					requiredProviderCapabilities: ['supportsLlamaReasoningControls'],
					title: t('settings.groupReasoning'),
					layout: 'two-column',
					fields: [
						{
							key: SETTINGS_KEYS.DISABLE_REASONING_PARSING,
							label: t('settings.fieldDisableServerSideThinkingExtraction'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.EXCLUDE_REASONING_FROM_CONTEXT,
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
							label: t('settings.fieldCustomJson'),
							type: SettingsFieldType.TEXTAREA
						}
					],
					fullWidth: true
				}
			]
		}
	];

	let activeSection = $derived<SettingsSectionTitle>(
		initialSection ?? SETTINGS_SECTION_TITLES.GENERAL
	);
	let localConfig: SettingsConfigType = $state({ ...config() });
	let activeConnectionKeys = $derived(getConnectionKeys(localConfig.apiProvider));
	let providerCapabilities = $derived(
		getApiProviderCapabilities(String(localConfig.apiProvider ?? ''), localConfig)
	);
	let settingsWarningDialogOpen = $state(false);
	let settingsWarningDialogTitle = $state('');
	let settingsWarningDialogMessage = $state('');

	function supportsRequiredCapabilities(capabilities?: ProviderCapabilityKey[]): boolean {
		return (
			!capabilities || capabilities.every((capability) => providerCapabilities[capability] === true)
		);
	}

	function supportsVisibleForProviders(providers?: ApiProviderId[]): boolean {
		return !providers || providers.includes(normalizeProviderId(localConfig.apiProvider));
	}

	function getProviderScopedField(field: SettingsFieldConfig): SettingsFieldConfig {
		if (field.key === SETTINGS_KEYS.SERVER_BASE_URL) {
			return { ...field, key: activeConnectionKeys.serverBaseUrl };
		}

		if (field.key === SETTINGS_KEYS.API_KEY) {
			return { ...field, key: activeConnectionKeys.apiKey };
		}

		return field;
	}

	function getVisibleFields(fields: SettingsFieldConfig[]): SettingsFieldConfig[] {
		return fields
			.filter((field) => supportsVisibleForProviders(field.visibleForProviders))
			.filter((field) => supportsRequiredCapabilities(field.requiredProviderCapabilities))
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
		localConfig.theme = newTheme;
	}

	function handleConfigChange(key: string, value: string | boolean) {
		const nextConfig = { ...localConfig, [key]: value };

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
	}

	function handleReset() {
		localConfig = { ...config() };

		setMode(getModeWatcherColorMode(String(config().theme)));
	}

	function showSettingsWarning(
		message: string,
		title = t('settings.settingsValidationDialogTitle')
	) {
		settingsWarningDialogTitle = title;
		settingsWarningDialogMessage = message;
		settingsWarningDialogOpen = true;
	}

	async function handleSave() {
		if (localConfig.custom && typeof localConfig.custom === 'string' && localConfig.custom.trim()) {
			try {
				JSON.parse(localConfig.custom);
			} catch (error) {
				showSettingsWarning(t('settings.invalidJsonCustomParameters'));
				console.error(error);
				return;
			}
		}

		// Convert numeric strings to numbers for numeric fields
		const processedConfig = { ...localConfig };

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

		const providerConnectionKeys = getConnectionKeys(processedConfig.apiProvider);
		processedConfig[SETTINGS_KEYS.SERVER_BASE_URL] =
			processedConfig[providerConnectionKeys.serverBaseUrl] ?? '';
		processedConfig[SETTINGS_KEYS.API_KEY] = processedConfig[providerConnectionKeys.apiKey] ?? '';

		const connectionValidation = await validateConnectionSettings(
			String(processedConfig[providerConnectionKeys.serverBaseUrl] || ''),
			String(processedConfig[providerConnectionKeys.apiKey] || ''),
			String(processedConfig.apiProvider || '')
		);

		if (!connectionValidation.ok) {
			showSettingsWarning(
				connectionValidation.errorMessage || t('settings.invalidServerConnectionSettings'),
				t('settings.connectionValidationDialogTitle')
			);
			return;
		}

		settingsStore.updateMultipleConfig(processedConfig);
		setMode(getModeWatcherColorMode(String(processedConfig.theme)));
		onSave?.();
	}

	export function reset() {
		localConfig = { ...config() };
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
							{#if currentSection.title === SETTINGS_SECTION_TITLES.APPEARANCE && group.id === 'message-display' && localConfig.theme === ColorMode.FROSTED_GLASS}
								<section class="rounded-2xl border border-border bg-background p-4 lg:col-span-2">
									<div
										class="mb-5 flex items-start justify-between gap-4 border-b border-border/30 pb-4"
										data-llampart-wallpaper-softening-header
									>
										<div class="min-w-0">
											<h3 class="text-sm font-semibold">
												{t('settings.groupFrostedGlassWallpaper')}
											</h3>
											<p class="mt-1 text-sm text-muted-foreground">
												{t('settings.frostedGlassWallpaperDescription')}
											</p>
										</div>

										<label
											class="mt-0.5 inline-flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
										>
											<input
												type="checkbox"
												class="size-4 shrink-0 accent-foreground"
												checked={Boolean(localConfig.frostedGlassWallpaperMilky)}
												onchange={(event) => {
													const input = event.currentTarget;

													if (input instanceof HTMLInputElement) {
														handleConfigChange(
															SETTINGS_KEYS.FROSTED_GLASS_WALLPAPER_MILKY,
															input.checked
														);
													}
												}}
											/>
											<span class="font-medium whitespace-nowrap">
												{t('settings.frostedGlassWallpaperMilk')}
											</span>
										</label>
									</div>

									<ChatSettingsFrostedGlassWallpaper
										selectedWallpaper={String(localConfig.frostedGlassWallpaper ?? '')}
										onWallpaperChange={(value) =>
											handleConfigChange(SETTINGS_KEYS.FROSTED_GLASS_WALLPAPER, value)}
									/>
								</section>
							{/if}

							{@const groupSpanClass = group.halfWidth ? '' : 'lg:col-span-2'}
							{#if group.framed === false}
								<div class={groupSpanClass}>
									<ChatSettingsFields
										fields={group.fields}
										layout={group.layout}
										{localConfig}
										onConfigChange={handleConfigChange}
										onThemeChange={handleThemeChange}
									/>
								</div>
							{:else}
								<section
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
										{localConfig}
										onConfigChange={handleConfigChange}
										onThemeChange={handleThemeChange}
									/>
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
