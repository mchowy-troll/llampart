<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Trash2, Pencil, Plus, Search, Settings, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { ChatSidebarConversationItem, DialogConfirmation } from '$lib/components/app';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import Label from '$lib/components/ui/label/label.svelte';
	import ScrollArea from '$lib/components/ui/scroll-area/scroll-area.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import Input from '$lib/components/ui/input/input.svelte';
	import {
		conversationsStore,
		conversations,
		buildConversationTree
	} from '$lib/stores/conversations.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { getPreviewText } from '$lib/utils';
	import { getChatSettingsDialogContext } from '$lib/contexts';
	import { getInterfaceLanguage, t } from '$lib/i18n';

	const chatSettingsDialog = getChatSettingsDialogContext();

	type ConversationCountVariant = 'one' | 'few' | 'many';
	type CountTranslationKeys = {
		one: string;
		few?: string;
		many: string;
	};

	function getConversationCountVariant(count: number): ConversationCountVariant {
		const language = getInterfaceLanguage();

		if (language === 'pl') {
			const mod10 = count % 10;
			const mod100 = count % 100;

			if (count === 1) return 'one';
			if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';

			return 'many';
		}

		return count === 1 ? 'one' : 'many';
	}

	function formatCountTranslation(keys: CountTranslationKeys, count: number) {
		const variant = getConversationCountVariant(count);
		const key =
			variant === 'one' ? keys.one : variant === 'few' ? (keys.few ?? keys.many) : keys.many;

		return t(key).replace('{count}', String(count));
	}

	let currentChatId = $derived(page.params.id);
	let isSearchModeActive = $state(false);
	let searchQuery = $state('');
	let showDeleteDialog = $state(false);
	let showBulkDeleteDialog = $state(false);
	let deleteWithForks = $state(false);
	let selectedConversationIds = $state<string[]>([]);
	let bulkDeleteTargetIds = $state<string[]>([]);
	let bulkDeleteMode = $state<'selected' | 'all'>('all');
	let showEditDialog = $state(false);
	let selectedConversation = $state<DatabaseConversation | null>(null);
	let editedName = $state('');
	let sidebarSearchInput: HTMLInputElement | null = $state(null);
	let sidebarViewportWidth = $state(0);
	let isCompactSidebar = $derived(Boolean(config().compactSidebar));
	let isConversationGridSingleColumn = $derived(
		isCompactSidebar ||
			(sidebarViewportWidth > 0 &&
				typeof window !== 'undefined' &&
				window.screen.width > 0 &&
				sidebarViewportWidth <= window.screen.width * (2 / 3))
	);
	let hasMeasuredConversationGridViewport = $derived(
		sidebarViewportWidth > 0 && typeof window !== 'undefined' && window.screen.width > 0
	);
	let selectedConversationNamePreview = $derived.by(() =>
		selectedConversation ? getPreviewText(selectedConversation.name) : ''
	);

	let deletableConversationIds = $derived.by(() =>
		conversations()
			.filter((conversation) => !conversation.pinned)
			.map((conversation) => conversation.id)
	);
	let hasDeletableConversations = $derived(deletableConversationIds.length > 0);
	let hasSelectedConversations = $derived(selectedConversationIds.length > 0);
	let bulkDeleteTargetCount = $derived(bulkDeleteTargetIds.length);
	let bulkDeleteDeletesAll = $derived(bulkDeleteMode === 'all');
	let bulkDeleteDialogTitle = $derived.by(() => {
		if (bulkDeleteDeletesAll) return t('sidebar.deleteAllConversationsTitle');

		return bulkDeleteTargetCount === 1
			? t('sidebar.deleteSelectedConversationTitle')
			: t('sidebar.deleteSelectedConversationsTitle');
	});
	let bulkDeleteDialogDescription = $derived.by(() => {
		if (bulkDeleteDeletesAll) {
			return formatCountTranslation(
				{
					one: 'sidebar.deleteAllConversationsDescriptionOne',
					few: 'sidebar.deleteAllConversationsDescriptionFew',
					many: 'sidebar.deleteAllConversationsDescriptionMany'
				},
				bulkDeleteTargetCount
			);
		}

		return formatCountTranslation(
			{
				one: 'sidebar.deleteSelectedConversationDescriptionOne',
				few: 'sidebar.deleteSelectedConversationsDescriptionFew',
				many: 'sidebar.deleteSelectedConversationsDescriptionMany'
			},
			bulkDeleteTargetCount
		);
	});
	let bulkDeleteConfirmText = $derived.by(() =>
		bulkDeleteDeletesAll
			? t('sidebar.deleteAllConversationsConfirmText')
			: t('sidebar.deleteSelectedConversationsConfirmText')
	);

	let filteredConversations = $derived.by(() => {
		if (searchQuery.trim().length > 0) {
			return conversations().filter((conversation: { name: string }) =>
				conversation.name.toLowerCase().includes(searchQuery.toLowerCase())
			);
		}

		return conversations();
	});

	let conversationTree = $derived(buildConversationTree(filteredConversations));

	$effect(() => {
		const deletableConversationIdsSet = new Set(deletableConversationIds);
		const availableSelectedIds = selectedConversationIds.filter((id) =>
			deletableConversationIdsSet.has(id)
		);
		const availableTargetIds = bulkDeleteTargetIds.filter((id) =>
			deletableConversationIdsSet.has(id)
		);

		if (availableSelectedIds.length !== selectedConversationIds.length) {
			selectedConversationIds = availableSelectedIds;
		}

		if (availableTargetIds.length !== bulkDeleteTargetIds.length) {
			bulkDeleteTargetIds = availableTargetIds;
		}
	});

	let selectedConversationHasDescendants = $derived.by(() => {
		if (!selectedConversation) return false;

		const allConvs = conversations();
		const queue = [selectedConversation.id];

		while (queue.length > 0) {
			const parentId = queue.pop()!;

			for (const c of allConvs) {
				if (c.forkedFromConversationId === parentId) return true;
			}
		}

		return false;
	});

	async function handleEditConversation(id: string) {
		const conversation = conversations().find((conv) => conv.id === id);
		if (conversation) {
			selectedConversation = conversation;
			editedName = conversation.name;
			showEditDialog = true;
		}
	}

	function setSelectedConversationChecked(id: string, checked: boolean) {
		if (checked && !deletableConversationIds.includes(id)) return;

		selectedConversationIds = checked
			? [...new Set([...selectedConversationIds, id])]
			: selectedConversationIds.filter((selectedId) => selectedId !== id);
	}

	async function handleConversationPinnedChange(id: string, pinned: boolean) {
		try {
			await conversationsStore.setConversationPinned(id, pinned);

			if (pinned) {
				selectedConversationIds = selectedConversationIds.filter((selectedId) => selectedId !== id);
				bulkDeleteTargetIds = bulkDeleteTargetIds.filter((targetId) => targetId !== id);
			}
		} catch (error) {
			console.error('Failed to update pinned conversation:', error);
			toast.error(t('common.unknownError'));
		}
	}

	function handleSearchModeDeactivate() {
		isSearchModeActive = false;
		searchQuery = '';
	}

	$effect(() => {
		if (isSearchModeActive) {
			sidebarSearchInput?.focus();
		}
	});

	// llampart-sidebar-search-hide-layout-trigger
	$effect(() => {
		if (typeof document === 'undefined') return;

		document.documentElement.classList.toggle('llampart-sidebar-search-active', isSearchModeActive);

		return () => {
			document.documentElement.classList.remove('llampart-sidebar-search-active');
		};
	});

	// llampart-compact-sidebar-layout-trigger
	$effect(() => {
		if (typeof document === 'undefined') return;

		document.documentElement.classList.toggle('llampart-compact-sidebar', isCompactSidebar);

		return () => {
			document.documentElement.classList.remove('llampart-compact-sidebar');
		};
	});

	function handleBulkDeleteClick() {
		const availableConversationIds = deletableConversationIds;
		if (availableConversationIds.length === 0) return;

		const availableConversationIdsSet = new Set(availableConversationIds);
		const selectedIds = selectedConversationIds.filter((id) => availableConversationIdsSet.has(id));

		bulkDeleteMode = selectedIds.length > 0 ? 'selected' : 'all';
		bulkDeleteTargetIds = selectedIds.length > 0 ? selectedIds : availableConversationIds;
		showBulkDeleteDialog = true;
	}

	async function handleConfirmBulkDelete() {
		const targetIds = [...bulkDeleteTargetIds];
		const mode = bulkDeleteMode;
		showBulkDeleteDialog = false;

		if (targetIds.length === 0) {
			return;
		}

		try {
			if (mode === 'selected') {
				const deletedCount = await conversationsStore.deleteConversations(targetIds);
				selectedConversationIds = selectedConversationIds.filter((id) => !targetIds.includes(id));
				bulkDeleteTargetIds = [];

				toast.success(
					formatCountTranslation(
						{
							one: 'sidebar.deletedSelectedConversation',
							few: 'sidebar.deletedSelectedConversationsFew',
							many: 'sidebar.deletedSelectedConversations'
						},
						deletedCount
					)
				);
				return;
			}

			const deletedCount = await conversationsStore.deleteConversations(targetIds);
			selectedConversationIds = [];
			bulkDeleteTargetIds = [];
			toast.success(
				formatCountTranslation(
					{
						one: 'sidebar.deletedAllConversation',
						few: 'sidebar.deletedAllConversationsFew',
						many: 'sidebar.deletedAllConversations'
					},
					deletedCount
				)
			);
		} catch (error) {
			console.error('Failed to delete conversations:', error);
			toast.error(t('sidebar.failedToDeleteConversations'), {
				description: error instanceof Error ? error.message : t('common.unknownError')
			});
		}
	}

	function handleConfirmDelete() {
		if (selectedConversation) {
			const convId = selectedConversation.id;
			const withForks = deleteWithForks;
			showDeleteDialog = false;

			setTimeout(async () => {
				try {
					await conversationsStore.deleteConversation(convId, {
						deleteWithForks: withForks
					});
					toast.success(t('sidebar.deletedConversation'));
				} catch (error) {
					console.error('Failed to delete conversation:', error);
					toast.error(t('sidebar.failedToDeleteConversations'), {
						description: error instanceof Error ? error.message : t('common.unknownError')
					});
				}
			}, 100);
		}
	}

	function handleConfirmEdit() {
		if (!editedName.trim() || !selectedConversation) return;

		showEditDialog = false;

		conversationsStore.updateConversationName(selectedConversation.id, editedName);
		selectedConversation = null;
	}

	export function activateSearchMode() {
		isSearchModeActive = true;
	}

	export function editActiveConversation() {
		if (currentChatId) {
			const activeConversation = filteredConversations.find((conv) => conv.id === currentChatId);

			if (activeConversation) {
				const event = new CustomEvent('edit-active-conversation', {
					detail: { conversationId: currentChatId }
				});
				document.dispatchEvent(event);
			}
		}
	}

	async function selectConversation(id: string) {
		if (isSearchModeActive) {
			isSearchModeActive = false;
			searchQuery = '';
		}

		await goto(`#/chat/${id}`);
	}

	function handleStopGeneration(id: string) {
		chatStore.stopGenerationForChat(id);
	}

	function handleSettingsClick() {
		chatSettingsDialog.open();
	}
