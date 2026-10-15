<script lang="ts">
	import { Check, Info, Lightbulb } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/components/ui/utils';
	import { REASONING_EFFORT_LEVELS } from '$lib/constants';
	import { ReasoningEffort } from '$lib/enums';
	import { effectiveLlamaReasoningEffort } from '$lib/utils/chat-template-thinking-detector';
	import { t } from '$lib/i18n';
	import {
		checkModelSupportsThinking,
		loadedModelIds,
		modelsStore,
		propsCacheVersion,
		supportsThinking
	} from '$lib/stores/models.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { activeMessages, conversationsStore } from '$lib/stores/conversations.svelte';
	import type { DatabaseMessage, ReasoningEffortLevel } from '$lib/types';

	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();

	let nativeReasoning = $derived(config().apiProvider === 'llama-server');
	let conversationModel = $derived(
		chatStore.getConversationModel(activeMessages() as DatabaseMessage[])
	);
	let controlModel = $derived(modelsStore.selectedModelName || conversationModel);
	let control = $derived(nativeReasoning ? modelsStore.getReasoningControl(controlModel) : 'none');
	let thinkingEnabled = $derived(control === 'effort' || conversationsStore.getThinkingEnabled());
	let currentEffort = $derived(
		nativeReasoning
			? effectiveLlamaReasoningEffort(conversationsStore.getReasoningEffort())
			: conversationsStore.getReasoningEffort()
	);
	let isOff = $derived(!thinkingEnabled);
	let subOpen = $state(false);
	let levels: ReasoningEffortLevel[] = $derived(
		nativeReasoning
			? control === 'toggle'
				? [{ value: 'off', isOff: true }, { value: ReasoningEffort.HIGH }]
				: REASONING_EFFORT_LEVELS.filter(
						(level) => !level.isOff && level.value !== ReasoningEffort.MAX
					)
			: REASONING_EFFORT_LEVELS.filter(
					(level) =>
						level.isOff ||
						(level.value !== ReasoningEffort.MAX &&
							(!modelsStore.capabilitySnapshot?.features.reasoning_effort?.values ||
								modelsStore.capabilitySnapshot.features.reasoning_effort.values.includes(
									level.value
								)))
				)
	);

	$effect(() => {
		if (nativeReasoning && isRouterMode() && controlModel) {
			// Loaded state changes may make model-specific props available later.
			loadedModelIds();
			void modelsStore.fetchModelProps(controlModel);
		}
	});
	$effect(() => {
		void controlModel;
		void control;
		subOpen = false;
	});

	let modelSupportsThinking = $derived.by(() => {
		if (nativeReasoning) return control !== 'none';
		loadedModelIds();
		propsCacheVersion();
		const providerSupportsThinking =
			modelsStore.capabilitySnapshot?.features.reasoning?.state !== 'unsupported';

		if (isRouterMode()) {
			const modelId = modelsStore.selectedModelName || conversationModel;
			return checkModelSupportsThinking(modelId ?? '') || providerSupportsThinking;
		}

		return supportsThinking() || providerSupportsThinking;
	});

	let tooltipText = $derived(
		control === 'toggle' && thinkingEnabled
			? t('chat.reasoningLabel')
			: thinkingEnabled
				? `${getLevelLabel({ value: currentEffort })} ${t('chat.reasoningLabel')}`
				: t('chat.reasoningDisabledTooltip')
	);

	function isSelected(item: ReasoningEffortLevel): boolean {
		if (item.isOff) return isOff;
		if (control === 'toggle') return thinkingEnabled;
		return thinkingEnabled && currentEffort === item.value;
	}

	function getLevelLabel(item: ReasoningEffortLevel): string {
		if (item.isOff) return t('chat.reasoningEffort.off');
		if (control === 'toggle') return t('chat.reasoningEnabled');
		return t(`chat.reasoningEffort.${item.value}`);
	}

	function handleSelection(item: ReasoningEffortLevel) {
		if (item.isOff) {
			conversationsStore.setThinkingEnabled(false);
		} else {
			conversationsStore.setThinkingEnabled(true);
			if (control !== 'toggle')
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
								{t(control === 'toggle' ? 'chat.reasoningLabel' : 'chat.reasoningEffortTitle')}
							</p>

							{#each levels as level (level.value)}
								{@const selected = isSelected(level)}

								<DropdownMenu.Item onSelect={() => handleSelection(level)}>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class={[
												'llampart-reasoning-effort-option grid w-full cursor-pointer grid-cols-[1.25rem_minmax(7.5rem,1fr)_11.25rem_1.25rem] items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-normal transition hover:bg-accent/35 hover:text-accent-foreground focus-visible:bg-accent/35 focus-visible:text-accent-foreground focus:outline-none',
												selected ? 'bg-accent/45 text-accent-foreground' : 'text-popover-foreground'
											]}
											role="menuitemradio"
											aria-checked={selected}
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
									{/snippet}
								</DropdownMenu.Item>
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
	.llampart-reasoning-effort-option :global(svg),
	.llampart-reasoning-effort-option :global(svg *) {
		stroke-width: 1.65;
	}
</style>
