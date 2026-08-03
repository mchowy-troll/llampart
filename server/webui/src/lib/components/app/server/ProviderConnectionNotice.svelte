<script lang="ts">
	import { AlertTriangle, RefreshCw } from '@lucide/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { t } from '$lib/i18n';
	import {
		providerConnectionDisconnected,
		providerConnectionError,
		providerConnectionStatus,
		providerConnectionStore
	} from '$lib/stores/provider-connection.svelte';

	let disconnected = $derived(providerConnectionDisconnected());
	let errorMessage = $derived(providerConnectionError());
	let checking = $derived(providerConnectionStatus() === 'checking');
</script>

{#if disconnected}
	<Alert.Root variant="destructive">
		<AlertTriangle class="h-4 w-4" />
		<Alert.Title class="flex items-center justify-between gap-3">
			<span>{t('server.serverUnavailable')}</span>
			<button
				onclick={() => providerConnectionStore.check()}
				disabled={checking}
				class="inline-flex min-w-24 items-center justify-center gap-1.5 rounded-lg bg-destructive/20 px-2 py-1 text-xs font-medium hover:bg-destructive/30 disabled:opacity-50"
			>
				<RefreshCw class="h-3 w-3 {checking ? 'animate-spin' : ''}" />
				{checking ? t('server.retrying') : t('common.retry')}
			</button>
		</Alert.Title>
		<Alert.Description>
			{errorMessage || t('server.connectionErrorTryAgain')}
		</Alert.Description>
	</Alert.Root>
{/if}
