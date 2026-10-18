<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertTriangle, RefreshCw, Settings } from '@lucide/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';
	import { getChatSettingsDialogContext } from '$lib/contexts';
	import { SETTINGS_SECTION_TITLES } from '$lib/constants';
	import { getApiProvider } from '$lib/services/providers';
	import { config } from '$lib/stores/settings.svelte';
	import {
		providerConnectionDisconnected,
		providerConnectionStore
	} from '$lib/stores/provider-connection.svelte';

	const settings = getChatSettingsDialogContext();
	let disconnected = $derived(providerConnectionDisconnected());
	let provider = $derived(getApiProvider(String(config().apiProvider)).label);

	// Revalidate only connectivity, never generation. A failed probe must not
	// clear the notice; the store clears it only after a successful validation.
	onMount(() => {
		const check = () => {
			if (providerConnectionDisconnected() && document.visibilityState === 'visible')
				void providerConnectionStore.check();
		};
		const interval = window.setInterval(check, 15000);
		window.addEventListener('online', check);
		window.addEventListener('focus', check);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener('online', check);
			window.removeEventListener('focus', check);
		};
	});
</script>

{#if disconnected}
	<Alert.Root
		class="llampart-provider-connection-notice z-20 border-border/50 bg-card/80 shadow-sm backdrop-blur-xl"
	>
		<AlertTriangle class="h-4 w-4" />
		<Alert.Title>
			{t(
				providerConnectionStore.authenticationError
					? 'server.authenticationRequired'
					: 'server.serverUnavailable'
			)} · {provider}
		</Alert.Title>
		<Alert.Description>
			<p class="connection-message">
				{t(
					providerConnectionStore.authenticationError
						? 'server.invalidApiKeyCheckTryAgain'
						: 'server.connectionUnavailableHelp'
				)}
			</p>
			<div class="connection-actions">
				<Button variant="outline" size="sm" onclick={() => window.location.reload()}>
					<RefreshCw class="h-4 w-4" />{t('server.refreshPage')}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() => settings.open(SETTINGS_SECTION_TITLES.GENERAL)}
				>
					<Settings class="h-4 w-4" />{t('server.connectionSettings')}
				</Button>
			</div>
		</Alert.Description>
	</Alert.Root>
{/if}

<style>
	.connection-message {
		margin: 0 0 0.75rem;
		overflow-wrap: anywhere;
	}
	.connection-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.connection-actions :global(button) {
		max-width: 100%;
		height: auto;
		min-height: 2rem;
		white-space: normal;
	}
</style>
