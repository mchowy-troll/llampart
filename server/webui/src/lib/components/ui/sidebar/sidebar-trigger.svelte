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
		color: #111111 !important;
	}

	:global(.llampart-sidebar-v-trigger-closed),
	:global(.llampart-sidebar-v-trigger-closed:hover),
	:global(.llampart-sidebar-v-trigger-closed:focus-visible) {
		background: #f9f9f9 !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(.llampart-sidebar-v-trigger-open),
	:global(.llampart-sidebar-v-trigger-open:hover),
	:global(.llampart-sidebar-v-trigger-open:focus-visible) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.dark:not(.has-frosted-glass-theme) .llampart-sidebar-v-trigger) {
		color: #f5f5f5 !important;
	}

	:global(html.dark:not(.has-frosted-glass-theme) .llampart-sidebar-v-trigger-closed),
	:global(html.dark:not(.has-frosted-glass-theme) .llampart-sidebar-v-trigger-closed:hover),
	:global(
		html.dark:not(.has-frosted-glass-theme) .llampart-sidebar-v-trigger-closed:focus-visible
	) {
		background: #1f1f1f !important;
	}

	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger) {
		color: #111111 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger-closed),
	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger-closed:hover),
	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger-closed:focus-visible) {
		background: rgba(255, 255, 255, 0.23) !important;
		backdrop-filter: blur(14px) saturate(128%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(128%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger-open),
	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger-open:hover),
	:global(html.has-frosted-glass-theme .llampart-sidebar-v-trigger-open:focus-visible) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(.llampart-sidebar-v-trigger svg),
	:global(.llampart-sidebar-v-trigger svg *) {
		filter: none !important;
		stroke-width: 2 !important;
	}
</style>
