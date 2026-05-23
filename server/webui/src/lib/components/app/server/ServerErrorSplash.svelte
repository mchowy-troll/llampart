<script lang="ts">
	import { AlertTriangle, RefreshCw, Key, CheckCircle, XCircle } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Label from '$lib/components/ui/label/label.svelte';
	import { serverStore, serverLoading } from '$lib/stores/server.svelte';
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import { validateConnectionSettings, normalizeServerBaseUrl } from '$lib/utils';
	import { fade, fly, scale } from 'svelte/transition';
	import { KeyboardKey } from '$lib/enums';

	interface Props {
		class?: string;
		error: string;
		onRetry?: () => void;
		showRetry?: boolean;
		showTroubleshooting?: boolean;
	}

	let {
		class: className = '',
		error,
		onRetry,
		showRetry = true,
		showTroubleshooting = false
	}: Props = $props();

	let isServerLoading = $derived(serverLoading());
	let isAccessDeniedError = $derived(
		error.toLowerCase().includes('access denied') ||
			error.toLowerCase().includes('invalid api key') ||
			error.toLowerCase().includes('unauthorized') ||
			error.toLowerCase().includes('401') ||
			error.toLowerCase().includes('403')
	);

	let serverAddressInput = $state('');
	let apiKeyInput = $state('');
	let showConnectionSettings = $state(false);
	let connectionState = $state<'idle' | 'validating' | 'success' | 'error'>('idle');
	let connectionError = $state('');

	function handleRetryConnection() {
		if (onRetry) {
			onRetry();
		} else {
			serverStore.fetch();
		}
	}

	function handleShowConnectionSettings() {
		showConnectionSettings = true;
		const currentConfig = config();
		serverAddressInput = currentConfig.serverBaseUrl?.toString() || '';
		apiKeyInput = currentConfig.apiKey?.toString() || '';
		connectionState = 'idle';
		connectionError = '';
	}

	async function handleSaveConnectionSettings() {
		connectionState = 'validating';
		connectionError = '';

		const validation = await validateConnectionSettings(serverAddressInput, apiKeyInput);

		if (!validation.ok) {
			connectionState = 'error';
			connectionError = validation.errorMessage || t('server.connectionErrorTryAgain');

			setTimeout(() => {
				connectionState = 'idle';
			}, 3000);

			return;
		}

		settingsStore.updateMultipleConfig({
			serverBaseUrl: normalizeServerBaseUrl(serverAddressInput),
			apiKey: apiKeyInput.trim()
		});

		connectionState = 'success';

		setTimeout(() => {
			goto(`#/`);
		}, 1000);
	}

	function handleConnectionSettingsKeydown(event: KeyboardEvent) {
		if (event.key === KeyboardKey.ENTER) {
			handleSaveConnectionSettings();
		}
	}
</script>