</script>

<svelte:window bind:innerWidth={sidebarViewportWidth} />

<div class="flex h-[100vh] flex-col">
	<div
		class="llampart-sidebar-conversations-frame mx-4 mt-3 mb-4 flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-background p-4 shadow-none"
	>
		<div
			class="llampart-sidebar-frame-header mb-3 grid min-h-12 -translate-y-4 grid-cols-1 items-center"
		>
			<h2 class="justify-self-center text-center text-sm font-semibold text-foreground">
				{t('sidebar.conversations')}
			</h2>
		</div>

		<div class="llampart-sidebar-header-separator llampart-sidebar-title-separator"></div>

		{#if isSearchModeActive}
			<div
				class="llampart-sidebar-header-actions llampart-sidebar-action-band flex h-[3.25rem] items-center"
			>
				<div
					class="relative w-full min-w-0"
					data-llampart-sidebar-search-input="llampart-sidebar-search-input-action-row"
				>
					<Search
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#333333]"
					/>

					<Input
						bind:ref={sidebarSearchInput}
						bind:value={searchQuery}
						onkeydown={(e) => e.key === 'Escape' && handleSearchModeDeactivate()}
						placeholder={t('sidebar.searchConversationsPlaceholder')}
						class="llampart-sidebar-action-search-input h-10 rounded-lg border-border bg-background pr-9 pl-9 text-sm font-medium text-[#333333] shadow-none placeholder:text-[#333333] hover:bg-background focus-visible:border-input focus-visible:ring-0 focus-visible:ring-transparent"
					/>

					<button
						aria-label={t('common.close')}
						class="absolute top-1/2 right-3 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-[#333333] transition-colors hover:text-[#333333] focus-visible:outline-none"
						onclick={handleSearchModeDeactivate}
						type="button"
					>
						<X class="h-4 w-4" />
					</button>
				</div>
			</div>
		{:else}
			<div
				class="llampart-sidebar-header-actions llampart-sidebar-action-band flex h-[3.25rem] items-center justify-between gap-3"
			>
				<Button
					aria-label={t('sidebar.newChat')}
					class="llampart-sidebar-primary-action llampart-sidebar-new-chat-action -ml-1 h-10 justify-start gap-2 rounded-lg pr-3 pl-0 text-sm font-medium text-[#333333] shadow-none backdrop-blur-none! transition-colors hover:bg-transparent hover:text-[#333333] focus-visible:bg-transparent focus-visible:text-[#333333] active:bg-transparent"
					href="?new_chat=true#/"
					variant="ghost"
				>
					<Plus class="llampart-sidebar-primary-action-icon h-4 w-4 shrink-0" />

					<span class="llampart-sidebar-primary-action-text">{t('sidebar.newChat')}</span>
				</Button>

				<Button
					aria-label={t('sidebar.search')}
					class="llampart-sidebar-primary-action llampart-sidebar-search-action h-10 justify-end gap-2 rounded-lg px-3 text-sm font-medium text-[#333333] shadow-none backdrop-blur-none! transition-colors hover:bg-transparent hover:text-[#333333] focus-visible:bg-transparent focus-visible:text-[#333333] active:bg-transparent"
					onclick={() => {
						isSearchModeActive = true;
					}}
					variant="ghost"
				>
					<span class="llampart-sidebar-primary-action-text">{t('sidebar.search')}</span>

					<Search class="llampart-sidebar-primary-action-icon h-4 w-4 shrink-0" />
				</Button>
			</div>
		{/if}

		<div class="llampart-sidebar-header-separator llampart-sidebar-actions-separator"></div>

		<ScrollArea class="min-h-0 flex-1">
			<Sidebar.Group class="m-0 space-y-2 p-0">
				{#if filteredConversations.length > 0 && isSearchModeActive}
					<Sidebar.GroupLabel class="px-0 text-sm font-semibold text-foreground/80">
						{t('sidebar.searchResults')}
					</Sidebar.GroupLabel>
				{/if}

				<Sidebar.GroupContent>
					<Sidebar.Menu
						class={[
							'llampart-conversation-grid-menu',
							hasMeasuredConversationGridViewport
								? isConversationGridSingleColumn
									? 'llampart-conversation-grid-menu-single-column'
									: 'llampart-conversation-grid-menu-two-column'
								: ''
						]
							.filter(Boolean)
							.join(' ')}
					>
						{#each conversationTree as { conversation, depth } (conversation.id)}
							<Sidebar.MenuItem class="llampart-conversation-grid-item p-0">
								<ChatSidebarConversationItem
									conversation={{
										id: conversation.id,
										name: conversation.name,
										lastModified: conversation.lastModified,
										currNode: conversation.currNode,
										forkedFromConversationId: conversation.forkedFromConversationId,
										pinned: conversation.pinned
									}}
									{depth}
									isActive={currentChatId === conversation.id}
									selectionChecked={selectedConversationIds.includes(conversation.id)}
									selectionAriaLabel={t('sidebar.selectConversation').replace(
										'{name}',
										getPreviewText(conversation.name)
									)}
									onSelectionChange={setSelectedConversationChecked}
									onPinnedChange={handleConversationPinnedChange}
									onSelect={selectConversation}
									onEdit={handleEditConversation}
									onStop={handleStopGeneration}
								/>
							</Sidebar.MenuItem>
						{/each}

						{#if conversationTree.length === 0}
							<div class="llampart-sidebar-empty-state px-2 py-4 text-center">
								<p class="mb-4 p-4 text-sm text-muted-foreground">
									{searchQuery.length > 0
										? t('sidebar.noResultsFound')
										: isSearchModeActive
											? t('sidebar.startTypingToSeeResults')
											: t('sidebar.noConversationsYet')}
								</p>
							</div>
						{/if}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</ScrollArea>

		<div class="llampart-sidebar-frame-footer mt-4 flex items-center justify-between">
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						aria-label={t('sidebar.settings')}
						class="llampart-sidebar-settings-button flex h-7 w-7 min-w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
						onclick={handleSettingsClick}
						variant="ghost"
					>
						<span
							class="llampart-sidebar-settings-icon pointer-events-none flex items-center justify-center"
						>
							<Settings class="h-[18px] w-[18px]" />
						</span>
					</Button>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>{t('sidebar.settings')}</p>
				</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						aria-label={hasSelectedConversations
							? t('sidebar.deleteSelectedConversationsButton')
							: t('sidebar.deleteAllConversationsButton')}
						class="llampart-sidebar-delete-button flex h-7 w-7 min-w-7 items-center justify-center rounded-md p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none disabled:opacity-100"
						disabled={!hasDeletableConversations}
						onclick={handleBulkDeleteClick}
						variant="ghost"
					>
						<span
							class="llampart-sidebar-delete-icon pointer-events-none flex items-center justify-center"
						>
							<Trash2 class="h-[18px] w-[18px]" />
						</span>
					</Button>
				</Tooltip.Trigger>

				<Tooltip.Content>
					<p>
						{hasSelectedConversations
							? t('sidebar.deleteSelectedConversationsButton')
							: t('sidebar.deleteAllConversationsButton')}
					</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</div>
	</div>
</div>

<DialogConfirmation
	bind:open={showBulkDeleteDialog}
	title={bulkDeleteDialogTitle}
	description={bulkDeleteDialogDescription}
	confirmText={bulkDeleteConfirmText}
	cancelText={t('common.cancel')}
	variant="destructive"
	icon={Trash2}
	onConfirm={handleConfirmBulkDelete}
	onCancel={() => {
		showBulkDeleteDialog = false;
		bulkDeleteTargetIds = [];
	}}
/>

<DialogConfirmation
	bind:open={showDeleteDialog}
	title={t('sidebar.deleteConversationTitle')}
	description={selectedConversation
		? t('sidebar.deleteConversationDescription').replace('{name}', selectedConversationNamePreview)
		: ''}
	confirmText={t('common.delete')}
	cancelText={t('common.cancel')}
	variant="destructive"
	icon={Trash2}
	onConfirm={handleConfirmDelete}
	onCancel={() => {
		showDeleteDialog = false;
		selectedConversation = null;
	}}
>
	{#if selectedConversationHasDescendants}
		<div class="flex items-center gap-2 py-2">
			<Checkbox id="delete-with-forks" bind:checked={deleteWithForks} />

			<Label for="delete-with-forks" class="text-sm">
				{t('sidebar.alsoDeleteForkedConversations')}
			</Label>
		</div>
	{/if}
</DialogConfirmation>

<DialogConfirmation
	bind:open={showEditDialog}
	title={t('sidebar.editConversationNameTitle')}
	description=""
	confirmText={t('common.save')}
	cancelText={t('common.cancel')}
	icon={Pencil}
	onConfirm={handleConfirmEdit}
	onCancel={() => {
		showEditDialog = false;
		selectedConversation = null;
	}}
	onKeydown={(e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopImmediatePropagation();
			handleConfirmEdit();
		}
	}}
>
	<Input
		class="text-foreground"
		placeholder={t('sidebar.enterNewConversationName')}
		type="text"
		bind:value={editedName}
	/>
</DialogConfirmation>

<style>
	/* llampart-sidebar-search-hide-layout-trigger-css */
	:global(
		html.llampart-sidebar-search-active [data-sidebar='trigger'].llampart-sidebar-v-trigger-open
	) {
		display: none !important;
		pointer-events: none !important;
	}

	/* llampart-sidebar-header-separator-visible */
	:global(.llampart-sidebar-header-separator) {
		display: block !important;
		flex: 0 0 1px !important;
		width: 100% !important;
		height: 1px !important;
		margin: 0 !important;
		padding: 0 !important;
		background: var(--llampart-sidebar-header-separator-background) !important;
		border: 0 !important;
		box-shadow: none !important;
	}

	:global(.llampart-sidebar-title-separator) {
		margin: -1.75rem 0 0 0 !important;
	}

	:global(.llampart-sidebar-actions-separator) {
		margin: 0 0 1rem 0 !important;
	}

	/* llampart-sidebar-container-query-columns */
	:global(.llampart-sidebar-conversations-frame) {
		container-type: inline-size;
	}

	:global(.llampart-conversation-grid-menu) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 1rem;
	}

	:global(.llampart-conversation-grid-item) {
		min-width: 0;
	}

	/* llampart-sidebar-empty-state-centered */
	.llampart-sidebar-empty-state {
		grid-column: 1 / -1;
		display: flex;
		width: 100%;
		justify-content: center;
	}

	.llampart-sidebar-empty-state p {
		margin-right: auto;
		margin-left: auto;
	}

	@media (min-width: 1024px) {
		:global(.llampart-conversation-grid-menu) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* llampart-sidebar-viewport-grid-columns */
	:global(.llampart-conversation-grid-menu.llampart-conversation-grid-menu-two-column) {
		grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
	}

	:global(.llampart-conversation-grid-menu.llampart-conversation-grid-menu-single-column) {
		grid-template-columns: minmax(0, 1fr) !important;
	}
	/* /llampart-sidebar-viewport-grid-columns */

	:global(.llampart-sidebar-select-checkbox) {
		appearance: none;
		display: inline-grid;
		place-content: center;
		border: 1px solid var(--muted-foreground);
		border-radius: 0.25rem;
		background-color: transparent;
		background-position: center;
		background-repeat: no-repeat;
		background-size: 0.75rem 0.75rem;
		transition:
			background-color 150ms ease-out,
			border-color 150ms ease-out,
			box-shadow 150ms ease-out;
	}

	:global(.llampart-sidebar-select-checkbox:hover) {
		border-color: var(--muted-foreground);
		background-color: color-mix(in oklch, var(--foreground) 10%, transparent);
	}

	:global(.llampart-sidebar-select-checkbox:focus-visible) {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in oklch, var(--sidebar-ring) 32%, transparent);
		border-color: var(--muted-foreground);
		background-color: color-mix(in oklch, var(--foreground) 10%, transparent);
	}

	:global(.llampart-sidebar-select-checkbox:checked),
	:global(.llampart-sidebar-select-checkbox:checked:hover),
	:global(.llampart-sidebar-select-checkbox:checked:focus-visible) {
		border-color: var(--llampart-sidebar-selection-accent);
		background-color: var(--llampart-sidebar-selection-accent);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M3.5 8.5 6.5 11.5 12.5 4.5' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	}

	:global(.llampart-sidebar-conversations-frame) {
		border-width: 1px;
		border-style: solid;
		border-color: var(--llampart-sidebar-conversations-frame-border-color);
		box-shadow: none;
	}

	:global(.llampart-sidebar-frame-header button) {
		color: var(--llampart-sidebar-action-foreground);
	}

	:global(.llampart-sidebar-delete-button) {
		border: 0;
		background-color: transparent;
		box-shadow: none;
		color: var(--llampart-sidebar-action-foreground);
		transition: color 150ms ease-out;
	}

	:global(.llampart-sidebar-delete-button:hover),
	:global(.llampart-sidebar-delete-button:focus-visible) {
		background-color: transparent;
		box-shadow: none;
		color: var(--llampart-sidebar-action-hover-foreground);
	}

	:global(.llampart-sidebar-delete-button:active) {
		background-color: transparent;
		box-shadow: none;
	}

	:global(.llampart-sidebar-delete-button:disabled),
	:global(.llampart-sidebar-delete-button:disabled:hover),
	:global(.llampart-sidebar-delete-button:disabled:focus-visible) {
		background-color: transparent;
		box-shadow: none;
		color: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
	}

	:global(.llampart-sidebar-delete-icon) {
		opacity: 1;
		transform: none;
		transition: none;
	}

	/* llampart sidebar polish: icon action hover parity */
	:global(.llampart-sidebar-delete-button) {
		border: 0;
		background-color: transparent;
		box-shadow: none;
		color: var(--llampart-sidebar-conversation-control-foreground);
		transition:
			background-color 150ms ease-out,
			color 150ms ease-out;
	}

	:global(.llampart-sidebar-delete-button:hover:not(:disabled)),
	:global(.llampart-sidebar-delete-button:focus-visible:not(:disabled)) {
		background-color: var(--accent);
		box-shadow: none;
		color: var(--accent-foreground);
	}

	:global(.llampart-sidebar-delete-button:disabled),
	:global(.llampart-sidebar-delete-button:disabled:hover),
	:global(.llampart-sidebar-delete-button:disabled:focus-visible) {
		background: transparent;
		box-shadow: none;
		color: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
	}
</style>
