<script lang="ts">
	import { Check, Lightbulb } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/components/ui/utils';
	import { resolveReasoning, sameReasoningIntent } from '$lib/services/providers/reasoning';
	import { t } from '$lib/i18n';
	import { loadedModelIds, modelsStore } from '$lib/stores/models.svelte';
	import { isRouterMode } from '$lib/stores/server.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { ChatService } from '$lib/services/chat.service';
	import { activeMessages, conversationsStore } from '$lib/stores/conversations.svelte';
	import type { DatabaseMessage, ReasoningIntent } from '$lib/types';

	interface Props {
		class?: string;
	}

	let { class: className = '' }: Props = $props();

	let nativeReasoning = $derived(config().apiProvider === 'llama-server');
	let conversationModel = $derived(
		chatStore.getConversationModel(activeMessages() as DatabaseMessage[])
	);
	let controlModel = $derived(
		ChatService.resolveEffectiveModel(
			ChatService.createProviderRequestContext(),
			undefined,
			conversationModel
		)
	);
	let capabilities = $derived(modelsStore.getReasoningCapabilities(controlModel));
	let resolved = $derived(resolveReasoning(capabilities, conversationsStore.getReasoningIntent()));
	let thinkingEnabled = $derived(resolved.selected.mode !== 'off');
	let subOpen = $state(false);
	let declaration = $state('');
	let declarationError = $state('');
	let controlIdentity = $derived(
		JSON.stringify([
			config().apiProvider,
			config().serverBaseUrl,
			config().apiKey,
			controlModel,
			capabilities.protocol
		])
	);

	$effect(() => {
		if (nativeReasoning && isRouterMode() && controlModel) {
			// Loaded state changes may make model-specific props available later.
			loadedModelIds();
			void modelsStore.fetchModelProps(controlModel);
		}
	});
	$effect(() => {
		void controlIdentity;
		declaration = '';
		declarationError = '';
		subOpen = false;
	});

	let tooltipText = $derived(
		`${getLevelLabel(resolved.requested)} ${t('chat.reasoningLabel')}${resolved.available ? '' : ` — ${t('chat.reasoningUnavailable')}`}`
	);

	function saveDeclaration(clear = false) {
		try {
			modelsStore.setDeclaredReasoningLevels(
				controlModel,
				clear ? null : declaration.split(',').map((value) => value.trim())
			);
			declarationError = '';
		} catch {
			declarationError = t('chat.reasoningDeclarationInvalid');
		}
	}

	function getLevelLabel(item: ReasoningIntent): string {
		if (item.mode === 'default') return t('chat.reasoningDefault');
		if (item.mode === 'off') return t('chat.reasoningEffort.off');
		if (item.mode === 'on') return t('chat.reasoningEnabled');
		const key = `chat.reasoningEffort.${item.value}`;
		const translated = t(key);
		return translated === key ? item.value : translated;
	}

	function handleSelection(item: ReasoningIntent) {
		void conversationsStore.setReasoningIntent(item);
		subOpen = false;
	}
</script>

{#if capabilities.availability !== 'unsupported' || !resolved.available}
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
								{t(
									capabilities.control === 'toggle'
										? 'chat.reasoningLabel'
										: 'chat.reasoningEffortTitle'
								)}
							</p>

							{#if capabilities.availability === 'unknown' || (capabilities.effort.state === 'supported' && !capabilities.effort.values)}
								<p class="px-3 pb-2 text-xs text-muted-foreground">
									{t(
										capabilities.availability === 'unknown'
											? 'chat.reasoningUnknown'
											: 'chat.reasoningLevelsUnknown'
									)}
								</p>
							{/if}
							{#if !resolved.available}
								<p role="alert" class="px-3 pb-2 text-xs text-destructive">
									{t('chat.reasoningUnavailable')} ({getLevelLabel(resolved.requested)})
								</p>
							{/if}
							{#if capabilities.effort.source === 'user'}
								<p class="px-3 pb-2 text-xs text-muted-foreground">
									{t('chat.reasoningDeclarationUser')}
								</p>
							{/if}
							{#each resolved.choices as level (`${level.mode}:${level.mode === 'effort' ? level.value : ''}`)}
								{@const selected = sameReasoningIntent(level, resolved.selected)}

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
											</span>
										</button>
									{/snippet}
								</DropdownMenu.Item>
							{/each}
							{#if capabilities.declarationKey && (!capabilities.effort.values || capabilities.effort.source === 'user')}
								<details class="px-3 py-2 text-xs">
									<summary class="cursor-pointer">{t('chat.reasoningDeclarationTitle')}</summary>
									<p class="my-2 text-muted-foreground">{t('chat.reasoningDeclarationHint')}</p>
									<label for="reasoning-declared-levels"
										>{t('chat.reasoningDeclarationTitle')}</label
									>
									<input
										id="reasoning-declared-levels"
										class="my-2 w-full rounded border bg-background p-2"
										bind:value={declaration}
										onkeydown={(event) => event.stopPropagation()}
									/>
									<div class="flex gap-3">
										<button type="button" onclick={() => saveDeclaration()}
											>{t('chat.reasoningDeclarationApply')}</button
										>
										<button type="button" onclick={() => saveDeclaration(true)}
											>{t('chat.reasoningDeclarationClear')}</button
										>
									</div>
									{#if declarationError}<p role="alert" class="mt-2 text-destructive">
											{declarationError}
										</p>{/if}
								</details>
							{/if}
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
