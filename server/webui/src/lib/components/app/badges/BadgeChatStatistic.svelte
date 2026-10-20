<script lang="ts">
	import BadgeInfo from '$lib/components/app/badges/BadgeInfo.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { copyToClipboard } from '$lib/utils';
	import type { Component, Snippet } from 'svelte';
	import { mergeProps } from 'bits-ui';

	interface Props {
		class?: string;
		icon: Component;
		value: string | number;
		tooltipLabel?: string;
		tooltipContent?: Snippet;
	}

	let { class: className = '', icon: Icon, value, tooltipLabel, tooltipContent }: Props = $props();

	function handleClick() {
		void copyToClipboard(String(value));
	}
</script>

{#if tooltipLabel || tooltipContent}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<BadgeInfo
					{...mergeProps(props, { onclick: handleClick })}
					class={className}
					aria-label={tooltipLabel ? `${tooltipLabel}: ${value}` : undefined}
				>
					{#snippet icon()}
						<Icon class="h-3 w-3" />
					{/snippet}

					{value}
				</BadgeInfo>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			{#if tooltipContent}
				{@render tooltipContent()}
			{:else}
				<p>{tooltipLabel}</p>
			{/if}
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<BadgeInfo class={className} onclick={handleClick}>
		{#snippet icon()}
			<Icon class="h-3 w-3" />
		{/snippet}

		{value}
	</BadgeInfo>
{/if}
