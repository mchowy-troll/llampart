<script lang="ts">
	import { ArrowUp } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { cn } from '$lib/components/ui/utils';
	import { t } from '$lib/i18n';

	interface Props {
		canSend?: boolean;
		disabled?: boolean;
		isLoading?: boolean;
		showErrorState?: boolean;
		tooltipLabel?: string;
	}

	let {
		canSend = false,
		disabled = false,
		isLoading = false,
		showErrorState = false,
		tooltipLabel
	}: Props = $props();

	let isDisabled = $derived(!canSend || disabled || isLoading);
</script>

{#snippet submitButton(props = {})}
	<Button
		type="submit"
		disabled={isDisabled}
		class={cn(
			'llampart-composer-action-button llampart-composer-submit-button h-8 w-8 rounded-full p-0',
			showErrorState
				? 'bg-red-400/10 text-red-400 hover:bg-red-400/20 hover:text-red-400 disabled:opacity-100'
				: ''
		)}
		{...props}
	>
		<span class="sr-only">{t('common.send')}</span>
		<ArrowUp class="h-12 w-12" />
	</Button>
{/snippet}

{#if tooltipLabel}
	<Tooltip.Root>
		<Tooltip.Trigger class="llampart-composer-submit-tooltip-trigger inline-flex rounded-full">
			{@render submitButton()}
		</Tooltip.Trigger>

		<Tooltip.Content>
			<p>{tooltipLabel}</p>
		</Tooltip.Content>
	</Tooltip.Root>
{:else}
	{@render submitButton()}
{/if}

<style>
	/* llampart-standard-composer-plus-button-fill-colors */
	:global(html:not(.dark):not(.has-frosted-glass-theme) .llampart-composer-plus-button) {
		background: #888888 !important;
		background-color: #888888 !important;
		border-color: #888888 !important;
	}

	:global(html.dark:not(.has-frosted-glass-theme) .llampart-composer-plus-button) {
		background: #828282 !important;
		background-color: #828282 !important;
		border-color: #828282 !important;
	}

	/* llampart-frosted-glass-submit-button-brighter */
	:global(html.has-frosted-glass-theme .llampart-composer-submit-button),
	:global(html.has-frosted-glass-theme .llampart-composer-plus-button) {
		border-color: rgba(255, 255, 255, 0.58) !important;
		background: rgba(255, 255, 255, 0.72) !important;
		color: #111111 !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.34),
			0 1px 2px rgba(0, 0, 0, 0.035) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-submit-button:hover),
	:global(html.has-frosted-glass-theme .llampart-composer-submit-button:focus-visible),
	:global(html.has-frosted-glass-theme .llampart-composer-plus-button:hover),
	:global(html.has-frosted-glass-theme .llampart-composer-plus-button:focus-visible) {
		background: rgba(255, 255, 255, 0.84) !important;
		border-color: rgba(255, 255, 255, 0.68) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-submit-button:disabled) {
		background: rgba(255, 255, 255, 0.54) !important;
		border-color: rgba(255, 255, 255, 0.38) !important;
		color: rgba(17, 17, 17, 0.62) !important;
		opacity: 1 !important;
	}

	/* llampart-frosted-glass-submit-tooltip-wrapper-reset */
	:global(html.has-frosted-glass-theme .llampart-composer-submit-tooltip-trigger) {
		width: 2rem !important;
		height: 2rem !important;
		padding: 0 !important;
		border: 0 !important;
		border-radius: 9999px !important;
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		box-shadow: none !important;
		outline: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-composer-submit-tooltip-trigger:hover),
	:global(html.has-frosted-glass-theme .llampart-composer-submit-tooltip-trigger:focus-visible) {
		background: transparent !important;
		box-shadow: none !important;
	}
</style>
