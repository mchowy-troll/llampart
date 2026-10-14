<script lang="ts">
	import { Clock, Gauge, WholeWord, BookOpenText, Sparkles, Wrench, Layers } from '@lucide/svelte';
	import BadgeChatStatistic from '$lib/components/app/badges/BadgeChatStatistic.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { ChatMessageStatsView } from '$lib/enums';
	import type { ChatMessageAgenticTimings } from '$lib/types/chat';
	import { formatPerformanceTime } from '$lib/utils';
	import { getProviderStatistics } from '$lib/utils/provider-statistics';
	import { MS_PER_SECOND, DEFAULT_PERFORMANCE_TIME } from '$lib/constants';
	import { t } from '$lib/i18n';

	interface Props {
		provider?: import('$lib/types/chat').ChatMessageTimings['provider'];
		predictedTokens?: number;
		predictedMs?: number;
		promptTokens?: number;
		promptMs?: number;
		isLive?: boolean;
		isProcessingPrompt?: boolean;
		initialView?: ChatMessageStatsView;
		agenticTimings?: ChatMessageAgenticTimings;
		onActiveViewChange?: (view: ChatMessageStatsView) => void;
		hideSummary?: boolean;
	}

	let {
		provider,
		predictedTokens,
		predictedMs,
		promptTokens,
		promptMs,
		isLive = false,
		isProcessingPrompt = false,
		initialView = ChatMessageStatsView.GENERATION,
		agenticTimings,
		onActiveViewChange,
		hideSummary = false
	}: Props = $props();

	let activeView: ChatMessageStatsView = $derived(initialView);
	let hasAutoSwitchedToGeneration = $state(false);
	let providerStats = $derived(
		provider
			? getProviderStatistics(
					provider,
					activeView === ChatMessageStatsView.READING ? 'reading' : 'generation'
				)
			: undefined
	);

	$effect(() => {
		onActiveViewChange?.(activeView);
	});

	// In live mode: auto-switch to GENERATION tab when prompt processing completes
	$effect(() => {
		if (isLive) {
			// Auto-switch to generation tab only when prompt processing is done (once)
			if (
				!hasAutoSwitchedToGeneration &&
				!isProcessingPrompt &&
				(provider?.usage?.completionTokens ?? predictedTokens ?? 0) > 0
			) {
				activeView = ChatMessageStatsView.GENERATION;
				hasAutoSwitchedToGeneration = true;
			} else if (!hasAutoSwitchedToGeneration) {
				// Stay on READING while prompt is still being processed
				activeView = ChatMessageStatsView.READING;
			}
		}
	});

	let hasGenerationStats = $derived(
		predictedTokens !== undefined &&
			predictedTokens > 0 &&
			predictedMs !== undefined &&
			predictedMs > 0
	);

	let tokensPerSecond = $derived(
		hasGenerationStats ? (predictedTokens! / predictedMs!) * MS_PER_SECOND : 0
	);
	let formattedTime = $derived(
		predictedMs !== undefined ? formatPerformanceTime(predictedMs) : DEFAULT_PERFORMANCE_TIME
	);

	let promptTokensPerSecond = $derived(
		promptTokens !== undefined && promptMs !== undefined && promptMs > 0
			? (promptTokens / promptMs) * MS_PER_SECOND
			: undefined
	);

	let formattedPromptTime = $derived(
		promptMs !== undefined ? formatPerformanceTime(promptMs) : undefined
	);

	let hasPromptStats = $derived(
		promptTokens !== undefined &&
			promptMs !== undefined &&
			promptTokensPerSecond !== undefined &&
			formattedPromptTime !== undefined
	);

	// In live mode, generation tab is disabled until we have generation stats
	let isGenerationDisabled = $derived(isLive && !hasGenerationStats);

	let hasAgenticStats = $derived(agenticTimings !== undefined && agenticTimings.toolCallsCount > 0);

	let agenticToolsPerSecond = $derived(
		hasAgenticStats && agenticTimings!.toolsMs > 0
			? (agenticTimings!.toolCallsCount / agenticTimings!.toolsMs) * MS_PER_SECOND
			: 0
	);

	let formattedAgenticToolsTime = $derived(
		hasAgenticStats ? formatPerformanceTime(agenticTimings!.toolsMs) : DEFAULT_PERFORMANCE_TIME
	);

	let agenticTotalTimeMs = $derived(
		hasAgenticStats
			? agenticTimings!.toolsMs + agenticTimings!.llm.predicted_ms + agenticTimings!.llm.prompt_ms
			: 0
	);

	let formattedAgenticTotalTime = $derived(formatPerformanceTime(agenticTotalTimeMs));
</script>

