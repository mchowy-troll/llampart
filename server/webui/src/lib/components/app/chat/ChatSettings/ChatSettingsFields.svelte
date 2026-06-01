<script lang="ts">
	import { RotateCcw, FlaskConical } from '@lucide/svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import Label from '$lib/components/ui/label/label.svelte';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { SETTING_CONFIG_INFO, SETTINGS_KEYS } from '$lib/constants';
	import { SettingsFieldType } from '$lib/enums/settings';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { serverStore } from '$lib/stores/server.svelte';
	import { modelsStore, selectedModelName } from '$lib/stores/models.svelte';
	import { normalizeFloatingPoint } from '$lib/utils/precision';
	import { ChatSettingsParameterSourceIndicator } from '$lib/components/app';
	import type { Component } from 'svelte';
	import { t } from '$lib/i18n';

	interface Props {
		fields: SettingsFieldConfig[];
		localConfig: SettingsConfigType;
		onConfigChange: (key: string, value: string | boolean) => void;
		onThemeChange?: (theme: string) => void;
	}

	let { fields, localConfig, onConfigChange, onThemeChange }: Props = $props();

	// server sampling defaults for placeholders
	let sp = $derived.by(() => {
		if (serverStore.isRouterMode) {
			const m = selectedModelName();
			if (m) {
				const p = modelsStore.getModelProps(m);
				return (p?.default_generation_settings?.params ?? {}) as Record<string, unknown>;
			}
		}
		return (serverStore.defaultParams ?? {}) as Record<string, unknown>;
	});

	const threeColumnModelGroupKeys = new Set([
		'temperature',
		'top_k',
		'top_p',
		'min_p',
		'typ_p',
		'max_tokens',
		'dynatemp_range',
		'dynatemp_exponent',
		'xtc_probability',
		'xtc_threshold',
		'samplers',
		'backend_sampling',
		'repeat_last_n',
		'repeat_penalty',
		'presence_penalty',
		'frequency_penalty',
		'dry_multiplier',
		'dry_base',
		'dry_allowed_length',
		'dry_penalty_last_n'
	]);

	const twoColumnGroupKeys = new Set([
		'serverBaseUrl',
		'apiKey',
		'showMessageStats',
		'keepStatsVisible',
		'showThoughtInProgress',
		'minimalAgenticIndicators',
		'renderUserContentAsMarkdown',
		'fullHeightCodeBlocks',
		'showRawModelNames',
		'disableAutoScroll',
		'disableReasoningParsing',
		'excludeReasoningFromContext',
		'showRawOutputSwitch',
		'copyTextAttachmentsAsPlainText',
		'pasteLongTextToFileLen',
		'pdfAsImage',
		'preEncodeConversation'
	]);

	const messageDisplayLeftColumnKeys = [
		SETTINGS_KEYS.SHOW_MESSAGE_STATS,
		SETTINGS_KEYS.SHOW_THOUGHT_IN_PROGRESS,
		SETTINGS_KEYS.MINIMAL_AGENTIC_INDICATORS,
		SETTINGS_KEYS.KEEP_STATS_VISIBLE
	];

	const messageDisplayRightColumnKeys = [
		SETTINGS_KEYS.RENDER_USER_CONTENT_AS_MARKDOWN,
		SETTINGS_KEYS.DISABLE_AUTO_SCROLL,
		SETTINGS_KEYS.FULL_HEIGHT_CODE_BLOCKS,
		SETTINGS_KEYS.SHOW_RAW_MODEL_NAMES
	];

	const messageDisplayFieldKeys = new Set([
		...messageDisplayLeftColumnKeys,
		...messageDisplayRightColumnKeys
	]);

	const compactInlineNumberKeys = new Set<string>();
	const compactPeerCheckboxKeys = new Set(['alwaysShowAgenticTurns', 'showToolCallInProgress']);
	const alignedMcpNumberKeys = new Set(['agenticMaxTurns', 'agenticMaxToolPreviewLines']);

	const isSidebarGroup = $derived(
		fields.length === 4 &&
			fields[0]?.key === SETTINGS_KEYS.ALWAYS_SHOW_SIDEBAR_ON_DESKTOP &&
			fields[1]?.key === SETTINGS_KEYS.AUTO_SHOW_SIDEBAR_ON_NEW_CHAT &&
			fields[2]?.key === SETTINGS_KEYS.SHOW_CONVERSATION_TIMESTAMPS &&
			fields[3]?.key === SETTINGS_KEYS.CONVERSATION_TIMESTAMP_FORMAT
	);

	const isThreeColumnModelGroup = $derived(
		fields.length > 1 && fields.every((field) => threeColumnModelGroupKeys.has(field.key))
	);

	const isTwoColumnGroup = $derived(
		fields.length > 0 && fields.every((field) => twoColumnGroupKeys.has(field.key))
	);

	const isMessageDisplayGroup = $derived(
		fields.length === messageDisplayFieldKeys.size &&
			fields.every((field) => messageDisplayFieldKeys.has(field.key))
	);

	const isAttachmentsFilesGroup = $derived(
		fields.length === 3 &&
			fields[0]?.key === SETTINGS_KEYS.COPY_TEXT_ATTACHMENTS_AS_PLAIN_TEXT &&
			fields[1]?.key === SETTINGS_KEYS.PASTE_LONG_TEXT_TO_FILE_LEN &&
			fields[2]?.key === SETTINGS_KEYS.PDF_AS_IMAGE
	);

	function getSettingInfo(fieldKey: string, fieldHelp?: string): string {
		if (fieldHelp) return fieldHelp;

		const info = SETTING_CONFIG_INFO[fieldKey];
		if (!info) return '';

		return info.startsWith('settings.') ? t(info) : info;
	}

	function getFieldsWrapperClass(): string {
		if (isThreeColumnModelGroup) {
			return 'grid gap-5 md:grid-cols-2 xl:grid-cols-3';
		}

		return isTwoColumnGroup ? 'grid gap-5 lg:grid-cols-2' : 'space-y-5';
	}

	function getFieldByKey(fieldKey: string): SettingsFieldConfig | undefined {
		return fields.find((field) => field.key === fieldKey);
	}

	function getFieldHelp(field: SettingsFieldConfig, helpOverride = '', hideHelp = false): string {
		if (hideHelp) return '';
		if (helpOverride) return helpOverride;

		return getSettingInfo(field.key, field.help);
	}

	function getFieldLabel(field: SettingsFieldConfig, labelOverride = ''): string {
		return labelOverride || field.label;
	}

	function getFieldContainerClass(extraClass = '', fieldKey = ''): string {
		if (compactInlineNumberKeys.has(fieldKey) || compactPeerCheckboxKeys.has(fieldKey)) {
			return ['grid grid-rows-[2rem_auto] gap-y-1', extraClass].filter(Boolean).join(' ');
		}

		if (alignedMcpNumberKeys.has(fieldKey)) {
			return ['grid grid-rows-[2rem_auto_auto] gap-y-1 pl-7', extraClass].filter(Boolean).join(' ');
		}

		return ['space-y-2', extraClass].filter(Boolean).join(' ');
	}

	function getHelpClass(fieldKey: string): string {
		return compactInlineNumberKeys.has(fieldKey) || alignedMcpNumberKeys.has(fieldKey)
			? 'w-full text-xs text-muted-foreground'
			: 'mt-1 w-full text-xs text-muted-foreground';
	}

	function getInputLabelRowClass(fieldKey: string): string {
		return alignedMcpNumberKeys.has(fieldKey)
			? 'flex h-8 items-center gap-2'
			: 'flex items-center gap-2';
	}

	function getInputLabelClass(fieldKey: string): string {
		return alignedMcpNumberKeys.has(fieldKey)
			? 'flex h-8 items-center gap-1.5 text-sm leading-8 font-medium'
			: 'flex items-center gap-1.5 text-sm font-medium';
	}

	function getInputWrapperClass(fieldKey: string): string {
		return compactInlineNumberKeys.has(fieldKey) ? 'relative w-16' : 'relative w-full';
	}

	function getInputClass(fieldKey: string, isCustomRealTime: boolean): string {
		return compactInlineNumberKeys.has(fieldKey)
			? 'h-7 w-16 -translate-y-0.5 text-center shadow-none'
			: [
					'w-full shadow-none focus-visible:border-input focus-visible:ring-0 focus-visible:ring-offset-0',
					isCustomRealTime ? 'pr-8' : ''
				]
					.filter(Boolean)
					.join(' ');
	}

	function getTextareaClass(fieldKey: string): string {
		return [
			fieldKey === SETTINGS_KEYS.SYSTEM_MESSAGE
				? 'min-h-[16rem] md:min-h-[20rem]'
				: 'min-h-[10rem]',
			'w-full shadow-none focus-visible:border-input focus-visible:ring-0 focus-visible:ring-offset-0'
		]
			.filter(Boolean)
			.join(' ');
	}
