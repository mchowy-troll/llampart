<script lang="ts">
	import {
		LineChart,
		BarChart,
		AreaChart,
		PieChart as DonutChart,
		Spline,
		Area,
		Points,
		Tooltip as ChartTooltip
	} from 'layerchart/svg';
	import { formatChartValue, type ChartSpec } from '$lib/charts/chart-schema';
	import { chartCsv, chartFilename, downloadChartBlob } from '$lib/charts/chart-csv';
	import VisualizationHeader from './VisualizationHeader.svelte';
	import VisualizationPreview from './VisualizationPreview.svelte';
	import ChartFrame from './ChartFrame.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { t, getInterfaceLanguage } from '$lib/i18n';
	import { tick, untrack } from 'svelte';
	import ChartSlice from './ChartSlice.svelte';
	import { donutTooltipValues } from '$lib/charts/chart-donut-tooltip';
	import { chartPresentation } from '$lib/charts/chart-presentation';
	import { chartAxisLayout, categoryAxis } from '$lib/charts/chart-axis-layout';
	import {
		STATIC_CHART_POINTS,
		HOVER_CHART_POINTS,
		showStaticChartPoints
	} from '$lib/charts/chart-points';
	import { applyChartPalette } from '$lib/themes/frosted-glass/chart-surface';
	import { curveMonotoneX, curveLinear } from 'd3-shape';
	import { prefersReducedMotion } from 'svelte/motion';
	import { VISUALIZATION_LABEL_SIZE } from '$lib/utils/visualization-typography';

	let {
		spec,
		previewMode = false,
		initialHidden = []
	}: {
		spec: ChartSpec;
		previewMode?: boolean;
		initialHidden?: string[];
	} = $props();
	let frame: HTMLElement;
	let plot: HTMLDivElement;
	let plotWidth = $state(0);
	let axisMetrics = $state({ size: 0, category: 0, number: 0 });
	let axisMeasure = $state.raw<(text: string) => number>(() => 0);
	let numericTicks = $state<string[]>([]);
	let categoryRows = $state(1);

	function observePlot(node: HTMLDivElement) {
		const observer = new ResizeObserver(([entry]) => (plotWidth = entry.contentRect.width));
		observer.observe(node);
		const labels = new MutationObserver(() => {
			const values = [...node.querySelectorAll('.chart-value-tick')].map(
				(n) => n.textContent || ''
			);
			if (values.join('\n') !== numericTicks.join('\n')) numericTicks = values;
			categoryRows = Math.max(
				1,
				...[...node.querySelectorAll('.chart-category-tick')].map(
					(n) => n.querySelectorAll('tspan').length
				)
			);
		});
		labels.observe(node, { childList: true, characterData: true, subtree: true });
		return {
			destroy: () => {
				observer.disconnect();
				labels.disconnect();
			}
		};
	}

	$effect(() => {
		void settingsStore.appearanceConfig;
		void plotWidth;
		const current = spec;
		const renderedNumbers = numericTicks;
		let disposed = false;
		void tick().then(async () => {
			await document.fonts.ready;
			if (disposed || !frame || !('series' in current)) return;
			// Measure the rendered label font, not the larger frame title font.
			const css = getComputedStyle(plot);
			const context = document.createElement('canvas').getContext('2d');
			if (!context) return;
			context.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
			const measure = (value: string) => context.measureText(value).width;
			axisMeasure = measure;
			axisMetrics = {
				size: parseFloat(css.fontSize),
				category: Math.max(0, ...current.data.map((row) => measure(String(row[current.xKey])))),
				number: Math.max(
					...renderedNumbers.map(measure),
					measure(axisNumber(0)),
					...current.data.flatMap((row) =>
						current.series.map((series) => measure(axisNumber(Number(row[series.key]))))
					)
				)
			};
		});
		return () => {
			disposed = true;
		};
	});
	let hidden = $state<string[]>([]);
	let exporting = $state(false);
	let exportError = $state(false);
	let paletteStyle = $state('');
	let previewOpen = $state(false);
	let previewTypography = $state('');
	const chartId = $props.id();
	const gradientId = (index: number) => `${chartId}-area-${index}`;
	// Categorical x is ordered by the input. Numeric x is never sorted for decoration.
	let curve = $derived(
		'xKey' in spec &&
			typeof spec.data[0][spec.xKey] === 'number' &&
			!spec.data.every(
				(row, i) => i === 0 || Number(row[spec.xKey]) > Number(spec.data[i - 1][spec.xKey])
			)
			? curveLinear
			: curveMonotoneX
	);
	$effect(() => {
		void spec;
		hidden = untrack(() => [...initialHidden]);
		previewOpen = false;
	});
	$effect(() => {
		void settingsStore.appearanceConfig;
		void previewOpen;
		let disposed = false;
		void tick().then(() => {
			if (disposed || !frame || previewMode) return;
			const css = getComputedStyle(frame);
			previewTypography = [
				'font-family',
				'font-size',
				'font-weight',
				'font-style',
				'--llampart-text-unit'
			]
				.map((key) => `${key}:${css.getPropertyValue(key)}`)
				.join(';');
		});
		return () => {
			disposed = true;
		};
	});
	let presentation = $derived(chartPresentation(spec));
	let entries = $derived(presentation.entries);
	let visible = $derived(entries.filter((entry) => !hidden.includes(entry.key)));
	let data = $derived(
		'series' in spec
			? presentation.data
			: presentation.data.filter((row) => !hidden.includes(String(row[spec.labelKey])))
	);
	let series = $derived(
		visible.map((entry) => ({
			key: entry.key,
			label: entry.label,
			value: (row: Record<string, string | number>) => row[entry.key],
			color: entry.color
		}))
	);
	const numericFormat = (value: number) => formatChartValue(spec, value, getInterfaceLanguage());
	const axisNumber = (value: number) =>
		Math.abs(value) >= 1e6
			? new Intl.NumberFormat(getInterfaceLanguage(), {
					notation: 'compact',
					style: spec.format === 'percent' ? 'percent' : 'decimal',
					maximumFractionDigits: 1
				}).format(value)
			: numericFormat(value);
	let horizontal = $derived('orientation' in spec && spec.orientation === 'horizontal');
	let numericX = $derived('xKey' in spec && typeof spec.data[0][spec.xKey] === 'number');
	// Categorical points sit at band centers. Nearest band-start lookup can
	// select the adjacent category at that midpoint after font/margin changes.
	let tooltipContext = $derived(
		'xKey' in spec && typeof spec.data[0][spec.xKey] === 'string'
			? { mode: 'bisect-band' as const }
			: true
	);
	let axisLayout = $derived(
		chartAxisLayout(
			plotWidth,
			horizontal,
			axisMetrics,
			'series' in spec && !!(horizontal ? spec.yLabel : spec.xLabel),
			'series' in spec && !!(horizontal ? spec.xLabel : spec.yLabel),
			'series' in spec ? data.map((row) => String(row[spec.xKey])) : [],
			axisMeasure,
			horizontal ? 1 : categoryRows
		)
	);
	let axisGap = $derived(axisLayout.gap);
	let yTickWidth = $derived(axisLayout.yTickWidth);
	let plotPadding = $derived(axisLayout.padding);
	let categoryLabels = $derived(
		categoryAxis(
			plotWidth,
			horizontal,
			plotPadding,
			axisLayout.categoryWidth,
			axisMetrics.size,
			axisMeasure
		)
	);
	let axisTextProps = $derived({
		fontSize: axisMetrics.size,
		capHeight: `${axisMetrics.size * 0.71}px`,
		// LayerChart resolves em against a fixed base, not the inherited axis font.
		lineHeight: `${axisMetrics.size * 1.5}px`
	});
	let donutTotal = $derived(
		'valueKey' in spec ? data.reduce((sum, row) => sum + Number(row[spec.valueKey]), 0) : 0
	);
	let chartProps = $derived({
		xAxis: {
			rule: false,
			tickLength: 0,
			ticks: horizontal || numericX ? axisLayout.ticks : categoryLabels.ticks,
			tickOcclusion:
				horizontal || numericX ? { padding: axisGap, priority: 'start-end' as const } : false,
			tickLabelProps: {
				...axisTextProps,
				dy: axisGap + axisMetrics.size * 0.3,
				class: horizontal || numericX ? 'chart-value-tick' : 'chart-category-tick',
				truncate: false
			},
			labelProps: { ...axisTextProps, dy: -axisGap },
			label: 'series' in spec ? (horizontal ? spec.yLabel : spec.xLabel) : undefined,
			format: horizontal ? axisNumber : numericX ? String : categoryLabels.format
		},
		yAxis: {
			rule: false,
			tickLength: 0,
			ticks: horizontal ? categoryLabels.ticks : 5,
			tickOcclusion: horizontal ? false : { padding: axisGap, priority: 'start-end' as const },
			label: 'series' in spec ? (horizontal ? spec.xLabel : spec.yLabel) : undefined,
			labelProps: { ...axisTextProps, x: -(yTickWidth + axisGap + axisMetrics.size * 1.5) },
			tickLabelProps: {
				...axisTextProps,
				dx: -axisGap,
				class: horizontal ? 'chart-category-tick' : 'chart-value-tick',
				truncate: false
			},
			format: horizontal ? categoryLabels.format : axisNumber
		},
		svg: { 'aria-label': spec.title || t('charts.title'), role: 'img' as const },
		grid: { x: horizontal, y: !horizontal },
		highlight: { motion: 'none' as const, points: HOVER_CHART_POINTS }
	});
	let barProps = $derived({
		...chartProps,
		// ChartChildren merges props.highlight AFTER highlight={...}; override points here.
		highlight: { ...chartProps.highlight, points: false },
		bars: { stroke: 'none', strokeWidth: 0, radius: 4, rounded: 'edge' as const }
	});
	let donutProps = $derived({
		...chartProps,
		// D3's default descending angle sort must not override presentation order.
		pie: { sort: null },
		// PieChart has no top-level highlight API; disable Cartesian marks in its
		// native ChartChildren props, independently of Arc's tooltip/active state.
		highlight: { motion: 'none' as const, points: false, lines: false, area: false, bar: false },
		arc: { stroke: 'var(--llampart-chart-separator, rgb(255 255 255 / 0.25))', strokeWidth: 1.5 }
	});
	function toggle(key: string) {
		hidden = hidden.includes(key)
			? hidden.filter((value) => value !== key)
			: visible.length > 1
				? [...hidden, key]
				: hidden;
	}
	async function download(format: 'png' | 'svg' | 'csv') {
		if (exporting) return;
		exporting = true;
		exportError = false;
		try {
			if (format === 'csv')
				downloadChartBlob(
					new Blob([chartCsv(spec)], { type: 'text/csv;charset=utf-8' }),
					`${chartFilename(spec.title)}.csv`
				);
			else {
				await document.fonts.ready;
				await tick();
				await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				const { exportChart } = await import('$lib/charts/chart-export');
				await exportChart(frame, plot, format, chartFilename(spec.title));
			}
		} catch (error) {
			console.error('Chart export failed:', error);
			exportError = true;
		} finally {
			exporting = false;
		}
	}
