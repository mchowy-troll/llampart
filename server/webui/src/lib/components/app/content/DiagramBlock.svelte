<script lang="ts">
	import { tick } from 'svelte';
	import VisualizationHeader from './VisualizationHeader.svelte';
	import VisualizationPreview from './VisualizationPreview.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { t } from '$lib/i18n';
	import { diagramType } from '$lib/diagrams/mermaid-policy';
	import { diagramTypography } from '$lib/diagrams/mermaid-presentation';
	import { mountDiagram } from '$lib/diagrams/diagram-svg';
	import { diagramTitle } from '$lib/diagrams/diagram-title';
	import VisualizationFallback from './VisualizationFallback.svelte';

	let {
		source,
		allowed = true,
		contextTitle
	}: { source: string; allowed?: boolean; contextTitle?: string } = $props();
	let title = $derived(diagramTitle(source) || contextTitle || t('diagrams.title'));
	let frame: HTMLDivElement;
	let svg = $state('');
	let invalid = $state(false);
	let open = $state(false);
	let exporting = $state(false);
	let exportError = $state(false);
	let viewportRevision = $state(0);
	let viewportWidth = $state(0);
	function observeWidth(node: HTMLDivElement) {
		const observer = new ResizeObserver(([entry]) => (viewportWidth = entry.contentRect.width));
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}
	let lastTypography = '';
	let active: AbortController | undefined;
	let request = 0;
	let appearance = $derived.by(() => {
		// Presentation reads the transactional overlay; requests still use only
		// committed config through withChatInstructions()/the provider snapshot.
		const settings = settingsStore.appearanceConfig;
		return JSON.stringify([
			settings.fontFamily,
			settings.fontVariant,
			settings.fontSize,
			settings.uiScale,
			settings.theme,
			settings.frostedGlassWallpaper,
			settings.interfaceLanguage
		]);
	});

	$effect(() => {
		void appearance;
		const input = source;
		const enabled = allowed;
		void viewportRevision;
		const width = /^\s*(?:%%[^\n]*\n\s*)*gantt\b/.test(input) ? viewportWidth : undefined;
		const revision = ++request;
		let disposed = false;
		async function update() {
			await tick();
			if (disposed) return;
			const font = diagramTypography(frame);
			lastTypography = JSON.stringify(font);
			active?.abort();
			const controller = new AbortController();
			active = controller;
			svg = '';
			invalid = false;
			exportError = false;
			let stage: 'policy' | 'module' | 'render' = 'policy';
			try {
				if (!enabled) throw new Error('Diagram limit');
				diagramType(input);
				stage = 'module';
				const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
				stage = 'render';
				const result = await renderDiagram(input, font, controller.signal, 'rounded', width);
				if (!disposed && revision === request && !controller.signal.aborted) svg = result;
			} catch (error) {
				if (!disposed && revision === request && !controller.signal.aborted) {
					// Parser errors can contain the original source. Log the stage and
					// policy reason / parser line, not model/conversation content.
					const message = error instanceof Error ? error.message : '';
					const line = /^Parse error on line (\d+):/.exec(message)?.[1];
					console.error(
						`Mermaid ${stage} failed:`,
						stage === 'policy'
							? message
							: line
								? `Syntax error at line ${line}`
								: error instanceof Error
									? error.name
									: 'Unknown error'
					);
					invalid = true;
				}
			}
		}
		void update();
		return () => {
			disposed = true;
			active?.abort();
		};
	});

	async function download(format: 'png' | 'svg') {
		if (!svg || exporting) return;
		const snapshot = svg;
		const signal = active?.signal;
		exporting = true;
		exportError = false;
		try {
			const { exportDiagram } = await import('$lib/diagrams/diagram-export');
			await exportDiagram(snapshot, frame, format, title, signal);
		} catch {
			if (!signal?.aborted) exportError = true;
		} finally {
			exporting = false;
		}
	}
</script>

<svelte:window
	onresize={() => {
		if (frame && JSON.stringify(diagramTypography(frame)) !== lastTypography) viewportRevision++;
	}}
/>

<div bind:this={frame} use:observeWidth class="diagram-typography">
	{#if invalid}
		<VisualizationFallback {source} {title} kind="diagram" />
	{:else if svg}
		<figure class="llampart-visualization-frame llampart-diagram-frame" aria-label={title}>
			<VisualizationHeader
				{title}
				kind="diagram"
				formats={['png', 'svg']}
				{exporting}
				exportLabel={t('diagrams.export')}
				previewLabel={t('diagrams.preview')}
				onexport={(format) => download(format as 'png' | 'svg')}
				onpreview={() => (open = true)}
			/>
			<div class="diagram-surface" use:mountDiagram={{ svg, label: title }}></div>
			{#if exportError}<div class="diagram-error" role="alert">
					{t('diagrams.exportError')}
				</div>{/if}
		</figure>
	{:else}
		<div class="llampart-inline-processing-status" role="status">{t('diagrams.preparing')}</div>
	{/if}
</div>

<VisualizationPreview bind:open {title} kind="diagram">
	{#if svg}<div use:mountDiagram={{ svg, preview: true, label: title }}></div>{/if}
</VisualizationPreview>

<style>
	.diagram-typography {
		min-width: 0;
		max-width: 100%;
		font: inherit;
	}
	.diagram-surface {
		min-width: 0;
		overflow: hidden;
		padding: var(--llampart-visualization-body-space);
	}
	.diagram-error {
		padding: 0 1rem 1rem;
		font-size: 0.875em;
	}
</style>
