<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import DialogCodePreview from '$lib/components/app/dialogs/DialogCodePreview.svelte';
	import { copyCodeToClipboard } from '$lib/utils/clipboard';
	import { t } from '$lib/i18n';

	let { source, title, kind }: { source: string; title: string; kind: 'diagram' | 'chart' } =
		$props();
	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
</script>

<div class="llampart-visualization-frame llampart-visualization-fallback llampart-{kind}-fallback">
	<div class="fallback-title">{title}</div>
	<div role="status" class="fallback-message">
		<p>{t(kind === 'diagram' ? 'diagrams.invalid' : 'charts.invalid')}</p>
		{#if kind === 'chart'}<p>{t('charts.inspectDefinition')}</p>{/if}
	</div>
	<div class="fallback-actions">
		<Button bind:ref={trigger} variant="outline" size="sm" onclick={() => (open = true)}
			>{t('common.showCode')}</Button
		>
		<Button
			variant="ghost"
			size="sm"
			onclick={() =>
				copyCodeToClipboard(
					source,
					t('common.codeCopiedToClipboard'),
					t('common.failedToCopyCode')
				)}>{t('common.copyCode')}</Button
		>
	</div>
</div>

<DialogCodePreview
	bind:open
	code={source}
	language={kind === 'diagram' ? 'mermaid' : 'json'}
	sourceOnly
	returnFocus={trigger}
/>

<style>
	.llampart-visualization-fallback {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		overflow-wrap: anywhere;
		padding: 1rem;
		font-size: 0.875em;
	}
	.fallback-title {
		font-weight: var(--llampart-font-semibold, 600);
		margin-bottom: 0.25rem;
		max-height: 3.5em;
		overflow: auto;
	}
	.fallback-message p {
		margin: 0;
	}
	.fallback-message p + p {
		margin-top: 0.75em;
	}
	.fallback-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.fallback-actions :global(button) {
		max-width: 100%;
		white-space: normal;
	}
</style>
