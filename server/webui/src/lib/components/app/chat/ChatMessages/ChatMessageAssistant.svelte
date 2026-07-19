<script lang="ts">
	import { t } from '$lib/i18n';
	import {
		ActionIcon,
		ChatMessageAgenticContent,
		ChatMessageActions,
		ChatMessageStatistics,
		DialogModelInformation,
		ModelBadge,
		ModelsSelector
	} from '$lib/components/app';
	import { getMessageEditContext } from '$lib/contexts';
	import { useProcessingState } from '$lib/hooks/use-processing-state.svelte';
	import { isLoading, isChatStreaming } from '$lib/stores/chat.svelte';
	import { autoResizeTextarea, copyToClipboard, isIMEComposing } from '$lib/utils';
	import { tick } from 'svelte';
	import { Check, X, Info } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { INPUT_CLASSES } from '$lib/constants';
	import { MessageRole, KeyboardKey, ChatMessageStatsView } from '$lib/enums';
	import Label from '$lib/components/ui/label/label.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { ServerModelStatus } from '$lib/enums';

	import { hasAgenticContent } from '$lib/utils';

	interface Props {
		class?: string;
		deletionInfo: {
			totalCount: number;
			userMessages: number;
			assistantMessages: number;
			messageTypes: string[];
		} | null;
		isLastAssistantMessage?: boolean;
		message: DatabaseMessage;
		toolMessages?: DatabaseMessage[];
		messageContent: string | undefined;
		onCopy: () => void;
		onConfirmDelete: () => void;
		onDelete: () => void;
		onEdit?: () => void;
		onForkConversation?: (options: { name: string; includeAttachments: boolean }) => void;
		onNavigateToSibling?: (siblingId: string) => void;
		onRegenerate: (modelOverride?: string) => void;
		onShowDeleteDialogChange: (show: boolean) => void;
		showDeleteDialog: boolean;
		siblingInfo?: ChatMessageSiblingInfo | null;
		textareaElement?: HTMLTextAreaElement;
	}

	let {
		class: className = '',
		deletionInfo,
		isLastAssistantMessage = false,
		message,
		toolMessages = [],
		messageContent,
		onConfirmDelete,
		onCopy,
		onDelete,
		onEdit,
		onForkConversation,
		onNavigateToSibling,
		onRegenerate,
		onShowDeleteDialogChange,
		showDeleteDialog,
		siblingInfo = null,
		textareaElement = $bindable()
	}: Props = $props();

	// Get edit context
	const editCtx = getMessageEditContext();

	// Local state for assistant-specific editing
	let shouldBranchAfterEdit = $state(false);

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === KeyboardKey.ENTER && !event.shiftKey && !isIMEComposing(event)) {
			event.preventDefault();
			editCtx.save();
		} else if (event.key === KeyboardKey.ESCAPE) {
			event.preventDefault();
			editCtx.cancel();
		}
	}

	const isAgentic = $derived(hasAgenticContent(message, toolMessages));
	const hasReasoning = $derived(!!message.reasoningContent);
	const processingState = useProcessingState();

	let currentConfig = $derived(config());
	let isRouter = $derived(isRouterMode());
	let showModelDialog = $state(false);
	let infoModelId = $state<string | null>(null);

	let hideMinimalisticProcessingInfo = $derived(
		!!currentConfig.minimalAgenticIndicators && isLastAssistantMessage
	);

	let activeStatsView = $state<ChatMessageStatsView>(ChatMessageStatsView.GENERATION);
	let statsContainerEl: HTMLDivElement | undefined = $state();

	function getScrollParent(el: HTMLElement): HTMLElement | null {
		let parent = el.parentElement;
		while (parent) {
			const style = getComputedStyle(parent);
			if (/(auto|scroll)/.test(style.overflowY)) {
				return parent;
			}
			parent = parent.parentElement;
		}
		return null;
	}

	async function handleStatsViewChange(view: ChatMessageStatsView) {
		const el = statsContainerEl;
		if (!el) {
			activeStatsView = view;

			return;
		}

		const scrollParent = getScrollParent(el);
		if (!scrollParent) {
			activeStatsView = view;

			return;
		}

		const yBefore = el.getBoundingClientRect().top;

		activeStatsView = view;

		await tick();

		const delta = el.getBoundingClientRect().top - yBefore;
		if (delta !== 0) {
			scrollParent.scrollTop += delta;
		}

		// Correct any drift after browser paint
		requestAnimationFrame(() => {
			const drift = el.getBoundingClientRect().top - yBefore;

			if (Math.abs(drift) > 1) {
				scrollParent.scrollTop += drift;
			}
		});
	}

	let highlightAgenticTurns = $derived(
		isAgentic &&
			(currentConfig.alwaysShowAgenticTurns || activeStatsView === ChatMessageStatsView.SUMMARY)
	);

	let displayedModel = $derived(message.model ?? null);
	let canShowModelProps = $derived(modelsStore.supportsModelProps);

	let isCurrentlyLoading = $derived(isLoading());
	let isStreaming = $derived(isChatStreaming());

	let hasNoContent = $derived(!message?.content?.trim());
	let isActivelyProcessing = $derived(isCurrentlyLoading || isStreaming);

	let showProcessingInfoTop = $derived(
		message?.role === MessageRole.ASSISTANT &&
			isActivelyProcessing &&
			!hideMinimalisticProcessingInfo &&
			hasNoContent &&
			!hasReasoning &&
			!isAgentic &&
			isLastAssistantMessage
	);

	// llampart-show-assistant-frame-during-reasoning-tools
	let showAssistantMessageBody = $derived(!showProcessingInfoTop || hasReasoning || isAgentic);

	let showProcessingInfoBottom = $derived(
		message?.role === MessageRole.ASSISTANT &&
			isActivelyProcessing &&
			!hideMinimalisticProcessingInfo &&
			(!hasNoContent || isAgentic) &&
			isLastAssistantMessage
	);

	function handleCopyModel() {
		void copyToClipboard(displayedModel ?? '');
	}

	function handleShowModelInformation() {
		if (!displayedModel || !canShowModelProps) return;

		infoModelId = displayedModel;
		showModelDialog = true;
	}

	$effect(() => {
		if (editCtx.isEditing && textareaElement) {
			autoResizeTextarea(textareaElement);
		}
	});

	$effect(() => {
		if (showProcessingInfoTop || showProcessingInfoBottom) {
			processingState.startMonitoring();
		}
	});
