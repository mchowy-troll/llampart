<script lang="ts">
	import type { ChartResult } from '$lib/charts/chart-schema';
	import { t } from '$lib/i18n';
	import VisualizationFallback from './VisualizationFallback.svelte';
	import { chartSourceTitle } from '$lib/charts/chart-title';
	import { diagnostic, type VisualizationDiagnostic } from '$lib/visualizations/diagnostics';
	let { result, source }: { result: ChartResult; source: string } = $props();
	let title = $derived(
		(result.success ? result.spec.title : chartSourceTitle(source)) || t('charts.title')
	);
	let renderer = $derived(result.success ? loadRenderer() : null);

	async function loadRenderer() {
		try {
			return await import('./ChartFrame.svelte');
		} catch {
			// A stale/unavailable module is not a schema validation failure.
			console.error('Chart renderer import failed: chart.module');
			throw new Error('chart.module');
		}
	}
</script>

{#snippet fallback(problem: VisualizationDiagnostic)}
	<VisualizationFallback {source} {title} kind="chart" {problem} />
{/snippet}

{#if result.success && renderer}
	{#key source}
		<svelte:boundary onerror={() => console.error('Chart rendering failed: chart.render')}>
			{#await renderer}
				<div class="llampart-inline-processing-status" role="status">{t('charts.preparing')}</div>
			{:then module}
				<module.default spec={result.spec} />
			{:catch}
				{@render fallback(diagnostic('chart.module'))}
			{/await}
			{#snippet failed()}{@render fallback(diagnostic('chart.render'))}{/snippet}
		</svelte:boundary>
	{/key}
{:else}
	{@render fallback(result.success ? diagnostic('chart.render') : result.diagnostic)}
{/if}
