<script lang="ts">
	import { t } from '$lib/i18n';
	import * as Dialog from '$lib/components/ui/dialog';

	interface Props {
		open: boolean;
		code: string;
		language: string;
		onOpenChange?: (open: boolean) => void;
		sourceOnly?: boolean;
		returnFocus?: HTMLElement | null;
	}

	let {
		open = $bindable(),
		code,
		language,
		onOpenChange,
		sourceOnly = false,
		returnFocus
	}: Props = $props();

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let displayLanguage = $derived((language || 'html').trim() || 'html');
	let displayLanguageLabel = $derived(displayLanguage.toUpperCase());

	$effect(() => {
		if (!iframeRef) return;

		if (open) {
			iframeRef.srcdoc = code;
		} else {
			iframeRef.srcdoc = '';
		}
	});

	function handleOpenChange(nextOpen: boolean) {
		open = nextOpen;
		onOpenChange?.(nextOpen);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content
		onCloseAutoFocus={(event) => {
			if (returnFocus?.isConnected) {
				event.preventDefault();
				returnFocus.focus();
			}
		}}
		class="llampart-code-preview-dialog-content table-preview-dialog-content llampart-attachment-preview-dialog-content z-[999999] flex !max-h-[80dvh] !w-[80vw] !max-w-[80vw] flex-col gap-0 overflow-hidden p-0"
	>
		<div
			class="table-preview-dialog llampart-attachment-preview-dialog-shell llampart-code-preview-dialog-shell"
		>
			<div
				class="table-preview-header llampart-attachment-preview-dialog-header llampart-code-preview-dialog-header"
			>
				<Dialog.Title class="table-preview-title llampart-attachment-preview-dialog-title">
					{t('common.previewCode')} · {displayLanguageLabel}
				</Dialog.Title>
			</div>

			<div
				class="table-preview-body llampart-attachment-preview-dialog-body llampart-code-preview-dialog-body"
			>
				{#if sourceOnly}
					<!-- A scrollable source region must be keyboard reachable. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="visualization-source-scroll"
						tabindex="0"
						role="region"
						aria-label={t('common.previewCode')}
					>
						<pre class="visualization-source"><code>{code}</code></pre>
					</div>
				{:else}
					<iframe
						bind:this={iframeRef}
						title={`${t('common.previewCode')} ${displayLanguageLabel}`}
						sandbox="allow-scripts"
						class="llampart-code-preview-iframe"
					></iframe>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.visualization-source-scroll {
		min-width: 0;
		max-width: 100%;
		max-height: calc(80dvh - 7rem);
		overflow: auto;
		overscroll-behavior: contain;
	}
	.visualization-source {
		display: block !important;
		width: max-content;
		min-width: 100%;
		margin: 0;
		padding: 0.75rem;
		white-space: pre;
		overflow-wrap: normal;
		word-break: normal;
		font-size: 0.875rem;
		line-height: 1.5 !important;
	}
	.llampart-code-preview-dialog-shell {
		width: 100%;
	}

	.llampart-code-preview-dialog-body {
		padding: 1rem !important;
		overflow: hidden !important;
	}

	.llampart-code-preview-iframe {
		display: block;
		width: 100%;
		height: min(68dvh, calc(80dvh - 5.25rem));
		min-height: 18rem;
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		border-radius: 0.75rem;
		background: white;
		color-scheme: light;
	}
</style>
