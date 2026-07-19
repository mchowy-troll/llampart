<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { t } from '$lib/i18n';
	import {
		ChatScreenForm,
		ChatScreenHeader,
		ChatMessages,
		ChatScreenProcessingInfo,
		DialogEmptyFileAlert,
		DialogChatError,
		ServerLoadingSplash,
		DialogConfirmation
	} from '$lib/components/app';
	import * as Alert from '$lib/components/ui/alert';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { KeyboardKey } from '$lib/enums';
	import { createAutoScrollController } from '$lib/hooks/use-auto-scroll.svelte';
	import {
		chatStore,
		errorDialog,
		isLoading,
		isChatStreaming,
		isEditing,
		getAddFilesHandler
	} from '$lib/stores/chat.svelte';
	import {
		conversationsStore,
		activeMessages,
		activeConversation
	} from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { getThemeDefinition } from '$lib/themes/registry';
	import { serverLoading, serverError, serverStore, isRouterMode } from '$lib/stores/server.svelte';
	import { modelsStore, modelOptions, selectedModelId } from '$lib/stores/models.svelte';
	import { isFileTypeSupported, filterFilesByModalities } from '$lib/utils';
	import { parseFilesToMessageExtras, processFilesToChatUploaded } from '$lib/utils/browser-only';
	import { ErrorDialogType } from '$lib/enums';
	import { onMount } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { Trash2, AlertTriangle, RefreshCw } from '@lucide/svelte';
	import ChatScreenDragOverlay from './ChatScreenDragOverlay.svelte';

	let { showCenteredEmpty = false } = $props();

	let disableAutoScroll = $derived(Boolean(config().disableAutoScroll));
	let activeTheme = $derived(getThemeDefinition(config().theme));
	let screenSlideDuration = $derived(activeTheme.motion.screenTransitions ? 150 : 0);
	let screenFlyDuration = $derived(activeTheme.motion.screenTransitions ? 250 : 0);
	let screenFadeDuration = $derived(activeTheme.motion.screenTransitions ? 300 : 0);
	let chatScrollContainer: HTMLDivElement | undefined = $state();
	let dragCounter = $state(0);
	let isDragOver = $state(false);
	let showFileErrorDialog = $state(false);
	let uploadedFiles = $state<ChatUploadedFile[]>([]);

	const autoScroll = createAutoScrollController({ isColumnReverse: true });

	let fileErrorData = $state<{
		generallyUnsupported: File[];
		modalityUnsupported: File[];
		modalityReasons: Record<string, string>;
		supportedTypes: string[];
	}>({
		generallyUnsupported: [],
		modalityUnsupported: [],
		modalityReasons: {},
		supportedTypes: []
	});

	let showDeleteDialog = $state(false);

	let showEmptyFileDialog = $state(false);

	let emptyFileNames = $state<string[]>([]);

	let initialMessage = $state('');

	let isEmpty = $derived(
		showCenteredEmpty && !activeConversation() && activeMessages().length === 0 && !isLoading()
	);

	let activeErrorDialog = $derived(errorDialog());
	let isServerLoading = $derived(serverLoading());
	let hasPropsError = $derived(!!serverError());
	let delayedFlyDelay = $derived(activeTheme.motion.screenTransitions && !hasPropsError ? 300 : 0);

	let isCurrentConversationLoading = $derived(isLoading() || isChatStreaming());

	let isRouter = $derived(isRouterMode());

	let conversationModel = $derived(
		chatStore.getConversationModel(activeMessages() as DatabaseMessage[])
	);

	let activeModelId = $derived.by(() => {
		const options = modelOptions();

		if (!isRouter) {
			return options.length > 0 ? options[0].model : null;
		}

		const selectedId = selectedModelId();
		if (selectedId) {
			const model = options.find((m) => m.id === selectedId);
			if (model) return model.model;
		}

		if (conversationModel) {
			const model = options.find((m) => m.model === conversationModel);
			if (model) return model.model;
		}

		return null;
	});

	let modelPropsVersion = $state(0);

	$effect(() => {
		if (activeModelId && modelsStore.supportsModelProps) {
			const cached = modelsStore.getModelProps(activeModelId);
			if (!cached) {
				modelsStore.fetchModelProps(activeModelId).then(() => {
					modelPropsVersion++;
				});
			}
		}
	});

	let hasAudioModality = $derived.by(() => {
		if (activeModelId) {
			void modelPropsVersion;
			return modelsStore.modelSupportsAudio(activeModelId);
		}

		return false;
	});

	let hasVideoModality = $derived.by(() => {
		if (activeModelId) {
			void modelPropsVersion;

			return modelsStore.modelSupportsVideo(activeModelId);
		}

		return false;
	});

	let hasVisionModality = $derived.by(() => {
		if (activeModelId) {
			void modelPropsVersion;

			return modelsStore.modelSupportsVision(activeModelId);
		}

		return false;
	});

	async function handleDeleteConfirm() {
		const conversation = activeConversation();

		if (conversation) {
			await conversationsStore.deleteConversation(conversation.id);
		}

		showDeleteDialog = false;
	}

	function handleDragEnter(event: DragEvent) {
		event.preventDefault();

		dragCounter++;

		if (event.dataTransfer?.types.includes('Files')) {
			isDragOver = true;
		}
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();

		dragCounter--;

		if (dragCounter === 0) {
			isDragOver = false;
		}
	}

	function handleErrorDialogOpenChange(open: boolean) {
		if (!open) {
			chatStore.dismissErrorDialog();
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();

		isDragOver = false;
		dragCounter = 0;

		if (event.dataTransfer?.files) {
			const files = Array.from(event.dataTransfer.files);

			if (isEditing()) {
				const handler = getAddFilesHandler();

				if (handler) {
					handler(files);
					return;
				}
			}

			processFiles(files);
		}
	}

	function handleFileRemove(fileId: string) {
		uploadedFiles = uploadedFiles.filter((f) => f.id !== fileId);
	}

	function handleFileUpload(files: File[]) {
		processFiles(files);
	}

	function handleKeydown(event: KeyboardEvent) {
		const isCtrlOrCmd = event.ctrlKey || event.metaKey;

		if (
			isCtrlOrCmd &&
			event.shiftKey &&
			(event.key === KeyboardKey.D_LOWER || event.key === KeyboardKey.D_UPPER)
		) {
			event.preventDefault();
			if (activeConversation()) {
				showDeleteDialog = true;
			}
		}
	}

	async function handleSystemPromptAdd(draft: { message: string; files: ChatUploadedFile[] }) {
		if (draft.message || draft.files.length > 0) {
			chatStore.savePendingDraft(draft.message, draft.files);
		}

		await chatStore.addSystemPrompt();
	}

	function handleScroll() {
		autoScroll.handleScroll();
	}

	async function handleSendMessage(message: string, files?: ChatUploadedFile[]): Promise<boolean> {
		const plainFiles = files ? $state.snapshot(files) : undefined;
		const result = plainFiles
			? await parseFilesToMessageExtras(plainFiles, activeModelId ?? undefined)
			: undefined;

		if (result?.emptyFiles && result.emptyFiles.length > 0) {
			emptyFileNames = result.emptyFiles;
			showEmptyFileDialog = true;

			if (files) {
				const emptyFileNamesSet = new Set(result.emptyFiles);
				uploadedFiles = uploadedFiles.filter((file) => !emptyFileNamesSet.has(file.name));
			}
			return false;
		}

		const extras = result?.extras;

		// Enable autoscroll for user-initiated message sending
		autoScroll.enable();
		await chatStore.sendMessage(message, extras);
		autoScroll.scrollToBottom();

		return true;
	}

	async function processFiles(files: File[]) {
		const generallySupported: File[] = [];
		const generallyUnsupported: File[] = [];

		for (const file of files) {
			if (isFileTypeSupported(file.name, file.type)) {
				generallySupported.push(file);
			} else {
				generallyUnsupported.push(file);
			}
		}

		// Use model-specific capabilities for file validation
		const capabilities = {
			hasVision: hasVisionModality,
			hasAudio: hasAudioModality,
			hasVideo: hasVideoModality
		};
		const { supportedFiles, unsupportedFiles, modalityReasons } = filterFilesByModalities(
			generallySupported,
			capabilities
		);

		const allUnsupportedFiles = [...generallyUnsupported, ...unsupportedFiles];

		if (allUnsupportedFiles.length > 0) {
			const supportedTypes: string[] = ['text files', 'PDFs'];

			if (hasVisionModality) supportedTypes.push('images');
			if (hasAudioModality) supportedTypes.push('audio files');
			if (hasVideoModality) supportedTypes.push('video files');

			fileErrorData = {
				generallyUnsupported,
				modalityUnsupported: unsupportedFiles,
				modalityReasons,
				supportedTypes
			};
			showFileErrorDialog = true;
		}

		if (supportedFiles.length > 0) {
			const processed = await processFilesToChatUploaded(
				supportedFiles,
				activeModelId ?? undefined
			);
			uploadedFiles = [...uploadedFiles, ...processed];
		}
	}

	afterNavigate(() => {
		if (!disableAutoScroll) {
			autoScroll.enable();
		}
	});

	onMount(() => {
		autoScroll.startObserving();

		if (!disableAutoScroll) {
			autoScroll.enable();
		}

		const pendingDraft = chatStore.consumePendingDraft();
		if (pendingDraft) {
			initialMessage = pendingDraft.message;
			uploadedFiles = pendingDraft.files;
		}
	});

	$effect(() => {
		autoScroll.setContainer(chatScrollContainer);
	});

	$effect(() => {
		autoScroll.setDisabled(disableAutoScroll);
	});
</script>

{#if isDragOver}
	<ChatScreenDragOverlay />
{/if}

<svelte:window onkeydown={handleKeydown} />

<ChatScreenHeader />

{#if !isEmpty}
	<div
		bind:this={chatScrollContainer}
		aria-label={t('chat.chatInterfaceWithFileDropZone')}
		class="llampart-chat-scroll-container flex h-full flex-col-reverse overflow-y-auto"
		ondragenter={handleDragEnter}
		ondragleave={handleDragLeave}
		ondragover={handleDragOver}
		ondrop={handleDrop}
		onscroll={handleScroll}
		role="main"
	>
		<div class="flex flex-col">
			<ChatMessages
				class="llampart-chat-messages-bottom-spacer"
				messages={activeMessages()}
				onUserAction={() => {
					autoScroll.enable();
					autoScroll.scrollToBottom();
				}}
			/>

			<div
				class="pointer-events-none sticky right-0 bottom-4 left-0 z-20 mt-auto"
				in:slide={{ duration: screenSlideDuration, axis: 'y' }}
			>
				<!-- llampart-chat-composer-boundary-fade-owner -->
				<div
					class="llampart-composer-fade-curtain pointer-events-none fixed inset-x-0 bottom-0 z-10 overflow-hidden"
					aria-hidden="true"
				></div>

				<div class="relative z-20">
					<ChatScreenProcessingInfo />
				</div>

				{#if hasPropsError}
					<div
						class="llampart-chat-composer-width pointer-events-auto mx-auto mb-4 px-1"
						in:fly={{ y: 10, duration: screenFlyDuration }}
					>
						<Alert.Root variant="destructive">
							<AlertTriangle class="h-4 w-4" />
							<Alert.Title class="flex items-center justify-between">
								<span>{t('server.serverUnavailable')}</span>
								<button
									onclick={() => serverStore.fetch()}
									disabled={isServerLoading}
									class="flex items-center gap-1.5 rounded-lg bg-destructive/20 px-2 py-1 text-xs font-medium hover:bg-destructive/30 disabled:opacity-50"
								>
									<RefreshCw class="h-3 w-3 {isServerLoading ? 'animate-spin' : ''}" />
									{isServerLoading ? t('server.retrying') : t('common.retry')}
								</button>
							</Alert.Title>
							<Alert.Description>{serverError()}</Alert.Description>
						</Alert.Root>
					</div>
				{/if}

				<div class="conversation-chat-form pointer-events-auto relative z-20 rounded-t-3xl">
					<ChatScreenForm
						disabled={hasPropsError || isEditing()}
						{initialMessage}
						isLoading={isCurrentConversationLoading}
						onFileRemove={handleFileRemove}
						onFileUpload={handleFileUpload}
						onSend={handleSendMessage}
						onStop={() => chatStore.stopGeneration()}
						onSystemPromptAdd={handleSystemPromptAdd}
						showHelperText={false}
						bind:uploadedFiles
					/>
				</div>
			</div>
		</div>
	</div>
{:else if isServerLoading}
	<!-- Server Loading State -->
	<ServerLoadingSplash />
{:else}
	<div
		aria-label={t('chat.welcomeScreenWithFileDropZone')}
		class="flex h-full items-center justify-center"
		ondragenter={handleDragEnter}
		ondragleave={handleDragLeave}
		ondragover={handleDragOver}
		ondrop={handleDrop}
		role="main"
	>
		<div class="llampart-empty-chat-form llampart-chat-composer-width w-full px-4">
			<div class="mb-10 text-center" in:fade={{ duration: screenFadeDuration }}>
				<h1
					class="llampart-empty-chat-title mb-2 text-2xl font-semibold tracking-tight md:text-3xl"
				>
					llampart
				</h1>

				<p class="llampart-empty-chat-subtitle text-muted-foreground md:text-lg">
					{serverStore.props?.modalities?.audio
						? t('home.recordAudioTypeMessageOrUploadFiles')
						: t('home.typeMessageOrUploadFiles')}
				</p>
			</div>

			{#if hasPropsError}
				<div class="mb-4" in:fly={{ y: 10, duration: screenFlyDuration }}>
					<Alert.Root variant="destructive">
						<AlertTriangle class="h-4 w-4" />

						<Alert.Title class="flex items-center justify-between">
							<span>{t('server.serverUnavailable')}</span>

							<button
								onclick={() => serverStore.fetch()}
								disabled={isServerLoading}
								class="flex items-center gap-1.5 rounded-lg bg-destructive/20 px-2 py-1 text-xs font-medium hover:bg-destructive/30 disabled:opacity-50"
							>
								<RefreshCw class="h-3 w-3 {isServerLoading ? 'animate-spin' : ''}" />
								{isServerLoading ? t('server.retrying') : t('common.retry')}
							</button>
						</Alert.Title>

						<Alert.Description>{serverError()}</Alert.Description>
					</Alert.Root>
				</div>
			{/if}

			<div in:fly={{ y: 10, duration: screenFlyDuration, delay: delayedFlyDelay }}>
				<ChatScreenForm
					disabled={hasPropsError}
					{initialMessage}
					isLoading={isCurrentConversationLoading}
					onFileRemove={handleFileRemove}
					onFileUpload={handleFileUpload}
					onSend={handleSendMessage}
					onStop={() => chatStore.stopGeneration()}
					onSystemPromptAdd={handleSystemPromptAdd}
					showHelperText
					bind:uploadedFiles
				/>
			</div>
		</div>
	</div>
{/if}

<!-- File Upload Error Alert Dialog -->
<AlertDialog.Root bind:open={showFileErrorDialog}>
	<AlertDialog.Portal>
		<AlertDialog.Overlay />

		<AlertDialog.Content class="flex max-w-md flex-col">
			<AlertDialog.Header>
				<AlertDialog.Title>{t('attachments.fileUploadError')}</AlertDialog.Title>

				<AlertDialog.Description class="text-sm text-muted-foreground">
					{t('attachments.someFilesCannotBeUploadedWithCurrentModel')}
				</AlertDialog.Description>
			</AlertDialog.Header>

			<div class="!max-h-[50vh] min-h-0 flex-1 space-y-4 overflow-y-auto">
				{#if fileErrorData.generallyUnsupported.length > 0}
					<div class="space-y-2">
						<h4 class="text-sm font-medium text-destructive">
							{t('attachments.unsupportedFileTypes')}
						</h4>

						<div class="space-y-1">
							{#each fileErrorData.generallyUnsupported as file (file.name)}
								<div class="rounded-md bg-destructive/10 px-3 py-2">
									<p class="font-mono text-sm break-all text-destructive">
										{file.name}
									</p>

									<p class="mt-1 text-xs text-muted-foreground">
										{t('attachments.fileTypeNotSupported')}
									</p>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if fileErrorData.modalityUnsupported.length > 0}
					<div class="space-y-2">
						<div class="space-y-1">
							{#each fileErrorData.modalityUnsupported as file (file.name)}
								<div class="rounded-md bg-destructive/10 px-3 py-2">
									<p class="font-mono text-sm break-all text-destructive">
										{file.name}
									</p>

									<p class="mt-1 text-xs text-muted-foreground">
										{fileErrorData.modalityReasons[file.name] ||
											t('attachments.notSupportedByCurrentModel')}
									</p>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<div class="rounded-md bg-muted/50 p-3">
				<h4 class="mb-2 text-sm font-medium">{t('attachments.thisModelSupports')}</h4>

				<p class="text-sm text-muted-foreground">
					{fileErrorData.supportedTypes.join(', ')}
				</p>
			</div>

			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => (showFileErrorDialog = false)}>
					{t('common.gotIt')}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Portal>
</AlertDialog.Root>

<DialogConfirmation
	bind:open={showDeleteDialog}
	title={t('sidebar.deleteConversationTitle')}
	description={t('sidebar.deleteConversationDescription')}
	confirmText={t('common.delete')}
	cancelText={t('common.cancel')}
	variant="destructive"
	icon={Trash2}
	onConfirm={handleDeleteConfirm}
	onCancel={() => (showDeleteDialog = false)}
/>

<DialogEmptyFileAlert
	bind:open={showEmptyFileDialog}
	emptyFiles={emptyFileNames}
	onOpenChange={(open) => {
		if (!open) {
			emptyFileNames = [];
		}
	}}
/>

<DialogChatError
	message={activeErrorDialog?.message ?? ''}
	contextInfo={activeErrorDialog?.contextInfo}
	onOpenChange={handleErrorDialogOpenChange}
	open={Boolean(activeErrorDialog)}
	type={activeErrorDialog?.type ?? ErrorDialogType.SERVER}
/>

<style>
	.conversation-chat-form {
		position: relative;

		&::after {
			content: '';
			position: absolute;
			bottom: 0;
			z-index: -1;
			left: 0;
			right: 0;
			width: 100%;
			height: 2.375rem;
			background-color: var(--background);
		}
	}
</style>
