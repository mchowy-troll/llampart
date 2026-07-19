<script lang="ts">
	import {
		ChatMessageStatistics,
		CollapsibleContentBlock,
		MarkdownContent,
		SyntaxHighlightedCode,
		ChatMessageActionCardPermissionRequest
	} from '$lib/components/app';
	import { config } from '$lib/stores/settings.svelte';
	import { Wrench, Loader2, Brain } from '@lucide/svelte';
	import { AgenticSectionType, FileTypeText, ToolPermissionDecision } from '$lib/enums';
	import { formatJsonPretty } from '$lib/utils';
	import {
		deriveAgenticSections,
		parseToolResultWithImages,
		type AgenticSection,
		type ToolResultLine
	} from '$lib/utils';
	import type { DatabaseMessage } from '$lib/types/database';
	import type { ChatMessageAgenticTimings, ChatMessageAgenticTurnStats } from '$lib/types/chat';
	import { ChatMessageStatsView } from '$lib/enums';
	import { t } from '$lib/i18n';
	import {
		agenticPendingPermissionRequest,
		agenticResolvePermission
	} from '$lib/stores/agentic.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		message: DatabaseMessage;
		toolMessages?: DatabaseMessage[];
		isStreaming?: boolean;
		isLastAssistantMessage?: boolean;
		highlightTurns?: boolean;
		footer?: Snippet;
	}

	let {
		message,
		toolMessages = [],
		isStreaming = false,
		isLastAssistantMessage = false,
		highlightTurns = false,
		footer
	}: Props = $props();

	let expandedStates: Record<number, boolean> = $state({});

	const showToolCallInProgress = $derived(config().showToolCallInProgress as boolean);
	const showThoughtInProgress = $derived(config().showThoughtInProgress as boolean);
	const minimalAgenticIndicators = $derived(config().minimalAgenticIndicators as boolean);
	const renderReasoningContentAsMarkdown = $derived(
		config().renderReasoningContentAsMarkdown as boolean
	);

	let permissionDismissed = $state(false);

	const pendingPermission = $derived(
		isStreaming && isLastAssistantMessage ? agenticPendingPermissionRequest(message.convId) : null
	);

	let previousPendingPermission = $state<typeof pendingPermission>(null);

	$effect(() => {
		if (pendingPermission !== previousPendingPermission) {
			previousPendingPermission = pendingPermission;
			permissionDismissed = false;
		}
	});

	function handlePermission(decision: ToolPermissionDecision) {
		permissionDismissed = true;
		agenticResolvePermission(message.convId, decision);
	}

	const sections = $derived(deriveAgenticSections(message, toolMessages, [], isStreaming));

	// Parse tool results with images
	const sectionsParsed = $derived(
		sections.map((section) => ({
			...section,
			parsedLines: section.toolResult
				? parseToolResultWithImages(section.toolResult, section.toolResultExtras || message?.extra)
				: ([] as ToolResultLine[])
		}))
	);

	const showMinimalReasoningStatus = $derived(
		minimalAgenticIndicators &&
			isStreaming &&
			sectionsParsed.some((section) => section.type === AgenticSectionType.REASONING_PENDING)
	);

	const showMinimalToolsStatus = $derived(
		minimalAgenticIndicators &&
			isStreaming &&
			sectionsParsed.some(
				(section) =>
					section.type === AgenticSectionType.TOOL_CALL_PENDING ||
					section.type === AgenticSectionType.TOOL_CALL_STREAMING
			)
	);

	const showMinimalInlineStatuses = $derived(showMinimalReasoningStatus || showMinimalToolsStatus);

	function shouldRenderAgenticPanel(section: AgenticSection): boolean {
		if (!minimalAgenticIndicators) return true;

		if (section.type === AgenticSectionType.TEXT) return true;

		// Minimalistic mode keeps Reasoning / Tools panels out of the message body
		// in every normal state. Permission requests are rendered separately below.
		return false;
	}

	// Group flat sections into agentic turns
	// A new turn starts when a non-tool section follows a tool section
	const turnGroups = $derived.by(() => {
		const turns: { sections: (typeof sectionsParsed)[number][]; flatIndices: number[] }[] = [];
		let currentTurn: (typeof sectionsParsed)[number][] = [];
		let currentIndices: number[] = [];
		let prevWasTool = false;

		for (let i = 0; i < sectionsParsed.length; i++) {
			const section = sectionsParsed[i];
			const isTool =
				section.type === AgenticSectionType.TOOL_CALL ||
				section.type === AgenticSectionType.TOOL_CALL_PENDING ||
				section.type === AgenticSectionType.TOOL_CALL_STREAMING;

			if (!isTool && prevWasTool && currentTurn.length > 0) {
				turns.push({ sections: currentTurn, flatIndices: currentIndices });
				currentTurn = [];
				currentIndices = [];
			}

			currentTurn.push(section);
			currentIndices.push(i);
			prevWasTool = isTool;
		}

		if (currentTurn.length > 0) {
			turns.push({ sections: currentTurn, flatIndices: currentIndices });
		}

		return turns;
	});

	function getDefaultExpanded(section: AgenticSection): boolean {
		if (
			section.type === AgenticSectionType.TOOL_CALL_PENDING ||
			section.type === AgenticSectionType.TOOL_CALL_STREAMING
		) {
			return showToolCallInProgress;
		}

		if (section.type === AgenticSectionType.REASONING_PENDING) {
			return showThoughtInProgress;
		}

		return false;
	}

	function isExpanded(index: number, section: AgenticSection): boolean {
		if (expandedStates[index] !== undefined) {
			return expandedStates[index];
		}

		return getDefaultExpanded(section);
	}

	function toggleExpanded(index: number, section: AgenticSection) {
		const currentState = isExpanded(index, section);

		expandedStates[index] = !currentState;
	}

	function buildTurnAgenticTimings(stats: ChatMessageAgenticTurnStats): ChatMessageAgenticTimings {
		return {
			turns: 1,
			toolCallsCount: stats.toolCalls.length,
			toolsMs: stats.toolsMs,
			toolCalls: stats.toolCalls,
			llm: stats.llm
		};
	}
