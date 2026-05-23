<script lang="ts">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { t } from '$lib/i18n';

	interface Props {
		class?: string;
		siblingInfo: ChatMessageSiblingInfo | null;
		onNavigateToSibling?: (siblingId: string) => void;
	}

	let { class: className = '', siblingInfo, onNavigateToSibling }: Props = $props();

	let hasPrevious = $derived(siblingInfo && siblingInfo.currentIndex > 0);
	let hasNext = $derived(siblingInfo && siblingInfo.currentIndex < siblingInfo.totalSiblings - 1);
	let nextSiblingId = $derived(
		hasNext ? siblingInfo!.siblingIds[siblingInfo!.currentIndex + 1] : null
	);
	let previousSiblingId = $derived(
		hasPrevious ? siblingInfo!.siblingIds[siblingInfo!.currentIndex - 1] : null
	);

	function handleNext() {
		if (nextSiblingId) {
			onNavigateToSibling?.(nextSiblingId);
		}
	}

	function handlePrevious() {
		if (previousSiblingId) {
			onNavigateToSibling?.(previousSiblingId);
		}
	}
</script>

{#if siblingInfo && siblingInfo.totalSiblings > 1}
	<div
		aria-label={`${t('messages.messageVersionLabel')} ${siblingInfo.currentIndex + 1} ${t('messages.of')} ${siblingInfo.totalSiblings}`}
		class="flex items-center gap-1 text-xs text-muted-foreground {className}"
		role="navigation"
	>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<Button
					aria-label={t('messages.previousMessageVersion')}
					class="h-5 w-5 p-0 {!hasPrevious ? 'cursor-not-allowed opacity-30' : ''}"
					disabled={!hasPrevious}
					onclick={handlePrevious}
					size="sm"
					variant="ghost"
				>
					<ChevronLeft class="h-3 w-3" />
				</Button>
			</Tooltip.Trigger>

			<Tooltip.Content>
				<p>{t('messages.previousVersion')}</p>
			</Tooltip.Content>
		</Tooltip.Root>

		<span class="px-1 font-mono text-xs">
			{siblingInfo.currentIndex + 1}/{siblingInfo.totalSiblings}
		</span>

		<Tooltip.Root>
			<Tooltip.Trigger>
				<Button
					aria-label={t('messages.nextMessageVersion')}
					class="h-5 w-5 p-0 {!hasNext ? 'cursor-not-allowed opacity-30' : ''}"
					disabled={!hasNext}
					onclick={handleNext}
					size="sm"
					variant="ghost"
				>
					<ChevronRight class="h-3 w-3" />
				</Button>
			</Tooltip.Trigger>

			<Tooltip.Content>
				<p>{t('messages.nextVersion')}</p>
			</Tooltip.Content>
		</Tooltip.Root>
	</div>
{/if}
