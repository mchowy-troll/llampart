<script lang="ts">
	import {
		CircleAlert,
		Heart,
		HeartOff,
		Info,
		Loader2,
		Power,
		PowerOff,
		RotateCw
	} from '@lucide/svelte';
	import { cn } from '$lib/components/ui/utils';
	import { ActionIcon, ModelId } from '$lib/components/app';
	import type { ModelOption } from '$lib/types/models';
	import { ServerModelStatus } from '$lib/enums';
	import { modelsStore, routerModels } from '$lib/stores/models.svelte';
	import { t } from '$lib/i18n';

	interface Props {
		option: ModelOption;
		isSelected: boolean;
		isHighlighted: boolean;
		isFav: boolean;
		showOrgName?: boolean;
		onSelect: (modelId: string) => void;
		onMouseEnter: () => void;
		onKeyDown: (e: KeyboardEvent) => void;
		onInfoClick?: (modelName: string) => void;
	}

	let {
		option,
		isSelected,
		isHighlighted,
		isFav,
		showOrgName = false,
		onSelect,
		onMouseEnter,
		onKeyDown,
		onInfoClick
	}: Props = $props();

	let currentRouterModels = $derived(routerModels());
	let serverStatus = $derived.by(() => {
		const model = currentRouterModels.find((m) => m.id === option.model);
		return (model?.status?.value as ServerModelStatus) ?? null;
	});
	let isOperationInProgress = $derived(modelsStore.isModelOperationInProgress(option.model));
	let isFailed = $derived(serverStatus === ServerModelStatus.FAILED);
	let isSleeping = $derived(serverStatus === ServerModelStatus.SLEEPING);
	let isLoaded = $derived(
		(serverStatus === ServerModelStatus.LOADED || isSleeping) && !isOperationInProgress
	);
	let isLoading = $derived(serverStatus === ServerModelStatus.LOADING || isOperationInProgress);
</script>

<div
	class={cn(
		'llampart-model-selector-option group flex w-full items-center gap-2 rounded-sm p-2 text-left text-sm font-normal transition focus:outline-none',
		'cursor-pointer hover:bg-muted focus:bg-muted',
		isSelected || isHighlighted
			? 'bg-accent text-accent-foreground'
			: 'hover:bg-accent hover:text-accent-foreground',
		isLoaded ? 'text-popover-foreground' : 'text-muted-foreground'
	)}
	data-llampart-loaded-model={isLoaded}
	role="option"
	aria-selected={isSelected || isHighlighted}
	tabindex="0"
	onclick={() => onSelect(option.id)}
	onmouseenter={onMouseEnter}
	onkeydown={onKeyDown}
>
	<ModelId
		modelId={option.model}
		{showOrgName}
		aliases={option.aliases}
		tags={option.tags}
		class="flex-1"
	/>

	<div class="flex shrink-0 items-center gap-1">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="llampart-model-selector-option-actions pointer-events-none flex items-center justify-center gap-0.75 pl-2 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
			onclick={(e) => e.stopPropagation()}
		>
			{#if isFav}
				<ActionIcon
					iconSize="h-2.5 w-2.5"
					icon={HeartOff}
					tooltip={t('models.removeFromFavorites')}
					class="h-3 w-3 hover:text-foreground"
					onclick={() => modelsStore.toggleFavorite(option.model)}
				/>
			{:else}
				<ActionIcon
					iconSize="h-2.5 w-2.5"
					icon={Heart}
					tooltip={t('models.addToFavorites')}
					class="h-3 w-3 hover:text-foreground"
					onclick={() => modelsStore.toggleFavorite(option.model)}
				/>
			{/if}

			<!-- info button: only shown when model is loaded and callback is provided -->
			{#if isLoaded && onInfoClick}
				<ActionIcon
					iconSize="h-2.5 w-2.5"
					icon={Info}
					tooltip={t('models.modelInformation')}
					class="h-3 w-3 hover:text-foreground"
					onclick={() => onInfoClick(option.model)}
				/>
			{/if}
		</div>

		{#if isLoading}
			<Loader2 class="llampart-model-loading-icon h-4 w-4 animate-spin text-muted-foreground" />
		{:else if isFailed}
			<div class="flex w-4 items-center justify-center">
				<CircleAlert class="h-3.5 w-3.5 text-red-500 group-hover:hidden" />

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="hidden group-hover:flex" onclick={(e) => e.stopPropagation()}>
					<ActionIcon
						iconSize="h-2.5 w-2.5"
						icon={RotateCw}
						tooltip={t('models.retryLoadingModel')}
						class="h-3 w-3 text-red-500 hover:text-foreground"
						onclick={() => modelsStore.loadModel(option.model)}
					/>
				</div>
			</div>
		{:else if isSleeping}
			<div class="flex w-4 items-center justify-center">
				<span class="h-2 w-2 rounded-full bg-orange-400 group-hover:hidden"></span>

				<div class="hidden group-hover:flex">
					<ActionIcon
						iconSize="h-2.5 w-2.5"
						icon={PowerOff}
						tooltip={t('models.unloadModel')}
						class="h-3 w-3 text-red-500 hover:text-red-600"
						onclick={(e) => {
							e?.stopPropagation();
							modelsStore.unloadModel(option.model);
						}}
					/>
				</div>
			</div>
		{:else if isLoaded}
			<div class="flex w-4 items-center justify-center">
				<span class="h-2 w-2 rounded-full bg-green-500 group-hover:hidden"></span>

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="hidden group-hover:flex" onclick={(e) => e.stopPropagation()}>
					<ActionIcon
						iconSize="h-2.5 w-2.5"
						icon={PowerOff}
						tooltip={t('models.unloadModel')}
						class="h-3 w-3 text-red-500 hover:text-red-600"
						onclick={() => modelsStore.unloadModel(option.model)}
					/>
				</div>
			</div>
		{:else}
			<div class="flex w-4 items-center justify-center">
				<span class="h-2 w-2 rounded-full bg-muted-foreground/50 group-hover:hidden"></span>

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="hidden group-hover:flex" onclick={(e) => e.stopPropagation()}>
					<ActionIcon
						iconSize="h-2.5 w-2.5"
						icon={Power}
						tooltip={t('models.loadModel')}
						class="h-3 w-3"
						onclick={() => modelsStore.loadModel(option.model)}
					/>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	/* llampart-model-selector-option-regular-and-frosted-loader */
	.llampart-model-selector-option :global(.font-medium),
	.llampart-model-selector-option :global([class*='font-']) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-model-loading-icon {
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

	/* llampart-frosted-glass-model-option-icon-weight-and-bg-reset */
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			[data-slot='button']
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			button
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			[role='button']
	) {
		border: 0 !important;
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			[data-slot='button']:hover
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			button:hover
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			[role='button']:hover
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			[data-slot='button']:focus-visible
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			button:focus-visible
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option
			.llampart-model-selector-option-actions
			[role='button']:focus-visible
	) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option svg),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option svg *) {
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
	}

	/* llampart-frosted-glass-model-option-all-buttons-transparent-anchorless */
	:global(html.has-frosted-glass-theme .llampart-model-selector-option [data-slot='button']),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option button) {
		border-color: transparent !important;
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option [data-slot='button']:hover),
	:global(
		html.has-frosted-glass-theme .llampart-model-selector-option [data-slot='button']:focus-visible
	),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option button:hover),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option button:focus-visible) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option [data-slot='button'] svg),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option [data-slot='button'] svg *) {
		stroke-width: 1.6 !important;
		filter: none !important;
		text-shadow: none !important;
	}
</style>
