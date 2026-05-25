<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { KeyValuePairs } from '$lib/components/app';
	import type { KeyValuePair } from '$lib/types';
	import { parseHeadersToArray, serializeHeaders } from '$lib/utils';
	import { UrlProtocol } from '$lib/enums';
	import { MCP_SERVER_URL_PLACEHOLDER } from '$lib/constants';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { t } from '$lib/i18n';

	interface Props {
		url: string;
		headers: string;
		useProxy?: boolean;
		onUrlChange: (url: string) => void;
		onHeadersChange: (headers: string) => void;
		onUseProxyChange?: (useProxy: boolean) => void;
		urlError?: string | null;
		id?: string;
	}

	let {
		url,
		headers,
		useProxy = false,
		onUrlChange,
		onHeadersChange,
		onUseProxyChange,
		urlError = null,
		id = 'server'
	}: Props = $props();

	let isWebSocket = $derived(
		url.toLowerCase().startsWith(UrlProtocol.WEBSOCKET) ||
			url.toLowerCase().startsWith(UrlProtocol.WEBSOCKET_SECURE)
	);

	let headerPairs = $derived<KeyValuePair[]>(parseHeadersToArray(headers));

	function updateHeaderPairs(newPairs: KeyValuePair[]) {
		headerPairs = newPairs;
		onHeadersChange(serializeHeaders(newPairs));
	}
</script>

<div class="grid gap-3">
	<div>
		<label for="server-url-{id}" class="mb-2 block text-xs font-medium">
			{t('mcp.serverUrl')} <span class="text-destructive">*</span>
		</label>

		<Input
			id="server-url-{id}"
			type="url"
			placeholder={MCP_SERVER_URL_PLACEHOLDER}
			value={url}
			oninput={(e) => onUrlChange(e.currentTarget.value)}
			class={urlError ? 'border-destructive' : ''}
		/>

		{#if urlError}
			<p class="mt-1.5 text-xs text-destructive">{urlError}</p>
		{/if}

		{#if !isWebSocket && onUseProxyChange}
			<label
				class="mt-3 flex items-start gap-2"
				class:cursor-pointer={mcpStore.isProxyAvailable}
				class:opacity-80={!mcpStore.isProxyAvailable}
			>
				<Switch
					class="mt-1"
					id="use-proxy-{id}"
					checked={useProxy}
					disabled={!mcpStore.isProxyAvailable}
					onCheckedChange={(checked) => onUseProxyChange?.(checked)}
				/>

				<span>
					<span class="text-xs text-muted-foreground">{t('mcp.useLlamaServerProxy')}</span>

					<br />

					{#if !mcpStore.isProxyAvailable}
						<span class="inline-flex gap-0.75 text-xs text-muted-foreground/60"
							>({t('mcp.runLlamaServerWith')}
							<pre>llama-server</pre>
							{t('common.with')}
							<pre>--ui-mcp-proxy</pre>
							{t('mcp.flag')})</span
						>
					{/if}
				</span>
			</label>
		{/if}
	</div>

	<KeyValuePairs
		class="mt-2"
		pairs={headerPairs}
		onPairsChange={updateHeaderPairs}
		keyPlaceholder={t('mcp.headerName')}
		valuePlaceholder={t('common.value')}
		addButtonLabel={t('common.add')}
		emptyMessage={t('mcp.noCustomHeadersConfigured')}
		sectionLabel={t('mcp.customHeaders')}
		sectionLabelOptional
	/>
</div>
