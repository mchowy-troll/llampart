<script lang="ts">
	import { t } from '$lib/i18n';
	import { X, AlertTriangle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { ChatForm, DialogConfirmation } from '$lib/components/app';
	import { getMessageEditContext } from '$lib/contexts';
	import { KeyboardKey } from '$lib/enums';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { processFilesToChatUploaded } from '$lib/utils/browser-only';

	interface Props {
		class?: string;
	}

	let { class: className = 'w-full max-w-[80%]' }: Props = $props();

	const editCtx = getMessageEditContext();

	let inputAreaRef: ChatForm | undefined = $state(undefined);
	let saveWithoutRegenerate = $state(false);
	let showDiscardDialog = $state(false);

	let hasUnsavedChanges = $derived.by(() => {
		if (editCtx.editedContent !== editCtx.originalContent) return true;
		if (editCtx.editedUploadedFiles.length > 0) return true;

		const extrasChanged =
			editCtx.editedExtras.length !== editCtx.originalExtras.length ||
			editCtx.editedExtras.some((extra, i) => extra !== editCtx.originalExtras[i]);

		if (extrasChanged) return true;

		return false;
	});

	let hasAttachments = $derived(
		(editCtx.editedExtras && editCtx.editedExtras.length > 0) ||
			(editCtx.editedUploadedFiles && editCtx.editedUploadedFiles.length > 0)
	);

	let canSubmit = $derived(editCtx.editedContent.trim().length > 0 || hasAttachments);

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.key === KeyboardKey.ESCAPE) {
			event.preventDefault();
			attemptCancel();
		}
	}

	function attemptCancel() {
		if (hasUnsavedChanges) {
			showDiscardDialog = true;
		} else {
			editCtx.cancel();
		}
	}

	function handleSubmit() {
		if (!canSubmit) return;

		if (saveWithoutRegenerate && editCtx.showSaveOnlyOption) {
			editCtx.saveOnly();
		} else {
			editCtx.save();
		}

		saveWithoutRegenerate = false;
	}

	function handleAttachmentRemove(index: number) {
		const newExtras = [...editCtx.editedExtras];
		newExtras.splice(index, 1);
		editCtx.setExtras(newExtras);
	}

	function handleUploadedFileRemove(fileId: string) {
		const newFiles = editCtx.editedUploadedFiles.filter((f) => f.id !== fileId);
		editCtx.setUploadedFiles(newFiles);
	}

	async function handleFilesAdd(files: File[]) {
		const processed = await processFilesToChatUploaded(files);
		editCtx.setUploadedFiles([...editCtx.editedUploadedFiles, ...processed]);
	}

	function handleUploadedFilesChange(files: ChatUploadedFile[]) {
		editCtx.setUploadedFiles(files);
	}

	$effect(() => {
		chatStore.setEditModeActive(handleFilesAdd);

		return () => {
			chatStore.clearEditMode();
		};
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="llampart-message-edit-form flex flex-col gap-3 {className}">
	<div class="relative w-full">
		<ChatForm
			class="llampart-message-edit-chat-form"
			bind:this={inputAreaRef}
			value={editCtx.editedContent}
			attachments={editCtx.editedExtras}
			uploadedFiles={editCtx.editedUploadedFiles}
			placeholder={t('messages.editYourMessagePlaceholder')}
			showMcpPromptButton
			onValueChange={editCtx.setContent}
			onAttachmentRemove={handleAttachmentRemove}
			onUploadedFileRemove={handleUploadedFileRemove}
			onUploadedFilesChange={handleUploadedFilesChange}
			onFilesAdd={handleFilesAdd}
			onSubmit={handleSubmit}
		/>
	</div>

	<div class="llampart-message-edit-controls flex w-full items-center justify-between gap-3">
		{#if editCtx.showSaveOnlyOption}
			<div class="llampart-message-edit-option flex items-center gap-2">
				<Switch
					id="save-only-switch"
					bind:checked={saveWithoutRegenerate}
					class="llampart-message-edit-save-only-switch scale-75"
				/>

				<label
					for="save-only-switch"
					class="llampart-message-edit-option-label cursor-pointer text-xs text-muted-foreground"
				>
					{t('messages.updateWithoutResending')}
				</label>
			</div>
		{:else}
			<div class="llampart-message-edit-control-spacer"></div>
		{/if}

		<Button
			class="llampart-message-edit-cancel-action h-7 px-3 text-xs"
			onclick={attemptCancel}
			size="sm"
			variant="ghost"
		>
			<X class="mr-1 h-3 w-3" />

			{t('common.cancel')}
		</Button>
	</div>
</div>

<DialogConfirmation
	bind:open={showDiscardDialog}
	title={t('messages.discardChangesTitle')}
	description={t('messages.discardChangesDescription')}
	confirmText={t('messages.discard')}
	cancelText={t('messages.keepEditing')}
	variant="destructive"
	icon={AlertTriangle}
	onConfirm={editCtx.cancel}
	onCancel={() => (showDiscardDialog = false)}
/>
