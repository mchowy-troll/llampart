<script lang="ts">
	import {
		Settings,
		Code,
		Monitor,
		ChevronLeft,
		ChevronRight,
		Database,
		MessageSquare,
		SlidersHorizontal,
		Wrench
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
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import {
		SETTINGS_SECTION_TITLES,
		type SettingsSectionTitle,
		NUMERIC_FIELDS,
		POSITIVE_INTEGER_FIELDS,
		SETTINGS_COLOR_MODES_CONFIG,
		SETTINGS_KEYS,
		getLocalizedTitleGenerationPrompt,
		isBuiltInTitleGenerationPrompt
	} from '$lib/constants';
	import { validateConnectionSettings } from '$lib/utils';
	import { setMode } from 'mode-watcher';
	import { ColorMode } from '$lib/enums/ui';
	import { SettingsFieldType } from '$lib/enums/settings';
	import type { Component } from 'svelte';
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
	const CONVERSATION_TIMESTAMP_FORMAT_OPTIONS = [
		{ value: 'ddmmyyyy24', label: '01.31.2026 20:00' },
		{ value: 'mmddyyyy12', label: '31.01.2026 08:00 p.m.' }
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

	type SettingsFieldGroup = {
		id: string;
		title?: string;
		description?: string;
		fields: SettingsFieldConfig[];
		fullWidth?: boolean;
		halfWidth?: boolean;
		framed?: boolean;
	};

	const settingSections: Array<{
		fields: SettingsFieldConfig[];
		groups?: SettingsFieldGroup[];
		icon: Component;
		title: SettingsSectionTitle;
	}> = [
		{
			title: SETTINGS_SECTION_TITLES.GENERAL,
			icon: Settings,
			fields: [],
			groups: [
				{
					id: 'connection',
					title: t('settings.groupConnection'),
					fields: [
						{
							key: SETTINGS_KEYS.SERVER_BASE_URL,
							label: t('settings.fieldServerAddress'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.API_KEY,
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
					halfWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.THEME,
							label: t('settings.fieldTheme'),
							type: SettingsFieldType.SELECT,
							options: THEME_OPTIONS
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
							key: SETTINGS_KEYS.SHOW_CONVERSATION_TIMESTAMPS,
							label: t('settings.fieldShowConversationTimestamps'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.CONVERSATION_TIMESTAMP_FORMAT,
							label: t('settings.fieldConversationTimestampFormat'),
							type: SettingsFieldType.SELECT,
							options: CONVERSATION_TIMESTAMP_FORMAT_OPTIONS
						}
					]
				},
				{
					id: 'message-display',
					title: t('settings.groupMessageDisplay'),
					fields: [
						{
							key: SETTINGS_KEYS.SHOW_MESSAGE_STATS,
							label: t('settings.fieldShowMessageGenerationStatistics'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_THOUGHT_IN_PROGRESS,
							label: t('settings.fieldShowThoughtInProgress'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.MINIMAL_AGENTIC_INDICATORS,
							label: t('settings.fieldMinimalAgenticIndicators'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.KEEP_STATS_VISIBLE,
							label: t('settings.fieldKeepStatsVisibleAfterGeneration'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.RENDER_USER_CONTENT_AS_MARKDOWN,
							label: t('settings.fieldRenderUserContentAsMarkdown'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.DISABLE_AUTO_SCROLL,
							label: t('settings.fieldDisableAutomaticScroll'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.FULL_HEIGHT_CODE_BLOCKS,
							label: t('settings.fieldUseFullHeightCodeBlocks'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.SHOW_RAW_MODEL_NAMES,
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
					halfWidth: true,
					fields: [
						{
							key: SETTINGS_KEYS.SEND_ON_ENTER,
							label: t('settings.fieldSendMessageOnEnter'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AUTO_MIC_ON_EMPTY,
							label: t('settings.fieldShowMicrophoneOnEmptyInput'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true
						}
					]
				},
				{
					id: 'conversation-titles',
					title: t('settings.groupConversationTitles'),
					fields: [
						{
							key: SETTINGS_KEYS.ASK_FOR_TITLE_CONFIRMATION,
							label: t('settings.fieldAskConfirmationBeforeChangingConversationTitle'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_USE_FIRST_LINE,
							label: t('settings.fieldUseFirstNonEmptyLineForConversationTitle'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_USE_LLM,
							label: t('settings.fieldUseLLMToGenerateConversationTitle'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true
						},
						{
							key: SETTINGS_KEYS.TITLE_GENERATION_PROMPT,
							label: t('settings.fieldLLMTitleGenerationPrompt'),
							type: SettingsFieldType.TEXTAREA
						}
					]
				},
				{
					id: 'attachments-files',
					title: t('settings.groupAttachmentsFiles'),
					fields: [
						{
							key: SETTINGS_KEYS.COPY_TEXT_ATTACHMENTS_AS_PLAIN_TEXT,
							label: t('settings.fieldCopyTextAttachmentsAsPlainText'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.PASTE_LONG_TEXT_TO_FILE_LEN,
							label: t('settings.fieldPasteLongTextToFileLength'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.PDF_AS_IMAGE,
							label: t('settings.fieldParsePdfAsImage'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				},
				{
					id: 'response-generation',
					title: t('settings.groupResponseGeneration'),
					fields: [
						{
							key: SETTINGS_KEYS.ENABLE_CONTINUE_GENERATION,
							label: t('settings.fieldEnableContinueButton'),
							type: SettingsFieldType.CHECKBOX,
							isExperimental: true
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
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.TOP_P,
							label: t('settings.fieldTopP'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.MIN_P,
							label: t('settings.fieldMinP'),
							type: SettingsFieldType.INPUT
						},
						{
							key: SETTINGS_KEYS.TYP_P,
							label: t('settings.fieldTypicalP'),
							type: SettingsFieldType.INPUT
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
					title: t('settings.groupDynamicTemperature'),
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
					title: t('settings.groupXtc'),
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
					title: t('settings.groupSamplerOrder'),
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
					title: t('settings.groupRepetition'),
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
					title: t('settings.groupDryPenalty'),
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
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AGENTIC_MAX_TURNS,
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
							label: t('settings.fieldShowToolCallInProgress'),
							type: SettingsFieldType.CHECKBOX
						},
						{
							key: SETTINGS_KEYS.AGENTIC_MAX_TOOL_PREVIEW_LINES,
							label: t('settings.fieldMaxLinesPerToolPreview'),
							type: SettingsFieldType.INPUT
						}
					]
				}
			]
		},
		{
			title: SETTINGS_SECTION_TITLES.TOOLS,
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
						},
						{
							key: SETTINGS_KEYS.SHOW_RAW_OUTPUT_SWITCH,
							label: t('settings.fieldEnableRawOutputToggle'),
							type: SettingsFieldType.CHECKBOX
						}
					]
				},
				{
					id: 'performance-cache',
					title: t('settings.groupPerformanceCache'),
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
	let currentSection = $derived(
		settingSections.find((section) => section.title === activeSection) || settingSections[0]
	);
	let localConfig: SettingsConfigType = $state({ ...config() });

	function syncLocalizedTitleGenerationPrompt(language: unknown, value: unknown) {
		const currentPrompt = String(value ?? '');
		const localizedPrompt = getLocalizedTitleGenerationPrompt(String(language || 'en'));

		if (
			currentPrompt !== localizedPrompt &&
			(!currentPrompt.trim() || isBuiltInTitleGenerationPrompt(currentPrompt))
		) {
			localConfig.titleGenerationPrompt = localizedPrompt;
		}
	}

	let canScrollLeft = $state(false);
	let canScrollRight = $state(false);
	let scrollContainer: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (initialSection) {
			activeSection = initialSection;
		}
	});

	// llampart-localized-title-generation-prompt
	$effect(() => {
		syncLocalizedTitleGenerationPrompt(
			localConfig.interfaceLanguage,
			localConfig.titleGenerationPrompt
		);
	});

	function getCurrentGroups(): SettingsFieldGroup[] {
		if (currentSection.groups?.length) {
			return currentSection.groups;
		}

		if (!currentSection.fields.length) {
			return [];
		}

		return [
			{
				id: `${currentSection.title}-fields`,
				fields: currentSection.fields,
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

	async function handleSave() {
		if (localConfig.custom && typeof localConfig.custom === 'string' && localConfig.custom.trim()) {
			try {
				JSON.parse(localConfig.custom);
			} catch (error) {
				alert(t('settings.invalidJsonCustomParameters'));
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
					alert(
						`${t('settings.invalidNumericValueFor')} ${field}. ${t('settings.enterValidNumber')}`
					);
					return;
				}
			}
		}

		const connectionValidation = await validateConnectionSettings(
			String(processedConfig.serverBaseUrl || ''),
			String(processedConfig.apiKey || '')
		);

		if (!connectionValidation.ok) {
			alert(connectionValidation.errorMessage || t('settings.invalidServerConnectionSettings'));
			return;
		}

		settingsStore.updateMultipleConfig(processedConfig);
		setMode(getModeWatcherColorMode(String(processedConfig.theme)));
		onSave?.();
	}

	function scrollToCenter(element: HTMLElement) {
		if (!scrollContainer) return;

		const containerRect = scrollContainer.getBoundingClientRect();
		const elementRect = element.getBoundingClientRect();

		const elementCenter = elementRect.left + elementRect.width / 2;
		const containerCenter = containerRect.left + containerRect.width / 2;
		const scrollOffset = elementCenter - containerCenter;

		scrollContainer.scrollBy({ left: scrollOffset, behavior: 'smooth' });
	}

	function scrollLeft() {
		if (!scrollContainer) return;

		scrollContainer.scrollBy({ left: -250, behavior: 'smooth' });
	}

	function scrollRight() {
		if (!scrollContainer) return;

		scrollContainer.scrollBy({ left: 250, behavior: 'smooth' });
	}

	function updateScrollButtons() {
		if (!scrollContainer) return;

		const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
		canScrollLeft = scrollLeft > 0;
		canScrollRight = scrollLeft < scrollWidth - clientWidth - 1; // -1 for rounding
	}

	export function reset() {
		localConfig = { ...config() };

		setTimeout(updateScrollButtons, 100);
	}

	$effect(() => {
		if (scrollContainer) {
			updateScrollButtons();
		}
	});
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
	<!-- Desktop Sidebar -->
	<div class="hidden w-60 shrink-0 border-r border-border/30 p-5 md:block lg:w-64">
		<nav class="space-y-1 py-2">
			{#each settingSections as section (section.title)}
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

	<!-- Mobile Header with Horizontal Scrollable Menu -->
	<div class="flex flex-col pt-6 md:hidden">
		<div class="border-b border-border/30 pt-4 md:py-4">
			<!-- Horizontal Scrollable Category Menu with Navigation -->
			<div class="relative flex items-center" style="scroll-padding: 1rem;">
				<button
					class="absolute left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-muted shadow-md backdrop-blur-sm transition-opacity hover:bg-accent {canScrollLeft
						? 'opacity-100'
						: 'pointer-events-none opacity-0'}"
					onclick={scrollLeft}
					aria-label={t('settings.scrollLeft')}
				>
					<ChevronLeft class="h-4 w-4" />
				</button>

				<div
					class="scrollbar-hide overflow-x-auto py-2"
					bind:this={scrollContainer}
					onscroll={updateScrollButtons}
				>
					<div class="flex min-w-max gap-2">
						{#each settingSections as section (section.title)}
							<button
								class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors first:ml-4 last:mr-4 hover:bg-accent {activeSection ===
								section.title
									? 'bg-accent text-accent-foreground'
									: 'text-muted-foreground'}"
								onclick={(e: MouseEvent) => {
									activeSection = section.title;
									scrollToCenter(e.currentTarget as HTMLElement);
								}}
							>
								<section.icon class="h-4 w-4 flex-shrink-0" />
								<span>{getSectionLabel(section.title)}</span>
							</button>
						{/each}
					</div>
				</div>

				<button
					class="absolute right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-muted shadow-md backdrop-blur-sm transition-opacity hover:bg-accent {canScrollRight
						? 'opacity-100'
						: 'pointer-events-none opacity-0'}"
					onclick={scrollRight}
					aria-label={t('settings.scrollRight')}
				>
					<ChevronRight class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		<ScrollArea class="min-h-0 flex-1">
			<div class="flex min-h-full flex-col gap-6 p-4 md:p-6">
				<div class="mb-6 hidden items-center gap-2 border-b border-border/30 pb-6 md:flex">
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
		<div class="px-4 py-4 md:px-6">
			<div class="border-t border-border/30 pt-6">
				<p class="text-xs text-muted-foreground">{t('settings.savedInLocalStorage')}</p>
			</div>
		</div>
	</div>
</div>

<ChatSettingsFooter onReset={handleReset} onSave={handleSave} />