</script>

<div
	class="llampart-assistant-message text-md group w-full leading-7.5 {className}"
	role="group"
	aria-label={t('messages.assistantMessageWithActions')}
>
	<!-- llampart-no-processing-text-outside-assistant-frame: local Processing/Reasoning label intentionally not rendered here. -->

	{#if editCtx.isEditing}
		<div class="llampart-message-edit-card llampart-assistant-message-edit-card w-full">
			<textarea
				bind:this={textareaElement}
				value={editCtx.editedContent}
				class="llampart-message-edit-textarea min-h-[50vh] w-full resize-y rounded-2xl px-3 py-2 text-sm {INPUT_CLASSES}"
				onkeydown={handleEditKeydown}
				oninput={(e) => {
					autoResizeTextarea(e.currentTarget);
					editCtx.setContent(e.currentTarget.value);
				}}
				placeholder={t('messages.editAssistantMessagePlaceholder')}
			></textarea>

			<div class="llampart-message-edit-controls mt-3 flex items-center justify-between gap-3">
				<div class="llampart-message-edit-option flex items-center space-x-2">
					<Checkbox
						class="llampart-message-edit-branch-checkbox"
						id="branch-after-edit"
						bind:checked={shouldBranchAfterEdit}
						onCheckedChange={(checked) => (shouldBranchAfterEdit = checked === true)}
					/>
					<Label
						for="branch-after-edit"
						class="llampart-message-edit-option-label cursor-pointer text-sm text-muted-foreground"
					>
						{t('messages.branchConversationAfterEdit')}
					</Label>
				</div>
				<div class="llampart-message-edit-actions flex gap-2">
					<Button
						class="llampart-message-edit-cancel-action h-8 px-3"
						onclick={editCtx.cancel}
						size="sm"
						variant="outline"
					>
						<X class="mr-1 h-3 w-3" />
						{t('common.cancel')}
					</Button>

					<Button
						class="llampart-message-edit-save-action h-8 px-3"
						onclick={editCtx.save}
						disabled={!editCtx.editedContent?.trim()}
						size="sm"
					>
						<Check class="mr-1 h-3 w-3" />
						{t('common.save')}
					</Button>
				</div>
			</div>
		</div>
	{:else if message.role === MessageRole.ASSISTANT}
		{#if showAssistantMessageBody}
			<!-- llampart-hide-empty-assistant-frame-while-processing -->
			<ChatMessageAgenticContent
				{message}
				{toolMessages}
				isStreaming={isChatStreaming()}
				{isLastAssistantMessage}
				highlightTurns={highlightAgenticTurns}
			>
				{#snippet footer()}
					{#if message.timestamp && !editCtx.isEditing}
						<div class="assistant-message-footer">
							<div class="assistant-message-footer-left">
								{#if displayedModel}
									<div
										bind:this={statsContainerEl}
										class="assistant-message-footer-meta text-xs text-muted-foreground"
									>
										{#if isRouter}
											<ModelsSelector
												currentModel={displayedModel}
												disabled={isLoading()}
												onModelChange={async (modelId, modelName) => {
													const status = modelsStore.getModelStatus(modelId);

													if (status !== ServerModelStatus.LOADED) {
														await modelsStore.loadModel(modelId);
													}

													onRegenerate(modelName);
													return true;
												}}
											/>
										{:else}
											<ModelBadge model={displayedModel || undefined} onclick={handleCopyModel} />
										{/if}

										{#if canShowModelProps}
											<ActionIcon
												icon={Info}
												tooltip={t('models.modelInformation')}
												iconSize="h-2.5 w-2.5"
												class="llampart-assistant-model-info-action h-3 w-3 hover:text-foreground"
												onclick={handleShowModelInformation}
											/>
										{/if}

										{#if currentConfig.showMessageStats && message.timings && message.timings.predicted_n && message.timings.predicted_ms}
											{@const agentic = message.timings.agentic}
											<ChatMessageStatistics
												promptTokens={agentic ? agentic.llm.prompt_n : message.timings.prompt_n}
												promptMs={agentic ? agentic.llm.prompt_ms : message.timings.prompt_ms}
												predictedTokens={agentic
													? agentic.llm.predicted_n
													: message.timings.predicted_n}
												predictedMs={agentic
													? agentic.llm.predicted_ms
													: message.timings.predicted_ms}
												agenticTimings={agentic}
												onActiveViewChange={handleStatsViewChange}
											/>
										{:else if isLoading() && currentConfig.showMessageStats}
											{@const liveStats = processingState.getLiveProcessingStats()}
											{@const genStats = processingState.getLiveGenerationStats()}
											{@const promptProgress = processingState.processingState?.promptProgress}
											{@const isStillProcessingPrompt =
												promptProgress && promptProgress.processed < promptProgress.total}

											{#if liveStats || genStats}
												<ChatMessageStatistics
													isLive
													isProcessingPrompt={!!isStillProcessingPrompt}
													promptTokens={liveStats?.tokensProcessed}
													promptMs={liveStats?.timeMs}
													predictedTokens={genStats?.tokensGenerated}
													predictedMs={genStats?.timeMs}
												/>
											{/if}
										{/if}
									</div>
								{/if}
							</div>

							<div class="assistant-message-footer-right">
								<ChatMessageActions
									role={MessageRole.ASSISTANT}
									justify="end"
									actionsPosition="right"
									{siblingInfo}
									{showDeleteDialog}
									{deletionInfo}
									{onCopy}
									{onEdit}
									{onRegenerate}
									{onForkConversation}
									{onDelete}
									{onConfirmDelete}
									{onNavigateToSibling}
									{onShowDeleteDialogChange}
								/>
							</div>
						</div>
					{/if}
				{/snippet}
			</ChatMessageAgenticContent>
		{/if}
	{:else}
		<div class="text-sm whitespace-pre-wrap">
			{messageContent}
		</div>
	{/if}
</div>

{#if canShowModelProps}
	<DialogModelInformation bind:open={showModelDialog} modelId={infoModelId} />
{/if}

<style>
	.llampart-assistant-message {
		color: var(--llampart-assistant-message-foreground);
	}

	.llampart-assistant-model-info-action,
	.llampart-assistant-model-info-action:is(:hover, :focus, :focus-visible, :active) {
		border: 0 !important;
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: var(--llampart-assistant-model-info-action-filter) !important;
		-webkit-backdrop-filter: var(--llampart-assistant-model-info-action-filter) !important;
		backdrop-filter: var(--llampart-assistant-model-info-action-filter) !important;
	}

	.assistant-message-footer {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: -0.25rem;
	}

	.assistant-message-footer-left {
		flex: 1 1 24rem;
		min-width: 0;
	}

	.assistant-message-footer-meta {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem;
		font-variant-numeric: tabular-nums;
	}

	.assistant-message-footer-right {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		margin-left: auto;
	}

	.assistant-message-footer-right :global(.relative) {
		margin-top: 0;
		height: auto;
	}

	@media (max-width: 640px) {
		.assistant-message-footer-right {
			width: 100%;
			margin-left: 0;
		}
	}
</style>
