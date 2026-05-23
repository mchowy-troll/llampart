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
	import { ColorMode } from '$lib/enums/ui';
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
	let isFrostedGlassTheme = $derived(config().theme === ColorMode.FROSTED_GLASS);
	let frostedGlassSlideDuration = $derived(isFrostedGlassTheme ? 0 : 150);
	let frostedGlassFlyDuration = $derived(isFrostedGlassTheme ? 0 : 250);
	let frostedGlassFadeDuration = $derived(isFrostedGlassTheme ? 0 : 300);
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
	let frostedGlassDelayedFlyDelay = $derived(isFrostedGlassTheme ? 0 : hasPropsError ? 0 : 300);

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
		if (activeModelId) {
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
		const capabilities = { hasVision: hasVisionModality, hasAudio: hasAudioModality };
		const { supportedFiles, unsupportedFiles, modalityReasons } = filterFilesByModalities(
			generallySupported,
			capabilities
		);

		const allUnsupportedFiles = [...generallyUnsupported, ...unsupportedFiles];

		if (allUnsupportedFiles.length > 0) {
			const supportedTypes: string[] = ['text files', 'PDFs'];

			if (hasVisionModality) supportedTypes.push('images');
			if (hasAudioModality) supportedTypes.push('audio files');

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
		class="flex h-full flex-col-reverse overflow-y-auto px-4 md:px-6"
		ondragenter={handleDragEnter}
		ondragleave={handleDragLeave}
		ondragover={handleDragOver}
		ondrop={handleDrop}
		onscroll={handleScroll}
		role="main"
	>
		<div class="flex flex-col">
			<ChatMessages
				class="mb-16 md:mb-24"
				messages={activeMessages()}
				onUserAction={() => {
					autoScroll.enable();
					autoScroll.scrollToBottom();
				}}
			/>

			<div
				class="pointer-events-none sticky right-0 bottom-4 left-0 z-20 mt-auto"
				in:slide={{ duration: frostedGlassSlideDuration, axis: 'y' }}
			>
				{#if isFrostedGlassTheme}
					<!-- llampart-frosted-glass-composer-fade-curtain -->
					<div
						class="llampart-frosted-glass-composer-fade-curtain pointer-events-none fixed inset-x-0 bottom-0 z-10 overflow-hidden"
						aria-hidden="true"
						style="--llampart-frosted-glass-composer-fade-height: clamp(4.6rem, 9.1vh, 6.15rem); --llampart-frosted-glass-composer-fade-end-offset: 2.9rem; background-color: hsl(var(--background) / 0.98); background-image: var(--llampart-frosted-glass-wallpaper); background-position: center; background-size: cover; background-repeat: no-repeat; background-attachment: fixed; -webkit-mask-image: linear-gradient(to bottom, transparent 0, black calc(var(--llampart-frosted-glass-composer-fade-height) + var(--llampart-frosted-glass-composer-fade-end-offset)), black 100%); mask-image: linear-gradient(to bottom, transparent 0, black calc(var(--llampart-frosted-glass-composer-fade-height) + var(--llampart-frosted-glass-composer-fade-end-offset)), black 100%);"
					></div>
				{/if}

				<div class="relative z-20">
					<ChatScreenProcessingInfo />
				</div>

				{#if hasPropsError}
					<div
						class="pointer-events-auto mx-auto mb-4 max-w-[48rem] px-1"
						in:fly={{ y: 10, duration: frostedGlassFlyDuration }}
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

				<div
					class="conversation-chat-form pointer-events-auto relative z-20 rounded-t-3xl"
					class:has-frosted-glass-theme={isFrostedGlassTheme}
				>
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
						showNewChatButton
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
		<div class="llampart-empty-chat-form w-full max-w-[48rem] px-4">
			<div class="mb-10 text-center" in:fade={{ duration: frostedGlassFadeDuration }}>
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
				<div class="mb-4" in:fly={{ y: 10, duration: frostedGlassFlyDuration }}>
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

			<div
				in:fly={{ y: 10, duration: frostedGlassFlyDuration, delay: frostedGlassDelayedFlyDelay }}
			>
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
					Got it
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

	:global(html:not(.has-frosted-glass-theme)) .conversation-chat-form::after {
		display: none;
	}

	.conversation-chat-form.has-frosted-glass-theme::after {
		background-color: transparent;
	}

	:global(.has-frosted-glass-theme) .conversation-chat-form::after {
		background-color: transparent;
	}

	/* llampart-frosted-glass-composer-menu-reset-match */
	:global(html.has-frosted-glass-theme) {
		--llampart-frosted-glass-composer-radius: 0.75rem;
		--llampart-frosted-glass-composer-item-radius: 0.625rem;
		--llampart-frosted-glass-composer-menu-bg: rgba(255, 255, 255, 0.46);
		--llampart-frosted-glass-composer-menu-border: rgba(255, 255, 255, 0.4);
		--llampart-frosted-glass-composer-menu-shadow:
			0 1px 2px rgba(0, 0, 0, 0.04), 0 10px 28px rgba(0, 0, 0, 0.038),
			0 24px 54px rgba(0, 0, 0, 0.03);
		--llampart-frosted-glass-composer-menu-filter: blur(32px) saturate(138%);
	}

	:global(html.has-frosted-glass-theme .conversation-chat-form .llampart-chat-input-frame),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .llampart-chat-input-frame) {
		border: 1px solid rgba(255, 255, 255, 0.34) !important;
		border-radius: var(--llampart-frosted-glass-composer-radius) !important;
		background: rgba(255, 255, 255, 0.34) !important;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.04),
			0 8px 26px rgba(0, 0, 0, 0.036),
			0 20px 48px rgba(0, 0, 0, 0.028) !important;
		backdrop-filter: blur(28px) saturate(132%) !important;
		-webkit-backdrop-filter: blur(28px) saturate(132%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-plus-trigger),
	:global(html.has-frosted-glass-theme .llampart-composer-plus-trigger *) {
		background: transparent !important;
		box-shadow: none !important;
		outline: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-plus-trigger),
	:global(html.has-frosted-glass-theme .llampart-composer-attachments-trigger),
	:global(html.has-frosted-glass-theme .llampart-composer-attachments-trigger > *),
	:global(
		html.has-frosted-glass-theme
			.llampart-composer-attachments-trigger
			[data-slot='dropdown-menu-trigger']
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-composer-attachments-trigger
			[data-slot='tooltip-trigger']
	) {
		display: inline-flex !important;
		width: auto !important;
		height: auto !important;
		padding: 0 !important;
		border: none !important;
		border-radius: 9999px !important;
		background: transparent !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .conversation-chat-form .llampart-composer-action-button),
	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button),
	:global(html.has-frosted-glass-theme .conversation-chat-form .llampart-model-selector-trigger),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .llampart-composer-action-button),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .llampart-model-selector-trigger) {
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		overflow: hidden !important;
		border: 1px solid rgba(255, 255, 255, 0.42) !important;
		background: rgba(255, 255, 255, 0.58) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.24),
			0 1px 2px rgba(0, 0, 0, 0.028) !important;
		color: #111111 !important;
		backdrop-filter: blur(14px) saturate(124%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(124%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-action-button:hover),
	:global(html.has-frosted-glass-theme .file-upload-button:hover),
	:global(html.has-frosted-glass-theme .llampart-model-selector-trigger:hover) {
		background: rgba(255, 255, 255, 0.66) !important;
	}

	:global(
		html.has-frosted-glass-theme [data-slot='dropdown-menu-content'].llampart-composer-menu-content
	),
	:global(
		html.has-frosted-glass-theme
			[data-slot='dropdown-menu-sub-content'].llampart-composer-mcp-submenu
	),
	:global(
		html.has-frosted-glass-theme [data-slot='dropdown-menu-content'].llampart-composer-mcp-selector
	),
	:global(
		html.has-frosted-glass-theme [data-slot='dropdown-menu-content'].llampart-model-selector-menu
	),
	:global(html.has-frosted-glass-theme .llampart-model-selector-sheet) {
		border: 1px solid var(--llampart-frosted-glass-composer-menu-border) !important;
		border-radius: var(--llampart-frosted-glass-composer-radius) !important;
		background: var(--llampart-frosted-glass-composer-menu-bg) !important;
		background-color: var(--llampart-frosted-glass-composer-menu-bg) !important;
		box-shadow: var(--llampart-frosted-glass-composer-menu-shadow) !important;
		backdrop-filter: var(--llampart-frosted-glass-composer-menu-filter) !important;
		-webkit-backdrop-filter: var(--llampart-frosted-glass-composer-menu-filter) !important;
		overflow: hidden !important;
	}

	/* llampart-frosted-glass-composer-submenu-escape */
	:global(
		html.has-frosted-glass-theme [data-slot='dropdown-menu-content'].llampart-composer-main-menu
	),
	:global(html.has-frosted-glass-theme .llampart-composer-main-menu) {
		max-height: none !important;
		overflow: visible !important;
		overflow-x: visible !important;
		overflow-y: visible !important;
	}
	:global(html.has-frosted-glass-theme .llampart-composer-menu-content),
	:global(html.has-frosted-glass-theme .llampart-composer-menu-content *),
	:global(html.has-frosted-glass-theme .llampart-composer-mcp-submenu),
	:global(html.has-frosted-glass-theme .llampart-composer-mcp-submenu *),
	:global(html.has-frosted-glass-theme .llampart-composer-mcp-selector),
	:global(html.has-frosted-glass-theme .llampart-composer-mcp-selector *),
	:global(html.has-frosted-glass-theme .llampart-model-selector-menu),
	:global(html.has-frosted-glass-theme .llampart-model-selector-menu *) {
		text-shadow:
			0 0 0.35px rgba(255, 255, 255, 0.42),
			0 0 8px rgba(255, 255, 255, 0.12) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-menu-content svg),
	:global(html.has-frosted-glass-theme .llampart-composer-mcp-submenu svg),
	:global(html.has-frosted-glass-theme .llampart-composer-mcp-selector svg),
	:global(html.has-frosted-glass-theme .llampart-model-selector-menu svg) {
		filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.12)) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-searchable-menu-header) {
		background: transparent !important;
		padding: 0.35rem 0.35rem 0.1rem !important;
	}

	:global(html.has-frosted-glass-theme .llampart-searchable-menu-panel) {
		padding: 0 0.3rem 0.3rem !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-search-input.llampart-quiet-search
			.llampart-search-native
	),
	:global(
		html.has-frosted-glass-theme .llampart-search-input.llampart-quiet-search [data-slot='input']
	) {
		height: 2.2rem !important;
		min-height: 2.2rem !important;
		border-radius: var(--llampart-frosted-glass-composer-radius) !important;
		border: 1px solid rgba(255, 255, 255, 0.48) !important;
		background: rgba(255, 255, 255, 0.64) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.28),
			0 1px 2px rgba(0, 0, 0, 0.022) !important;
		color: #111111 !important;
		backdrop-filter: blur(16px) saturate(124%) !important;
		-webkit-backdrop-filter: blur(16px) saturate(124%) !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-search-input.llampart-quiet-search
			.llampart-search-native::placeholder
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-search-input.llampart-quiet-search
			[data-slot='input']::placeholder
	) {
		color: rgba(0, 0, 0, 0.44) !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-search-input.llampart-quiet-search
			.llampart-search-input-icon
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-search-input.llampart-quiet-search
			.llampart-search-input-clear
	) {
		color: rgba(17, 17, 17, 0.72) !important;
		text-shadow: 0 0 8px rgba(255, 255, 255, 0.16) !important;
	}

	:global(
		html.has-frosted-glass-theme .llampart-composer-menu-content [data-slot='dropdown-menu-item']
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-composer-menu-content
			[data-slot='dropdown-menu-sub-trigger']
	),
	:global(html.has-frosted-glass-theme .llampart-model-selector-menu [role='option']),
	:global(html.has-frosted-glass-theme .llampart-model-selector-sheet [role='option']),
	:global(html.has-frosted-glass-theme .llampart-mcp-server-item) {
		border-radius: var(--llampart-frosted-glass-composer-item-radius) !important;
		color: #111111 !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-composer-menu-content
			[data-slot='dropdown-menu-item']:hover
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-composer-menu-content
			[data-slot='dropdown-menu-sub-trigger']:hover
	),
	:global(html.has-frosted-glass-theme .llampart-model-selector-menu [role='option']:hover),
	:global(
		html.has-frosted-glass-theme .llampart-model-selector-menu [role='option'][aria-selected='true']
	),
	:global(html.has-frosted-glass-theme .llampart-model-selector-sheet [role='option']:hover),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-sheet
			[role='option'][aria-selected='true']
	),
	:global(html.has-frosted-glass-theme .llampart-mcp-server-item:hover) {
		background: rgba(255, 255, 255, 0.42) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option .font-medium),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option [class*='font-medium']) {
		font-weight: 400 !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option[data-llampart-loaded-model='true']
			.font-medium
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-model-selector-option[data-llampart-loaded-model='true']
			[class*='font-medium']
	) {
		font-weight: 600 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-model-selector-option-actions button),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option-actions [role='button']),
	:global(html.has-frosted-glass-theme .llampart-model-selector-option-actions .action-icon),
	:global(
		html.has-frosted-glass-theme .llampart-model-selector-option-actions [data-slot='button']
	) {
		background: transparent !important;
		border: 0 !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-mcp-server-list) {
		max-height: min(20rem, 55vh) !important;
		overflow-y: auto !important;
		padding: 0.125rem !important;
	}

	:global(html.has-frosted-glass-theme .llampart-frosted-glass-switch),
	:global(html.has-frosted-glass-theme .llampart-frosted-glass-switch[data-slot='switch']) {
		border: 1px solid rgba(255, 255, 255, 0.34) !important;
		background: rgba(255, 255, 255, 0.18) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 1px 2px rgba(0, 0, 0, 0.024) !important;
		backdrop-filter: blur(16px) saturate(126%) !important;
		-webkit-backdrop-filter: blur(16px) saturate(126%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-frosted-glass-switch[data-state='checked']),
	:global(
		html.has-frosted-glass-theme
			.llampart-frosted-glass-switch[data-slot='switch'][data-state='checked']
	) {
		background: rgba(63, 66, 72, 0.82) !important;
		border-color: rgba(255, 255, 255, 0.26) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			0 0 0 1px rgba(255, 255, 255, 0.04),
			0 6px 18px rgba(0, 0, 0, 0.12) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-frosted-glass-switch [data-slot='switch-thumb']),
	:global(html.has-frosted-glass-theme .llampart-frosted-glass-switch .thumb) {
		background: rgba(255, 255, 255, 0.92) !important;
		border: 1px solid rgba(255, 255, 255, 0.55) !important;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
	}

	/* llampart-frosted-glass-mcp-submenu-switch-off-visible */
	:global(html.has-frosted-glass-theme .llampart-frosted-glass-switch[data-state='unchecked']),
	:global(
		html.has-frosted-glass-theme
			.llampart-frosted-glass-switch[data-slot='switch'][data-state='unchecked']
	) {
		background: rgba(17, 24, 39, 0.16) !important;
		border-color: rgba(17, 24, 39, 0.18) !important;
		box-shadow:
			inset 0 1px 1px rgba(17, 24, 39, 0.08),
			0 1px 2px rgba(0, 0, 0, 0.035) !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-frosted-glass-switch[data-state='unchecked']
			[data-slot='switch-thumb']
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-frosted-glass-switch[data-slot='switch'][data-state='unchecked']
			[data-slot='switch-thumb']
	) {
		background: rgba(255, 255, 255, 0.96) !important;
		border-color: rgba(17, 24, 39, 0.2) !important;
		box-shadow:
			0 1px 2px rgba(17, 24, 39, 0.16),
			0 0 0 1px rgba(17, 24, 39, 0.04) !important;
	}

	/* llampart-frosted-glass-mcp-submenu-white-fallback */
	:global(
		html.has-frosted-glass-theme
			[data-slot='dropdown-menu-sub-content'].llampart-composer-mcp-submenu
	),
	:global(
		html.has-frosted-glass-theme
			[data-slot='dropdown-menu-sub-content'].llampart-composer-menu-content.llampart-composer-mcp-submenu
	) {
		border: 1px solid rgba(0, 0, 0, 0.08) !important;
		border-radius: var(--llampart-frosted-glass-composer-radius) !important;
		background: #ffffff !important;
		background-color: #ffffff !important;
		background-image: none !important;
		box-shadow:
			0 14px 36px rgba(15, 23, 42, 0.14),
			0 2px 8px rgba(15, 23, 42, 0.08) !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		overflow: hidden !important;
		color: #111111 !important;
	}

	/* llampart-frosted-glass-plus-half-milk-final */
	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button) {
		box-sizing: border-box !important;
		width: 2rem !important;
		height: 2rem !important;
		min-width: 2rem !important;
		min-height: 2rem !important;
		max-width: 2rem !important;
		max-height: 2rem !important;
		padding: 0 !important;
		border: 0 !important;
		outline: 0 !important;
		border-radius: 9999px !important;
		background: rgba(137, 148, 146, 0.29) !important;
		background-color: rgba(137, 148, 146, 0.29) !important;
		background-image: none !important;
		color: #111111 !important;
		opacity: 1 !important;
		box-shadow: none !important;
		filter: none !important;
		transform: none !important;
		transition:
			background-color 160ms ease,
			opacity 160ms ease !important;
		--tw-ring-offset-shadow: 0 0 #0000 !important;
		--tw-ring-shadow: 0 0 #0000 !important;
		--tw-shadow: 0 0 #0000 !important;
		--tw-shadow-colored: 0 0 #0000 !important;
		backdrop-filter: blur(8px) saturate(104%) !important;
		-webkit-backdrop-filter: blur(8px) saturate(104%) !important;
	}

	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button:hover),
	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button:focus),
	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button:focus-visible),
	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button:active),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button:hover),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button:focus),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button:focus-visible),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button:active),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button:hover),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button:focus),
	:global(
		html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button:focus-visible
	),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button:active),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button:hover),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button:focus),
	:global(
		html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button:focus-visible
	),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button:active) {
		border: 0 !important;
		outline: 0 !important;
		background: rgba(137, 148, 146, 0.34) !important;
		background-color: rgba(137, 148, 146, 0.34) !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
		transform: none !important;
		--tw-ring-offset-shadow: 0 0 #0000 !important;
		--tw-ring-shadow: 0 0 #0000 !important;
		--tw-shadow: 0 0 #0000 !important;
		--tw-shadow-colored: 0 0 #0000 !important;
	}

	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button::before),
	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button::after),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button::before),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button::after),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button::before),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button::after),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button::before),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button::after) {
		content: none !important;
		display: none !important;
		background: transparent !important;
		box-shadow: none !important;
		opacity: 0 !important;
	}

	:global(html.has-frosted-glass-theme .conversation-chat-form .file-upload-button svg),
	:global(html.has-frosted-glass-theme .llampart-empty-chat-form .file-upload-button svg),
	:global(html.has-frosted-glass-theme .llampart-chat-input-frame .file-upload-button svg),
	:global(html.has-frosted-glass-theme .file-upload-button.llampart-composer-action-button svg) {
		width: 1.125rem !important;
		height: 1.125rem !important;
		color: #111111 !important;
		stroke: currentColor !important;
		stroke-width: 1.85 !important;
		filter: none !important;
	}

	/* llampart-frosted-glass-welcome-text-polish */
	:global(html.has-frosted-glass-theme) .llampart-empty-chat-title {
		color: #050505 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.64),
			0 0 8px rgba(255, 255, 255, 0.5),
			0 0 16px rgba(255, 255, 255, 0.34) !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-empty-chat-subtitle {
		color: rgba(5, 5, 5, 0.72) !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.58),
			0 0 8px rgba(255, 255, 255, 0.42),
			0 0 16px rgba(255, 255, 255, 0.24) !important;
	}

	/* llampart-frosted-glass-fullwidth-composer-fade-milk-only */
	.llampart-frosted-glass-composer-fade-curtain {
		position: fixed !important;
		inset-inline: 0 !important;
		top: auto !important;
		bottom: 0 !important;
		width: 100vw !important;
		height: calc(
			var(--llampart-frosted-glass-composer-fade-height, 5.5rem) +
				var(--llampart-frosted-glass-composer-fade-end-offset, 2.9rem) + 8.5rem
		);
		transform: none !important;
		overflow: hidden;
		contain: paint;
	}

	:global(html.has-frosted-glass-theme.has-frosted-glass-wallpaper-milk)
		.llampart-frosted-glass-composer-fade-curtain {
		background-color: transparent !important;
		background-image: none !important;
		isolation: isolate;
	}

	:global(html.has-frosted-glass-theme.has-frosted-glass-wallpaper-milk)
		.llampart-frosted-glass-composer-fade-curtain::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 100vh;
		z-index: 0;
		pointer-events: none;
		background-image: var(--llampart-frosted-glass-wallpaper);
		background-position: center;
		background-size: cover;
		background-repeat: no-repeat;
		transform-origin: center bottom;
	}

	:global(html.has-frosted-glass-theme.has-frosted-glass-wallpaper-milk)
		.llampart-frosted-glass-composer-fade-curtain::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background:
			linear-gradient(180deg, rgb(255 255 255 / 0.19), rgb(255 255 255 / 0.12)),
			linear-gradient(0deg, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.12));
	}
</style>
