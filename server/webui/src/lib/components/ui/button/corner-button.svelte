<script lang="ts">
	import { Button, type ButtonProps } from './index.js';

	let {
		ref = $bindable(null),
		class: className,
		subtle = false,
		children,
		...restProps
	}: ButtonProps & { subtle?: boolean } = $props();
</script>

<Button
	bind:ref
	variant="ghost"
	size="icon-lg"
	class="llampart-corner-button h-8 w-8 rounded-full border-0 p-0 shadow-none hover:bg-transparent focus-visible:bg-transparent md:h-8 md:w-8 md:hover:bg-transparent md:focus-visible:bg-transparent {subtle
		? 'llampart-corner-button-subtle'
		: 'llampart-corner-button-surface'} {className}"
	type="button"
	{...restProps}
>
	{@render children?.()}
</Button>

<style>
	:global(.llampart-corner-button),
	:global(.llampart-corner-button:hover),
	:global(.llampart-corner-button:focus-visible) {
		border: 0 !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		color: var(--llampart-sidebar-trigger-foreground) !important;
	}

	:global(.llampart-corner-button-surface),
	:global(.llampart-corner-button-surface:hover),
	:global(.llampart-corner-button-surface:focus-visible) {
		background: var(--llampart-sidebar-trigger-closed-background) !important;
		backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
		-webkit-backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
	}

	:global(.llampart-corner-button-subtle),
	:global(.llampart-corner-button-subtle:hover),
	:global(.llampart-corner-button-subtle:focus-visible) {
		background: var(--llampart-sidebar-trigger-open-background) !important;
		background-color: var(--llampart-sidebar-trigger-open-background) !important;
		background-image: var(--llampart-sidebar-trigger-open-background-image) !important;
		backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
		-webkit-backdrop-filter: var(--llampart-sidebar-trigger-backdrop-filter) !important;
	}

	:global(.llampart-corner-button svg),
	:global(.llampart-corner-button svg *) {
		filter: var(--llampart-sidebar-trigger-icon-filter) !important;
		stroke-width: 2 !important;
	}
</style>
