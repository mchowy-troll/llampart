<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronDown, Loader2, Package } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { cn } from '$lib/components/ui/utils';
	import {
		modelsStore,
		modelOptions,
		modelsLoading,
		modelsUpdating,
		selectedModelId,
		singleModelName
	} from '$lib/stores/models.svelte';
	import { KeyboardKey } from '$lib/enums';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import {
		DialogModelInformation,
		DropdownMenuSearchable,
		ModelId,
		ModelsSelectorList,
		ModelsSelectorOption
	} from '$lib/components/app';
	import type { ModelOption } from '$lib/types/models';
	import { filterModelOptions, groupModelOptions, type ModelItem } from './utils';
	import { t } from '$lib/i18n';

	interface Props {
		class?: string;
		currentModel?: string | null;
		disabled?: boolean;
		forceForegroundText?: boolean;
		onModelChange?: (modelId: string, modelName: string) => Promise<boolean> | boolean | void;
		useGlobalSelection?: boolean;
	}

	let {
		class: className = '',
		currentModel = null,
		disabled = false,
		forceForegroundText = false,
		onModelChange,
		useGlobalSelection = false
	}: Props = $props();

	let options = $derived(
		modelOptions().filter((option) => {
			const modelProps = modelsStore.getModelProps(option.model);

			return modelProps?.webui !== false;
		})
	);
	let loading = $derived(modelsLoading());
	let updating = $derived(modelsUpdating());
	let activeId = $derived(selectedModelId());
	let isRouter = $derived(isRouterMode());
	let serverModel = $derived(singleModelName());

	let isHighlightedCurrentModelActive = $derived.by(() => {
		if (!isRouter || !currentModel) return false;

		const currentOption = options.find((option) => option.model === currentModel);

		return currentOption ? currentOption.id === activeId : false;
	});

	let isCurrentModelInCache = $derived.by(() => {
		if (!isRouter || !currentModel) return true;

		return options.some((option) => option.model === currentModel);
	});

	let isLoadingModel = $state(false);

	let searchTerm = $state('');
	let highlightedIndex = $state<number>(-1);

	let filteredOptions = $derived(filterModelOptions(options, searchTerm));

	let groupedFilteredOptions = $derived(
		groupModelOptions(filteredOptions, modelsStore.favoriteModelIds, (m) =>
			modelsStore.isModelLoaded(m)
		)
	);

	$effect(() => {
		void searchTerm;
		highlightedIndex = -1;
	});

	let isOpen = $state(false);
	let showModelDialog = $state(false);
	let infoModelId = $state<string | null>(null);

	function handleInfoClick(modelName: string) {
		infoModelId = modelName;
		showModelDialog = true;
	}

	onMount(() => {
		modelsStore.fetch().catch((error) => {
			console.error('Unable to load models:', error);
		});
	});

	function handleOpenChange(open: boolean) {
		if (loading || updating) return;

		if (isRouter) {
			if (open) {
				isOpen = true;
				searchTerm = '';
				highlightedIndex = -1;

				modelsStore.fetchRouterModels().then(() => {
					modelsStore.fetchModalitiesForLoadedModels();
				});
			} else {
				isOpen = false;
				searchTerm = '';
				highlightedIndex = -1;
			}
		} else {
			showModelDialog = open;
		}
	}

	export function open() {
		handleOpenChange(true);
	}

	function handleSearchKeyDown(event: KeyboardEvent) {
		if (event.isComposing) return;

		if (event.key === KeyboardKey.ARROW_DOWN) {
			event.preventDefault();

			if (filteredOptions.length === 0) return;

			if (highlightedIndex === -1 || highlightedIndex === filteredOptions.length - 1) {
				highlightedIndex = 0;
			} else {
				highlightedIndex += 1;
			}
		} else if (event.key === KeyboardKey.ARROW_UP) {
			event.preventDefault();

			if (filteredOptions.length === 0) return;

			if (highlightedIndex === -1 || highlightedIndex === 0) {
				highlightedIndex = filteredOptions.length - 1;
			} else {
				highlightedIndex -= 1;
			}
		} else if (event.key === KeyboardKey.ENTER) {
			event.preventDefault();

			if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
				const option = filteredOptions[highlightedIndex];

				handleSelect(option.id);
			} else if (filteredOptions.length > 0) {
				highlightedIndex = 0;
			}
		}
	}

	async function handleSelect(modelId: string) {
		const option = options.find((opt) => opt.id === modelId);
		if (!option) return;

		let shouldCloseMenu = true;

		if (onModelChange) {
			const result = await onModelChange(option.id, option.model);

			if (result === false) {
				shouldCloseMenu = false;
			}
		} else {
			await modelsStore.selectModelById(option.id);
		}

		if (shouldCloseMenu) {
			handleOpenChange(false);

			requestAnimationFrame(() => {
				const textarea = document.querySelector<HTMLTextAreaElement>(
					'[data-slot="chat-form"] textarea'
				);
				textarea?.focus();
			});
		}

		if (!onModelChange && isRouter && !modelsStore.isModelLoaded(option.model)) {
			isLoadingModel = true;
			modelsStore
				.loadModel(option.model)
				.catch((error) => console.error('Failed to load model:', error))
				.finally(() => (isLoadingModel = false));
		}
	}

	function getDisplayOption(): ModelOption | undefined {
		if (!isRouter) {
			const displayModel = serverModel || currentModel;
			if (displayModel) {
				return {
					id: serverModel ? 'current' : 'offline-current',
					model: displayModel,
					name: displayModel.split('/').pop() || displayModel,
					capabilities: []
				};
			}

			return undefined;
		}

		if (useGlobalSelection && activeId) {
			const selected = options.find((option) => option.id === activeId);

			if (selected) return selected;
		}

		if (currentModel) {
			if (!isCurrentModelInCache) {
				return {
					id: 'not-in-cache',
					model: currentModel,
					name: currentModel.split('/').pop() || currentModel,
					capabilities: []
				};
			}

			return options.find((option) => option.model === currentModel);
		}

		if (activeId) {
			return options.find((option) => option.id === activeId);
		}

		return undefined;
	}
