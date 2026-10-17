<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	let {
		open = $bindable(false),
		title,
		kind,
		children
	}: {
		open?: boolean;
		title: string;
		kind: 'chart' | 'diagram';
		children: Snippet;
	} = $props();
</script>

<!-- Same Dialog, dimensions, glass classes, focus handling and scroll pattern as tables. -->
<Dialog.Root bind:open>
	<Dialog.Content
		class="table-preview-dialog-content {kind}-preview-dialog-content z-[999999] flex !max-h-[80dvh] !w-[80vw] !max-w-[80vw] flex-col gap-0 overflow-hidden p-0"
	>
		<div class="table-preview-dialog visualization-preview-dialog">
			<div class="table-preview-header visualization-preview-header">
				<Dialog.Title class="table-preview-title">{title}</Dialog.Title>
			</div>
			<div class="table-preview-body">
				<div class="table-preview-wrapper visualization-preview-scroll {kind}-preview-scroll">
					{@render children()}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.visualization-preview-dialog {
		display: flex;
		flex-direction: column;
		min-height: 0;
		max-height: 80dvh;
	}
	.visualization-preview-header {
		display: flex;
		align-items: center;
		min-height: 3.25rem;
		padding: 0.75rem 3rem 0.75rem 1.25rem;
		border-bottom: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
	}
	.visualization-preview-header :global(.table-preview-title) {
		font-size: var(--llampart-text-unit, 1rem);
		font-weight: var(--llampart-font-semibold, 600);
		overflow-wrap: anywhere;
	}
	.table-preview-body {
		min-height: 0;
		padding: 1rem;
		overflow: hidden;
	}
	.visualization-preview-scroll {
		max-width: 100%;
		max-height: calc(80dvh - 5rem);
		overflow: auto;
	}
</style>