{#if provider}
	<div
		class="llampart-chat-message-statistics inline-flex items-center text-xs text-muted-foreground"
	>
		{#snippet providerDetails()}
			<div class="max-w-80 space-y-1">
				<p>
					{t(
						activeView === ChatMessageStatsView.READING
							? 'messages.statsPromptProcessingSpeed'
							: 'messages.statsGenerationSpeed'
					)}
				</p>
				{#if providerStats?.approximate}<p>{t('messages.statsClientApproximate')}</p>
				{:else}<p>{t('settings.sourceBackend')}</p>{/if}
				{#each [['input', provider.usage?.promptTokens], ['output', provider.usage?.completionTokens], ['total', provider.usage?.totalTokens], ['cached', provider.usage?.cachedTokens], ['reasoning', provider.usage?.reasoningTokens]] as [name, value] (name)}
					<p>{name}: {value ?? '—'} tokens</p>
				{/each}
				{#each provider.metrics ?? [] as metric (metric.name)}
					<p>
						{metric.name}: {metric.available ? metric.value + ' ' + metric.unit : '—'} ({metric.source})
					</p>
				{/each}
				{#if provider.metrics?.some((metric) => metric.source === 'browser')}<p>
						{t('settings.sourceBrowser')}
					</p>{/if}
				{#if provider.finishReason}<p>{provider.finishReason}</p>{/if}
			</div>
		{/snippet}
		<div
			class="stats-view-switcher inline-flex items-center rounded-sm bg-muted-foreground/15 p-0.5"
		>
			{#each [ChatMessageStatsView.READING, ChatMessageStatsView.GENERATION] as view (view)}
				<Tooltip.Root>
					<Tooltip.Trigger
						type="button"
						class="stats-view-button inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors {activeView ===
						view
							? 'stats-view-button-active bg-background text-foreground shadow-sm'
							: 'hover:text-foreground'}"
						aria-pressed={activeView === view}
						onclick={() => (activeView = view)}
					>
						{#if view === ChatMessageStatsView.READING}
							<BookOpenText class="h-3 w-3" />
						{:else}
							<Sparkles class="h-3 w-3" />
						{/if}
						<span class="sr-only"
							>{t(
								view === ChatMessageStatsView.READING
									? 'messages.statsReading'
									: 'messages.statsGeneration'
							)}</span
						>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>
							{t(
								view === ChatMessageStatsView.READING
									? 'messages.statsReadingPromptProcessing'
									: 'messages.statsGenerationTokenOutput'
							)}
						</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</div>
		<div class="flex items-center gap-1 px-2">
			<BadgeChatStatistic
				class="bg-transparent"
				icon={WholeWord}
				value="{providerStats?.tokens?.toLocaleString() ?? '—'} tokens"
				tooltipLabel={t(
					activeView === ChatMessageStatsView.READING
						? 'messages.statsPromptTokens'
						: 'messages.statsGeneratedTokens'
				)}
			/>
			<BadgeChatStatistic
				class="bg-transparent"
				icon={Clock}
				value={providerStats?.timeMs !== undefined
					? formatPerformanceTime(providerStats.timeMs)
					: '—'}
				tooltipLabel={t(
					activeView === ChatMessageStatsView.READING
						? 'messages.statsPromptProcessingTime'
						: 'messages.statsGenerationTime'
				)}
			/>
			<BadgeChatStatistic
				class="bg-transparent"
				icon={Gauge}
				tooltipContent={providerDetails}
				value={providerStats?.tokensPerSecond !== undefined
					? `${providerStats.approximate ? '≈ ' : ''}${providerStats.tokensPerSecond.toFixed(2)} ${activeView === ChatMessageStatsView.READING ? 'tokens/s' : 't/s'}`
					: '—'}
				tooltipLabel={t(
					activeView === ChatMessageStatsView.READING
						? 'messages.statsPromptProcessingSpeed'
						: 'messages.statsGenerationSpeed'
				)}
			/>
		</div>
	</div>
{:else}
	<div
		class="llampart-chat-message-statistics inline-flex items-center text-xs text-muted-foreground"
	>
		<div
			class="stats-view-switcher inline-flex items-center rounded-sm bg-muted-foreground/15 p-0.5"
		>
			{#if hasPromptStats || isLive}
				<Tooltip.Root>
					<Tooltip.Trigger
						type="button"
						class="stats-view-button inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors {activeView ===
						ChatMessageStatsView.READING
							? 'stats-view-button-active bg-background text-foreground shadow-sm'
							: 'hover:text-foreground'}"
						onclick={() => (activeView = ChatMessageStatsView.READING)}
					>
						<BookOpenText class="h-3 w-3" />

						<span class="sr-only">{t('messages.statsReading')}</span>
					</Tooltip.Trigger>

					<Tooltip.Content>
						<p>{t('messages.statsReadingPromptProcessing')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}
			<Tooltip.Root>
				<Tooltip.Trigger
					type="button"
					class="stats-view-button inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors {activeView ===
					ChatMessageStatsView.GENERATION
						? 'stats-view-button-active bg-background text-foreground shadow-sm'
						: isGenerationDisabled
							? 'cursor-not-allowed opacity-40'
							: 'hover:text-foreground'}"
					onclick={() => !isGenerationDisabled && (activeView = ChatMessageStatsView.GENERATION)}
					disabled={isGenerationDisabled}
				>
					<Sparkles class="h-3 w-3" />

					<span class="sr-only">{t('messages.statsGeneration')}</span>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>
						{isGenerationDisabled
							? t('messages.statsGenerationWaiting')
							: t('messages.statsGenerationTokenOutput')}
					</p>
				</Tooltip.Content>
			</Tooltip.Root>

			{#if hasAgenticStats}
				<Tooltip.Root>
					<Tooltip.Trigger
						type="button"
						class="stats-view-button inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors {activeView ===
						ChatMessageStatsView.TOOLS
							? 'stats-view-button-active bg-background text-foreground shadow-sm'
							: 'hover:text-foreground'}"
						onclick={() => (activeView = ChatMessageStatsView.TOOLS)}
					>
						<Wrench class="h-3 w-3" />

						<span class="sr-only">{t('messages.statsTools')}</span>
					</Tooltip.Trigger>

					<Tooltip.Content>
						<p>{t('messages.statsToolCalls')}</p>
					</Tooltip.Content>
				</Tooltip.Root>

				{#if !hideSummary}
					<Tooltip.Root>
						<Tooltip.Trigger
							type="button"
							class="stats-view-button inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors {activeView ===
							ChatMessageStatsView.SUMMARY
								? 'stats-view-button-active bg-background text-foreground shadow-sm'
								: 'hover:text-foreground'}"
							onclick={() => (activeView = ChatMessageStatsView.SUMMARY)}
						>
							<Layers class="h-3 w-3" />

							<span class="sr-only">{t('messages.statsSummary')}</span>
						</Tooltip.Trigger>

						<Tooltip.Content>
							<p>{t('messages.statsAgenticSummary')}</p>
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{/if}
		</div>

		<div class="flex items-center gap-1 px-2">
			{#if activeView === ChatMessageStatsView.GENERATION && hasGenerationStats}
				<BadgeChatStatistic
					class="bg-transparent"
					icon={WholeWord}
					value="{predictedTokens?.toLocaleString()} tokens"
					tooltipLabel={t('messages.statsGeneratedTokens')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Clock}
					value={formattedTime}
					tooltipLabel={t('messages.statsGenerationTime')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Gauge}
					value="{tokensPerSecond.toFixed(2)} t/s"
					tooltipLabel={t('messages.statsGenerationSpeed')}
				/>
			{:else if activeView === ChatMessageStatsView.TOOLS && hasAgenticStats}
				<BadgeChatStatistic
					class="bg-transparent"
					icon={Wrench}
					value="{agenticTimings!.toolCallsCount} calls"
					tooltipLabel={t('messages.statsToolCallsExecuted')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Clock}
					value={formattedAgenticToolsTime}
					tooltipLabel={t('messages.statsToolExecutionTime')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Gauge}
					value="{agenticToolsPerSecond.toFixed(2)} calls/s"
					tooltipLabel={t('messages.statsToolExecutionRate')}
				/>
			{:else if activeView === ChatMessageStatsView.SUMMARY && hasAgenticStats}
				<BadgeChatStatistic
					class="bg-transparent"
					icon={Layers}
					value="{agenticTimings!.turns} turns"
					tooltipLabel={t('messages.statsAgenticTurns')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={WholeWord}
					value="{agenticTimings!.llm.predicted_n.toLocaleString()} tokens"
					tooltipLabel={t('messages.statsTotalTokensGenerated')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Clock}
					value={formattedAgenticTotalTime}
					tooltipLabel={t('messages.statsTotalTime')}
				/>
			{:else if hasPromptStats}
				<BadgeChatStatistic
					class="bg-transparent"
					icon={WholeWord}
					value="{promptTokens} tokens"
					tooltipLabel={t('messages.statsPromptTokens')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Clock}
					value={formattedPromptTime ?? '0s'}
					tooltipLabel={t('messages.statsPromptProcessingTime')}
				/>

				<BadgeChatStatistic
					class="bg-transparent"
					icon={Gauge}
					value="{promptTokensPerSecond!.toFixed(2)} tokens/s"
					tooltipLabel={t('messages.statsPromptProcessingSpeed')}
				/>
			{/if}
		</div>
	</div>
{/if}
