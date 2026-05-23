<script lang="ts">
	import { t } from '$lib/i18n';
	import { Copy } from '@lucide/svelte';
	import { copyToClipboard } from '$lib/utils';

	interface Props {
		ariaLabel?: string;
		canCopy?: boolean;
		text: string;
	}

	let { ariaLabel = t('common.copyToClipboard'), canCopy = true, text }: Props = $props();
</script>

<Copy
	class="h-3 w-3 flex-shrink-0 cursor-{canCopy ? 'pointer' : 'not-allowed'}"
	aria-label={ariaLabel}
	onclick={() => canCopy && copyToClipboard(text)}
/>
