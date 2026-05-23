<script lang="ts">
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Card } from '$lib/components/ui/card';
	import { createAutoScrollController } from '$lib/hooks/use-auto-scroll.svelte';
	import type { Snippet } from 'svelte';
	import type { Component } from 'svelte';

	interface Props {
		open?: boolean;
		class?: string;
		icon?: Component;
		iconClass?: string;
		title: string;
		subtitle?: string;
		isStreaming?: boolean;
		onToggle?: () => void;
		children: Snippet;
	}

	let {
		open = $bindable(false),
		class: className = '',
		icon: Icon,
		iconClass = 'h-4 w-4',
		title,
		subtitle,
		isStreaming = false,
		onToggle,
		children
	}: Props = $props();

	let contentContainer: HTMLDivElement | undefined = $state();
	const autoScroll = createAutoScrollController();

	$effect(() => {
		autoScroll.setContainer(contentContainer);
	});

	$effect(() => {
		// Only auto-scroll when open and streaming
		autoScroll.updateInterval(open && isStreaming);
	});

	function handleScroll() {
		autoScroll.handleScroll();
	}
</script>

<Collapsible.Root
	{open}
	onOpenChange={(value) => {
		open = value;
		onToggle?.();
	}}
	class={className}
>
	<Card class="llampart-agentic-panel gap-0 bg-muted/30 py-0 shadow-none">
		<Collapsible.Trigger
			class="flex min-h-10 w-full cursor-pointer items-center justify-between px-4 py-2.5"
		>
			<div class="flex items-center gap-2 text-muted-foreground">
				{#if Icon}
					<Icon class={iconClass} />
				{/if}

				<span class="text-sm leading-snug font-normal">{title}</span>

				{#if subtitle}
					<span class="llampart-agentic-panel-subtitle text-xs font-normal italic">{subtitle}</span>
				{/if}
			</div>

			<div
				class={buttonVariants({
					variant: 'ghost',
					size: 'sm',
					class: 'h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
				})}
			>
				<ChevronsUpDownIcon class="h-4 w-4" />

				<span class="sr-only">Toggle content</span>
			</div>
		</Collapsible.Trigger>

		<Collapsible.Content>
			<div
				bind:this={contentContainer}
				class="overflow-y-auto border-t border-border/70 px-4 pb-4"
				onscroll={handleScroll}
				style="min-height: var(--min-message-height); max-height: var(--max-message-height);"
			>
				{@render children()}
			</div>
		</Collapsible.Content>
	</Card>
</Collapsible.Root>

<style>
	:global(.llampart-agentic-panel) {
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		border-radius: 1.5rem;
		overflow: hidden;
		box-shadow: none;
	}

	/* llampart-frosted-glass-collapsible-match-agentic-frame */
	:global(html.has-frosted-glass-theme .llampart-agentic-panel) {
		position: relative !important;
		color: #000000 !important;
		text-shadow:
			0 0 1px rgba(255, 255, 255, 0.28),
			0 0 3px rgba(255, 255, 255, 0.16) !important;
		border: 1px solid rgba(255, 255, 255, 0.26) !important;
		border-radius: 0.75rem !important;
		background: rgba(255, 255, 255, 0.28) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 4px 10px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(14px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(108%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel *) {
		color: #000000 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel .card),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel [data-slot='card']),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel [data-slot='card-content']),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel [data-slot='card-header']),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel [data-slot='card-footer']) {
		background: transparent !important;
		box-shadow: none !important;
		border-color: transparent !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel svg) {
		color: #000000 !important;
		stroke: currentColor !important;
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.22)) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel button),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel [role='button']) {
		color: #000000 !important;
		background: transparent !important;
		border-color: transparent !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel .h-6.w-6) {
		background: rgba(255, 255, 255, 0.34) !important;
		border: 1px solid rgba(255, 255, 255, 0.22) !important;
		border-radius: 0.75rem !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(10px) saturate(106%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(106%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel .border-t) {
		border-top-color: rgba(255, 255, 255, 0.16) !important;
	}

	/* llampart-frosted-glass-agentic-panel-regular-title-icons */
	:global(html.has-frosted-glass-theme .llampart-agentic-panel),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel *) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel svg),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel svg *) {
		stroke-width: 1.65 !important;
		filter: none !important;
	}
	/* llampart-frosted-glass-agentic-panel-title-glow-regular-final */
	:global(html.has-frosted-glass-theme .llampart-agentic-panel-title),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel-subtitle),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .text-xs),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .text-sm) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel svg),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel svg *) {
		stroke-width: 1.65 !important;
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.32)) !important;
	}

	/* llampart-tools-reasoning-radius-all-themes-targeted */
	:global(.llampart-agentic-panel) {
		border-radius: 0.75rem !important;
		overflow: hidden !important;
	}

	:global(.llampart-agentic-panel [data-slot='card']),
	:global(.llampart-agentic-panel [data-slot='card-header']),
	:global(.llampart-agentic-panel [data-slot='card-content']),
	:global(.llampart-agentic-panel [data-slot='card-footer']) {
		border-radius: inherit !important;
	}

	:global(.llampart-agentic-panel button),
	:global(.llampart-agentic-panel [role='button']) {
		border-radius: 0.75rem !important;
	}

	:global(.llampart-agentic-panel .h-6.w-6) {
		border-radius: 0.75rem !important;
	}

	:global(.llampart-agentic-panel .overflow-y-auto) {
		border-bottom-right-radius: 0.75rem !important;
		border-bottom-left-radius: 0.75rem !important;
	}
</style>