<div class="flex h-full items-center justify-center {className}">
	<div class="w-full max-w-md px-4 text-center">
		<div class="mb-6" in:fade={{ duration: 300 }}>
			<div
				class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10"
			>
				<AlertTriangle class="h-8 w-8 text-destructive" />
			</div>

			<h2 class="mb-2 text-xl font-semibold">{t('server.serverConnectionError')}</h2>

			<p class="mb-4 text-sm text-muted-foreground">
				{error}
			</p>
		</div>

		{#if !showConnectionSettings}
			<div in:fly={{ y: 10, duration: 300, delay: 200 }} class="mb-4">
				<Button onclick={handleShowConnectionSettings} variant="outline" class="w-full">
					<Key class="h-4 w-4" />
					{#if isAccessDeniedError}
						{t('server.editServerAddressApiKey')}
					{:else}
						{t('server.editConnectionSettings')}
					{/if}
				</Button>
			</div>
		{/if}

		{#if showConnectionSettings}
			<div in:fly={{ y: 10, duration: 300, delay: 200 }} class="mb-4 space-y-3 text-left">
				<div class="space-y-2">
					<Label for="server-address-input" class="text-sm font-medium"
						>{t('settings.serverAddress')}</Label
					>
					<Input
						id="server-address-input"
						placeholder={t('server.serverAddressPlaceholder')}
						bind:value={serverAddressInput}
						onkeydown={handleConnectionSettingsKeydown}
						disabled={connectionState === 'validating'}
					/>
					<p class="text-xs text-muted-foreground">
						{t('server.serverAddressHint')}
					</p>
				</div>

				<div class="space-y-2">
					<Label for="api-key-input" class="text-sm font-medium">{t('settings.apiKey')}</Label>

					<div class="relative">
						<Input
							id="api-key-input"
							placeholder={t('server.apiKeyPlaceholder')}
							bind:value={apiKeyInput}
							onkeydown={handleConnectionSettingsKeydown}
							class="w-full pr-10 {connectionState === 'error'
								? 'border-destructive'
								: connectionState === 'success'
									? 'border-green-500'
									: ''}"
							disabled={connectionState === 'validating'}
						/>
						{#if connectionState === 'validating'}
							<div class="absolute top-1/2 right-3 -translate-y-1/2">
								<RefreshCw class="h-4 w-4 animate-spin text-muted-foreground" />
							</div>
						{:else if connectionState === 'success'}
							<div
								class="absolute top-1/2 right-3 -translate-y-1/2"
								in:scale={{ duration: 200, start: 0.8 }}
							>
								<CheckCircle class="h-4 w-4 text-green-500" />
							</div>
						{:else if connectionState === 'error'}
							<div
								class="absolute top-1/2 right-3 -translate-y-1/2"
								in:scale={{ duration: 200, start: 0.8 }}
							>
								<XCircle class="h-4 w-4 text-destructive" />
							</div>
						{/if}
					</div>

					{#if connectionError}
						<p class="text-sm text-destructive" in:fly={{ y: -10, duration: 200 }}>
							{connectionError}
						</p>
					{/if}

					{#if connectionState === 'success'}
						<p class="text-sm text-green-600" in:fly={{ y: -10, duration: 200 }}>
							{t('server.connectionSettingsValidated')}
						</p>
					{/if}
				</div>

				<div class="flex gap-2">
					<Button
						onclick={handleSaveConnectionSettings}
						disabled={connectionState === 'validating' || connectionState === 'success'}
						class="flex-1"
					>
						{#if connectionState === 'validating'}
							<RefreshCw class="h-4 w-4 animate-spin" />
							{t('server.validating')}
						{:else if connectionState === 'success'}
							{t('server.success')}
						{:else}
							{t('server.saveAndRetry')}
						{/if}
					</Button>
					<Button
						onclick={() => {
							showConnectionSettings = false;
							connectionState = 'idle';
							connectionError = '';
						}}
						variant="outline"
						class="flex-1"
						disabled={connectionState === 'validating'}
					>
						{t('common.cancel')}
					</Button>
				</div>
			</div>
		{/if}

		{#if showRetry}
			<div in:fly={{ y: 10, duration: 300, delay: 200 }}>
				<Button onclick={handleRetryConnection} disabled={isServerLoading} class="w-full">
					{#if isServerLoading}
						<RefreshCw class="h-4 w-4 animate-spin" />
						{t('server.connectingToServer')}
					{:else}
						<RefreshCw class="h-4 w-4" />
						{t('server.retryConnection')}
					{/if}
				</Button>
			</div>
		{/if}

		{#if showTroubleshooting}
			<div class="mt-4 text-left" in:fly={{ y: 10, duration: 300, delay: 400 }}>
				<details class="text-sm">
					<summary class="cursor-pointer text-muted-foreground hover:text-foreground">
						{t('server.troubleshooting')}
					</summary>

					<div class="mt-2 space-y-3 text-xs text-muted-foreground">
						<div class="space-y-2">
							<p class="mb-4 font-medium">{t('server.startLlamaServer')}</p>

							<div class="rounded bg-muted/50 px-2 py-1 font-mono text-xs">
								<p>llama-server -hf ggml-org/gemma-3-4b-it-GGUF</p>
							</div>

							<p>{t('common.or')}</p>

							<div class="rounded bg-muted/50 px-2 py-1 font-mono text-xs">
								<p class="mt-1">llama-server -m locally-stored-model.gguf</p>
							</div>
						</div>
						<ul class="list-disc space-y-1 pl-4">
							<li>{t('server.checkServerUrl')}</li>
							<li>{t('server.verifyNetworkConnection')}</li>
							<li>{t('server.checkServerLogs')}</li>
						</ul>
					</div>
				</details>
			</div>
		{/if}
	</div>
</div>
