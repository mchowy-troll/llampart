<script lang="ts">
	import { t } from '$lib/i18n';
	import { ActionIconRemove } from '$lib/components/app';
	import { formatFileSize, getFileTypeLabel, getPreviewText, isTextFile } from '$lib/utils';
	import { AttachmentType } from '$lib/enums';

	interface Props {
		class?: string;
		id: string;
		onClick?: (event?: MouseEvent) => void;
		onRemove?: (id: string) => void;
		name: string;
		readonly?: boolean;
		size?: number;
		textContent?: string;
		// Either uploaded file or stored attachment
		uploadedFile?: ChatUploadedFile;
		attachment?: DatabaseMessageExtra;
	}

	let {
		class: className = '',
		id,
		onClick,
		onRemove,
		name,
		readonly = false,
		size,
		textContent,
		uploadedFile,
		attachment
	}: Props = $props();

	let isText = $derived(isTextFile(attachment, uploadedFile));

	let fileTypeLabel = $derived.by(() => {
		if (uploadedFile?.type) {
			return getFileTypeLabel(uploadedFile.type);
		}

		if (attachment) {
			if ('mimeType' in attachment && attachment.mimeType) {
				return getFileTypeLabel(attachment.mimeType);
			}

			if (attachment.type) {
				return getFileTypeLabel(attachment.type);
			}
		}

		return getFileTypeLabel(name);
	});

	let pdfProcessingMode = $derived.by(() => {
		if (attachment?.type === AttachmentType.PDF) {
			const pdfAttachment = attachment as DatabaseMessageExtraPdfFile;

			return pdfAttachment.processedAsImages
				? t('attachments.sentAsImage')
				: t('attachments.sentAsText');
		}
		return null;
	});
</script>

{#if isText}
	{#if readonly}
		<!-- Readonly mode (ChatMessage) -->
		<button
			class="llampart-attachment-thumbnail-file llampart-attachment-thumbnail-file-readonly w-full max-w-2xl cursor-pointer rounded-lg border border-border bg-muted p-3 transition-shadow hover:shadow-md {className}"
			onclick={onClick}
			aria-label={`${t('attachments.preview')} ${name}`}
			type="button"
		>
			<div class="flex items-start gap-3">
				<div class="flex min-w-0 flex-1 flex-col items-start text-left">
					<span class="w-full truncate text-sm font-medium text-foreground">{name}</span>

					{#if size}
						<span class="text-xs text-muted-foreground">{formatFileSize(size)}</span>
					{/if}

					{#if textContent}
						<div class="relative mt-2 w-full">
							<div
								class="overflow-hidden font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
							>
								{getPreviewText(textContent)}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</button>
	{:else}
		<!-- Non-readonly mode (ChatForm) -->
		<button
			class="llampart-attachment-thumbnail-file group relative rounded-lg border border-border bg-muted p-3 {className} {textContent
				? 'max-h-24 max-w-72'
				: 'max-w-36'} cursor-pointer text-left"
			onclick={onClick}
		>
			<div class="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
				<ActionIconRemove {id} {onRemove} />
			</div>

			<div class="pr-8">
				<span class="mb-3 block truncate text-sm font-medium text-foreground">{name}</span>

				{#if textContent}
					<div class="relative">
						<div
							class="overflow-hidden font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
							style="max-height: 3rem; line-height: 1.2em;"
						>
							{getPreviewText(textContent)}
						</div>
					</div>
				{/if}
			</div>
		</button>
	{/if}
{:else}
	<button
		class="llampart-attachment-thumbnail-file {readonly
			? 'llampart-attachment-thumbnail-file-readonly'
			: ''} group relative flex items-center gap-3 rounded-lg border border-border bg-muted p-3 {className}"
		onclick={onClick}
	>
		<div
			class="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-xs font-medium text-primary"
		>
			{fileTypeLabel}
		</div>

		<div class="flex flex-col gap-0.5">
			<span
				class="max-w-24 truncate text-sm font-medium text-foreground {readonly
					? ''
					: 'group-hover:pr-6'} md:max-w-32"
			>
				{name}
			</span>

			{#if pdfProcessingMode}
				<span class="text-left text-xs text-muted-foreground">{pdfProcessingMode}</span>
			{:else if size}
				<span class="text-left text-xs text-muted-foreground">{formatFileSize(size)}</span>
			{/if}
		</div>

		{#if !readonly}
			<div class="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
				<ActionIconRemove {id} {onRemove} />
			</div>
		{/if}
	</button>
{/if}

<style>
	/* llampart-block-b-attachment-thumbnail-polish */
	:global(html.has-frosted-glass-theme) .llampart-attachment-thumbnail-file-readonly {
		border: 1px solid rgba(255, 255, 255, 0.18) !important;
		background: rgba(255, 255, 255, 0.16) !important;
		color: #000000 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.58),
			0 0 7px rgba(255, 255, 255, 0.42),
			0 0 14px rgba(255, 255, 255, 0.24) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 4px 10px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(14px) saturate(110%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(110%) !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-attachment-thumbnail-file-readonly:hover {
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.16),
			0 1px 2px rgba(0, 0, 0, 0.055),
			0 5px 12px rgba(0, 0, 0, 0.045) !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-attachment-thumbnail-file-readonly :global(*) {
		color: #000000 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.58),
			0 0 7px rgba(255, 255, 255, 0.42),
			0 0 14px rgba(255, 255, 255, 0.24) !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-attachment-thumbnail-file-readonly
		:global(.text-muted-foreground) {
		color: rgba(0, 0, 0, 0.68) !important;
	}
	/* /llampart-block-b-attachment-thumbnail-polish */
</style>
