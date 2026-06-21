<script lang="ts">
	import { t } from '$lib/i18n';
	import * as Dialog from '$lib/components/ui/dialog';

	interface Props {
		open: boolean;
		code: string;
		language: string;
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), code, language, onOpenChange }: Props = $props();

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
				<iframe
					bind:this={iframeRef}
					title={`${t('common.previewCode')} ${displayLanguageLabel}`}
					sandbox="allow-scripts"
					class="llampart-code-preview-iframe"
				></iframe>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
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
