<script lang="ts">
	import { untrack } from 'svelte';
	import { PROCESSING_INFO_TIMEOUT, STATS_UNITS } from '$lib/constants';
	import { t } from '$lib/i18n';
	import { useProcessingState } from '$lib/hooks/use-processing-state.svelte';
	import { getApiProviderCapabilities } from '$lib/services/providers';
	import { chatStore, isLoading, isChatStreaming } from '$lib/stores/chat.svelte';
	import { activeMessages, activeConversation } from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';

	const processingState = useProcessingState();
	const PROCESSING_INFO_TRANSITION_MS = 300;

	type DisplayedProcessingStats = {
		readonly contextValue: string;
		readonly speedValue: string;
	};

	let isCurrentConversationLoading = $derived(isLoading());
	let isStreaming = $derived(isChatStreaming());
	let showComposerProcessingStats = $derived(config().showComposerStats !== false);
	let supportsComposerProcessingStats = $derived(
		showComposerProcessingStats &&
			getApiProviderCapabilities(String(config().apiProvider ?? ''), config())
				.supportsPromptProgress
	);
	let composerProcessingStats = $derived(
		supportsComposerProcessingStats ? processingState.getComposerProcessingStats() : null
	);
	let hasProcessingData = $derived(
		supportsComposerProcessingStats && composerProcessingStats !== null
	);
	let contextValue = $derived(
		composerProcessingStats
			? `${composerProcessingStats.context.used} ${t('messages.composerStatsContextOf')} ${composerProcessingStats.context.total} (${composerProcessingStats.context.percent}%)`
			: ''
	);
	let speedValue = $derived(
		composerProcessingStats?.speed.tokensPerSecond
			? `${composerProcessingStats.speed.tokensPerSecond.toFixed(1)} ${STATS_UNITS.TOKENS_PER_SECOND}`
			: `— ${STATS_UNITS.TOKENS_PER_SECOND}`
	);
	let displayedProcessingStats = $state<DisplayedProcessingStats | null>(null);

	let showProcessingInfo = $derived(
		supportsComposerProcessingStats &&
			displayedProcessingStats !== null &&
			(isCurrentConversationLoading ||
				isStreaming ||
				config().keepStatsVisible ||
				hasProcessingData)
	);

	$effect(() => {
		if (!composerProcessingStats) {
			return;
		}

		displayedProcessingStats = { contextValue, speedValue };
	});

	$effect(() => {
		if (showProcessingInfo || displayedProcessingStats === null) {
			return;
		}

		const timeout = setTimeout(() => {
			if (!showProcessingInfo) {
				displayedProcessingStats = null;
			}
		}, PROCESSING_INFO_TRANSITION_MS);

		return () => clearTimeout(timeout);
	});

	$effect(() => {
		const conversation = activeConversation();

		untrack(() =>
			chatStore.setActiveProcessingConversation(
				supportsComposerProcessingStats ? (conversation?.id ?? null) : null
			)
		);
	});

	$effect(() => {
		if (!supportsComposerProcessingStats) {
			processingState.stopMonitoring();
			return;
		}

		const keepStatsVisible = config().keepStatsVisible;
		const shouldMonitor = keepStatsVisible || isCurrentConversationLoading || isStreaming;

		if (shouldMonitor) {
			processingState.startMonitoring();
		}

		if (!isCurrentConversationLoading && !isStreaming && !keepStatsVisible) {
			const timeout = setTimeout(() => {
				if (!config().keepStatsVisible && !isChatStreaming()) {
					processingState.stopMonitoring();
				}
			}, PROCESSING_INFO_TIMEOUT);

			return () => clearTimeout(timeout);
		}
	});

	$effect(() => {
		if (!supportsComposerProcessingStats) {
			return;
		}

		const conversation = activeConversation();
		const messages = activeMessages() as DatabaseMessage[];
		const keepStatsVisible = config().keepStatsVisible;

		if (keepStatsVisible && conversation) {
			if (messages.length === 0) {
				untrack(() => chatStore.clearProcessingState(conversation.id));
				return;
			}

			if (!isCurrentConversationLoading && !isStreaming) {
				untrack(() => chatStore.restoreProcessingStateFromMessages(messages, conversation.id));
			}
		}
	});
</script>

