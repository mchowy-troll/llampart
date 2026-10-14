<script lang="ts">
	import { Gauge } from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import BadgeChatStatistic from '$lib/components/app/badges/BadgeChatStatistic.svelte';
	import ChatMessageStatistics from '$lib/components/app/chat/ChatMessages/ChatMessageStatistics.svelte';
	let { tooltipLabel, statistics }: { tooltipLabel?: string; statistics?: 'native' | 'provider' } =
		$props();
</script>

<Tooltip.Provider>
	{#if statistics}
		<ChatMessageStatistics
			predictedTokens={24}
			predictedMs={2000}
			promptTokens={120}
			promptMs={1000}
			provider={statistics === 'provider'
				? {
						usage: { promptTokens: 120, completionTokens: 24, totalTokens: 144 },
						metrics: [
							{ name: 'generation', value: 2000, unit: 'ms', source: 'backend', available: true }
						]
					}
				: undefined}
		/>
	{:else}
		<BadgeChatStatistic icon={Gauge} value="12 t/s" {tooltipLabel} />
	{/if}
</Tooltip.Provider>
