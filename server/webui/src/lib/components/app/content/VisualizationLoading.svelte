<script lang="ts">
	import type { ChartSpec } from '$lib/charts/chart-schema';
	import { chartPresentation } from '$lib/charts/chart-presentation';
	import { VISUALIZATION_LABEL_SIZE } from '$lib/utils/visualization-typography';
	import { t } from '$lib/i18n';
	import './visualization-frame.css';

	let { kind, spec }: { kind: 'chart' | 'diagram'; spec?: ChartSpec } = $props();
	let labels = $derived(spec ? chartPresentation(spec).entries.map((entry) => entry.label) : []);
</script>

<div
	class="llampart-visualization-loading"
	style:--llampart-visualization-label-size={VISUALIZATION_LABEL_SIZE}
	role="status"
	aria-busy="true"
>
	{#if spec?.description}
		<div class="visualization-loading-description" aria-hidden="true">{spec.description}</div>
	{/if}
	<div
		class="visualization-loading-body"
		class:visualization-loading-body--chart={kind === 'chart'}
		class:visualization-loading-body--diagram={kind === 'diagram'}
	>
		{t(kind === 'chart' ? 'charts.preparing' : 'diagrams.preparing')}
	</div>
	{#if spec}
		<div class="visualization-loading-legend" aria-hidden="true">
			{#each labels as label, index (index)}<span><i></i><span>{label}</span></span>{/each}
		</div>
	{/if}
</div>
