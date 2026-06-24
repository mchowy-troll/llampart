<script lang="ts">
	import { modelsStore } from '$lib/stores/models.svelte';
	import { ModelsSelectorOption } from '$lib/components/app';
	import type { GroupedModelOptions, ModelItem } from './utils';
	import { t } from '$lib/i18n';

	interface Props {
		groups: GroupedModelOptions;
		currentModel: string | null;
		activeId: string | null;
		sectionHeaderClass?: string;
		orgHeaderClass?: string;
		onSelect: (modelId: string) => void;
		onInfoClick?: (modelName: string) => void;
		renderOption?: import('svelte').Snippet<[ModelItem, boolean]>;
	}

	let {
		groups,
		currentModel,
		activeId,
		sectionHeaderClass = 'my-1 px-2 py-2 text-[13px] font-normal text-muted-foreground/70 select-none',
		orgHeaderClass = 'px-2 py-2 text-[11px] font-normal text-muted-foreground/50 select-none [&:not(:first-child)]:mt-1',
		onSelect,
		onInfoClick,
		renderOption
	}: Props = $props();
	let render = $derived(renderOption ?? defaultOption);
</script>

{#snippet defaultOption(item: ModelItem, showOrgName: boolean)}
	{@const { option } = item}
	{@const isSelected = currentModel === option.model || activeId === option.id}
	{@const isFav = modelsStore.favoriteModelIds.has(option.model)}

	<ModelsSelectorOption
		{option}
		{isSelected}
		isHighlighted={false}
		{isFav}
		{showOrgName}
		{onSelect}
		{onInfoClick}
		onMouseEnter={() => {}}
		onKeyDown={() => {}}
	/>
{/snippet}

{#if groups.loaded.length > 0}
	<section class="llampart-model-selector-section">
		<p class={sectionHeaderClass}>{t('models.loadedModels')}</p>
		{#each groups.loaded as item (`loaded-${item.option.id}`)}
			{@render render(item, true)}
		{/each}
	</section>
{/if}

{#if groups.favorites.length > 0}
	<section class="llampart-model-selector-section">
		<p class={sectionHeaderClass}>{t('models.favoriteModels')}</p>
		{#each groups.favorites as item (`fav-${item.option.id}`)}
			{@render render(item, true)}
		{/each}
	</section>
{/if}

{#if groups.available.length > 0}
	<section class="llampart-model-selector-section">
		<p class={sectionHeaderClass}>{t('models.availableModels')}</p>
		{#each groups.available as group (group.orgName)}
			{#if group.orgName}
				<p class={orgHeaderClass}>{group.orgName}</p>
			{/if}
			{#each group.items as item (item.option.id)}
				{@render render(item, !group.orgName)}
			{/each}
		{/each}
	</section>
{/if}

<style>
	/* llampart-model-selector-section-dividers */
	.llampart-model-selector-section {
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
	}

	.llampart-model-selector-section + .llampart-model-selector-section {
		margin-top: 0.35rem;
		border-top: 1px solid color-mix(in oklch, var(--border) 54%, transparent);
		padding-top: 0.45rem;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-model-selector-section
		+ .llampart-model-selector-section {
		border-top-color: rgba(255, 255, 255, 0.18) !important;
	}
</style>
