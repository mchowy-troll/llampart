<script lang="ts">
	import type { ChartResult } from '$lib/charts/chart-schema';
	import { t } from '$lib/i18n';
	import VisualizationFallback from './VisualizationFallback.svelte';
	import VisualizationLoading from './VisualizationLoading.svelte';
	import VisualizationHeader from './VisualizationHeader.svelte';
	import { chartSourceTitle } from '$lib/charts/chart-title';
	import { diagnostic, type VisualizationDiagnostic } from '$lib/visualizations/diagnostics';
	let {
		result,
		source,
		historical = false
	}: { result: ChartResult; source: string; historical?: boolean } = $props();
	let title = $derived(
		(result.success ? result.spec.title : chartSourceTitle(source)) || t('charts.title')
	);
	let valid = $derived(result.success);
	let renderer = $state<typeof import('./ChartFrame.svelte')>();
	let moduleFailed = $state(false);
	$effect(() => {
		if (!valid) return;
		let disposed = false;
		moduleFailed = false;
		void loadRenderer().then(
			(module) => {
				if (!disposed) renderer = module;
			},
			() => {
				if (!disposed) moduleFailed = true;
			}
		);
		return () => {
			disposed = true;
		};
	});

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

{#if result.success}
	{#key source}
		<svelte:boundary onerror={() => console.error('Chart rendering failed: chart.render')}>
			{#if moduleFailed}
				{@render fallback(diagnostic('chart.module'))}
			{:else if historical}
				<figure class="llampart-visualization-frame llampart-chart-frame" aria-label={title}>
					{#if renderer}
						<renderer.default spec={result.spec} embedded reveal />
					{:else}
						<VisualizationHeader
							{title}
							kind="chart"
							formats={['png', 'svg', 'csv']}
							exporting={false}
							unavailable
							exportLabel={t('charts.export')}
							previewLabel={t('charts.preview')}
							onexport={() => {}}
							onpreview={() => {}}
						/>
						<VisualizationLoading kind="chart" spec={result.spec} />
					{/if}
				</figure>
			{:else if renderer}
				<renderer.default spec={result.spec} />
			{:else}
				<div class="llampart-inline-processing-status" role="status">{t('charts.preparing')}</div>
			{/if}
			{#snippet failed()}{@render fallback(diagnostic('chart.render'))}{/snippet}
		</svelte:boundary>
	{/key}
{:else}
	{@render fallback(result.success ? diagnostic('chart.render') : result.diagnostic)}
{/if}
