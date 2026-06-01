<script lang="ts">
	import {
		Pencil,
		Download,
		Loader2,
		Square,
		GitBranch,
		Clock,
		Calendar,
		Pin
	} from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { FORK_TREE_DEPTH_PADDING } from '$lib/constants';
	import { getAllLoadingChats } from '$lib/stores/chat.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { formatConversationTimestampParts } from '$lib/utils';
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';

	interface Props {
		isActive?: boolean;
		depth?: number;
		conversation: DatabaseConversation;
		handleMobileSidebarItemClick?: () => void;
		onEdit?: (id: string) => void;
		onSelect?: (id: string) => void;
		onStop?: (id: string) => void;
		selectionChecked?: boolean;
		selectionAriaLabel?: string;
		onSelectionChange?: (id: string, checked: boolean) => void;
		onPinnedChange?: (id: string, pinned: boolean) => void;
	}

	let {
		conversation,
		handleMobileSidebarItemClick,
		onEdit,
		onSelect,
		onStop,
		selectionChecked = false,
		selectionAriaLabel,
		onSelectionChange,
		onPinnedChange,
		isActive = false,
		depth = 0
	}: Props = $props();

	let isLoading = $derived(getAllLoadingChats().includes(conversation.id));
	let shouldShowConversationTimestamp = $derived(
		settingsStore.config.showConversationTimestamps !== false
	);
	let conversationTimestampParts = $derived(
		shouldShowConversationTimestamp
			? formatConversationTimestampParts(
					conversation.lastModified,
					settingsStore.config.conversationTimestampFormat === 'mmddyyyy12'
						? 'mmddyyyy12'
						: 'ddmmyyyy24'
				)
			: { date: '', time: '' }
	);
	let hasConversationTimestamp = $derived(
		conversationTimestampParts.date.length > 0 && conversationTimestampParts.time.length > 0
	);

	function handleEdit(event: Event) {
		event.stopPropagation();
		onEdit?.(conversation.id);
	}

	function handleExport(event: Event) {
		event.stopPropagation();
		conversationsStore.downloadConversation(conversation.id);
	}

	function handleStop(event: Event) {
		event.stopPropagation();
		onStop?.(conversation.id);
	}

	function handleGlobalEditEvent(event: Event) {
		const customEvent = event as CustomEvent<{ conversationId: string }>;

		if (customEvent.detail.conversationId === conversation.id && isActive) {
			handleEdit(event);
		}
	}

	function handleSelect() {
		onSelect?.(conversation.id);
	}

	function handleSelectionChange(event: Event) {
		event.stopPropagation();
		onSelectionChange?.(conversation.id, (event.currentTarget as HTMLInputElement).checked);
	}

	function handleSelectionClick(event: MouseEvent) {
		event.stopPropagation();
	}

	function handlePinnedClick(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		onPinnedChange?.(conversation.id, !conversation.pinned);
	}

	function handleConversationKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;

		if (target?.closest('input, button, a')) {
			return;
		}

		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSelect();
		}
	}

	onMount(() => {
		document.addEventListener('edit-active-conversation', handleGlobalEditEvent as EventListener);

		return () => {
			document.removeEventListener(
				'edit-active-conversation',
				handleGlobalEditEvent as EventListener
			);
		};
	});
</script>

<div
	class="conversation-item group flex h-36 w-full cursor-pointer flex-col rounded-2xl border border-border bg-background p-3 text-left transition-colors hover:bg-accent/35 focus-visible:bg-accent/35 {isActive
		? 'border-border bg-accent/45 text-accent-foreground'
		: ''}"
	role="button"
	tabindex="0"
	onclick={handleSelect}
	onkeydown={handleConversationKeydown}
