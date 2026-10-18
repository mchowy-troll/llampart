<script lang="ts">
	import type { ChartResult } from '$lib/charts/chart-schema';
	import { t } from '$lib/i18n';
	import VisualizationFallback from './VisualizationFallback.svelte';
	import { chartSourceTitle } from '$lib/charts/chart-title';
	let { result, source }: { result: ChartResult; source: string } = $props();
	let title = $derived(
		(result.success ? result.spec.title : chartSourceTitle(source)) || t('charts.title')
	);
	let renderer = $derived(result.success ? loadRenderer() : null);

	async function loadRenderer() {
		try {
			return await import('./ChartFrame.svelte');
		} catch (error) {
			// A stale/unavailable module is not a schema validation failure.
			console.error('Chart renderer import failed:', error);
			throw error;
		}
	}
</script>

{#snippet fallback()}
	<VisualizationFallback {source} {title} kind="chart" />
{/snippet}

{#if result.success && renderer}
	{#key source}
		<svelte:boundary onerror={(error) => console.error('Chart rendering failed:', error)}>
			{#await renderer}
				<div class="llampart-inline-processing-status" role="status">{t('charts.preparing')}</div>
			{:then module}
				<module.default spec={result.spec} />
			{:catch}
				{@render fallback()}
			{/await}
			{#snippet failed()}{@render fallback()}{/snippet}
		</svelte:boundary>
	{/key}
{:else}
	{@render fallback()}
{/if}
