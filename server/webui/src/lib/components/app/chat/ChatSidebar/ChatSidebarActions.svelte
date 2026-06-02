<script lang="ts">
	import { Plus, Search, X } from '@lucide/svelte';
	import { KeyboardShortcutInfo } from '$lib/components/app';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { t } from '$lib/i18n';

	interface Props {
		handleMobileSidebarItemClick: () => void;
		isSearchModeActive: boolean;
		searchQuery: string;
		searchInputExternal?: boolean;
	}

	let {
		handleMobileSidebarItemClick,
		isSearchModeActive = $bindable(),
		searchQuery = $bindable(),
		searchInputExternal = false
	}: Props = $props();

	let searchInput: HTMLInputElement | null = $state(null);

	function handleSearchModeDeactivate() {
		isSearchModeActive = false;
		searchQuery = '';
	}

	$effect(() => {
		if (isSearchModeActive && !searchInputExternal) {
			searchInput?.focus();
		}
	});
</script>

<div class="my-1 space-y-1.5">
	{#if isSearchModeActive && !searchInputExternal}
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#333333] dark:text-foreground/80"
			/>

			<Input
				bind:ref={searchInput}
				bind:value={searchQuery}
				onkeydown={(e) => e.key === 'Escape' && handleSearchModeDeactivate()}
				placeholder={t('sidebar.searchConversationsPlaceholder')}
				class="h-10 rounded-lg border-border bg-background pr-9 pl-9 text-sm font-medium text-[#333333] shadow-none placeholder:text-[#333333] hover:bg-background focus-visible:border-input focus-visible:ring-0 focus-visible:ring-transparent dark:text-foreground/80 dark:placeholder:text-foreground/80"
			/>

			<X
				class="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 cursor-pointer text-[#333333] transition-colors hover:text-[#333333] dark:text-foreground/80 dark:hover:text-foreground/80"
				onclick={handleSearchModeDeactivate}
			/>
		</div>
	{:else}
		<Button
			class="llampart-sidebar-primary-action llampart-sidebar-new-chat-action h-10 w-full justify-between rounded-lg px-3 text-sm font-medium text-[#333333] shadow-none backdrop-blur-none! transition-colors hover:bg-transparent hover:text-[#333333] focus-visible:bg-transparent focus-visible:text-[#333333] active:bg-transparent dark:text-foreground/80 dark:hover:bg-transparent dark:hover:text-foreground/80 dark:focus-visible:bg-transparent dark:focus-visible:text-foreground/80 dark:active:bg-transparent hover:[&>kbd]:opacity-100"
			href="?new_chat=true#/"
			onclick={handleMobileSidebarItemClick}
			variant="ghost"
		>
			<div class="llampart-sidebar-primary-action-main flex items-center gap-3">
				<Plus class="llampart-sidebar-primary-action-icon h-4 w-4 shrink-0" />

				<span class="llampart-sidebar-primary-action-text">{t('sidebar.newChat')}</span>
			</div>

			<KeyboardShortcutInfo keys={['shift', 'cmd', 'o']} />
		</Button>

		{#if !searchInputExternal}
			<Button
				class="llampart-sidebar-primary-action llampart-sidebar-search-action h-10 w-full justify-between rounded-lg px-3 text-sm font-medium text-[#333333] shadow-none backdrop-blur-none! transition-colors hover:bg-transparent hover:text-[#333333] focus-visible:bg-transparent focus-visible:text-[#333333] active:bg-transparent dark:text-foreground/80 dark:hover:bg-transparent dark:hover:text-foreground/80 dark:focus-visible:bg-transparent dark:focus-visible:text-foreground/80 dark:active:bg-transparent hover:[&>kbd]:opacity-100"
				onclick={() => {
					isSearchModeActive = true;
				}}
				variant="ghost"
			>
				<div class="llampart-sidebar-primary-action-main flex items-center gap-3">
					<Search class="llampart-sidebar-primary-action-icon h-4 w-4 shrink-0" />

					<span class="llampart-sidebar-primary-action-text">{t('sidebar.search')}</span>
				</div>

				<KeyboardShortcutInfo keys={['cmd', 'k']} />
			</Button>
		{/if}
	{/if}
</div>