</script>

{#snippet tooltip({ context }: { context: import('layerchart').ChartState })}
	<ChartTooltip.Root
		{context}
		portal
		contained="window"
		variant="none"
		class="llampart-chart-tooltip"
		props={{
			root: {
				class: `llampart-chart-tooltip-root${previewMode ? ' chart-preview-tooltip-root' : ''}`
			}
		}}
		motion="none"
		fadeDuration={prefersReducedMotion.current || exporting ? 0 : 90}
	>
		{#snippet children({ data })}
			{#if data}
				<div
					class="chart-tooltip-content"
					style={paletteStyle}
					style:--llampart-visualization-label-size={VISUALIZATION_LABEL_SIZE}
					role="status"
				>
					{#if 'series' in spec}
						<strong>{data[spec.xKey]}</strong>
						{#each visible as entry (entry.key)}
							<div class="chart-tooltip-row">
								<span class="chart-swatch" style:background={entry.color}></span>
								<span>{entry.label}</span><span class="chart-tooltip-value"
									>{numericFormat(Number(data[entry.key]))}</span
								>
							</div>
						{/each}
					{:else}
						{@const values = donutTooltipValues(
							spec,
							Number(data[spec.valueKey]),
							donutTotal,
							getInterfaceLanguage()
						)}
						<div class="chart-tooltip-row">
							<span
								class="chart-swatch"
								style:background={entries.find((entry) => entry.key === String(data[spec.labelKey]))
									?.color}
							></span>
							<strong>{data[spec.labelKey]}</strong>
							{#if values.value === null}<span class="chart-tooltip-value">— {values.share}</span
								>{/if}
						</div>
						{#if values.value !== null}<div>
								{t('charts.value')}: {values.value} · {t('charts.share')}: {values.share}
							</div>{/if}
					{/if}
				</div>
			{/if}
		{/snippet}
	</ChartTooltip.Root>
{/snippet}

<figure
	bind:this={frame}
	use:applyChartPalette={(styles) => {
		paletteStyle = styles;
	}}
	style={paletteStyle}
	style:--llampart-visualization-label-size={VISUALIZATION_LABEL_SIZE}
	class={previewMode
		? 'llampart-chart-renderer chart-live-preview'
		: 'llampart-visualization-frame llampart-chart-frame llampart-chart-renderer'}
	class:chart-exporting={exporting}
	aria-label={spec.title || t('charts.title')}
>
	{#if !previewMode}<VisualizationHeader
			title={spec.title || t('charts.title')}
			kind="chart"
			formats={['png', 'svg', 'csv']}
			{exporting}
			exportLabel={t('charts.export')}
			previewLabel={t('charts.preview')}
			onexport={(format) => download(format as 'png' | 'svg' | 'csv')}
			onpreview={() => (previewOpen = true)}
		/>{/if}
	{#if spec.description}<div class="chart-description">{spec.description}</div>{/if}
	<div bind:this={plot} use:observePlot class="chart-plot">
		{#if 'series' in spec}
			{#if spec.type === 'bar'}
				<BarChart
					{data}
					{series}
					props={barProps}
					{tooltip}
					padding={plotPadding}
					x={spec.orientation === 'horizontal' ? undefined : (row) => row[spec.xKey]}
					y={spec.orientation === 'horizontal' ? (row) => row[spec.xKey] : undefined}
					orientation={spec.orientation}
					seriesLayout="group"
					rule={false}
					bandPadding={0.3}
					groupPadding={0.14}
					highlight={exporting ? false : { area: true }}
					motion="none"
					legend={false}
				/>
			{:else if spec.type === 'area'}
				<AreaChart
					{tooltipContext}
					{data}
					{series}
					props={chartProps}
					{tooltip}
					padding={plotPadding}
					x={(row) => row[spec.xKey]}
					seriesLayout="overlap"
					rule={false}
					highlight={exporting ? false : { points: true, lines: false }}
					motion="none"
					legend={false}
				>
					{#snippet marks({ context })}
						{#each context.series.visibleSeries as item (item.key)}
							{@const index = entries.findIndex((entry) => entry.key === item.key)}
							<defs
								><linearGradient id={gradientId(index)} x1="0" y1="0" x2="0" y2="1"
									><stop offset="0%" stop-color={item.color} stop-opacity="0.38" /><stop
										offset="100%"
										stop-color={item.color}
										stop-opacity="0.025"
									/></linearGradient
								></defs
							>
							<Area seriesKey={item.key} {curve} fill={`url(#${gradientId(index)})`} />
							<Spline class="chart-series-line" seriesKey={item.key} {curve} strokeWidth={2.25} />
							{#if showStaticChartPoints(data.length)}<Points
									seriesKey={item.key}
									{...STATIC_CHART_POINTS}
									fill={item.color}
								/>{/if}
						{/each}
					{/snippet}
				</AreaChart>
			{:else}
				<LineChart
					{tooltipContext}
					rule={false}
					{data}
					{series}
					props={chartProps}
					{tooltip}
					padding={plotPadding}
					x={(row) => row[spec.xKey]}
					motion="none"
					legend={false}
					highlight={exporting ? false : { points: true, lines: false }}
				>
					{#snippet marks({ context })}
						{#each context.series.visibleSeries as item (item.key)}
							<Spline class="chart-series-line" seriesKey={item.key} {curve} strokeWidth={2.25} />
							{#if showStaticChartPoints(data.length)}<Points
									seriesKey={item.key}
									{...STATIC_CHART_POINTS}
									fill={item.color}
								/>{/if}
						{/each}
					{/snippet}
				</LineChart>
			{/if}
		{:else}
			<DonutChart
				{data}
				{tooltip}
				props={donutProps}
				key={(row) => row[spec.labelKey]}
				label={(row) => row[spec.labelKey]}
				value={(row) => row[spec.valueKey]}
				c={(row: Record<string, string | number>) => row[spec.labelKey]}
				cDomain={entries.map((entry) => entry.key)}
				cRange={entries.map((entry) => entry.color)}
				motion="none"
				legend={false}
			>
				{#snippet arc({ props, context })}
					{@const row = props.data as Record<string, string | number>}
					<ChartSlice
						arcProps={props}
						radius={Math.max(0, Math.min(context.width, context.height) / 2 - 8)}
						active={context.tooltip.data === row}
						{exporting}
					/>
				{/snippet}
			</DonutChart>
		{/if}
	</div>
	<div class="chart-legend" aria-label={t('charts.legend')}>
		{#each entries as entry (entry.key)}
			<button
				type="button"
				aria-pressed={!hidden.includes(entry.key)}
				onclick={() => toggle(entry.key)}
			>
				<span class="chart-swatch" style:background={entry.color}></span><span>{entry.label}</span>
			</button>
		{/each}
	</div>
	{#if exportError}<div class="chart-export-error" role="alert">{t('charts.exportError')}</div>{/if}
</figure>

{#if !previewMode}
	<VisualizationPreview
		bind:open={previewOpen}
		title={spec.title || t('charts.title')}
		kind="chart"
	>
		<div style={previewTypography}>
			<ChartFrame {spec} previewMode initialHidden={hidden} />
		</div>
	</VisualizationPreview>
{/if}

<style>
	.chart-live-preview {
		margin: 0;
		min-width: min(38rem, 70vw);
		font: inherit;
		color: var(--foreground);
	}
	.chart-live-preview .chart-plot {
		height: clamp(20rem, 48dvh, 36rem);
	}
	.chart-description {
		padding: 0.75rem 1rem 0;
		font-size: var(--llampart-visualization-label-size);
	}
	.chart-plot {
		height: 20rem;
		min-width: 0;
		margin: var(--llampart-visualization-body-space);
		font-size: var(--llampart-visualization-label-size);
	}
	.chart-plot :global(text) {
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		font-synthesis: none;
		text-shadow: none !important;
		stroke: none !important;
	}
	.chart-plot :global(.lc-axis) {
		color: var(--foreground);
	}
	.chart-plot :global(.lc-grid .lc-line) {
		stroke: currentColor;
		opacity: 0.09;
		stroke-dasharray: none;
	}
	.chart-plot :global(.lc-axis text) {
		opacity: 1;
	}
	.chart-plot :global(.lc-highlight-point) {
		filter: none;
		pointer-events: none;
		transition: r 120ms ease;
	}
	.chart-plot :global(.lc-bars-bar) {
		transition: filter 120ms ease;
	}
	.chart-plot :global(.lc-bars-bar:hover) {
		filter: brightness(1.07);
	}
	.chart-plot :global(.chart-slice) {
		transition: filter 120ms ease;
	}
	.chart-plot :global(.chart-slice:hover) {
		filter: brightness(1.045);
	}
	.chart-plot :global(.chart-series-line) {
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.chart-exporting .chart-plot {
		pointer-events: none;
	}
	.chart-exporting .chart-plot :global(*) {
		transition: none !important;
		filter: none !important;
	}
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.35rem 1rem;
		padding: 0 1rem 1rem;
	}
	.chart-legend button {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		max-width: 100%;
		font: inherit;
		font-size: var(--llampart-visualization-label-size);
		text-align: left;
		overflow-wrap: anywhere;
		cursor: pointer;
		border-radius: 0.25rem;
		padding: 0.2rem;
	}
	.chart-legend button[aria-pressed='false'] {
		opacity: 0.45;
		text-decoration: line-through;
	}
	.chart-legend button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
	.chart-swatch {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 0.15rem;
		flex-shrink: 0;
	}
	.chart-export-error {
		padding: 0 1rem 1rem;
		font-size: calc(var(--llampart-text-unit, 1rem) * 0.875);
	}
	:global(.llampart-chart-tooltip-root) {
		z-index: 999999 !important;
	}
	:global(.chart-preview-tooltip-root) {
		z-index: 1000000 !important;
	}
	:global(.llampart-chart-tooltip) {
		font: inherit !important;
		font-synthesis: none;
		text-shadow: none !important;
		max-width: min(24rem, 90vw);
		overflow-wrap: anywhere;
	}
	.chart-tooltip-content {
		padding: 0.6rem 0.8rem;
		background: var(--popover);
		color: var(--popover-foreground);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		font-family: inherit;
		font-size: var(--llampart-visualization-label-size);
		line-height: 1.6;
		text-shadow: none;
	}
	.chart-tooltip-content > strong {
		display: block;
		margin-bottom: 0.3rem;
		font-weight: var(--llampart-font-medium, 500);
	}
	.chart-tooltip-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
	}
	.chart-tooltip-value {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	@media (prefers-reduced-motion: reduce) {
		.chart-plot :global(*) {
			transition: none !important;
		}
	}
</style>