</script>

{#snippet renderMinimalInlineStatus(label: string)}
	<div
		class="llampart-inline-processing-status llampart-agentic-inline-status"
		role="status"
		aria-label={label}
	>
		<span
			class="llampart-inline-processing-status__symbol llampart-inline-processing-status__symbol--animated"
			aria-hidden="true"
		>
			•
		</span>
		<span class="llampart-inline-processing-status__label">{label}</span>
	</div>
{/snippet}

{#snippet renderSection(section: (typeof sectionsParsed)[number], index: number)}
	{#if !shouldRenderAgenticPanel(section)}
		<!-- Hidden by Minimalistic Reasoning/Tools mode. -->
	{:else if section.type === AgenticSectionType.TEXT}
		<div class="agentic-text">
			<MarkdownContent
				class="llampart-assistant-markdown"
				content={section.content}
				attachments={message?.extra}
			/>
		</div>
	{:else if section.type === AgenticSectionType.TOOL_CALL_STREAMING}
		{@const streamingIcon = isStreaming ? Loader2 : Loader2}
		{@const streamingIconClass = isStreaming ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}

		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={streamingIcon}
			iconClass={streamingIconClass}
			title={section.toolName || t('messages.agenticToolCall')}
			subtitle={isStreaming ? '' : t('messages.agenticIncomplete')}
			{isStreaming}
			onToggle={() => toggleExpanded(index, section)}
		>
			<div class="pt-3">
				<div class="my-3 flex items-center gap-2 text-xs text-muted-foreground">
					<span>{t('messages.agenticArguments')}</span>

					{#if isStreaming}
						<Loader2 class="h-3 w-3 animate-spin" />
					{/if}
				</div>
				{#if section.toolArgs}
					<SyntaxHighlightedCode
						code={formatJsonPretty(section.toolArgs)}
						language={FileTypeText.JSON}
						maxHeight="20rem"
						class="text-xs"
					/>
				{:else if isStreaming}
					<div class="rounded bg-muted/30 p-2 text-xs text-muted-foreground italic">
						{t('messages.agenticReceivingArguments')}
					</div>
				{:else}
					<div class="rounded bg-yellow-500/10 p-2 text-xs text-yellow-600 italic">
						{t('messages.agenticResponseTruncated')}
					</div>
				{/if}
			</div>
		</CollapsibleContentBlock>
	{:else if section.type === AgenticSectionType.TOOL_CALL || section.type === AgenticSectionType.TOOL_CALL_PENDING}
		{@const isPending = section.type === AgenticSectionType.TOOL_CALL_PENDING}
		{@const isActivePending = isPending && isStreaming}
		{@const toolIcon = isActivePending ? Loader2 : Wrench}
		{@const toolIconClass = isActivePending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}

		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={toolIcon}
			iconClass={toolIconClass}
			title={section.toolName || ''}
			subtitle={isActivePending ? t('messages.agenticExecuting') : undefined}
			isStreaming={isActivePending}
			onToggle={() => toggleExpanded(index, section)}
		>
			{#if section.toolArgs && section.toolArgs !== '{}'}
				<div class="pt-3">
					<div class="my-3 text-xs text-muted-foreground">{t('messages.agenticArguments')}</div>

					<SyntaxHighlightedCode
						code={formatJsonPretty(section.toolArgs)}
						language={FileTypeText.JSON}
						maxHeight="20rem"
						class="text-xs"
					/>
				</div>
			{/if}

			<div class="pt-3">
				<div class="my-3 flex items-center gap-2 text-xs text-muted-foreground">
					<span>{t('messages.agenticResult')}</span>

					{#if isActivePending}
						<Loader2 class="h-3 w-3 animate-spin" />
					{/if}
				</div>
				{#if section.toolResult}
					<div class="overflow-auto rounded-lg border border-border bg-muted p-4">
						{#each section.parsedLines as line, i (i)}
							<div class="font-mono text-xs leading-relaxed whitespace-pre-wrap">{line.text}</div>
							{#if line.image}
								<img
									src={line.image.base64Url}
									alt={line.image.name}
									class="mt-2 mb-2 h-auto max-w-full rounded-lg"
									loading="lazy"
								/>
							{/if}
						{/each}
					</div>
				{:else if isPending}
					<div class="rounded bg-muted/30 p-2 text-xs text-muted-foreground italic">
						{t('messages.agenticWaitingForResult')}
					</div>
				{/if}
			</div>
		</CollapsibleContentBlock>
	{:else if section.type === AgenticSectionType.REASONING}
		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={Brain}
			title={t('messages.agenticReasoning')}
			onToggle={() => toggleExpanded(index, section)}
		>
			<div class="pt-3">
				<div class="llampart-reasoning-content text-xs leading-relaxed break-words">
					{#if renderReasoningContentAsMarkdown}
						<div class="llampart-reasoning-markdown">
							<MarkdownContent
								content={section.content}
								attachments={message?.extra}
								inheritTypography
							/>
						</div>
					{:else}
						<div class="whitespace-pre-wrap">{section.content}</div>
					{/if}
				</div>
			</div>
		</CollapsibleContentBlock>
	{:else if section.type === AgenticSectionType.REASONING_PENDING}
		{@const reasoningTitle = isStreaming
			? t('messages.agenticReasoningStreaming')
			: t('messages.agenticReasoning')}
		{@const reasoningSubtitle = isStreaming ? '' : t('messages.agenticIncomplete')}

		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={Brain}
			title={reasoningTitle}
			subtitle={reasoningSubtitle}
			{isStreaming}
			onToggle={() => toggleExpanded(index, section)}
		>
			<div class="pt-3">
				<div class="llampart-reasoning-content text-xs leading-relaxed break-words">
					{#if renderReasoningContentAsMarkdown}
						<div class="llampart-reasoning-markdown">
							<MarkdownContent
								content={section.content}
								attachments={message?.extra}
								inheritTypography
							/>
						</div>
					{:else}
						<div class="whitespace-pre-wrap">{section.content}</div>
					{/if}
				</div>
			</div>
		</CollapsibleContentBlock>
	{/if}
{/snippet}

<div
	class="agentic-content llampart-assistant-message"
	class:minimal-agentic-mode={minimalAgenticIndicators}
>
	{#if !minimalAgenticIndicators && highlightTurns && turnGroups.length > 1}
		{#each turnGroups as turn, turnIndex (turnIndex)}
			{@const turnStats = message?.timings?.agentic?.perTurn?.[turnIndex]}
			<div class="agentic-turn my-2 hover:bg-muted/80">
				<span class="agentic-turn-label">{t('messages.agenticTurn')} {turnIndex + 1}</span>
				{#each turn.sections as section, sIdx (turn.flatIndices[sIdx])}
					{@render renderSection(section, turn.flatIndices[sIdx])}
				{/each}
				{#if turnStats}
					<div class="turn-stats">
						<ChatMessageStatistics
							promptTokens={turnStats.llm.prompt_n}
							promptMs={turnStats.llm.prompt_ms}
							predictedTokens={turnStats.llm.predicted_n}
							predictedMs={turnStats.llm.predicted_ms}
							agenticTimings={turnStats.toolCalls.length > 0
								? buildTurnAgenticTimings(turnStats)
								: undefined}
							initialView={ChatMessageStatsView.GENERATION}
							hideSummary
						/>
					</div>
				{/if}
			</div>
		{/each}
	{:else}
		{#each sectionsParsed as section, index (index)}
			{@render renderSection(section, index)}
		{/each}
	{/if}

	{#if showMinimalInlineStatuses}
		<div class="minimal-agentic-inline-statuses" aria-live="polite">
			{#if showMinimalReasoningStatus}
				{@render renderMinimalInlineStatus(t('messages.minimalReasoningStatus'))}
			{/if}

			{#if showMinimalToolsStatus}
				{@render renderMinimalInlineStatus(t('messages.minimalToolsStatus'))}
			{/if}
		</div>
	{/if}

	{#if pendingPermission && !permissionDismissed}
		<ChatMessageActionCardPermissionRequest
			toolName={pendingPermission.toolName}
			serverLabel={pendingPermission.serverLabel}
			onDecision={handlePermission}
		/>
	{/if}

	{#if footer}
		<div class="agentic-footer-slot">
			{@render footer()}
		</div>
	{/if}
</div>

<style>
	.llampart-assistant-message {
		color: #3c3c3c;
	}

	.agentic-content {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 57.6rem;
		border: 1px solid #cecece;
		border-radius: 0.75rem;
		padding: 1rem;
	}

	.minimal-agentic-mode {
		position: relative;
		min-height: 5.75rem;
		padding-top: 0.9375rem;
	}

	.minimal-agentic-inline-statuses {
		position: absolute;
		top: 0.9375rem;
		left: 1.25rem;
		right: 1.25rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		margin-top: 0;
		pointer-events: none;
	}

	.llampart-agentic-inline-status {
		max-width: 100%;
	}

	.agentic-text {
		width: 100%;
	}

	.llampart-reasoning-content {
		font-family: inherit;
		font-size: 0.75rem;
		line-height: 1.625;
	}

	.llampart-reasoning-markdown {
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
	}

	/* llampart-assistant-markdown-top-edge-alignment */
	.agentic-text :global(.llampart-assistant-markdown > :first-child),
	.agentic-text :global(.llampart-assistant-markdown p:first-child),
	.agentic-text :global(.llampart-assistant-markdown h1:first-child),
	.agentic-text :global(.llampart-assistant-markdown h2:first-child),
	.agentic-text :global(.llampart-assistant-markdown h3:first-child),
	.agentic-text :global(.llampart-assistant-markdown h4:first-child),
	.agentic-text :global(.llampart-assistant-markdown h5:first-child),
	.agentic-text :global(.llampart-assistant-markdown h6:first-child),
	.agentic-text :global(.llampart-assistant-markdown ul:first-child),
	.agentic-text :global(.llampart-assistant-markdown ol:first-child),
	.agentic-text :global(.llampart-assistant-markdown blockquote:first-child),
	.agentic-text :global(.llampart-assistant-markdown pre:first-child),
	.agentic-text :global(.llampart-assistant-markdown table:first-child) {
		margin-top: 0 !important;
	}

	/* llampart-minimalistic-first-markdown-top-edge */
	.minimal-agentic-mode .agentic-text :global(.markdown-content > :first-child),
	.minimal-agentic-mode .agentic-text :global(.markdown-user-content > :first-child),
	.minimal-agentic-mode .agentic-text :global(p:first-child),
	.minimal-agentic-mode .agentic-text :global(h1:first-child),
	.minimal-agentic-mode .agentic-text :global(h2:first-child),
	.minimal-agentic-mode .agentic-text :global(h3:first-child),
	.minimal-agentic-mode .agentic-text :global(h4:first-child),
	.minimal-agentic-mode .agentic-text :global(h5:first-child),
	.minimal-agentic-mode .agentic-text :global(h6:first-child),
	.minimal-agentic-mode .agentic-text :global(ul:first-child),
	.minimal-agentic-mode .agentic-text :global(ol:first-child),
	.minimal-agentic-mode .agentic-text :global(blockquote:first-child),
	.minimal-agentic-mode .agentic-text :global(pre:first-child),
	.minimal-agentic-mode .agentic-text :global(table:first-child) {
		margin-top: 0 !important;
	}
	/* /llampart-minimalistic-first-markdown-top-edge */

	.agentic-turn {
		position: relative;
		border: 1.5px dashed #cecece;
		border-radius: 0.75rem;
		padding: 1rem;
		transition: background 0.1s;
	}

	.agentic-turn-label {
		position: absolute;
		top: -1rem;
		left: 0.75rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		background-color: var(--background);
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		border-radius: 0.375rem;
		box-shadow: none;
		font-size: 0.7rem;
		line-height: 1rem;
		font-weight: 400;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
	}

	.turn-stats {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid hsl(var(--muted) / 0.5);
	}

	.agentic-footer-slot {
		margin-top: 0.375rem;
		padding-top: 0.125rem;
		border-top: 0;
	}

	/* Chat answer Frosted Glass layout. Surface values are owned by app.css. */
	:global(.has-frosted-glass-theme) .agentic-content {
		position: relative;
		color: var(--llampart-frosted-surface-text);
		text-shadow: var(--llampart-frosted-surface-text-shadow);
	}

	:global(.has-frosted-glass-theme) .agentic-content {
		padding-bottom: 0.125rem;
	}

	/* llampart-main-agentic-frame-final-tuning
	   Frame surface values are owned by the global Frosted Glass surface primitives in app.css. */

	:global(html.has-frosted-glass-theme .agentic-footer-slot) {
		margin-right: -0.5rem;
		margin-left: -0.5rem;
	}

	:global(html.has-frosted-glass-theme .agentic-content.llampart-assistant-message) {
		padding-bottom: 0.375rem;
	}

	/* llampart-frosted-glass-expanded-agentic-content */
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .code-preview-wrapper),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .code-block-wrapper),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .table-block),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .overflow-auto.rounded-lg),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .rounded.bg-muted\/30),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .rounded.bg-yellow-500\/10),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .mt-2.rounded-md.border),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .mt-3.rounded-md.border) {
		background: rgba(255, 255, 255, 0.11) !important;
		border: 1px solid rgba(255, 255, 255, 0.12) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			0 1px 2px rgba(0, 0, 0, 0.03),
			0 3px 8px rgba(0, 0, 0, 0.025) !important;
		backdrop-filter: blur(10px) saturate(104%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(104%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel .code-preview-wrapper pre),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .code-preview-wrapper code),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .code-block-wrapper pre),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .code-block-wrapper code) {
		background: transparent !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel .font-mono),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .text-xs),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .text-sm),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .text-muted-foreground) {
		color: #000000 !important;
		text-shadow:
			0 0 1px rgba(255, 255, 255, 0.18),
			0 0 2px rgba(255, 255, 255, 0.1) !important;
	}
	/* llampart-agentic-footer-equal-edge-offset */
	:global(html.has-frosted-glass-theme .agentic-content.llampart-assistant-message) {
		padding-bottom: 0.625rem !important;
	}

	:global(html.has-frosted-glass-theme .agentic-footer-slot) {
		margin-right: -0.5rem !important;
		margin-left: -0.5rem !important;
	}

	/* llampart-footer-lower-insets-and-user-height-restore */
	:global(html.has-frosted-glass-theme .agentic-content.llampart-assistant-message) {
		position: relative;
		padding-bottom: 3.25rem !important;
	}

	:global(html.has-frosted-glass-theme .agentic-footer-slot) {
		position: absolute;
		right: 1rem;
		bottom: 0.375rem;
		left: 1rem;
		margin: 0 !important;
		padding: 0 !important;
	}

	/* llampart-frosted-glass-agentic-turns-and-labels */
	:global(html.has-frosted-glass-theme .agentic-turn) {
		border: 1.5px dashed rgba(255, 255, 255, 0.28) !important;
		background: rgba(255, 255, 255, 0.08) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			0 1px 2px rgba(0, 0, 0, 0.03),
			0 3px 8px rgba(0, 0, 0, 0.025) !important;
		backdrop-filter: blur(10px) saturate(106%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(106%) !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn:hover) {
		background: rgba(255, 255, 255, 0.1) !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn-label) {
		background: rgba(255, 255, 255, 0.72) !important;
		border: 1px solid rgba(255, 255, 255, 0.42) !important;
		border-radius: 0.5rem;
		color: #7a7a7a !important;
		text-shadow: none !important;
		box-shadow: none !important;
		backdrop-filter: blur(8px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(8px) saturate(108%) !important;
	}

	/* llampart-frosted-glass-agentic-turn-regular-text */
	:global(html.has-frosted-glass-theme .agentic-turn),
	:global(html.has-frosted-glass-theme .agentic-turn *),
	:global(html.has-frosted-glass-theme .turn-stats),
	:global(html.has-frosted-glass-theme .turn-stats *) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn svg),
	:global(html.has-frosted-glass-theme .agentic-turn svg *) {
		stroke-width: 1.65 !important;
		filter: none !important;
	}
	/* llampart-frosted-glass-agentic-turns-footer-glow-final */
	:global(html.has-frosted-glass-theme .agentic-turn),
	:global(html.has-frosted-glass-theme .agentic-turn *),
	:global(html.has-frosted-glass-theme .turn-stats),
	:global(html.has-frosted-glass-theme .turn-stats *) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn svg),
	:global(html.has-frosted-glass-theme .agentic-turn svg *) {
		stroke-width: 1.65 !important;
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.32)) !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn-label) {
		background: rgba(255, 255, 255, 0.16) !important;
		border-color: rgba(255, 255, 255, 0.18) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 1px 2px rgba(0, 0, 0, 0.035) !important;
		backdrop-filter: blur(10px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(108%) !important;
	}

	:global(html.has-frosted-glass-theme .turn-stats) {
		border-top-color: rgba(255, 255, 255, 0.16) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-agentic-panel .overflow-auto.rounded-lg),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .rounded.bg-muted\/30),
	:global(html.has-frosted-glass-theme .llampart-agentic-panel .rounded.bg-yellow-500\/10) {
		color: #000000 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}

	/* llampart-frosted-glass-agentic-position-only-final */
	:global(html.has-frosted-glass-theme .agentic-turn) {
		position: relative !important;
		padding-bottom: 3rem !important;
	}

	:global(html.has-frosted-glass-theme .turn-stats) {
		position: absolute !important;
		left: 1.25rem !important;
		right: 1.25rem !important;
		bottom: 0.78rem !important;
		display: flex !important;
		align-items: center !important;
		margin: 0 !important;
		padding: 0 !important;
		border: 0 !important;
		background: transparent !important;
		box-shadow: none !important;
		line-height: 1 !important;
		transform: none !important;
	}

	/* llampart-frosted-glass-agentic-label-stronger-blur */
	:global(html.has-frosted-glass-theme .agentic-turn-label) {
		background: rgba(255, 255, 255, 0.34) !important;
		border-color: rgba(255, 255, 255, 0.24) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 1px 4px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(24px) saturate(122%) !important;
		-webkit-backdrop-filter: blur(24px) saturate(122%) !important;
	}

	/* llampart-agentic-turn-label-match-system-prompt-and-reasoning */
	:global(html.has-frosted-glass-theme .agentic-turn) {
		position: relative !important;
		padding-top: 3.0625rem !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn-label) {
		position: absolute !important;
		top: 0.75rem !important;
		left: 0.875rem !important;
		display: inline-flex !important;
		align-items: center !important;
		gap: 0.25rem !important;
		padding: 0.125rem 0.5rem !important;
		border: 1px solid rgba(255, 255, 255, 0.26) !important;
		border-radius: 0.75rem !important;
		background: rgba(255, 255, 255, 0.28) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 4px 10px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(14px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(108%) !important;
		font-size: 0.7rem !important;
		line-height: 1rem !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		color: #000000 !important;
		text-transform: uppercase !important;
		letter-spacing: 0.05em !important;
		white-space: nowrap !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
		z-index: 2 !important;
		pointer-events: none !important;
	}

	:global(html.has-frosted-glass-theme .agentic-turn-label::before),
	:global(html.has-frosted-glass-theme .agentic-turn-label::after) {
		content: none !important;
		display: none !important;
	}

	/* llampart-1-0-2-assistant-message-rhythm */
	:global(html.has-frosted-glass-theme .agentic-content.llampart-assistant-message) {
		padding: 1.5rem 1.5rem 3.5rem !important;
	}

	:global(html.has-frosted-glass-theme .agentic-content.llampart-assistant-message .agentic-text) {
		padding-inline: 0.125rem;
	}

	/* /llampart-1-0-2-assistant-message-rhythm */
</style>
