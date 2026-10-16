<script lang="ts">
	import type { ChartResult } from '$lib/charts/chart-schema';
	import { copyCodeToClipboard } from '$lib/utils/clipboard';
	import { t } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	let { result, source }: { result: ChartResult; source: string } = $props();
	let renderer = $derived(result.success ? import('./ChartFrame.svelte') : null);
</script>

{#snippet fallback()}
	<div class="llampart-chart-fallback code-block-wrapper">
		<div class="code-block-header">
			<span>{t('charts.invalid')}</span>
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
		<div class="code-block-scroll-container"><pre><code>{source}</code></pre></div>
	</div>
{/snippet}

{#if result.success && renderer}
	{#key source}
		<svelte:boundary>
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
