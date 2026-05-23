<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronDown, Loader2, Package } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import { cn } from '$lib/components/ui/utils';
	import {
		modelsStore,
		modelOptions,
		modelsLoading,
		modelsUpdating,
		selectedModelId,
		singleModelName
	} from '$lib/stores/models.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import {
		DialogModelInformation,
		ModelsSelectorList,
		SearchInput,
		TruncatedText
	} from '$lib/components/app';
	import type { ModelOption } from '$lib/types/models';
	import { filterModelOptions, groupModelOptions } from './utils';
	import { t } from '$lib/i18n';

	interface Props {
		class?: string;
		currentModel?: string | null;
		/** Callback when model changes. Return false to keep menu open (e.g., for validation failures) */
		onModelChange?: (modelId: string, modelName: string) => Promise<boolean> | boolean | void;
		disabled?: boolean;
		forceForegroundText?: boolean;
		/** When true, user's global selection takes priority over currentModel (for form selector) */
		useGlobalSelection?: boolean;
	}

	let {
		class: className = '',
		currentModel = null,
		onModelChange,
		disabled = false,
		forceForegroundText = false,
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

	let isLoadingModel = $state(false);

	let isHighlightedCurrentModelActive = $derived(
		!isRouter || !currentModel
			? false
			: (() => {
					const currentOption = options.find((option) => option.model === currentModel);

					return currentOption ? currentOption.id === activeId : false;
				})()
	);

	let isCurrentModelInCache = $derived.by(() => {
		if (!isRouter || !currentModel) return true;

		return options.some((option) => option.model === currentModel);
	});

	let searchTerm = $state('');

	let filteredOptions = $derived(filterModelOptions(options, searchTerm));

	let groupedFilteredOptions = $derived(
		groupModelOptions(filteredOptions, modelsStore.favoriteModelIds, (m) =>
			modelsStore.isModelLoaded(m)
		)
	);

	let sheetOpen = $state(false);
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
				sheetOpen = true;
				searchTerm = '';

				modelsStore.fetchRouterModels().then(() => {
					modelsStore.fetchModalitiesForLoadedModels();
				});
			} else {
				sheetOpen = false;
				searchTerm = '';
			}
		} else {
			showModelDialog = open;
		}
	}

	export function open() {
		handleOpenChange(true);
	}

	function handleSheetOpenChange(open: boolean) {
		if (!open) {
			handleOpenChange(false);
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
			if (serverModel) {
				return {
					id: 'current',
					model: serverModel,
					name: serverModel.split('/').pop() || serverModel,
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
		<p class="text-xs text-muted-foreground">{t('models.noModelsAvailable')}</p>
	{:else}
		{@const selectedOption = getDisplayOption()}

		{#if isRouter}
			<button
				type="button"
				class={cn(
					`llampart-model-selector-trigger inline-grid cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-1.5 rounded-sm bg-muted-foreground/10 px-1.5 py-1 text-xs transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60`,
					!isCurrentModelInCache
						? 'bg-red-400/10 !text-red-400 hover:bg-red-400/20 hover:text-red-400'
						: forceForegroundText
							? 'text-foreground'
							: isHighlightedCurrentModelActive
								? 'text-foreground'
								: 'text-muted-foreground',
					sheetOpen ? 'text-foreground' : ''
				)}
				style="max-width: min(calc(100cqw - 9rem), 20rem)"
				disabled={disabled || updating}
				onclick={() => handleOpenChange(true)}
			>
				<Package class="h-3.5 w-3.5" />

				<TruncatedText
					text={selectedOption?.model || t('models.selectModel')}
					class="min-w-0 font-normal"
				/>

				{#if updating || isLoadingModel}
					<Loader2 class="llampart-model-trigger-loading-icon h-3 w-3.5 animate-spin" />
				{:else}
					<ChevronDown class="h-3 w-3.5" />
				{/if}
			</button>

			<Sheet.Root bind:open={sheetOpen} onOpenChange={handleSheetOpenChange}>
				<Sheet.Content
					side="bottom"
					class="llampart-composer-menu-content llampart-model-selector-sheet max-h-[85vh] gap-1"
				>
					<Sheet.Header>
						<Sheet.Title>{t('models.selectModelTitle')}</Sheet.Title>

						<Sheet.Description class="sr-only">
							{t('models.selectModelDescription')}
						</Sheet.Description>
					</Sheet.Header>

					<div class="flex flex-col gap-1 pb-4">
						<div class="mb-3 px-4">
							<SearchInput
								class="llampart-quiet-search"
								placeholder={t('models.searchModels')}
								bind:value={searchTerm}
							/>
						</div>

						<div class="max-h-[60vh] overflow-y-auto px-2">
							{#if !isCurrentModelInCache && currentModel}
								<button
									type="button"
									class="flex w-full cursor-not-allowed items-center rounded-md bg-red-400/10 px-3 py-2.5 text-left text-sm text-red-400"
									disabled
								>
									<span class="min-w-0 flex-1 truncate">
										{selectedOption?.name || currentModel}
									</span>
									<span class="ml-2 text-xs whitespace-nowrap opacity-70">
										{t('models.notAvailableShort')}
									</span>
								</button>
								<div class="my-1 h-px bg-border"></div>
							{/if}

							{#if filteredOptions.length === 0}
								<p class="px-3 py-3 text-center text-sm text-muted-foreground">
									{t('models.noModelsFound')}
								</p>
							{/if}

							<ModelsSelectorList
								groups={groupedFilteredOptions}
								{currentModel}
								{activeId}
								sectionHeaderClass="px-2 py-2 text-xs font-semibold text-muted-foreground/60 select-none"
								orgHeaderClass="px-2 py-2 text-xs font-normal text-muted-foreground/60 select-none [&:not(:first-child)]:mt-2"
								onSelect={handleSelect}
								onInfoClick={handleInfoClick}
							/>
						</div>
					</div>
				</Sheet.Content>
			</Sheet.Root>
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
								: 'text-muted-foreground'
				)}
				style="max-width: min(calc(100cqw - 6.5rem), 32rem)"
				onclick={() => handleOpenChange(true)}
				disabled={disabled || updating}
			>
				<Package class="h-3.5 w-3.5" />

				<TruncatedText text={selectedOption?.model || ''} class="min-w-0 font-normal" />

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
