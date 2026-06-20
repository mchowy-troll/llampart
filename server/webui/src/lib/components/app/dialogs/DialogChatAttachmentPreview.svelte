<script lang="ts">
	import { t } from '$lib/i18n';
	import * as Dialog from '$lib/components/ui/dialog';
	import { ChatAttachmentPreview } from '$lib/components/app';
	import { formatFileSize } from '$lib/utils';

	interface Props {
		open: boolean;
		onOpenChange?: (open: boolean) => void;
		// Either an uploaded file or a stored attachment
		uploadedFile?: ChatUploadedFile;
		attachment?: DatabaseMessageExtra;
		// For uploaded files
		preview?: string;
		name?: string;
		size?: number;
		textContent?: string;
		// For vision modality check
		activeModelId?: string;
	}

	let {
		open = $bindable(),
		onOpenChange,
		uploadedFile,
		attachment,
		preview,
		name,
		size,
		textContent,
		activeModelId
	}: Props = $props();

	let chatAttachmentPreviewRef: ChatAttachmentPreview | undefined = $state();

	let displayName = $derived(
		uploadedFile?.name || attachment?.name || name || t('common.unknownFile')
	);

	let displaySize = $derived(uploadedFile?.size || size);

	$effect(() => {
		if (open && chatAttachmentPreviewRef) {
			chatAttachmentPreviewRef.reset();
		}
	});
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content
		class="llampart-attachment-preview-dialog-content z-[999999] !max-h-[80dvh] !w-auto !max-w-[80vw] gap-0"
	>
		<div class="table-preview-dialog llampart-attachment-preview-dialog-shell">
			<div class="table-preview-header llampart-attachment-preview-dialog-header">
				<div class="min-w-0">
					<Dialog.Title class="table-preview-title llampart-attachment-preview-dialog-title"
						>{displayName}</Dialog.Title
					>

					{#if displaySize}
						<Dialog.Description class="llampart-attachment-preview-dialog-description">
							{formatFileSize(displaySize)}
						</Dialog.Description>
					{/if}
				</div>
			</div>

			<div class="table-preview-body llampart-attachment-preview-dialog-body">
				<ChatAttachmentPreview
					bind:this={chatAttachmentPreviewRef}
					{uploadedFile}
					{attachment}
					{preview}
					name={displayName}
					{textContent}
					{activeModelId}
				/>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
