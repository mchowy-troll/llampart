<script lang="ts">
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { TruncatedText } from '$lib/components/app/misc';
	import { toolsStore } from '$lib/stores/tools.svelte';
	import { permissionsStore } from '$lib/stores/permissions.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { ToolSource } from '$lib/enums';
	import { t } from '$lib/i18n';
	import type { OpenAIToolDefinition, ToolGroup } from '$lib/types';

	const TOOL_COLUMNS_COUNT = 1;
	const TOOL_GROUP_SOURCE_ORDER: Record<ToolSource, number> = {
		[ToolSource.BUILTIN]: 0,
		[ToolSource.MCP]: 1,
		[ToolSource.CUSTOM]: 2
	};

	let expandedGroups = $state<string[]>([]);
	let groups = $derived(getSortedToolGroups(toolsStore.toolGroups));
	let columns = $derived(distributeToolGroups(groups, TOOL_COLUMNS_COUNT));

	$effect(() => {
		const groupKeys = groups.map(getGroupKey);
		const missingGroupKeys = groupKeys.filter((groupKey) => !expandedGroups.includes(groupKey));

		if (missingGroupKeys.length > 0) {
			expandedGroups = [...expandedGroups, ...missingGroupKeys];
		}
	});

	function getGroupKey(group: ToolGroup): string {
		return `${group.source}:${group.label}`;
	}

	function getFavicon(group: ToolGroup): string | null {
		if (group.source !== ToolSource.MCP) return null;

		if (group.serverId) {
			return mcpStore.getServerFavicon(group.serverId);
		}

		for (const server of mcpStore.getServersSorted()) {
			if (mcpStore.getServerLabel(server) === group.label) {
				return mcpStore.getServerFavicon(server.id);
			}
		}

		return null;
	}

	function getToolCountLabel(count: number): string {
		return count === 1
			? t('settings.toolsCountOne')
			: t('settings.toolsCountMany').replace('{count}', String(count));
	}

	function toggleExpanded(key: string) {
		expandedGroups = expandedGroups.includes(key)
			? expandedGroups.filter((expandedGroupKey) => expandedGroupKey !== key)
			: [...expandedGroups, key];
	}

	function getSortedToolGroups(toolGroups: ToolGroup[]): ToolGroup[] {
		const mergedGroups: ToolGroup[] = [];

		for (const group of toolGroups) {
			const key = getGroupKey(group);
			const existing = mergedGroups.find((mergedGroup) => getGroupKey(mergedGroup) === key);

			if (!existing) {
				mergedGroups.push({
					...group,
					tools: getSortedTools(group.tools)
				});
				continue;
			}

			const mergedTools = [...existing.tools];

			for (const tool of group.tools) {
				const existingToolIndex = mergedTools.findIndex(
					(existingTool) => existingTool.function.name === tool.function.name
				);

				if (existingToolIndex === -1) {
					mergedTools.push(tool);
				} else {
					mergedTools[existingToolIndex] = tool;
				}
			}

			existing.tools = getSortedTools(mergedTools);
		}

		return mergedGroups.sort(compareToolGroups);
	}

	function getSortedTools(tools: OpenAIToolDefinition[]): OpenAIToolDefinition[] {
		return [...tools].sort((left, right) =>
			compareToolNames(left.function.name, right.function.name)
		);
	}

	function compareToolGroups(left: ToolGroup, right: ToolGroup): number {
		const leftSourceOrder = TOOL_GROUP_SOURCE_ORDER[left.source] ?? 99;
		const rightSourceOrder = TOOL_GROUP_SOURCE_ORDER[right.source] ?? 99;
		if (leftSourceOrder !== rightSourceOrder) return leftSourceOrder - rightSourceOrder;

		return left.label.localeCompare(right.label, undefined, {
			numeric: true,
			sensitivity: 'base'
		});
	}

	function compareToolNames(left: string, right: string): number {
		const leftIsServerInfo = left.startsWith('server_info');
		const rightIsServerInfo = right.startsWith('server_info');

		if (leftIsServerInfo !== rightIsServerInfo) {
			return leftIsServerInfo ? 1 : -1;
		}

		return left.localeCompare(right, undefined, {
			numeric: true,
			sensitivity: 'base'
		});
	}

	function distributeToolGroups(toolGroups: ToolGroup[], columnCount: number): ToolGroup[][] {
		const result: ToolGroup[][] = Array.from({ length: columnCount }, () => []);
		const weights = Array.from({ length: columnCount }, () => 0);

		for (const group of toolGroups) {
			const targetColumn = weights.indexOf(Math.min(...weights));
			result[targetColumn].push(group);
			weights[targetColumn] += getGroupWeight(group);
		}

		return result;
	}

	function getGroupWeight(group: ToolGroup): number {
		return group.tools.length + 3;
	}
