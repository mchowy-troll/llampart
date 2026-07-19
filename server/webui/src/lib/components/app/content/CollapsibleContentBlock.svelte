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
