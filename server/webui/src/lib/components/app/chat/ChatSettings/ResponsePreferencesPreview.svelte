<script lang="ts">
	import { Copy } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { copyToClipboard } from '$lib/utils';
	import { buildResponsePreferenceInstructions } from '$lib/utils/response-preferences';

	let { localConfig }: { localConfig: SettingsConfigType } = $props();
	let instructions = $derived(buildResponsePreferenceInstructions(localConfig));
</script>

<details class="mt-5 border-t border-border/30 pt-3">
	<summary
		class="cursor-pointer rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-ring"
	>
		{t('settings.responsePreferencesPreview')}
	</summary>
	<div class="mt-3 space-y-2">
		{#if instructions}
			<button
				type="button"
				class="inline-flex items-center gap-2 rounded-md p-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
				onclick={() => copyToClipboard(instructions)}
			>
				<Copy class="h-3.5 w-3.5" aria-hidden="true" />
				{t('common.copyToClipboard')}
			</button>
			<pre
				class="max-w-full rounded-lg bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words"
				data-response-instructions>{instructions}</pre>
		{:else}
			<p class="text-xs text-muted-foreground">{t('settings.responsePreferencesEmpty')}</p>
		{/if}
	</div>
</details>
