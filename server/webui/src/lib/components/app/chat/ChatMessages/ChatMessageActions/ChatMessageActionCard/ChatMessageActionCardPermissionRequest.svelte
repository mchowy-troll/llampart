<script lang="ts">
	import { ShieldQuestion } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ToolPermissionDecision, ToolSource } from '$lib/enums';
	import { TOOL_SERVER_LABELS } from '$lib/constants';
	import { toolsStore } from '$lib/stores/tools.svelte';
	import { t } from '$lib/i18n';
	import ChatMessageActionCard from './ChatMessageActionCard.svelte';

	interface Props {
		toolName: string;
		serverLabel: string;
		onDecision: (decision: ToolPermissionDecision) => void;
	}

	let { toolName, serverLabel, onDecision }: Props = $props();

	const providerName = $derived.by(() => {
		if (serverLabel) return serverLabel;

		const source = toolsStore.getToolSource(toolName);

		if (source === ToolSource.BUILTIN) return TOOL_SERVER_LABELS[ToolSource.BUILTIN];
		if (source === ToolSource.CUSTOM) return TOOL_SERVER_LABELS[ToolSource.CUSTOM];

		return t('messages.mcpToolsProvider');
	});

	function splitTemplate(template: string, token: string) {
		const placeholder = `{${token}}`;
		const index = template.indexOf(placeholder);

		if (index === -1) {
			return { before: `${template} `, after: '' };
		}

		return {
			before: template.slice(0, index),
			after: template.slice(index + placeholder.length)
		};
	}

	const alwaysAllowToolLabel = $derived.by(() =>
		splitTemplate(t('messages.alwaysAllowTool'), 'tool')
	);
	const alwaysAllowProviderLabel = $derived.by(() =>
		splitTemplate(t('messages.alwaysAllowProviderTools'), 'provider')
	);
</script>

<ChatMessageActionCard class="llampart-tool-permission-card" icon={ShieldQuestion}>
	{#snippet message()}
		{t('messages.allowToolUsePrompt')}
		<span class="font-semibold">{toolName}</span>
		{#if providerName}
			{t('messages.allowToolFromPrompt')} <span class="font-semibold">{providerName}</span>
		{/if}
		?
	{/snippet}

	{#snippet actions()}
		<Button
			class="llampart-tool-permission-allow-action"
			size="sm"
			onclick={() => onDecision(ToolPermissionDecision.ONCE)}
		>
			{t('messages.allowOnce')}
		</Button>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				<Button class="llampart-tool-permission-allow-action" variant="secondary" size="sm"
					>{t('messages.morePermissionOptions')}</Button
				>
			</DropdownMenu.Trigger>

			<DropdownMenu.Content align="center" class="llampart-tool-permission-menu min-w-[12rem]">
				<DropdownMenu.Item onclick={() => onDecision(ToolPermissionDecision.ALWAYS)}>
					{alwaysAllowToolLabel.before}<span class="font-semibold">{toolName}</span
					>{alwaysAllowToolLabel.after}
				</DropdownMenu.Item>

				<DropdownMenu.Item onclick={() => onDecision(ToolPermissionDecision.ALWAYS_SERVER)}>
					{alwaysAllowProviderLabel.before}<span class="font-semibold">{providerName}</span
					>{alwaysAllowProviderLabel.after}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<Button
			class="llampart-tool-permission-deny-action"
			variant="destructive"
			size="sm"
			onclick={() => onDecision(ToolPermissionDecision.DENY)}
		>
			{t('messages.denyToolUse')}
		</Button>
	{/snippet}
</ChatMessageActionCard>