</script>

{#snippet renderField(
	field: SettingsFieldConfig,
	labelOverride = '',
	helpOverride = '',
	hideHelp = false,
	extraClass = ''
)}
	<div class={getFieldContainerClass(extraClass, field.key)}>
		{#if field.type === SettingsFieldType.INPUT}
			{@const currentValue = String(localConfig[field.key] ?? '')}
			{@const serverDefault = sp[field.key]}
			{@const isCustomRealTime = (() => {
				if (serverDefault == null) return false;
				if (currentValue === '') return false;

				const numericInput = parseFloat(currentValue);
				const normalizedInput = !isNaN(numericInput)
					? Math.round(numericInput * 1000000) / 1000000
					: currentValue;
				const normalizedDefault =
					typeof serverDefault === 'number'
						? Math.round(serverDefault * 1000000) / 1000000
						: serverDefault;

				return normalizedInput !== normalizedDefault;
			})()}

			{#if compactInlineNumberKeys.has(field.key)}
				<div class="flex h-8 items-end gap-2">
					<Label for={field.key} class="min-w-0 flex-1 text-sm leading-8 font-medium">
						{getFieldLabel(field, labelOverride)}

						{#if field.isExperimental}
							<FlaskConical class="inline h-3.5 w-3.5 text-muted-foreground" />
						{/if}
					</Label>

					<div class="relative w-16 flex-none">
						<Input
							id={field.key}
							value={currentValue}
							oninput={(e) => {
								onConfigChange(field.key, e.currentTarget.value);
							}}
							placeholder={sp[field.key] != null
								? `${t('settings.defaultPrefix')} ${normalizeFloatingPoint(sp[field.key])}`
								: ''}
							class="h-8 w-16 text-center"
						/>
						{#if isCustomRealTime}
							<button
								type="button"
								onclick={() => {
									settingsStore.resetParameterToServerDefault(field.key);
									onConfigChange(field.key, '');
								}}
								class="absolute top-1/2 right-1 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded transition-colors hover:bg-muted"
								aria-label={t('settings.resetToDefault')}
								title={t('settings.resetToDefault')}
							>
								<RotateCcw class="h-3 w-3" />
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<div class={getInputLabelRowClass(field.key)}>
					<Label for={field.key} class={getInputLabelClass(field.key)}>
						{getFieldLabel(field, labelOverride)}

						{#if field.isExperimental}
							<FlaskConical class="h-3.5 w-3.5 text-muted-foreground" />
						{/if}
					</Label>
					{#if isCustomRealTime}
						<ChatSettingsParameterSourceIndicator />
					{/if}
				</div>

				<div class={getInputWrapperClass(field.key)}>
					<Input
						id={field.key}
						value={currentValue}
						oninput={(e) => {
							onConfigChange(field.key, e.currentTarget.value);
						}}
						placeholder={sp[field.key] != null
							? `${t('settings.defaultPrefix')} ${normalizeFloatingPoint(sp[field.key])}`
							: ''}
						class={getInputClass(field.key, isCustomRealTime)}
					/>
					{#if isCustomRealTime}
						<button
							type="button"
							onclick={() => {
								settingsStore.resetParameterToServerDefault(field.key);
								onConfigChange(field.key, '');
							}}
							class="absolute top-1/2 right-2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded transition-colors hover:bg-muted"
							aria-label={t('settings.resetToDefault')}
							title={t('settings.resetToDefault')}
						>
							<RotateCcw class="h-3 w-3" />
						</button>
					{/if}
				</div>
			{/if}

			{@const help = getFieldHelp(field, helpOverride, hideHelp)}
			{#if help}
				<p class={getHelpClass(field.key)}>
					{@html help}
				</p>
			{/if}
		{:else if field.type === SettingsFieldType.TEXTAREA}
			<Label for={field.key} class="block flex items-center gap-1.5 text-sm font-medium">
				{getFieldLabel(field, labelOverride)}

				{#if field.isExperimental}
					<FlaskConical class="h-3.5 w-3.5 text-muted-foreground" />
				{/if}
			</Label>

			<Textarea
				id={field.key}
				value={String(localConfig[field.key] ?? '')}
				onchange={(e) => onConfigChange(field.key, e.currentTarget.value)}
				placeholder=""
				class={getTextareaClass(field.key)}
			/>

			{@const help = getFieldHelp(field, helpOverride, hideHelp)}
			{#if help}
				<p class="mt-1 text-xs text-muted-foreground">
					{@html help}
				</p>
			{/if}

			{#if field.key === SETTINGS_KEYS.SYSTEM_MESSAGE}
				<div class="mt-3 flex items-center gap-2">
					<Checkbox
						id="showSystemMessage"
						checked={Boolean(localConfig.showSystemMessage ?? true)}
						onCheckedChange={(checked) => onConfigChange('showSystemMessage', Boolean(checked))}
					/>

					<Label for="showSystemMessage" class="cursor-pointer text-sm font-normal">
						{t('settings.showSystemMessageInConversations')}
					</Label>
				</div>
			{/if}
		{:else if field.type === SettingsFieldType.SELECT}
			{@const selectedOption = field.options?.find(
				(opt: { value: string; label: string; icon?: Component }) =>
					opt.value === localConfig[field.key]
			)}
			{@const currentValue = localConfig[field.key]}
			{@const serverDefault = sp[field.key]}
			{@const isCustomRealTime = (() => {
				if (serverDefault == null) return false;
				if (currentValue === '' || currentValue === undefined) return false;
				return currentValue !== serverDefault;
			})()}

			<div class="flex items-center gap-2">
				<Label for={field.key} class="flex items-center gap-1.5 text-sm font-medium">
					{getFieldLabel(field, labelOverride)}

					{#if field.isExperimental}
						<FlaskConical class="h-3.5 w-3.5 text-muted-foreground" />
					{/if}
				</Label>
				{#if isCustomRealTime}
					<ChatSettingsParameterSourceIndicator />
				{/if}
			</div>

			<Select.Root
				type="single"
				value={currentValue}
				onValueChange={(value) => {
					if (field.key === SETTINGS_KEYS.THEME && value && onThemeChange) {
						onThemeChange(value);
					} else {
						onConfigChange(field.key, value);
					}
				}}
			>
				<div class="relative w-full">
					<Select.Trigger
						class="w-full shadow-none focus-visible:border-input focus-visible:ring-0 focus-visible:ring-offset-0"
					>
						<div class="flex items-center gap-2">
							{#if selectedOption?.icon}
								{@const IconComponent = selectedOption.icon}
								<IconComponent class="h-4 w-4" />
							{/if}

							{selectedOption?.label || t('settings.select')}
						</div>
					</Select.Trigger>
					{#if isCustomRealTime}
						<button
							type="button"
							onclick={() => {
								settingsStore.resetParameterToServerDefault(field.key);
								onConfigChange(field.key, '');
							}}
							class="absolute top-1/2 right-8 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded transition-colors hover:bg-muted"
							aria-label={t('settings.resetToDefault')}
							title={t('settings.resetToDefault')}
						>
							<RotateCcw class="h-3 w-3" />
						</button>
					{/if}
				</div>
				<Select.Content class="llampart-settings-select-content">
					{#if field.options}
						{#each field.options as option (option.value)}
							<Select.Item value={option.value} label={option.label}>
								<div class="flex items-center gap-2">
									{#if option.icon}
										{@const IconComponent = option.icon}
										<IconComponent class="h-4 w-4" />
									{/if}
									{option.label}
								</div>
							</Select.Item>
						{/each}
					{/if}
				</Select.Content>
			</Select.Root>
			{@const help = getFieldHelp(field, helpOverride, hideHelp)}
			{#if help}
				<p class="mt-1 text-xs text-muted-foreground">
					{@html help}
				</p>
			{/if}
		{:else if field.type === SettingsFieldType.CHECKBOX}
			{#if compactPeerCheckboxKeys.has(field.key)}
				<div class="flex h-8 items-end gap-3">
					<div class="flex h-8 items-center">
						<Checkbox
							id={field.key}
							checked={Boolean(localConfig[field.key])}
							onCheckedChange={(checked) => onConfigChange(field.key, Boolean(checked))}
						/>
					</div>

					<label
						for={field.key}
						class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-sm leading-8 font-medium"
					>
						{getFieldLabel(field, labelOverride)}

						{#if field.isExperimental}
							<FlaskConical class="h-3.5 w-3.5 text-muted-foreground" />
						{/if}
					</label>
				</div>

				{#if getFieldHelp(field, helpOverride, hideHelp)}
					<p class="ml-7 text-xs text-muted-foreground">
						{@html getFieldHelp(field, helpOverride, hideHelp)}
					</p>
				{/if}
			{:else}
				<div class="flex items-start space-x-3">
					<Checkbox
						id={field.key}
						checked={Boolean(localConfig[field.key])}
						onCheckedChange={(checked) => onConfigChange(field.key, Boolean(checked))}
						class="mt-1"
					/>

					<div class="min-w-0 space-y-1">
						<label
							for={field.key}
							class="flex min-w-0 cursor-pointer items-center gap-1.5 pt-1 pb-0.5 text-sm leading-none font-medium"
						>
							{getFieldLabel(field, labelOverride)}

							{#if field.isExperimental}
								<FlaskConical class="h-3.5 w-3.5 text-muted-foreground" />
							{/if}
						</label>

						{#if getFieldHelp(field, helpOverride, hideHelp)}
							<p class="max-w-full text-xs break-words text-muted-foreground">
								{@html getFieldHelp(field, helpOverride, hideHelp)}
							</p>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

{#if isSidebarGroup}
	<div class="space-y-5">
		{@render renderField(fields[0])}
		{@render renderField(fields[1])}

		<div class="space-y-4">
			{@render renderField(fields[2], '', t('settings.sidebarTimestampCombinedHelp'))}
			{@render renderField(
				fields[3],
				t('settings.fieldChooseConversationTimestampFormat'),
				'',
				true,
				'ml-[1.625rem]'
			)}
		</div>
	</div>
{:else if isMessageDisplayGroup}
	<div class="grid gap-x-5 gap-y-4 lg:grid-cols-2">
		<div class="space-y-4">
			{#each messageDisplayLeftColumnKeys as fieldKey (fieldKey)}
				{@const field = getFieldByKey(fieldKey)}
				{#if field}
					{@render renderField(field)}
				{/if}
			{/each}
		</div>

		<div class="space-y-4">
			{#each messageDisplayRightColumnKeys as fieldKey (fieldKey)}
				{@const field = getFieldByKey(fieldKey)}
				{#if field}
					{@render renderField(field)}
				{/if}
			{/each}
		</div>
	</div>
{:else if isAttachmentsFilesGroup}
	<div class="grid gap-x-5 gap-y-4 lg:grid-cols-2">
		<div class="space-y-4">
			{@render renderField(fields[0])}
			{@render renderField(fields[2])}
		</div>

		<div>
			{@render renderField(fields[1])}
		</div>
	</div>
{:else}
	<div class={getFieldsWrapperClass()}>
		{#each fields as field (field.key)}
			{@render renderField(field)}
		{/each}
	</div>
{/if}
