<script lang="ts">
	import { ChevronDown, ChevronRight, Info, Loader2, PencilRuler } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		COMPOSER_TOOLS_SUBMENU_GROUP_ROW_CLASSES,
		COMPOSER_TOOLS_SUBMENU_ITEM_ROW_CLASSES,
		COMPOSER_TOOLS_SUBMENU_LIST_MAX_HEIGHT,
		COMPOSER_TOOLS_SUBMENU_PANEL_CLASSES
	} from '$lib/constants';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { toolsStore } from '$lib/stores/tools.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { ToolSource } from '$lib/enums';
	import { t } from '$lib/i18n';
	import type { ToolGroup } from '$lib/types';

	interface Props {
		onSubmenuIntent?: () => void;
	}

	let { onSubmenuIntent }: Props = $props();

	let expandedGroups = new SvelteSet<string>();

	let activeGroups = $derived(
		toolsStore.toolGroups.filter(
			(group) =>
				group.source !== ToolSource.MCP ||
				!group.serverId ||
				conversationsStore.isMcpServerEnabledForChat(group.serverId)
		)
	);
	let totalToolCount = $derived(
		activeGroups.reduce((count, group) => count + group.tools.length, 0)
	);

	function getGroupKey(group: ToolGroup): string {
		return group.source === ToolSource.MCP ? `mcp:${group.serverId ?? group.label}` : group.source;
	}

	function isGroupExpanded(group: ToolGroup): boolean {
		return expandedGroups.has(getGroupKey(group));
	}

	function toggleGroupExpanded(group: ToolGroup): void {
		const key = getGroupKey(group);
		if (expandedGroups.has(key)) {
			expandedGroups.delete(key);
		} else {
			expandedGroups.add(key);
		}
	}

	function getEnabledToolCount(group: ToolGroup): number {
		return group.tools.filter((entry) => toolsStore.isToolEnabled(entry.key)).length;
	}

	function getFavicon(group: ToolGroup): string | null {
		if (group.source !== ToolSource.MCP || !group.serverId) return null;
		return mcpStore.getServerFavicon(group.serverId);
	}

	function handleSubmenuIntent(): void {
		onSubmenuIntent?.();

		if (toolsStore.builtinTools.length === 0 && !toolsStore.loading) {
			void toolsStore.fetchBuiltinTools();
		}

		mcpStore.runHealthChecksForServers(
			mcpStore.getServersSorted().filter((server) => server.enabled)
		);
	}
</script>

<DropdownMenu.Sub onOpenChange={(open) => open && handleSubmenuIntent()}>
	<DropdownMenu.SubTrigger
		class="llampart-composer-tools-submenu-trigger flex w-full cursor-pointer items-center gap-2"
		onpointerenter={handleSubmenuIntent}
		onfocus={handleSubmenuIntent}
		onclick={handleSubmenuIntent}
	>
		<PencilRuler class="h-4 w-4" />
		<span>{t('settings.groupToolsEmptyTitle')}</span>
	</DropdownMenu.SubTrigger>

	<DropdownMenu.SubContent class={COMPOSER_TOOLS_SUBMENU_PANEL_CLASSES}>
		{#if totalToolCount === 0}
			{#if toolsStore.loading}
				<div class="px-3 py-4 text-center text-sm text-muted-foreground">
					<Loader2 class="mx-auto mb-1 h-4 w-4 animate-spin" />
					{t('settings.toolsLoading')}
				</div>
			{:else if toolsStore.isToolsEndpointUnreachable}
				<div class="flex gap-2 px-3 py-4 text-sm text-muted-foreground">
					<Info class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{t('settings.toolsEndpointUnavailable')}</span>
				</div>
			{:else}
				<div class="px-3 py-4 text-center text-sm text-muted-foreground">
					{t('settings.toolsNoToolsAvailable')}
				</div>
			{/if}
		{:else}
			<div
				class="llampart-tools-group-list {COMPOSER_TOOLS_SUBMENU_LIST_MAX_HEIGHT} overflow-y-auto"
			>
				{#each activeGroups as group (getGroupKey(group))}
					{@const expanded = isGroupExpanded(group)}
					{@const checked = toolsStore.isGroupFullyEnabled(group)}
					{@const favicon = getFavicon(group)}

					<Collapsible.Root open={expanded} onOpenChange={() => toggleGroupExpanded(group)}>
						<div class="flex items-center gap-1">
							<Collapsible.Trigger class={COMPOSER_TOOLS_SUBMENU_GROUP_ROW_CLASSES}>
								{#if expanded}
									<ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
								{:else}
									<ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
								{/if}

								{#if favicon}
									<img
										src={favicon}
										alt=""
										class="h-4 w-4 shrink-0 rounded-sm"
										onerror={(e) => {
											(e.currentTarget as HTMLImageElement).style.display = 'none';
										}}
									/>
								{/if}

								<span class="min-w-0 flex-1 truncate">{group.label}</span>
								<span class="shrink-0 text-xs text-muted-foreground">
									{getEnabledToolCount(group)}/{group.tools.length}
								</span>
							</Collapsible.Trigger>

							<Checkbox
								{checked}
								onCheckedChange={() => toolsStore.toggleGroup(group)}
								class="mr-2 h-4 w-4 shrink-0"
							/>
						</div>

						<Collapsible.Content>
							<div class="ml-5 flex flex-col gap-0.5 border-l border-border/50 pl-2">
								{#each group.tools as entry (entry.key)}
									{@const enabled = toolsStore.isToolEnabled(entry.key)}

									<div class={COMPOSER_TOOLS_SUBMENU_ITEM_ROW_CLASSES}>
										<Checkbox
											checked={enabled}
											onCheckedChange={() => toolsStore.toggleTool(entry.key)}
											class="h-4 w-4 shrink-0"
										/>

										<button
											type="button"
											class="min-w-0 flex-1 truncate text-left text-sm"
											onclick={() => toolsStore.toggleTool(entry.key)}
										>
											{entry.definition.function.name}
										</button>
									</div>
								{/each}
							</div>
						</Collapsible.Content>
					</Collapsible.Root>
				{/each}
			</div>
		{/if}
	</DropdownMenu.SubContent>
</DropdownMenu.Sub>
