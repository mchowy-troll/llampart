<script lang="ts">
	import {
		ChatAttachmentsList,
		ChatAttachmentMcpResources,
		ChatFormActions,
		ChatFormFileInputInvisible,
		ChatFormPromptPicker,
		ChatFormResourcePicker,
		ChatFormTextarea
	} from '$lib/components/app';
	import { DialogMcpResources } from '$lib/components/app/dialogs';
	import {
		CLIPBOARD_CONTENT_QUOTE_PREFIX,
		INPUT_CLASSES,
		SETTING_CONFIG_DEFAULT,
		INITIAL_FILE_SIZE,
		PROMPT_CONTENT_SEPARATOR,
		PROMPT_TRIGGER_PREFIX,
		RESOURCE_TRIGGER_PREFIX
	} from '$lib/constants';
	import {
		AttachmentSource,
		ContentPartType,
		FileExtensionText,
		KeyboardKey,
		MimeTypeText,
		SpecialFileType
	} from '$lib/enums';
	import { config } from '$lib/stores/settings.svelte';
	import { modelOptions, modelsStore, selectedModelId } from '$lib/stores/models.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { mcpHasResourceAttachments } from '$lib/stores/mcp-resources.svelte';
	import { conversationsStore, activeMessages } from '$lib/stores/conversations.svelte';
	import type { GetPromptResult, MCPPromptInfo, MCPResourceInfo, PromptMessage } from '$lib/types';
	import { isIMEComposing, parseClipboardContent, uuid } from '$lib/utils';
	import {
		AudioRecorder,
		convertToWav,
		createAudioFile,
		isAudioRecordingSupported
	} from '$lib/utils/browser-only';
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';

	interface Props {
		// Data
		attachments?: DatabaseMessageExtra[];
		uploadedFiles?: ChatUploadedFile[];
		value?: string;

		// UI State
		class?: string;
		disabled?: boolean;
		isLoading?: boolean;
		placeholder?: string;
		showMcpPromptButton?: boolean;

		// Event Handlers
		onAttachmentRemove?: (index: number) => void;
		onFilesAdd?: (files: File[]) => void;
		onStop?: () => void;
		onSubmit?: () => void;
		onSystemPromptClick?: (draft: { message: string; files: ChatUploadedFile[] }) => void;
		onUploadedFileRemove?: (fileId: string) => void;
		onUploadedFilesChange?: (files: ChatUploadedFile[]) => void;
		onValueChange?: (value: string) => void;
	}

	let {
		attachments = [],
		class: className = '',
		disabled = false,
		isLoading = false,
		placeholder = '',
		showMcpPromptButton = false,
		uploadedFiles = $bindable([]),
		value = $bindable(''),
		onAttachmentRemove,
		onFilesAdd,
		onStop,
		onSubmit,
		onSystemPromptClick,
		onUploadedFileRemove,
		onUploadedFilesChange,
		onValueChange
	}: Props = $props();

	/**
	 *
	 *
	 * STATE
	 *
	 *
	 */

	// Component References
	let audioRecorder: AudioRecorder | undefined;
	let chatFormActionsRef: ChatFormActions | undefined = $state(undefined);
	let fileInputRef: ChatFormFileInputInvisible | undefined = $state(undefined);
	let promptPickerRef: ChatFormPromptPicker | undefined = $state(undefined);
	let resourcePickerRef: ChatFormResourcePicker | undefined = $state(undefined);
	let textareaRef: ChatFormTextarea | undefined = $state(undefined);

	// Audio Recording State
	let isRecording = $state(false);
	let recordingSupported = $state(false);

	// Prompt Picker State
	let isPromptPickerOpen = $state(false);
	let promptSearchQuery = $state('');

	// Inline Resource Picker State (triggered by @)
	let isInlineResourcePickerOpen = $state(false);
	let resourceSearchQuery = $state('');

	// Resource Dialog State
	let isResourceDialogOpen = $state(false);
	let preSelectedResourceUri = $state<string | undefined>(undefined);

	/**
	 *
	 *
	 * DERIVED STATE
	 *
	 *
	 */

	// Configuration
	let currentConfig = $derived(config());
	let pasteLongTextToFileLength = $derived.by(() => {
		const n = Number(currentConfig.pasteLongTextToFileLen);
		return Number.isNaN(n) ? Number(SETTING_CONFIG_DEFAULT.pasteLongTextToFileLen) : n;
	});
	let resolvedPlaceholder = $derived(placeholder || t('chat.typeMessage'));

	// Model Selection Logic
	let isRouter = $derived(isRouterMode());
	let usesSelectableModelList = $derived(modelsStore.usesSelectableModelList);
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

	// Form Validation State
	let hasModelSelected = $derived(
		!usesSelectableModelList || !!conversationModel || !!selectedModelId()
	);
	let hasLoadingAttachments = $derived(uploadedFiles.some((f) => f.isLoading));
	let hasAttachments = $derived(
		(attachments && attachments.length > 0) || (uploadedFiles && uploadedFiles.length > 0)
	);
	let canSubmit = $derived(value.trim().length > 0 || hasAttachments);

	/**
	 *
	 *
	 * LIFECYCLE
	 *
	 *
	 */

	onMount(() => {
		recordingSupported = isAudioRecordingSupported();
		audioRecorder = new AudioRecorder();
	});

	/**
	 *
	 *
	 * PUBLIC API
	 *
	 *
	 */

	export function focus() {
		textareaRef?.focus();
	}

	export function resetTextareaHeight() {
		textareaRef?.resetHeight();
	}

	export function openModelSelector() {
		chatFormActionsRef?.openModelSelector();
	}

	/**
	 * Check if a model is selected, open selector if not
	 * @returns true if model is selected, false otherwise
	 */
	export function checkModelSelected(): boolean {
		if (!hasModelSelected) {
			chatFormActionsRef?.openModelSelector();
			return false;
		}
		return true;
	}

	/**
	 *
	 *
	 * EVENT HANDLERS - File Management
	 *
	 *
	 */

	function handleFileSelect(files: File[]) {
		onFilesAdd?.(files);
	}

	function handleFileUpload() {
		fileInputRef?.click();
	}

	function handleFileRemove(fileId: string) {
		if (fileId.startsWith('attachment-')) {
			const index = parseInt(fileId.replace('attachment-', ''), 10);
			if (!isNaN(index) && index >= 0 && index < attachments.length) {
				onAttachmentRemove?.(index);
			}
		} else {
			onUploadedFileRemove?.(fileId);
		}
	}

	/**
	 *
	 *
	 * EVENT HANDLERS - Input & Keyboard
	 *
	 *
	 */

	function handleInput() {
		const perChatOverrides = conversationsStore.getAllMcpServerOverrides();
		const hasServers = mcpStore.hasEnabledServers(perChatOverrides);

		if (value.startsWith(PROMPT_TRIGGER_PREFIX) && hasServers) {
			isPromptPickerOpen = true;
			promptSearchQuery = value.slice(1);
			isInlineResourcePickerOpen = false;
			resourceSearchQuery = '';
		} else if (
			value.startsWith(RESOURCE_TRIGGER_PREFIX) &&
			hasServers &&
			mcpStore.hasResourcesCapability(perChatOverrides)
		) {
			isInlineResourcePickerOpen = true;
			resourceSearchQuery = value.slice(1);
			isPromptPickerOpen = false;
			promptSearchQuery = '';
		} else {
			isPromptPickerOpen = false;
			promptSearchQuery = '';
			isInlineResourcePickerOpen = false;
			resourceSearchQuery = '';
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (isPromptPickerOpen && promptPickerRef?.handleKeydown(event)) {
			return;
		}

		if (isInlineResourcePickerOpen && resourcePickerRef?.handleKeydown(event)) {
			return;
		}

		if (event.key === KeyboardKey.ESCAPE && isPromptPickerOpen) {
			isPromptPickerOpen = false;
			promptSearchQuery = '';
			return;
		}

		if (event.key === KeyboardKey.ESCAPE && isInlineResourcePickerOpen) {
			isInlineResourcePickerOpen = false;
			resourceSearchQuery = '';
			return;
		}

		if (event.key === KeyboardKey.ENTER && !event.shiftKey && !isIMEComposing(event)) {
			const isModifier = event.ctrlKey || event.metaKey;
			const sendOnEnter = currentConfig.sendOnEnter !== false;

			if (sendOnEnter || isModifier) {
				event.preventDefault();

				if (!canSubmit || disabled || isLoading || hasLoadingAttachments) return;

				onSubmit?.();
			}
		}
	}

	function handlePaste(event: ClipboardEvent) {
		if (!event.clipboardData) return;

		const files = Array.from(event.clipboardData.items)
			.filter((item) => item.kind === 'file')
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);

		if (files.length > 0) {
			event.preventDefault();
			onFilesAdd?.(files);
			return;
		}

		const text = event.clipboardData.getData(MimeTypeText.PLAIN);

		if (text.startsWith(CLIPBOARD_CONTENT_QUOTE_PREFIX)) {
			const parsed = parseClipboardContent(text);

			if (parsed.textAttachments.length > 0 || parsed.mcpPromptAttachments.length > 0) {
				event.preventDefault();
				value = parsed.message;
				onValueChange?.(parsed.message);

				// Handle text attachments as files
				if (parsed.textAttachments.length > 0) {
					const attachmentFiles = parsed.textAttachments.map(
						(att) =>
							new File([att.content], att.name, {
								type: MimeTypeText.PLAIN
							})
					);
					onFilesAdd?.(attachmentFiles);
				}

				// Handle MCP prompt attachments as ChatUploadedFile with mcpPrompt data
				if (parsed.mcpPromptAttachments.length > 0) {
					const mcpPromptFiles: ChatUploadedFile[] = parsed.mcpPromptAttachments.map((att) => ({
						id: uuid(),
						name: att.name,
						size: att.content.length,
						type: SpecialFileType.MCP_PROMPT,
						file: new File([att.content], `${att.name}${FileExtensionText.TXT}`, {
							type: MimeTypeText.PLAIN
						}),
						isLoading: false,
						textContent: att.content,
						mcpPrompt: {
							serverName: att.serverName,
							promptName: att.promptName,
							arguments: att.arguments
						}
					}));

					uploadedFiles = [...uploadedFiles, ...mcpPromptFiles];
					onUploadedFilesChange?.(uploadedFiles);
				}

				setTimeout(() => {
					textareaRef?.focus();
				}, 10);

				return;
			}
		}

		if (
			text.length > 0 &&
			pasteLongTextToFileLength > 0 &&
			text.length > pasteLongTextToFileLength
		) {
			event.preventDefault();

			const textFile = new File([text], t('chat.pastedText'), {
				type: MimeTypeText.PLAIN
			});

			const pastedTextAttachment: ChatUploadedFile = {
				id: uuid(),
				name: t('chat.pastedText'),
				size: text.length,
				type: MimeTypeText.PLAIN,
				file: textFile,
				isLoading: false,
				textContent: text,
				source: AttachmentSource.PASTED_TEXT
			};

			uploadedFiles = [...uploadedFiles, pastedTextAttachment];
			onUploadedFilesChange?.(uploadedFiles);
		}
	}

	/**
	 *
	 *
	 * EVENT HANDLERS - Prompt Picker
	 *
	 *
	 */

	function handlePromptLoadStart(
		placeholderId: string,
		promptInfo: MCPPromptInfo,
		args?: Record<string, string>
	) {
		// Only clear the value if the prompt was triggered by typing '/'
		if (value.startsWith(PROMPT_TRIGGER_PREFIX)) {
			value = '';
			onValueChange?.('');
		}
		isPromptPickerOpen = false;
		promptSearchQuery = '';

		const promptName = promptInfo.title || promptInfo.name;
		const placeholder: ChatUploadedFile = {
			id: placeholderId,
			name: promptName,
			size: INITIAL_FILE_SIZE,
			type: SpecialFileType.MCP_PROMPT,
			file: new File([], 'loading'),
			isLoading: true,
			mcpPrompt: {
				serverName: promptInfo.serverName,
				promptName: promptInfo.name,
				arguments: args ? { ...args } : undefined
			}
		};

		uploadedFiles = [...uploadedFiles, placeholder];
		onUploadedFilesChange?.(uploadedFiles);
		textareaRef?.focus();
	}

	function handlePromptLoadComplete(placeholderId: string, result: GetPromptResult) {
		const promptText = result.messages
			?.map((msg: PromptMessage) => {
				if (typeof msg.content === 'string') {
					return msg.content;
				}

				if (msg.content.type === ContentPartType.TEXT) {
					return msg.content.text;
				}

				return '';
			})
			.filter(Boolean)
			.join(PROMPT_CONTENT_SEPARATOR);

		uploadedFiles = uploadedFiles.map((f) =>
			f.id === placeholderId
				? {
						...f,
						isLoading: false,
						textContent: promptText,
						size: promptText.length,
						file: new File([promptText], `${f.name}${FileExtensionText.TXT}`, {
							type: MimeTypeText.PLAIN
						})
					}
				: f
		);
		onUploadedFilesChange?.(uploadedFiles);
	}

	function handlePromptLoadError(placeholderId: string, error: string) {
		uploadedFiles = uploadedFiles.map((f) =>
			f.id === placeholderId ? { ...f, isLoading: false, loadError: error } : f
		);
		onUploadedFilesChange?.(uploadedFiles);
	}

	function handlePromptPickerClose() {
		isPromptPickerOpen = false;
		promptSearchQuery = '';
		textareaRef?.focus();
	}

	/**
	 *
	 *
	 * EVENT HANDLERS - Inline Resource Picker
	 *
	 *
	 */

	function handleInlineResourcePickerClose() {
		isInlineResourcePickerOpen = false;
		resourceSearchQuery = '';
		textareaRef?.focus();
	}

	function handleInlineResourceSelect() {
		// Clear the @query from input after resource is attached
		if (value.startsWith(RESOURCE_TRIGGER_PREFIX)) {
			value = '';
			onValueChange?.('');
		}

		isInlineResourcePickerOpen = false;
		resourceSearchQuery = '';
		textareaRef?.focus();
	}

	function handleBrowseResources() {
		isInlineResourcePickerOpen = false;
		resourceSearchQuery = '';

		if (value.startsWith(RESOURCE_TRIGGER_PREFIX)) {
			value = '';
			onValueChange?.('');
		}

		isResourceDialogOpen = true;
	}

	/**
	 *
	 *
	 * EVENT HANDLERS - Audio Recording
	 *
	 *
	 */

	async function handleMicClick() {
		if (!audioRecorder || !recordingSupported) {
			console.warn('Audio recording not supported');
			return;
		}

		if (isRecording) {
			try {
				const audioBlob = await audioRecorder.stopRecording();
				const wavBlob = await convertToWav(audioBlob);
				const audioFile = createAudioFile(wavBlob);

				onFilesAdd?.([audioFile]);
				isRecording = false;
			} catch (error) {
				console.error('Failed to stop recording:', error);
				isRecording = false;
			}
		} else {
			try {
				await audioRecorder.startRecording();
				isRecording = true;
			} catch (error) {
				console.error('Failed to start recording:', error);
			}
		}
	}
