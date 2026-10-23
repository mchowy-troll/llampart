<script lang="ts">
	import { Copy } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { copyCodeToClipboard } from '$lib/utils/clipboard';
	import { t } from '$lib/i18n';
	import MathPreview from './MathPreview.svelte';
	import VisualizationHeader from './VisualizationHeader.svelte';

	let { display, source }: { display: HTMLElement; source: string } = $props();
	let exporting = $state(false);
	let exportError = $state(false);
	let open = $state(false);
	let trigger = $state<HTMLButtonElement>();
	const controller = new AbortController();
	onDestroy(() => controller.abort());
	async function download(format: 'png' | 'svg') {
		if (exporting) return;
		exporting = true;
		exportError = false;
		try {
			const { exportMath } = await import('$lib/markdown/math-export');
			await exportMath(display, format, controller.signal);
		} catch {
			if (!controller.signal.aborted) exportError = true;
		} finally {
			exporting = false;
		}
	}
</script>

<VisualizationHeader
	kind="math"
	formats={['png', 'svg']}
	{exporting}
	exportLabel={t('math.export')}
	previewLabel={t('math.preview')}
	onexport={(format) => download(format as 'png' | 'svg')}
	onpreview={() => (open = true)}
	bind:previewTrigger={trigger}
>
	{#snippet beforePreview()}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						class="visualization-preview-action"
						aria-label={t('math.copySource')}
						onclick={() =>
							copyCodeToClipboard(
								source,
								t('common.codeCopiedToClipboard'),
								t('common.failedToCopyCode')
							)}><Copy size={14} /></button
					>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content role="tooltip">{t('math.copySource')}</Tooltip.Content>
		</Tooltip.Root>
	{/snippet}
</VisualizationHeader>
{#if exportError}<div class="math-export-error" role="alert">{t('math.exportError')}</div>{/if}
<MathPreview bind:open {display} {trigger} />
