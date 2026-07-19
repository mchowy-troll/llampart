<script lang="ts">
	import { Check, Info, Lightbulb } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/components/ui/utils';
	import { REASONING_EFFORT_LEVELS, REASONING_EFFORT_TOKENS } from '$lib/constants';
	import { MessageRole, ReasoningEffort } from '$lib/enums';
	import { t } from '$lib/i18n';
	import {
		checkModelSupportsThinking,
		loadedModelIds,
		modelsStore,
		propsCacheVersion,
		supportsThinking
	} from '$lib/stores/models.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { activeMessages, conversationsStore } from '$lib/stores/conversations.svelte';
	import type { DatabaseMessage, ReasoningEffortLevel } from '$lib/types';

	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();

	let thinkingEnabled = $derived(conversationsStore.getThinkingEnabled());
	let currentEffort = $derived(conversationsStore.getReasoningEffort());
	let isOff = $derived(!thinkingEnabled);
	let subOpen = $state(false);

	let conversationModel = $derived(
		chatStore.getConversationModel(activeMessages() as DatabaseMessage[])
	);

	let modelSupportsThinkingFromMessages = $derived.by(() => {
		const modelId = isRouterMode() ? modelsStore.selectedModelName || conversationModel : null;
		if (!modelId) return false;

		return conversationsStore.activeMessages.some(
			(message: DatabaseMessage) =>
				message.role === MessageRole.ASSISTANT &&
				message.model === modelId &&
				!!message.reasoningContent
		);
	});

	let modelSupportsThinking = $derived.by(() => {
		loadedModelIds();
		propsCacheVersion();

		if (isRouterMode()) {
			const modelId = modelsStore.selectedModelName || conversationModel;
			return checkModelSupportsThinking(modelId ?? '') || modelSupportsThinkingFromMessages;
		}

		return supportsThinking() || modelSupportsThinkingFromMessages;
	});

	let tooltipText = $derived(
		thinkingEnabled
			? `${getLevelLabel({ value: currentEffort })} ${t('chat.reasoningLabel')}`
			: t('chat.reasoningDisabledTooltip')
	);

	function isSelected(item: ReasoningEffortLevel): boolean {
		if (item.isOff) return isOff;
		return thinkingEnabled && currentEffort === item.value;
	}

	function getLevelLabel(item: ReasoningEffortLevel): string {
		if (item.isOff) return t('chat.reasoningEffort.off');
		return t(`chat.reasoningEffort.${item.value}`);
	}

	function getTokenLabel(item: ReasoningEffortLevel): string {
		if (item.isOff) return '';
		const value = item.value as ReasoningEffort;
		const tokens = REASONING_EFFORT_TOKENS[value];
		if (tokens === -1) return t('chat.reasoningUnlimited');
		return `${t('chat.reasoningMaxTokensPrefix')} ${tokens.toLocaleString()} ${t('chat.reasoningMaxTokensSuffix')}`;
	}

	function handleSelection(item: ReasoningEffortLevel) {
		if (item.isOff) {
			conversationsStore.setThinkingEnabled(false);
		} else {
			conversationsStore.setThinkingEnabled(true);
			conversationsStore.setReasoningEffort(item.value as ReasoningEffort);
		}
		subOpen = false;
	}
</script>

{#if modelSupportsThinking}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<span
					{...props}
					class={cn(
						'llampart-reasoning-trigger-shell inline-flex h-8 w-8 shrink-0 items-center justify-center',
						className
					)}
				>
					<DropdownMenu.Root bind:open={subOpen}>
						<DropdownMenu.Trigger
							class={cn(
								buttonVariants({ variant: 'default' }),
								'llampart-reasoning-trigger llampart-composer-action-button llampart-composer-submit-button inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full p-0 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
								thinkingEnabled
									? 'llampart-composer-neutral-action-button llampart-composer-reasoning-button-on'
									: 'llampart-composer-neutral-action-button llampart-composer-reasoning-button-off'
							)}
							aria-label={`${tooltipText}. ${t('chat.reasoningConfigureHint')}`}
						>
							<Lightbulb
								class={cn(
									'h-4 w-4 shrink-0',
									!thinkingEnabled ? 'llampart-reasoning-trigger-icon-disabled' : ''
								)}
							/>
						</DropdownMenu.Trigger>

						<DropdownMenu.Content
							align="end"
							class="llampart-composer-menu-content llampart-reasoning-effort-menu w-[28rem] max-w-[calc(100vw-2rem)] overflow-hidden p-2"
						>
							<p
								class="my-1 px-3 py-2 text-[13px] font-semibold text-muted-foreground/75 select-none"
							>
								{t('chat.reasoningEffortTitle')}
							</p>

							{#each REASONING_EFFORT_LEVELS as level (level.value)}
								{@const selected = isSelected(level)}

								<button
									type="button"
									class={[
										'llampart-reasoning-effort-option grid w-full cursor-pointer grid-cols-[1.25rem_minmax(7.5rem,1fr)_11.25rem_1.25rem] items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-normal transition hover:bg-accent/35 hover:text-accent-foreground focus-visible:bg-accent/35 focus-visible:text-accent-foreground focus:outline-none',
										selected ? 'bg-accent/45 text-accent-foreground' : 'text-popover-foreground'
									]}
									role="option"
									aria-selected={selected}
									onclick={() => handleSelection(level)}
								>
									<span class="flex h-4 w-4 items-center justify-center">
										{#if selected}
											<Check class="h-3.5 w-3.5 shrink-0" />
										{/if}
									</span>

									<span class="min-w-0 whitespace-nowrap">{getLevelLabel(level)}</span>

									<span
										class="justify-self-start text-xs whitespace-nowrap text-muted-foreground/80"
									>
										{#if !level.isOff}
											{getTokenLabel(level)}
										{/if}
									</span>

									<span class="flex h-4 w-4 items-center justify-center justify-self-end">
										{#if level.hasInfo}
											<Tooltip.Root>
												<Tooltip.Trigger>
													<Info class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
												</Tooltip.Trigger>
												<Tooltip.Content side="left">
													<p>{t('chat.reasoningMaxInfo')}</p>
												</Tooltip.Content>
											</Tooltip.Root>
										{/if}
									</span>
								</button>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</span>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			<p>{tooltipText}</p>
		</Tooltip.Content>
	</Tooltip.Root>
{/if}

<style>
	/* llampart-reasoning-off-icon-red */
	:global(html.has-frosted-glass-theme .llampart-reasoning-trigger-icon-disabled),
	:global(html.has-frosted-glass-theme .llampart-reasoning-trigger-icon-disabled *) {
		color: #e7000b !important;
		stroke: #e7000b !important;
		stroke-width: 2.35 !important;
		opacity: 1 !important;
	}

	.llampart-reasoning-effort-option :global(svg),
	.llampart-reasoning-effort-option :global(svg *) {
		stroke-width: 1.65;
	}
</style>
