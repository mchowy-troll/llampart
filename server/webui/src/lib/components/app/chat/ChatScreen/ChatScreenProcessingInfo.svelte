<script lang="ts">
	import { untrack } from 'svelte';
	import { PROCESSING_INFO_TIMEOUT } from '$lib/constants';
	import { useProcessingState } from '$lib/hooks/use-processing-state.svelte';
	import { chatStore, isLoading, isChatStreaming } from '$lib/stores/chat.svelte';
	import { activeMessages, activeConversation } from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';

	const processingState = useProcessingState();

	let isCurrentConversationLoading = $derived(isLoading());
	let isStreaming = $derived(isChatStreaming());
	let hasProcessingData = $derived(processingState.processingState !== null);
	let processingDetails = $derived(processingState.getTechnicalDetails());

	let showProcessingInfo = $derived(
		isCurrentConversationLoading || isStreaming || config().keepStatsVisible || hasProcessingData
	);

	$effect(() => {
		const conversation = activeConversation();

		untrack(() => chatStore.setActiveProcessingConversation(conversation?.id ?? null));
	});

	$effect(() => {
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
	<div class="chat-processing-info-content">
		{#each processingDetails as detail (detail)}
			<span class="chat-processing-info-detail pointer-events-auto">{detail}</span>
		{/each}
	</div>
</div>

<style>
	.chat-processing-info-container {
		position: sticky;
		top: 0;
		z-index: 10;
		padding: 0 1rem 0.75rem;
		opacity: 0;
		transform: translateY(50%);
		transition:
			opacity 300ms ease-out,
			transform 300ms ease-out;
	}

	.chat-processing-info-container.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.chat-processing-info-content {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		justify-content: center;
		max-width: 48rem;
		margin: 0 auto;
	}

	.chat-processing-info-detail {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		min-width: 0;
		gap: 0.25rem;
		color: var(--muted-foreground);
		background-color: var(--background);
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		border-radius: 0.375rem;
		box-shadow: none;
		font-family: inherit;
		font-size: 0.75rem;
		line-height: 1rem;
		padding: 0.125rem 0.375rem;
		white-space: nowrap;
	}

	/* llampart-frosted-glass-composer-processing-stats */
	:global(html.has-frosted-glass-theme) .chat-processing-info-detail {
		border: 1px solid rgba(255, 255, 255, 0.2) !important;
		background: rgba(255, 255, 255, 0.16) !important;
		color: #000000 !important;
		font-weight: 400 !important;
		text-shadow: none !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 1px 2px rgba(0, 0, 0, 0.03) !important;
		backdrop-filter: blur(12px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(12px) saturate(108%) !important;
	}

	@media (max-width: 768px) {
		.chat-processing-info-content {
			gap: 0.5rem;
		}

		.chat-processing-info-detail {
			font-size: 0.7rem;
			padding: 0.125rem 0.375rem;
		}
	}
	/* llampart-frosted-glass-composer-processing-stats-glow-final */
	:global(html.has-frosted-glass-theme) .chat-processing-info-detail {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}

	/* llampart-frosted-glass-composer-processing-stats-bold-round-4 */
	:global(html.has-frosted-glass-theme) .chat-processing-info-detail {
		border: 1px solid rgba(255, 255, 255, 0.28) !important;
		background: rgba(255, 255, 255, 0.28) !important;
		color: #000000 !important;
		font-weight: 600 !important;
		font-variation-settings: 'wght' 600 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.68),
			0 0 7px rgba(255, 255, 255, 0.5),
			0 0 14px rgba(255, 255, 255, 0.3) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.16),
			0 1px 2px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(10px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(108%) !important;
	}
</style>
