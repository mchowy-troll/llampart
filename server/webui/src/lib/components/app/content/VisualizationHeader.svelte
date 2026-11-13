<script lang="ts">
	import { Eye } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import './visualization-frame.css';

	let {
		title,
		kind,
		formats,
		exporting,
		unavailable = false,
		exportLabel,
		previewLabel,
		onexport,
		onpreview,
		beforePreview,
		previewTrigger = $bindable<HTMLButtonElement>()
	}: {
		title?: string;
		kind: 'chart' | 'diagram' | 'math';
		formats: readonly string[];
		exporting: boolean;
		unavailable?: boolean;
		exportLabel: string;
		previewLabel: string;
		onexport: (format: string) => void;
		onpreview: () => void;
		beforePreview?: Snippet;
		previewTrigger?: HTMLButtonElement;
	} = $props();
</script>

<header class="visualization-header {kind}-header">
	{#if title}<span class="visualization-title {kind}-title">{title}</span>{/if}
	<div class="visualization-actions {kind}-actions">
		{#each formats as format (format)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							class="format-export-action"
							variant="text-action"
							size="sm"
							disabled={exporting || unavailable}
							aria-label={`${exportLabel} ${format.toUpperCase()}`}
							onclick={() => onexport(format)}>{format.toUpperCase()}</Button
						>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{exportLabel} {format.toUpperCase()}</Tooltip.Content>
			</Tooltip.Root>
		{/each}
		{@render beforePreview?.()}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						bind:this={previewTrigger}
						class="visualization-preview-action"
						type="button"
						disabled={unavailable}
						aria-label={previewLabel}
						onclick={onpreview}><Eye size={14} /></button
					>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{previewLabel}</Tooltip.Content>
		</Tooltip.Root>
	</div>
</header>
