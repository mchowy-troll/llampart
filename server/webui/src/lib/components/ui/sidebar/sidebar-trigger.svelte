<script lang="ts">
	import { t } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { ComponentProps } from 'svelte';
	import { useSidebar } from './context.svelte.js';

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-lg"
	class="llampart-sidebar-v-trigger h-8 w-8 rounded-full border-0 p-0 shadow-none hover:bg-transparent focus-visible:bg-transparent md:h-8 md:w-8 md:hover:bg-transparent md:focus-visible:bg-transparent md:[&_svg]:transition-transform md:[&_svg]:duration-200 {sidebar.open
		? 'llampart-sidebar-v-trigger-open md:[&_svg]:rotate-180'
		: 'llampart-sidebar-v-trigger-closed md:[&_svg]:rotate-0'} {className}"
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<ChevronDown class="h-4 w-4 translate-y-0.5" />
	<span class="sr-only">{t('common.toggleSidebar')}</span>
</Button>

<style>
	:global(.llampart-sidebar-v-trigger),
	:global(.llampart-sidebar-v-trigger:hover),
	:global(.llampart-sidebar-v-trigger:focus-visible) {
		border: 0 !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		color: var(--llampart-sidebar-trigger-foreground) !important;
	}

	:global(.llampart-sidebar-v-trigger-closed),
	:global(.llampart-sidebar-v-trigger-closed:hover),
	:global(.llampart-sidebar-v-trigger-closed:focus-visible) {
		background: var(--llampart-sidebar-trigger-closed-background) !important;
		backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
		-webkit-backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
	}

	:global(.llampart-sidebar-v-trigger-open),
	:global(.llampart-sidebar-v-trigger-open:hover),
	:global(.llampart-sidebar-v-trigger-open:focus-visible) {
		background: var(--llampart-sidebar-trigger-open-background) !important;
		background-color: var(--llampart-sidebar-trigger-open-background) !important;
		background-image: var(--llampart-sidebar-trigger-open-background-image) !important;
		backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
		-webkit-backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
	}

	:global(.llampart-sidebar-v-trigger svg),
	:global(.llampart-sidebar-v-trigger svg *) {
		filter: var(--llampart-sidebar-trigger-icon-filter) !important;
		stroke-width: 2 !important;
	}
</style>
