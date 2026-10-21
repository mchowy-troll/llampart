<script lang="ts">
	import { Eye } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import './visualization-frame.css';

	let {
		title,
		kind,
		formats,
		exporting,
		exportLabel,
		previewLabel,
		onexport,
		onpreview
	}: {
		title: string;
		kind: 'chart' | 'diagram';
		formats: readonly string[];
		exporting: boolean;
		exportLabel: string;
		previewLabel: string;
		onexport: (format: string) => void;
		onpreview: () => void;
	} = $props();
</script>

<header class="visualization-header {kind}-header">
	<span class="visualization-title {kind}-title">{title}</span>
	<div class="visualization-actions {kind}-actions">
		{#each formats as format (format)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							class="format-export-action"
							variant="ghost"
							size="sm"
							disabled={exporting}
							aria-label={`${exportLabel} ${format.toUpperCase()}`}
							onclick={() => onexport(format)}>{format.toUpperCase()}</Button
						>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{exportLabel} {format.toUpperCase()}</Tooltip.Content>
			</Tooltip.Root>
		{/each}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="visualization-preview-action"
						type="button"
						aria-label={previewLabel}
						onclick={onpreview}><Eye size={14} /></button
					>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{previewLabel}</Tooltip.Content>
		</Tooltip.Root>
	</div>
</header>