</script>

<ChatFormFileInputInvisible bind:this={fileInputRef} onFileSelect={handleFileSelect} />

<form
	class="llampart-chat-form-root relative {className}"
	onsubmit={(e) => {
		e.preventDefault();
		if (!canSubmit || disabled || isLoading || hasLoadingAttachments) return;
		onSubmit?.();
	}}
>
	<ChatFormPromptPicker
		bind:this={promptPickerRef}
		isOpen={isPromptPickerOpen}
		searchQuery={promptSearchQuery}
		onClose={handlePromptPickerClose}
		onPromptLoadStart={handlePromptLoadStart}
		onPromptLoadComplete={handlePromptLoadComplete}
		onPromptLoadError={handlePromptLoadError}
	/>

	<ChatFormResourcePicker
		bind:this={resourcePickerRef}
		isOpen={isInlineResourcePickerOpen}
		searchQuery={resourceSearchQuery}
		onClose={handleInlineResourcePickerClose}
		onResourceSelect={handleInlineResourceSelect}
		onBrowse={handleBrowseResources}
	/>

	<div
		class="{INPUT_CLASSES} llampart-chat-input-frame overflow-hidden rounded-3xl {disabled
			? 'cursor-not-allowed opacity-60'
			: ''}"
		data-slot="input-area"
	>
		<ChatAttachmentsList
			{attachments}
			bind:uploadedFiles
			onFileRemove={handleFileRemove}
			limitToSingleRow
			class="py-5"
			style="scroll-padding: 1rem;"
			activeModelId={activeModelId ?? undefined}
		/>

		<div
			class="flex-column relative min-h-[48px] items-center rounded-3xl py-2 pb-2.25 transition-all md:!py-3"
			data-llampart-composer-body
			onpaste={handlePaste}
		>
			<ChatFormTextarea
				class="px-5 py-1.5 md:pt-0"
				bind:this={textareaRef}
				bind:value
				onKeydown={handleKeydown}
				onInput={() => {
					handleInput();
					onValueChange?.(value);
				}}
				{disabled}
				placeholder={resolvedPlaceholder}
			/>

			{#if mcpHasResourceAttachments()}
				<ChatAttachmentMcpResources
					class="mb-3"
					onResourceClick={(uri) => {
						preSelectedResourceUri = uri;
						isResourceDialogOpen = true;
					}}
				/>
			{/if}

			<ChatFormActions
				class="px-3"
				bind:this={chatFormActionsRef}
				canSend={canSubmit}
				hasText={value.trim().length > 0}
				{disabled}
				{isLoading}
				{isRecording}
				{uploadedFiles}
				onFileUpload={handleFileUpload}
				onMicClick={handleMicClick}
				{onStop}
				onSystemPromptClick={() => onSystemPromptClick?.({ message: value, files: uploadedFiles })}
				onMcpPromptClick={showMcpPromptButton ? () => (isPromptPickerOpen = true) : undefined}
				onMcpResourcesClick={() => (isResourceDialogOpen = true)}
			/>
		</div>
	</div>
</form>

<DialogMcpResources
	bind:open={isResourceDialogOpen}
	preSelectedUri={preSelectedResourceUri}
	onAttach={(resource: MCPResourceInfo) => {
		mcpStore.attachResource(resource.uri);
	}}
	onOpenChange={(newOpen: boolean) => {
		if (!newOpen) {
			preSelectedResourceUri = undefined;
		}
	}}
/>

<style>
	.llampart-chat-input-frame {
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		box-shadow: none;
	}

	/* llampart-frosted-glass-composer-compositing-stability */
	:global(html.has-frosted-glass-theme) .llampart-chat-input-frame {
		position: relative !important;
		isolation: isolate;
		background-clip: padding-box !important;
	}

	:global(html.has-frosted-glass-theme .llampart-chat-input-frame [data-llampart-composer-body]),
	:global(
		html.has-frosted-glass-theme .llampart-chat-input-frame [data-llampart-composer-body] > *
	) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-chat-input-frame [data-llampart-composer-body]) {
		transition-property: min-height, padding, opacity, transform !important;
	}

	/* llampart-frosted-glass-composer-shell-and-menus
	   Frame surface values are owned by the global Frosted Glass surface primitives in app.css. */
	/* llampart-composer-bare-action: transparent icon-only composer triggers opt out of the filled Frosted Glass button chrome below. */

	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global(button:not(.llampart-composer-bare-action)),
	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global([role='button']:not(.llampart-composer-bare-action)),
	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global([data-slot='button']:not(.llampart-composer-bare-action)) {
		border: 1px solid rgba(255, 255, 255, 0.2) !important;
		background: rgba(255, 255, 255, 0.2) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(0, 0, 0, 0.045) !important;
		backdrop-filter: blur(10px) saturate(110%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(110%) !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global(button:not(.llampart-composer-bare-action):hover),
	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global([role='button']:not(.llampart-composer-bare-action):hover),
	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global([data-slot='button']:not(.llampart-composer-bare-action):hover) {
		background: rgba(255, 255, 255, 0.28) !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-chat-input-frame :global(button[disabled]),
	:global(html.has-frosted-glass-theme) .llampart-chat-input-frame :global([data-disabled]) {
		opacity: 0.58 !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-chat-input-frame :global(svg) {
		color: #000000 !important;
		stroke: currentColor !important;
		filter: none !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global(svg.llampart-reasoning-trigger-icon-disabled) {
		color: #e7000b !important;
		stroke: #e7000b !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-chat-input-frame :global([data-slot='badge']),
	:global(html.has-frosted-glass-theme) .llampart-chat-input-frame :global(.badge) {
		background: rgba(255, 255, 255, 0.22) !important;
		border-color: rgba(255, 255, 255, 0.2) !important;
		box-shadow: none !important;
	}

	/* llampart-frosted-glass-composer-runtime-control-polish */

	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global(.llampart-composer-stop-action:hover) {
		background: rgba(255, 255, 255, 0.34) !important;
		background-color: rgba(255, 255, 255, 0.34) !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global(.llampart-composer-stop-glyph) {
		width: 1rem !important;
		height: 1rem !important;
		color: rgba(231, 0, 11, 0.78) !important;
		fill: rgba(231, 0, 11, 0.78) !important;
		stroke: rgba(231, 0, 11, 0.78) !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-chat-input-frame
		:global(.llampart-composer-stop-action:hover .llampart-composer-stop-glyph) {
		color: rgba(231, 0, 11, 0.9) !important;
		fill: rgba(231, 0, 11, 0.9) !important;
		stroke: rgba(231, 0, 11, 0.9) !important;
	}

	:global(html.has-frosted-glass-theme [data-slot='dropdown-menu-content']),
	:global(html.has-frosted-glass-theme [data-slot='popover-content']),
	:global(html.has-frosted-glass-theme [data-slot='select-content']),
	:global(html.has-frosted-glass-theme [data-slot='sheet-content']) {
		border: 1px solid rgba(255, 255, 255, 0.2) !important;
		background: rgba(255, 255, 255, 0.18) !important;
		color: #000000 !important;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.06),
			0 4px 12px rgba(0, 0, 0, 0.055),
			0 16px 32px rgba(0, 0, 0, 0.045) !important;
		backdrop-filter: blur(18px) saturate(116%) !important;
		-webkit-backdrop-filter: blur(18px) saturate(116%) !important;
	}

	:global(html.has-frosted-glass-theme [data-slot='dropdown-menu-content'] *),
	:global(html.has-frosted-glass-theme [data-slot='popover-content'] *),
	:global(html.has-frosted-glass-theme [data-slot='select-content'] *),
	:global(html.has-frosted-glass-theme [data-slot='sheet-content'] *) {
		color: #000000 !important;
	}

	:global(html.has-frosted-glass-theme [data-slot='dropdown-menu-content'] [role='menuitem']:hover),
	:global(
		html.has-frosted-glass-theme
			[data-slot='dropdown-menu-content']
			[role='menuitem'][data-highlighted]
	),
	:global(html.has-frosted-glass-theme [data-slot='select-content'] [data-highlighted]) {
		background: rgba(255, 255, 255, 0.22) !important;
	}
</style>
