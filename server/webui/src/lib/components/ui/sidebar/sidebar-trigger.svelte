<script lang="ts">
	import { t } from '$lib/i18n';
	import type { ButtonProps } from '$lib/components/ui/button/index.js';
	import CornerButton from '$lib/components/ui/button/corner-button.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { useSidebar } from './context.svelte.js';

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ButtonProps & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();
</script>

<CornerButton
	bind:ref
	subtle={sidebar.open}
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	class="llampart-sidebar-v-trigger md:[&_svg]:transition-transform md:[&_svg]:duration-200 {sidebar.open
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
</CornerButton>
