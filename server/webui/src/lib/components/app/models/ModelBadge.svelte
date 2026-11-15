<script lang="ts">
	import { Package } from '@lucide/svelte';
	import BadgeInfo from '$lib/components/app/badges/BadgeInfo.svelte';
	import ActionIconCopyToClipboard from '$lib/components/app/actions/ActionIconCopyToClipboard.svelte';
	import ModelId from './ModelId.svelte';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { serverStore } from '$lib/stores/backend.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { t } from '$lib/i18n';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props {
		class?: string;
		model?: string | null;
		showRaw?: boolean;
		onclick?: () => void;
		showCopyIcon?: boolean;
		showTooltip?: boolean;
	}

	let {
		class: className = '',
		model: modelProp,
		showRaw,
		onclick,
		showCopyIcon = false,
		showTooltip = false
	}: Props = $props();

	// Explicit null means unknown historical identity, not the active model.
	let model = $derived(modelProp === undefined ? modelsStore.singleModelName : modelProp);
	let isModelMode = $derived(serverStore.isModelMode);
	let shouldShow = $derived(
		modelProp === null || (model && (modelProp !== undefined || isModelMode))
	);
</script>

{#snippet badgeContent(triggerProps: HTMLButtonAttributes = {})}
	<BadgeInfo {...triggerProps} class="max-w-full min-w-0 {className}" {onclick} disabled={!model}>
		{#snippet icon()}
			<Package class="h-3 w-3" />
		{/snippet}

		{#if model}
			<ModelId modelId={model} {showRaw} />
		{:else}
			{t('models.unknownModel')}
		{/if}

		{#if showCopyIcon && model}
			<ActionIconCopyToClipboard text={model || ''} ariaLabel={t('models.copyModelName')} />
		{/if}
	</BadgeInfo>
{/snippet}

{#if shouldShow}
	{#if showTooltip && model}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					{@render badgeContent(props)}
				{/snippet}
			</Tooltip.Trigger>

			<Tooltip.Content>
				<p>{model}</p>
			</Tooltip.Content>
		</Tooltip.Root>
	{:else}
		{@render badgeContent()}
	{/if}
{/if}