</script>

{#if toolsStore.loading && groups.length === 0}
	<p class="px-1 py-2 text-sm text-muted-foreground">
		{t('settings.toolsLoading')}
	</p>
{:else if groups.length === 0}
	<div class="px-1 py-2">
		<h4 class="mb-2 text-sm font-semibold">{t('settings.groupToolsEmptyTitle')}</h4>
		<p class="text-sm text-muted-foreground">
			{toolsStore.isToolsEndpointUnreachable
				? t('settings.toolsEndpointUnavailable')
				: t('settings.toolsNoToolsAvailable')}
		</p>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1">
		{#each columns as column, columnIndex (columnIndex)}
			<div class="min-w-0 space-y-3">
				{#each column as group (getGroupKey(group))}
					{@const groupKey = getGroupKey(group)}
					{@const isExpanded = expandedGroups.includes(groupKey)}
					{@const favicon = getFavicon(group)}

					<Collapsible.Root open={isExpanded} onOpenChange={() => toggleExpanded(groupKey)}>
						<section class="min-w-0 rounded-2xl border border-border bg-background p-3">
							<Collapsible.Trigger
								class="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-muted/40"
							>
								{#if isExpanded}
									<ChevronDown class="h-4 w-4 shrink-0" />
								{:else}
									<ChevronRight class="h-4 w-4 shrink-0" />
								{/if}

								<span class="inline-flex min-w-0 items-center gap-2 font-semibold">
									{#if favicon}
										<img
											src={favicon}
											alt=""
											class="h-4 w-4 shrink-0 rounded-sm"
											onerror={(event) => {
												(event.currentTarget as HTMLImageElement).style.display = 'none';
											}}
										/>
									{/if}

									<span class="truncate">{group.label}</span>
								</span>

								<span class="ml-auto shrink-0 text-xs text-muted-foreground">
									{getToolCountLabel(group.tools.length)}
								</span>
							</Collapsible.Trigger>

							<Collapsible.Content>
								<div class="mt-2 border-t border-border/40 pt-2">
									<div
										class="grid grid-cols-[minmax(0,1fr)_4rem_5rem] items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
									>
										<span class="min-w-0">{t('settings.toolsColumnTool')}</span>
										<span class="text-center leading-tight">{t('settings.toolsColumnEnabled')}</span
										>
										<span class="text-center leading-tight"
											>{t('settings.toolsColumnAlwaysAllow')}</span
										>
									</div>

									{#each group.tools as tool (tool.function.name)}
										{@const toolName = tool.function.name}
										{@const isEnabled = toolsStore.isToolEnabled(toolName)}
										{@const permissionKey = toolsStore.getPermissionKey(toolName)}
										{@const isAlwaysAllowed = permissionKey
											? permissionsStore.hasTool(permissionKey)
											: false}

										<div
											class="grid grid-cols-[minmax(0,1fr)_4rem_5rem] items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/40"
										>
											<TruncatedText text={toolName} class="min-w-0 truncate" showTooltip={true} />

											<div class="flex justify-center">
												<Checkbox
													checked={isEnabled}
													onCheckedChange={() => toolsStore.toggleTool(toolName)}
													class="h-4 w-4"
												/>
											</div>

											<div class="flex justify-center">
												<Checkbox
													checked={isAlwaysAllowed}
													onCheckedChange={() => {
														if (!permissionKey) return;
														if (isAlwaysAllowed) {
															permissionsStore.revokeTool(permissionKey);
														} else {
															permissionsStore.allowTool(permissionKey);
														}
													}}
													class="h-4 w-4"
												/>
											</div>
										</div>
									{/each}
								</div>
							</Collapsible.Content>
						</section>
					</Collapsible.Root>
				{/each}
			</div>
		{/each}
	</div>
{/if}