<div class="chat-processing-info-container pointer-events-none" class:visible={showProcessingInfo}>
	{#if displayedProcessingStats}
		<div class="chat-processing-info-slot">
			<dl
				class="llampart-chat-composer-width chat-processing-info-frame pointer-events-auto"
				aria-label={t('messages.composerStatsLabel')}
			>
				<div class="chat-processing-info-item chat-processing-info-item-context">
					<dt class="chat-processing-info-label">{t('messages.composerStatsContext')}</dt>
					<span class="chat-processing-info-separator" aria-hidden="true">|</span>
					<dd class="chat-processing-info-value chat-processing-info-context-value">
						{displayedProcessingStats.contextValue}
					</dd>
				</div>

				<div class="chat-processing-info-item chat-processing-info-item-speed">
					<dt class="chat-processing-info-label">{t('messages.composerStatsSpeed')}</dt>
					<span class="chat-processing-info-separator" aria-hidden="true">|</span>
					<dd class="chat-processing-info-value chat-processing-info-speed-value">
						{displayedProcessingStats.speedValue}
					</dd>
				</div>
			</dl>
		</div>
	{/if}
</div>

<style>
	.chat-processing-info-container {
		display: grid;
		grid-template-rows: 0fr;
		overflow: hidden;
		position: sticky;
		top: 0;
		z-index: 10;
		padding: 0 1rem 0;
		opacity: 0;
		transform: translateY(var(--llampart-composer-processing-stats-enter-offset));
		transition:
			opacity 300ms ease-out,
			transform 300ms ease-out,
			grid-template-rows 300ms ease-out,
			padding-bottom 300ms ease-out;
	}

	.chat-processing-info-container.visible {
		grid-template-rows: 1fr;
		overflow: visible;
		padding-bottom: var(--llampart-composer-processing-stats-bottom-gap);
		opacity: 1;
		transform: translateY(0);
	}

	.chat-processing-info-slot {
		min-height: 0;
		overflow: visible;
	}

	.chat-processing-info-frame {
		display: flex;
		align-items: center;
		justify-content: space-between;
		box-sizing: border-box;
		width: 100%;
		min-height: var(--llampart-composer-processing-stats-min-height);
		margin: 0 auto;
		padding-inline: var(--llampart-composer-processing-stats-padding-inline);
		gap: var(--llampart-composer-processing-stats-frame-gap);
		border: 1px solid var(--llampart-composer-processing-stats-border);
		border-radius: var(--llampart-composer-processing-stats-radius);
		background: var(--llampart-composer-processing-stats-background);
		background-color: var(--llampart-composer-processing-stats-background);
		background-image: none;
		box-shadow: var(--llampart-composer-processing-stats-shadow);
		-webkit-backdrop-filter: var(--llampart-composer-processing-stats-filter);
		backdrop-filter: var(--llampart-composer-processing-stats-filter);
		color: var(--llampart-composer-processing-stats-foreground);
		text-shadow: var(--llampart-composer-processing-stats-text-shadow);
		font-family: inherit;
		font-size: var(--llampart-composer-processing-stats-font-size);
		font-weight: var(--llampart-composer-processing-stats-font-weight);
		line-height: var(--llampart-composer-processing-stats-line-height);
	}

	.chat-processing-info-item {
		display: inline-grid;
		grid-template-columns: auto auto minmax(
				var(--llampart-composer-processing-stats-value-min-width),
				max-content
			);
		align-items: center;
		min-width: 0;
		column-gap: var(--llampart-composer-processing-stats-item-gap);
		white-space: nowrap;
	}

	.chat-processing-info-item-speed {
		grid-template-columns: auto auto minmax(
				var(--llampart-composer-processing-stats-speed-value-min-width),
				max-content
			);
	}

	.chat-processing-info-label,
	.chat-processing-info-value {
		min-width: 0;
		margin: 0;
	}

	.chat-processing-info-separator {
		color: var(--llampart-composer-processing-stats-separator);
	}

	.chat-processing-info-value {
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
		letter-spacing: var(--llampart-composer-processing-stats-value-letter-spacing);
	}

	.chat-processing-info-context-value {
		min-inline-size: var(--llampart-composer-processing-stats-context-value-width);
		text-align: left;
	}

	.chat-processing-info-speed-value {
		min-inline-size: var(--llampart-composer-processing-stats-speed-value-width);
		text-align: left;
	}

	@media (max-width: 768px) {
		.chat-processing-info-frame {
			font-size: var(--llampart-composer-processing-stats-font-size-sm);
		}
	}

	@media (max-width: 480px) {
		.chat-processing-info-frame {
			align-items: stretch;
			flex-direction: column;
			padding-block: 0.375rem;
			gap: 0.25rem;
		}

		.chat-processing-info-item,
		.chat-processing-info-item-speed {
			grid-template-columns: auto auto minmax(0, 1fr);
			white-space: normal;
		}

		.chat-processing-info-context-value,
		.chat-processing-info-speed-value {
			min-inline-size: 0;
		}
	}
</style>