>
	{#if hasConversationTimestamp}
		<div class="conversation-card-meta flex min-w-0 items-center justify-between gap-3">
			<span
				class="conversation-timestamp-badge inline-flex max-w-[52%] min-w-0 items-center gap-1.5 truncate rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors"
			>
				<Calendar class="h-3 w-3 shrink-0" />

				<span class="truncate">{conversationTimestampParts.date}</span>
			</span>

			<span
				class="conversation-timestamp-badge inline-flex max-w-[42%] min-w-0 items-center gap-1.5 truncate rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors"
			>
				<Clock class="h-3 w-3 shrink-0" />

				<span class="truncate">{conversationTimestampParts.time}</span>
			</span>
		</div>
	{/if}

	<div
		class="conversation-card-title-row flex min-w-0 flex-1 items-start gap-2 py-4"
		style:padding-left="{depth * FORK_TREE_DEPTH_PADDING}px"
	>
		{#if depth > 0}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<a
						href="#/chat/{conversation.forkedFromConversationId}"
						class="conversation-parent-link mt-0.5 flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
					>
						<GitBranch class="h-3.5 w-3.5" />
					</a>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>{t('sidebar.seeParentConversation')}</p>
				</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span
			class="conversation-title min-w-0 flex-1 text-sm leading-snug font-medium break-words whitespace-normal transition-colors"
			onclick={handleMobileSidebarItemClick}
		>
			{conversation.name}
		</span>
	</div>

	<div class="conversation-card-footer mt-auto flex min-h-6 items-center justify-between gap-3">
		<div class="conversation-card-status flex min-w-0 items-center gap-2">
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						aria-label={conversation.pinned
							? t('sidebar.unpinConversation')
							: t('sidebar.pinConversation')}
						class="conversation-pin-button flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
						type="button"
						onclick={handlePinnedClick}
					>
						<Pin class="h-3.5 w-3.5 {conversation.pinned ? 'fill-current' : 'fill-none'}" />
					</button>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>
						{conversation.pinned ? t('sidebar.unpinConversation') : t('sidebar.pinConversation')}
					</p>
				</Tooltip.Content>
			</Tooltip.Root>
			{#if isLoading}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<div
							class="stop-button flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
							onclick={handleStop}
							onkeydown={(e) => e.key === 'Enter' && handleStop(e)}
							role="button"
							tabindex="0"
							aria-label={t('sidebar.stopGeneration')}
						>
							<Loader2 class="loading-icon h-3.5 w-3.5 animate-spin" />

							<Square class="stop-icon hidden h-3 w-3 fill-current text-destructive" />
						</div>
					</Tooltip.Trigger>

					<Tooltip.Content>
						<p>{t('sidebar.stopGeneration')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}
		</div>

		<div class="conversation-card-actions flex shrink-0 items-center gap-2">
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						aria-label={t('common.edit')}
						class="conversation-action-button flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
						type="button"
						onclick={handleEdit}
					>
						<Pencil class="h-3.5 w-3.5" />
					</button>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>{t('common.edit')}</p>
				</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						aria-label={t('common.export')}
						class="conversation-action-button flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
						type="button"
						onclick={handleExport}
					>
						<Download class="h-3.5 w-3.5" />
					</button>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>{t('common.export')}</p>
				</Tooltip.Content>
			</Tooltip.Root>

			{#if !conversation.pinned}
				<Tooltip.Root>
					<Tooltip.Trigger class="flex h-6 w-6 items-center justify-center">
						<input
							aria-label={selectionAriaLabel ??
								t('sidebar.selectConversation').replace('{name}', conversation.name)}
							class="llampart-sidebar-select-checkbox size-4 shrink-0 cursor-pointer transition-colors"
							checked={selectionChecked}
							type="checkbox"
							onchange={handleSelectionChange}
							onclick={handleSelectionClick}
						/>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p>{t('sidebar.selectForDeletion')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}
		</div>
	</div>
</div>

<style>
	.conversation-item:is(:hover, :focus-visible) .conversation-title,
	.conversation-item:is(:hover, :focus-visible) :global(.conversation-action-button),
	.conversation-item:is(:hover, :focus-visible) .conversation-pin-button,
	.conversation-item:is(:hover, :focus-visible) .conversation-timestamp-badge,
	.conversation-item:is(:hover, :focus-visible) .conversation-parent-link {
		color: #686868;
	}

	.conversation-item:is(:hover, :focus-visible) .llampart-sidebar-select-checkbox:not(:checked) {
		border-color: #686868;
	}

	:global(.dark) .conversation-item:is(:hover, :focus-visible) .conversation-title,
	:global(.dark) .conversation-item:is(:hover, :focus-visible) :global(.conversation-action-button),
	:global(.dark) .conversation-item:is(:hover, :focus-visible) .conversation-pin-button,
	:global(.dark) .conversation-item:is(:hover, :focus-visible) .conversation-timestamp-badge,
	:global(.dark) .conversation-item:is(:hover, :focus-visible) .conversation-parent-link {
		color: #e8e8e8;
	}

	:global(.dark) .conversation-item:is(:hover, :focus-visible) .conversation-timestamp-badge,
	:global(.dark)
		.conversation-item:is(:hover, :focus-visible)
		.llampart-sidebar-select-checkbox:not(:checked) {
		border-color: #e8e8e8;
	}

	.conversation-title {
		display: -webkit-box;
		max-height: 2.75em;
		overflow: hidden;
		color: #686868;
		text-overflow: ellipsis;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	:global(.dark) .conversation-title {
		color: color-mix(in oklch, var(--sidebar-foreground) 70%, transparent);
	}

	.conversation-card-title-row {
		min-height: 4.5rem;
	}

	.conversation-card-actions :global(.conversation-action-button),
	.conversation-pin-button {
		color: #686868;
	}

	:global(.dark) .conversation-card-actions :global(.conversation-action-button),
	:global(.dark) .conversation-pin-button {
		color: var(--muted-foreground);
	}

	.conversation-item {
		.stop-button {
			:global(.stop-icon) {
				display: none;
			}

			:global(.loading-icon) {
				display: block;
			}
		}

		&:is(:hover) .stop-button {
			:global(.stop-icon) {
				display: block;
			}

			:global(.loading-icon) {
				display: none;
			}
		}
	}

	.conversation-timestamp-badge,
	.conversation-timestamp-badge :global(svg) {
		color: #686868;
		stroke: currentColor;
	}

	:global(.dark) .conversation-timestamp-badge,
	:global(.dark) .conversation-timestamp-badge :global(svg) {
		color: var(--muted-foreground);
		stroke: currentColor;
	}

	/* llampart-sidebar-conversation-radius-match-llm */
	:global(.conversation-item) {
		border-radius: 0.75rem !important;
		overflow: hidden !important;
	}

	:global(.conversation-item button) {
		border-radius: 0.75rem !important;
	}

	/* llampart-1-0-2-sidebar-card-dark-fill */
	:global(html.dark:not(.has-frosted-glass-theme) .conversation-item),
	:global(html.dark:not(.has-frosted-glass-theme) .conversation-item:is(:hover, :focus-visible)) {
		background-color: #262626 !important;
	}
	/* /llampart-1-0-2-sidebar-card-dark-fill */
</style>
