<script lang="ts">
	import { Wrench, Database, MessageSquare, FileText, Sparkles, ListChecks } from '@lucide/svelte';
	import type { MCPCapabilitiesInfo } from '$lib/types';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		capabilities?: MCPCapabilitiesInfo;
	}

	let { capabilities }: Props = $props();
</script>

{#if capabilities}
	{#if capabilities.server.tools}
		<Badge variant="outline" class="h-5 gap-1 bg-green-50 px-1.5 text-[10px]">
			<Wrench class="h-3 w-3 text-green-600" />

			Tools
		</Badge>
	{/if}

	{#if capabilities.server.resources}
		<Badge variant="outline" class="h-5 gap-1 bg-blue-50 px-1.5 text-[10px]">
			<Database class="h-3 w-3 text-blue-600" />

			Resources
		</Badge>
	{/if}

	{#if capabilities.server.prompts}
		<Badge variant="outline" class="h-5 gap-1 bg-purple-50 px-1.5 text-[10px]">
			<MessageSquare class="h-3 w-3 text-purple-600" />

			Prompts
		</Badge>
	{/if}

	{#if capabilities.server.logging}
		<Badge variant="outline" class="h-5 gap-1 bg-orange-50 px-1.5 text-[10px]">
			<FileText class="h-3 w-3 text-orange-600" />

			Logging
		</Badge>
	{/if}

	{#if capabilities.server.completions}
		<Badge variant="outline" class="h-5 gap-1 bg-cyan-50 px-1.5 text-[10px]">
			<Sparkles class="h-3 w-3 text-cyan-600" />

			Completions
		</Badge>
	{/if}

	{#if capabilities.server.tasks}
		<Badge variant="outline" class="h-5 gap-1 bg-pink-50 px-1.5 text-[10px]">
			<ListChecks class="h-3 w-3 text-pink-600" />

			Tasks
		</Badge>
	{/if}
{/if}
