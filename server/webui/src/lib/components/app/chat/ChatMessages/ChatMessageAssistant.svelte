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
	import {
		autoResizeTextarea,
		copyToClipboard,
		deriveAgenticSections,
		isIMEComposing
	} from '$lib/utils';
	import { AgenticSectionType } from '$lib/enums';
	import { tick } from 'svelte';
	import { Check, X, Loader2, Brain, Wrench, Info } from '@lucide/svelte';
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
		onContinue?: () => void;
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
		onContinue,
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

	let minimalAgenticIndicatorsActive = $derived(
		!!currentConfig.minimalAgenticIndicators && isAgentic
	);

	let minimalAgenticUiSections = $derived(
		minimalAgenticIndicatorsActive
			? deriveAgenticSections(message, toolMessages, [], isStreaming)
			: []
	);

	let hasActiveMinimalFooterReasoningIndicator = $derived(
		minimalAgenticIndicatorsActive &&
			isStreaming &&
			minimalAgenticUiSections.some(
				(section) => section.type === AgenticSectionType.REASONING_PENDING
			)
	);

	let hasActiveMinimalFooterToolIndicator = $derived(
		minimalAgenticIndicatorsActive &&
			isStreaming &&
			minimalAgenticUiSections.some(
				(section) =>
					section.type === AgenticSectionType.TOOL_CALL_PENDING ||
					section.type === AgenticSectionType.TOOL_CALL_STREAMING
			)
	);

	let showMinimalAgenticFooterIndicators = $derived(
		hasActiveMinimalFooterReasoningIndicator || hasActiveMinimalFooterToolIndicator
	);
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
		<div class="w-full">
			<textarea
				bind:this={textareaElement}
				value={editCtx.editedContent}
				class="min-h-[50vh] w-full resize-y rounded-2xl px-3 py-2 text-sm {INPUT_CLASSES}"
				onkeydown={handleEditKeydown}
				oninput={(e) => {
					autoResizeTextarea(e.currentTarget);
					editCtx.setContent(e.currentTarget.value);
				}}
				placeholder={t('messages.editAssistantMessagePlaceholder')}
			></textarea>

			<div class="mt-2 flex items-center justify-between">
				<div class="flex items-center space-x-2">
					<Checkbox
						id="branch-after-edit"
						bind:checked={shouldBranchAfterEdit}
						onCheckedChange={(checked) => (shouldBranchAfterEdit = checked === true)}
					/>
					<Label for="branch-after-edit" class="cursor-pointer text-sm text-muted-foreground">
						{t('messages.branchConversationAfterEdit')}
					</Label>
				</div>
				<div class="flex gap-2">
					<Button class="h-8 px-3" onclick={editCtx.cancel} size="sm" variant="outline">
						<X class="mr-1 h-3 w-3" />
						{t('common.cancel')}
					</Button>

					<Button
						class="h-8 px-3"
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
								{#if showMinimalAgenticFooterIndicators}
									<div class="minimal-agentic-footer-indicators" aria-live="polite">
										{#if hasActiveMinimalFooterReasoningIndicator}
											<span
												class="minimal-agentic-footer-indicator"
												aria-label={t('messages.agenticReasoningStreaming')}
											>
												<span class="minimal-agentic-footer-spinner" aria-hidden="true">
													<Loader2 />
												</span>
												<span class="minimal-agentic-footer-center-icon" aria-hidden="true">
													<Brain />
												</span>
											</span>
										{/if}

										{#if hasActiveMinimalFooterToolIndicator}
											<span
												class="minimal-agentic-footer-indicator"
												aria-label={t('messages.agenticExecuting')}
											>
												<span class="minimal-agentic-footer-spinner" aria-hidden="true">
													<Loader2 />
												</span>
												<span class="minimal-agentic-footer-center-icon" aria-hidden="true">
													<Wrench />
												</span>
											</span>
										{/if}
									</div>
								{/if}

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
									onContinue={currentConfig.enableContinueGeneration && !hasReasoning
										? onContinue
										: undefined}
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
		color: #3c3c3c;
	}

	:global(.dark) .llampart-assistant-message {
		color: var(--llampart-assistant-message-foreground, #e8e8e8);
	}

	.llampart-assistant-model-info-action,
	.llampart-assistant-model-info-action:is(:hover, :focus, :focus-visible, :active) {
		border: 0 !important;
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		filter: none !important;
		-webkit-backdrop-filter: none !important;
		backdrop-filter: none !important;
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

	:global(.has-frosted-glass-theme) .assistant-message-footer,
	:global(.has-frosted-glass-theme) .assistant-message-footer :global(*) {
		color: #000000 !important;
		font-weight: 400 !important;
		text-shadow:
			0 0 1px rgba(255, 255, 255, 0.32),
			0 0 3px rgba(255, 255, 255, 0.2);
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer {
		gap: 0.875rem;
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer-left,
	:global(.has-frosted-glass-theme) .assistant-message-footer-right {
		min-height: 2rem;
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer :global(svg) {
		color: #000000 !important;
		stroke: currentColor;
		stroke-width: 2.15;
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.28));
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer :global(button),
	:global(.has-frosted-glass-theme) .assistant-message-footer :global([role='button']) {
		background: transparent !important;
		border-color: transparent !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer :global(.stats-view-switcher) {
		background: transparent !important;
		border: 0 !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer :global(.stats-view-button) {
		background: transparent !important;
		border: 1px solid transparent !important;
		box-shadow: none !important;
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer :global(.stats-view-button:hover) {
		background: transparent !important;
	}

	:global(.has-frosted-glass-theme) .assistant-message-footer :global(.stats-view-button-active) {
		background: rgba(255, 255, 255, 0.16) !important;
		border-color: rgba(255, 255, 255, 0.16) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 1px 2px rgba(0, 0, 0, 0.05) !important;
		backdrop-filter: blur(10px) saturate(115%);
		-webkit-backdrop-filter: blur(10px) saturate(115%);
	}

	.minimal-agentic-footer-indicators {
		display: inline-flex;
		height: 1.5rem;
		align-items: center;
		gap: 0.125rem;
		margin-right: 0.125rem;
		pointer-events: none;
	}

	.minimal-agentic-footer-indicator {
		position: relative;
		display: inline-flex;
		height: 1.5rem;
		width: 1.5rem;
		flex: 0 0 1.5rem;
		align-items: center;
		justify-content: center;
		color: hsl(var(--foreground));
	}

	.minimal-agentic-footer-spinner {
		position: absolute;
		inset: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		opacity: 0.52;
	}

	.minimal-agentic-footer-spinner :global(svg) {
		height: 1.35rem;
		width: 1.35rem;
		animation: spin 1s linear infinite;
		stroke-width: 1.05;
	}

	.minimal-agentic-footer-center-icon {
		position: relative;
		z-index: 1;
		display: inline-flex;
		height: 0.75rem;
		width: 0.75rem;
		align-items: center;
		justify-content: center;
	}

	.minimal-agentic-footer-center-icon :global(svg) {
		height: 0.75rem;
		width: 0.75rem;
		stroke-width: 1.7;
	}

	@media (prefers-reduced-motion: reduce) {
		.minimal-agentic-footer-spinner :global(svg) {
			animation: none !important;
		}
	}

	:global(html.has-frosted-glass-theme) .minimal-agentic-footer-indicator {
		color: var(--llampart-frosted-user-message-foreground, #000000);
		filter: none;
	}

	:global(html.has-frosted-glass-theme) .minimal-agentic-footer-spinner {
		opacity: 0.5;
	}

	/* minimal-agentic-footer-spinner-specific-stroke */
	:global(html.has-frosted-glass-theme)
		.assistant-message-footer
		.minimal-agentic-footer-spinner
		:global(svg),
	:global(html.has-frosted-glass-theme)
		.assistant-message-footer
		.minimal-agentic-footer-spinner
		:global(svg *) {
		stroke-width: 1.05 !important;
	}

	@media (max-width: 640px) {
		.assistant-message-footer-right {
			width: 100%;
			margin-left: 0;
		}
	}

	/* llampart-frosted-footer-final-tuning */
	:global(html.has-frosted-glass-theme .assistant-message-footer) {
		gap: 0.875rem;
		margin-bottom: 0;
		padding-bottom: 0.125rem;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer),
	:global(html.has-frosted-glass-theme .assistant-message-footer *) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: normal !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-left),
	:global(html.has-frosted-glass-theme .assistant-message-footer-right) {
		min-height: 2rem;
		padding-bottom: 0.125rem;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-left) {
		padding-left: 0.125rem;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-right) {
		padding-right: 0.125rem;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer svg) {
		color: #000000 !important;
		stroke: currentColor;
		stroke-width: 2 !important;
		filter: none !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer button),
	:global(html.has-frosted-glass-theme .assistant-message-footer [role='button']),
	:global(html.has-frosted-glass-theme .assistant-message-footer a) {
		background: transparent !important;
		border-color: transparent !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		font-weight: 400 !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-switcher) {
		background: transparent !important;
		border: 0 !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-button) {
		background: transparent !important;
		border: 1px solid transparent !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		font-weight: 400 !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-button:hover) {
		background: transparent !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-button-active) {
		background: rgba(255, 255, 255, 0.16) !important;
		border-color: rgba(255, 255, 255, 0.16) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 1px 2px rgba(0, 0, 0, 0.05) !important;
		backdrop-filter: blur(10px) saturate(115%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(115%) !important;
	}

	/* llampart-assistant-message-footer-icon-only-light-dark */
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right [data-slot='button']),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right button),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right a),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right [role='button']) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border: 0 !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		filter: none !important;
		text-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		transform: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
	}

	:global(
		html:not(.has-frosted-glass-theme) .assistant-message-footer-right [data-slot='button']:hover
	),
	:global(
		html:not(.has-frosted-glass-theme)
			.assistant-message-footer-right
			[data-slot='button']:focus-visible
	),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right button:hover),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right button:focus-visible),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right a:hover),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right a:focus-visible),
	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right [role='button']:hover),
	:global(
		html:not(.has-frosted-glass-theme) .assistant-message-footer-right [role='button']:focus-visible
	) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		filter: none !important;
		text-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		transform: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
	}

	:global(html:not(.has-frosted-glass-theme) .assistant-message-footer-right svg) {
		filter: none !important;
		text-shadow: none !important;
		box-shadow: none !important;
		transform: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
	}

	/* llampart-assistant-footer-lower-insets-regular-weight */
	:global(html.has-frosted-glass-theme .assistant-message-footer) {
		align-items: center !important;
		gap: 0.875rem !important;
		margin: 0 !important;
		padding: 0 !important;
		font-weight: 400 !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer),
	:global(html.has-frosted-glass-theme .assistant-message-footer *) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: normal !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-left),
	:global(html.has-frosted-glass-theme .assistant-message-footer-right) {
		min-height: 0 !important;
		padding: 0 !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-meta) {
		align-items: center !important;
		font-weight: 400 !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer button),
	:global(html.has-frosted-glass-theme .assistant-message-footer [role='button']),
	:global(html.has-frosted-glass-theme .assistant-message-footer a) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border-color: transparent !important;
		box-shadow: none !important;
		font-weight: 400 !important;
		text-shadow: none !important;
		filter: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer svg) {
		stroke-width: 1.8 !important;
		filter: none !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-button) {
		font-weight: 400 !important;
	}
	/* llampart-footer-regular-weight-only-final */
	:global(html.has-frosted-glass-theme .assistant-message-footer),
	:global(html.has-frosted-glass-theme .assistant-message-footer *),
	:global(html.has-frosted-glass-theme .assistant-message-footer *),
	:global(html.has-frosted-glass-theme .assistant-message-footer button),
	:global(html.has-frosted-glass-theme .assistant-message-footer [data-slot='button']),
	:global(html.has-frosted-glass-theme .assistant-message-footer [data-slot='badge']),
	:global(html.has-frosted-glass-theme .assistant-message-footer [class*='font-']),
	:global(html.has-frosted-glass-theme .assistant-message-footer strong),
	:global(html.has-frosted-glass-theme .assistant-message-footer b) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer svg),
	:global(html.has-frosted-glass-theme .assistant-message-footer svg *) {
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
	}

	/* llampart-frosted-glass-assistant-footer-regular-black */
	:global(html.has-frosted-glass-theme) .assistant-message-footer,
	:global(html.has-frosted-glass-theme) .assistant-message-footer :global(*) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme) .assistant-message-footer :global(svg),
	:global(html.has-frosted-glass-theme) .assistant-message-footer :global(svg *) {
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
	}
	/* llampart-frosted-glass-assistant-footer-glow-regular-final */
	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer),
	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer *),
	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer *) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer svg),
	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer svg *) {
		stroke-width: 1.65 !important;
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.32)) !important;
	}

	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer button),
	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer [role='button']),
	:global(html.has-frosted-glass-theme .agentic-content .assistant-message-footer a) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border-color: transparent !important;
		box-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	/* llampart-frosted-glass-main-footer-axis-final */
	:global(html.has-frosted-glass-theme .assistant-message-footer) {
		display: flex !important;
		align-items: center !important;
		gap: 0.875rem !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-left),
	:global(html.has-frosted-glass-theme .assistant-message-footer-right),
	:global(html.has-frosted-glass-theme .assistant-message-footer-meta) {
		display: inline-flex !important;
		align-items: center !important;
		min-height: 2rem !important;
		line-height: 1 !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer-meta) {
		gap: 0.5rem !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .llampart-chat-message-statistics),
	:global(html.has-frosted-glass-theme .assistant-message-footer .llampart-chat-message-statistics),
	:global(html.has-frosted-glass-theme .assistant-message-footer .llampart-message-actions) {
		display: inline-flex !important;
		align-items: center !important;
		line-height: 1 !important;
		transform: none !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-switcher),
	:global(html.has-frosted-glass-theme .assistant-message-footer .stats-view-button),
	:global(html.has-frosted-glass-theme .assistant-message-footer button),
	:global(html.has-frosted-glass-theme .assistant-message-footer a),
	:global(html.has-frosted-glass-theme .assistant-message-footer [role='button']) {
		display: inline-flex !important;
		align-items: center !important;
		justify-content: center !important;
		line-height: 1 !important;
		vertical-align: middle !important;
	}

	:global(html.has-frosted-glass-theme .assistant-message-footer svg) {
		display: block !important;
		flex: 0 0 auto !important;
	}
</style>