</script>

<div class={cn('relative inline-flex flex-col items-end gap-1', className)}>
	{#if loading && options.length === 0 && isRouter}
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<Loader2 class="llampart-model-loading-icon h-3.5 w-3.5 animate-spin" />

			{t('models.loadingModels')}
		</div>
	{:else if options.length === 0 && isRouter}
		{#if currentModel}
			<span
				class={cn(
					'inline-flex items-center gap-1.5 rounded-sm bg-muted-foreground/10 px-1.5 py-1 text-xs text-muted-foreground',
					className
				)}
				style="max-width: min(calc(100cqw - 9rem), 20rem)"
			>
				<Package class="h-3.5 w-3.5" />

				<ModelId modelId={currentModel} class="min-w-0" showOrgName />
			</span>
		{:else}
			<p class="text-xs text-muted-foreground">{t('models.noModelsAvailable')}</p>
		{/if}
	{:else}
		{@const selectedOption = getDisplayOption()}

		{#if isRouter}
			<DropdownMenu.Root bind:open={isOpen} onOpenChange={handleOpenChange}>
				<DropdownMenu.Trigger
					class={cn(
						`llampart-model-selector-trigger inline-grid cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-1.5 rounded-sm bg-muted-foreground/10 px-1.5 py-1 text-xs transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`,
						!isCurrentModelInCache
							? 'bg-red-400/10 !text-red-400 hover:bg-red-400/20 hover:text-red-400'
							: forceForegroundText
								? 'text-foreground'
								: isHighlightedCurrentModelActive
									? 'text-foreground'
									: 'text-muted-foreground',
						isOpen ? 'text-foreground' : ''
					)}
					style="max-width: min(calc(100cqw - 9rem), 20rem)"
					disabled={disabled || updating}
				>
					<Package class="h-3.5 w-3.5" />

					{#if selectedOption}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<!-- prevent another nested button element -->
								{#snippet child({ props })}
									<ModelId
										modelId={selectedOption.model}
										class="min-w-0 overflow-hidden"
										showOrgName
										{...props}
									/>
								{/snippet}
							</Tooltip.Trigger>

							<Tooltip.Content>
								<p class="font-mono">{selectedOption.model}</p>
							</Tooltip.Content>
						</Tooltip.Root>
					{:else}
						<span class="min-w-0 font-normal">{t('models.selectModel')}</span>
					{/if}

					{#if updating || isLoadingModel}
						<Loader2 class="llampart-model-trigger-loading-icon h-3 w-3.5 animate-spin" />
					{:else}
						<ChevronDown class="h-3 w-3.5" />
					{/if}
				</DropdownMenu.Trigger>

				<DropdownMenu.Content
					align="end"
					class="llampart-composer-menu-content llampart-model-selector-menu w-full max-w-[100vw] pt-0 sm:w-max sm:max-w-[calc(100vw-2rem)]"
				>
					<DropdownMenuSearchable
						bind:searchValue={searchTerm}
						placeholder={t('models.searchModels')}
						onSearchKeyDown={handleSearchKeyDown}
						emptyMessage={t('models.noModelsFound')}
						isEmpty={filteredOptions.length === 0 && isCurrentModelInCache}
					>
						<div class="models-list">
							{#if !isCurrentModelInCache && currentModel}
								<!-- Show unavailable model as first option (disabled) -->
								<button
									type="button"
									class="flex w-full cursor-not-allowed items-center bg-red-400/10 p-2 text-left text-sm text-red-400"
									role="option"
									aria-selected="true"
									aria-disabled="true"
									disabled
								>
									<ModelId modelId={currentModel} class="flex-1" showOrgName />

									<span class="ml-2 text-xs whitespace-nowrap opacity-70">
										{t('models.notAvailableShort')}
									</span>
								</button>
							{/if}

							{#if filteredOptions.length === 0}
								<p class="px-4 py-3 text-sm text-muted-foreground">{t('models.noModelsFound')}</p>
							{/if}

							{#snippet modelOption(item: ModelItem, showOrgName: boolean)}
								{@const { option, flatIndex } = item}
								{@const isSelected = currentModel === option.model || activeId === option.id}
								{@const isHighlighted = flatIndex === highlightedIndex}
								{@const isFav = modelsStore.favoriteModelIds.has(option.model)}

								<ModelsSelectorOption
									{option}
									{isSelected}
									{isHighlighted}
									{isFav}
									{showOrgName}
									onSelect={handleSelect}
									onInfoClick={handleInfoClick}
									onMouseEnter={() => (highlightedIndex = flatIndex)}
									onKeyDown={(e) => {
										if (e.key === KeyboardKey.ENTER || e.key === KeyboardKey.SPACE) {
											e.preventDefault();
											handleSelect(option.id);
										}
									}}
								/>
							{/snippet}

							<ModelsSelectorList
								groups={groupedFilteredOptions}
								{currentModel}
								{activeId}
								sectionHeaderClass="my-1.5 px-2 py-2 text-[13px] font-semibold text-muted-foreground/70 select-none"
								onSelect={handleSelect}
								onInfoClick={handleInfoClick}
								renderOption={modelOption}
							/>
						</div>
					</DropdownMenuSearchable>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<button
				class={cn(
					`inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-muted-foreground/10 px-1.5 py-1 text-xs transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`,
					!isCurrentModelInCache
						? 'bg-red-400/10 !text-red-400 hover:bg-red-400/20 hover:text-red-400'
						: forceForegroundText
							? 'text-foreground'
							: isHighlightedCurrentModelActive
								? 'text-foreground'
								: 'text-muted-foreground',
					isOpen ? 'text-foreground' : ''
				)}
				style="max-width: min(calc(100cqw - 6.5rem), 32rem)"
				onclick={() => handleOpenChange(true)}
				disabled={disabled || updating}
			>
				<Package class="h-3.5 w-3.5" />

				{#if selectedOption}
					<Tooltip.Root>
						<Tooltip.Trigger>
							<!-- prevent another nested button element -->
							{#snippet child({ props })}
								<ModelId
									modelId={selectedOption.model}
									class="min-w-0 overflow-hidden"
									showOrgName
									{...props}
								/>
							{/snippet}
						</Tooltip.Trigger>

						<Tooltip.Content>
							<p class="font-mono">{selectedOption.model}</p>
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}

				{#if updating}
					<Loader2 class="llampart-model-trigger-loading-icon h-3 w-3.5 animate-spin" />
				{/if}
			</button>
		{/if}
	{/if}
</div>

{#if showModelDialog}
	<DialogModelInformation bind:open={showModelDialog} modelId={infoModelId} />
{/if}

<style>
	/* llampart-model-selector-trigger-regular-and-frosted-loader */
	:global(.llampart-model-selector-trigger .font-medium),
	:global(.llampart-model-selector-trigger [class*='font-']) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-trigger-loading-icon) {
		animation: none !important;
		background: transparent !important;
		box-shadow: none !important;
		filter: none !important;
	}

	/* llampart-frosted-glass-model-loader-hover-static-spinner-round-5 */
	:global(html.has-frosted-glass-theme .llampart-model-selector-option button),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option [role='button']) {
		transition:
			color 160ms ease,
			opacity 160ms ease,
			transform 160ms ease !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option button:hover),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option button:focus-visible),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option [role='button']:hover),
	:global(
		html.has-frosted-glass-theme .llampart-model-selector-option [role='button']:focus-visible
	) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border-color: transparent !important;
		box-shadow: none !important;
		filter: none !important;
		animation: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option button:hover svg),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option button:focus-visible svg),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option [role='button']:hover svg),
	:global(
		html.has-frosted-glass-theme .llampart-model-selector-option [role='button']:focus-visible svg
	) {
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.34)) !important;
		animation: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-loading-icon),
	:global(html.has-frosted-glass-theme .llampart-model-trigger-loading-icon) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border: 0 !important;
		box-shadow: none !important;
		filter: none !important;
	}

	/* Prawdziwy spinner ładowania ma się kręcić tylko wtedy, kiedy ta ikona faktycznie jest renderowana. */
	:global(html.has-frosted-glass-theme .llampart-model-loading-icon.animate-spin),
	:global(html.has-frosted-glass-theme .llampart-model-trigger-loading-icon.animate-spin) {
		animation: spin 1s linear infinite !important;
	}

	/* llampart-frosted-glass-model-trigger-regular-icon-and-name */
	:global(html.has-frosted-glass-theme .llampart-model-selector-trigger),
	:global(html.has-frosted-glass-theme .llampart-model-selector-trigger *) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-trigger svg),
	:global(html.has-frosted-glass-theme .llampart-model-selector-trigger svg *) {
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-trigger-loading-icon) {
		border: 0 !important;
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
	}

	/* llampart-model-selector-badge-rem-scale */
	:global(.llampart-model-selector-trigger span[class*='text-[10px]']),
	:global(.llampart-model-selector-option span[class*='text-[10px]']) {
		font-size: 0.625rem !important;
		line-height: 0.85rem !important;
		padding: 0 0.22rem !important;
		border-radius: 0.34rem !important;
	}
	/* /llampart-model-selector-badge-rem-scale */
</style>
