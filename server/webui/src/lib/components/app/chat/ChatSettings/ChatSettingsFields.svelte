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

	/**
	 * Renders settings from declarative group and field metadata.
	 * Layout decisions should come from explicit layout hints, not from detecting specific setting keys.
	 */
	interface Props {
		fields: SettingsFieldConfig[];
		layout?: SettingsFieldGroupLayout;
		localConfig: SettingsConfigType;
		onConfigChange: (key: string, value: string | boolean) => void;
		onThemeChange?: (theme: string) => void;
	}

	let { fields, layout = 'default', localConfig, onConfigChange, onThemeChange }: Props = $props();

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

	const isSidebarGroup = $derived(layout === 'sidebar');
	const isThreeColumnModelGroup = $derived(layout === 'three-column');
	const isTwoColumnGroup = $derived(layout === 'two-column');
	const isAttachmentsFilesGroup = $derived(layout === 'attachments-files');
	const isMultiColumnGroup = $derived(
		isTwoColumnGroup || isThreeColumnModelGroup || isAttachmentsFilesGroup
	);
	const orderedFields = $derived.by(() => getOrderedFields(fields));
	const multiColumnFields = $derived.by(() =>
		distributeFieldsIntoColumns(orderedFields, getMultiColumnCount())
	);
	const fieldsWithoutCluster = $derived.by(() => getFieldsWithoutCluster());
	const sidebarTimestampFields = $derived.by(() => getFieldsByCluster('sidebar-timestamp'));

	/**
	 * Field layout helpers keep compact variants named and reusable across the template.
	 * Avoid adding one-off key checks here; prefer SettingsFieldConfig.layout for new cases.
	 */
	function hasFieldLayout(field: SettingsFieldConfig, fieldLayout: SettingsFieldLayout): boolean {
		return field.layout === fieldLayout;
	}

	function isCompactInlineNumberField(field: SettingsFieldConfig): boolean {
		return hasFieldLayout(field, 'compact-inline-number');
	}

	function getSettingInfo(fieldKey: string, fieldHelp?: string): string {
		if (fieldHelp) return fieldHelp;

		const info = SETTING_CONFIG_INFO[fieldKey];
		if (!info) return '';

		return info.startsWith('settings.') ? t(info) : info;
	}

	function getFieldsWrapperClass(): string {
		return 'space-y-5';
	}

	function getOrderedFields(inputFields: SettingsFieldConfig[]): SettingsFieldConfig[] {
		return [...inputFields].sort((left, right) => left.order - right.order);
	}

	function getMultiColumnCount(): number {
		if (isThreeColumnModelGroup) return 3;
		if (isTwoColumnGroup || isAttachmentsFilesGroup) return 2;

		return 1;
	}

	function getMultiColumnWrapperClass(): string {
		return isThreeColumnModelGroup
			? 'grid gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-3'
			: 'grid gap-x-5 gap-y-4 lg:grid-cols-2';
	}

	function distributeFieldsIntoColumns(
		inputFields: SettingsFieldConfig[],
		columnCount: number
	): SettingsFieldConfig[][] {
		if (inputFields.length === 0) return [];

		const effectiveColumnCount = Math.max(1, Math.min(columnCount, inputFields.length));
		const chunkSize = Math.ceil(inputFields.length / effectiveColumnCount);

		return Array.from({ length: effectiveColumnCount }, (_, columnIndex) => {
			const start = columnIndex * chunkSize;
			return inputFields.slice(start, start + chunkSize);
		}).filter((columnFields) => columnFields.length > 0);
	}

	function getFieldsWithoutCluster(): SettingsFieldConfig[] {
		return orderedFields.filter((field) => !field.cluster);
	}

	function getFieldsByCluster(cluster: SettingsFieldCluster): SettingsFieldConfig[] {
		return orderedFields.filter((field) => field.cluster === cluster);
	}

	function isDependentFieldAfterCheckbox(
		inputFields: SettingsFieldConfig[],
		fieldIndex: number
	): boolean {
		if (fieldIndex <= 0) return false;

		const field = inputFields[fieldIndex];
		const previousField = inputFields[fieldIndex - 1];

		return (
			field.type !== SettingsFieldType.CHECKBOX && previousField.type === SettingsFieldType.CHECKBOX
		);
	}

	function getFieldHelp(field: SettingsFieldConfig, helpOverride = '', hideHelp = false): string {
		if (hideHelp || field.hideHelp) return '';
		if (helpOverride) return helpOverride;

		return getSettingInfo(field.key, field.help);
	}

	function getFieldLabel(field: SettingsFieldConfig, labelOverride = ''): string {
		return labelOverride || field.label;
	}

	function getFieldContainerClass(
		extraClass = '',
		field?: SettingsFieldConfig,
		isDependentOnCheckbox = false
	): string {
		if (field && isCompactInlineNumberField(field)) {
			return ['grid grid-rows-[2rem_auto] gap-y-1', extraClass].filter(Boolean).join(' ');
		}

		if (field && isDependentOnCheckbox) {
			return ['grid grid-rows-[2rem_auto_auto] gap-y-1 pl-7', extraClass].filter(Boolean).join(' ');
		}

		return ['space-y-2', extraClass].filter(Boolean).join(' ');
	}

	function getHelpClass(field: SettingsFieldConfig, isDependentOnCheckbox = false): string {
		return isCompactInlineNumberField(field) || isDependentOnCheckbox
			? 'w-full whitespace-pre-line text-xs text-muted-foreground'
			: 'mt-1 w-full whitespace-pre-line text-xs text-muted-foreground';
	}

	function getInputLabelRowClass(
		_field: SettingsFieldConfig,
		isDependentOnCheckbox = false
	): string {
		return isDependentOnCheckbox ? 'flex h-8 items-center gap-2' : 'flex items-center gap-2';
	}

	function getInputLabelClass(_field: SettingsFieldConfig, isDependentOnCheckbox = false): string {
		return isDependentOnCheckbox
			? 'flex h-8 items-center gap-1.5 text-sm leading-8 font-medium'
			: 'flex items-center gap-1.5 text-sm font-medium';
	}

	function getInputWrapperClass(field: SettingsFieldConfig): string {
		return isCompactInlineNumberField(field) ? 'relative w-16' : 'relative w-full';
	}

	function getInputClass(field: SettingsFieldConfig, isCustomRealTime: boolean): string {
		return isCompactInlineNumberField(field)
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
	extraClass = '',
	isDependentOnCheckbox = false
)}
	<div class={getFieldContainerClass(extraClass, field, isDependentOnCheckbox)}>
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

			{#if isCompactInlineNumberField(field)}
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
				<div class={getInputLabelRowClass(field, isDependentOnCheckbox)}>
					<Label for={field.key} class={getInputLabelClass(field, isDependentOnCheckbox)}>
						{getFieldLabel(field, labelOverride)}

						{#if field.isExperimental}
							<FlaskConical class="h-3.5 w-3.5 text-muted-foreground" />
						{/if}
					</Label>
					{#if isCustomRealTime}
						<ChatSettingsParameterSourceIndicator />
					{/if}
				</div>

				<div class={getInputWrapperClass(field)}>
					<Input
						id={field.key}
						value={currentValue}
						oninput={(e) => {
							onConfigChange(field.key, e.currentTarget.value);
						}}
						placeholder={sp[field.key] != null
							? `${t('settings.defaultPrefix')} ${normalizeFloatingPoint(sp[field.key])}`
							: ''}
						class={getInputClass(field, isCustomRealTime)}
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
				<p class={getHelpClass(field, isDependentOnCheckbox)}>
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
				<p class={getHelpClass(field, isDependentOnCheckbox)}>
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

			<div class={getInputLabelRowClass(field, isDependentOnCheckbox)}>
				<Label for={field.key} class={getInputLabelClass(field, isDependentOnCheckbox)}>
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
				<p class={getHelpClass(field, isDependentOnCheckbox)}>
					{@html help}
				</p>
			{/if}
		{:else if field.type === SettingsFieldType.CHECKBOX}
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
						<p class="max-w-full whitespace-pre-line text-xs break-words text-muted-foreground">
							{@html getFieldHelp(field, helpOverride, hideHelp)}
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#if isSidebarGroup}
	<div class="grid gap-x-5 gap-y-4 lg:grid-cols-2">
		<div class="space-y-4">
			{#each fieldsWithoutCluster as field, fieldIndex (field.key)}
				{@render renderField(
					field,
					'',
					'',
					false,
					'',
					isDependentFieldAfterCheckbox(fieldsWithoutCluster, fieldIndex)
				)}
			{/each}
		</div>

		{#if sidebarTimestampFields.length > 0}
			<div class="space-y-4">
				{#each sidebarTimestampFields as field, fieldIndex (field.key)}
					{@render renderField(
						field,
						'',
						'',
						field.hideHelp,
						'',
						isDependentFieldAfterCheckbox(sidebarTimestampFields, fieldIndex)
					)}
				{/each}
			</div>
		{/if}
	</div>
{:else if isMultiColumnGroup}
	<div class={getMultiColumnWrapperClass()}>
		{#each multiColumnFields as columnFields, columnIndex (columnIndex)}
			<div class="space-y-4">
				{#each columnFields as field, fieldIndex (field.key)}
					{@render renderField(
						field,
						'',
						'',
						false,
						'',
						isDependentFieldAfterCheckbox(columnFields, fieldIndex)
					)}
				{/each}
			</div>
		{/each}
	</div>
{:else}
	<div class={getFieldsWrapperClass()}>
		{#each orderedFields as field, fieldIndex (field.key)}
			{@render renderField(
				field,
				'',
				'',
				false,
				'',
				isDependentFieldAfterCheckbox(orderedFields, fieldIndex)
			)}
		{/each}
	</div>
{/if}
