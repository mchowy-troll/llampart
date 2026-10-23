<script lang="ts">
	import { t } from '$lib/i18n';
	import { Mic, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { mergeProps } from 'bits-ui';

	interface Props {
		class?: string;
		disabled?: boolean;
		hasAudioModality?: boolean;
		isLoading?: boolean;
		isRecording?: boolean;
		onMicClick?: () => void;
	}

	let {
		class: className = '',
		disabled = false,
		hasAudioModality = false,
		isLoading = false,
		isRecording = false,
		onMicClick
	}: Props = $props();
	const audioHintId = $props.id();

	function handleMicClick() {
		if (disabled || isLoading || !hasAudioModality) return;
		onMicClick?.();
	}
</script>

<div class="flex items-center gap-1 {className}">
	<Tooltip.Root>
		<Tooltip.Trigger disabled={hasAudioModality && (disabled || isLoading)}>
			{#snippet child({ props })}
				<span
					class="llampart-composer-bare-action inline-flex rounded-full border border-transparent"
				>
					<Button
						{...mergeProps(props, { onclick: handleMicClick })}
						class="llampart-composer-action-button llampart-composer-record-button h-8 w-8 rounded-full p-0 aria-disabled:pointer-events-auto {isRecording
							? 'animate-pulse bg-red-500 text-white hover:bg-red-600'
							: ''}"
						disabled={hasAudioModality && (disabled || isLoading)}
						aria-disabled={!hasAudioModality || undefined}
						aria-describedby={!hasAudioModality ? audioHintId : undefined}
						data-disabled={disabled || isLoading || !hasAudioModality ? '' : undefined}
						type="button"
						data-recording={isRecording}
					>
						<span class="sr-only"
							>{isRecording ? t('chat.stopRecording') : t('chat.startRecording')}</span
						>

						{#if isRecording}
							<Square class="h-4 w-4 animate-pulse fill-white" />
						{:else}
							<Mic class="h-4 w-4" />
						{/if}
					</Button>
					{#if !hasAudioModality}
						<span id={audioHintId} class="sr-only">{t('chat.currentModelDoesNotSupportAudio')}</span
						>
					{/if}
				</span>
			{/snippet}
		</Tooltip.Trigger>

		{#if !hasAudioModality}
			<Tooltip.Content>
				<p>{t('chat.currentModelDoesNotSupportAudio')}</p>
			</Tooltip.Content>
		{/if}
	</Tooltip.Root>
</div>

<style>
	/* A no-audio button now receives pointer events for its tooltip. Keep the
	 * disabled Frosted Glass fill rather than introducing an enabled hover fill. */
	div :global(button[aria-disabled='true']:hover) {
		--llampart-glass-white-280: var(--llampart-glass-white-200, rgba(255, 255, 255, 0.2));
		--llampart-glass-white-660: var(--llampart-glass-white-580, rgba(255, 255, 255, 0.58));
	}
</style>
