<script lang="ts">
	import { t } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { SearchInput } from '$lib/components/app';

	interface Props {
		placeholder?: string;
		searchValue?: string;
		onSearchChange?: (value: string) => void;
		onSearchKeyDown?: (event: KeyboardEvent) => void;
		emptyMessage?: string;
		isEmpty?: boolean;
		children: Snippet;
		footer?: Snippet;
	}

	let {
		placeholder = t('common.searchEllipsis'),
		searchValue = $bindable(''),
		onSearchChange,
		onSearchKeyDown,
		emptyMessage = t('common.noItemsFound'),
		isEmpty = false,
		children,
		footer
	}: Props = $props();
</script>

<div class="llampart-searchable-menu-header sticky top-0 z-10 mb-2 p-1 pt-2">
	<SearchInput
		class="llampart-quiet-search"
		{placeholder}
		bind:value={searchValue}
		onInput={onSearchChange}
		onKeyDown={onSearchKeyDown}
	/>
</div>

<div class="llampart-searchable-menu-panel overflow-y-auto">
	{@render children()}

	{#if isEmpty}
		<div class="px-2 py-3 text-center text-sm text-muted-foreground">{emptyMessage}</div>
	{/if}
</div>

{#if footer}
	<DropdownMenu.Separator />

	{@render footer()}
{/if}
