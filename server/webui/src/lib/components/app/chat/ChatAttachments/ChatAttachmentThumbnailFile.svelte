<script lang="ts">
	import { t } from '$lib/i18n';
	import { ActionIconRemove } from '$lib/components/app';
	import { formatFileSize, getFileTypeLabel } from '$lib/utils';
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

	let isTextLikeAttachment = $derived(
		attachment?.type === AttachmentType.TEXT ||
			uploadedFile?.type?.startsWith('text/') ||
			Boolean(textContent)
	);

	let fileTypeLabel = $derived.by(() => {
		const labelFromName = getFileTypeLabel(name);
		if (labelFromName !== 'FILE') return labelFromName;

		if (uploadedFile?.type) {
			const labelFromUploadType = getFileTypeLabel(uploadedFile.type);
			if (labelFromUploadType !== 'FILE') return labelFromUploadType;
		}

		if (attachment) {
			if ('mimeType' in attachment && attachment.mimeType) {
				const labelFromMimeType = getFileTypeLabel(attachment.mimeType);
				if (labelFromMimeType !== 'FILE') return labelFromMimeType;
			}

			if (attachment.type) {
				return getFileTypeLabel(attachment.type);
			}
		}

		return 'FILE';
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

	let supportingLabel = $derived.by(() => {
		if (pdfProcessingMode) return pdfProcessingMode;
		if (size) return formatFileSize(size);
		if (isTextLikeAttachment) return t('attachments.sentAsText');

		return null;
	});
</script>

<button
	class="llampart-attachment-thumbnail-file llampart-attachment-card {readonly
		? 'llampart-attachment-thumbnail-file-readonly'
		: ''} group relative flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted p-3 text-left transition-shadow hover:shadow-md {className}"
	onclick={onClick}
	aria-label={`${t('attachments.preview')} ${name}`}
	type="button"
>
	<div
		class="llampart-attachment-file-label flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary"
	>
		{fileTypeLabel}
	</div>

	<div class="flex min-w-0 flex-col gap-0.5">
		<span
			class="llampart-attachment-file-title truncate text-sm font-medium text-foreground {readonly
				? ''
				: 'group-hover:pr-6'}"
		>
			{name}
		</span>

		{#if supportingLabel}
			<span class="text-left text-xs text-muted-foreground">{supportingLabel}</span>
		{/if}
	</div>

	{#if !readonly}
		<div class="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
			<ActionIconRemove {id} {onRemove} />
		</div>
	{/if}
</button>
