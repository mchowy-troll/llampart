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

<style>
	:global(html.has-frosted-glass-theme .llampart-tool-permission-card) {
		border: 1px solid rgba(255, 255, 255, 0.18) !important;
		background: rgba(255, 255, 255, 0.14) !important;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.06),
			0 2px 4px rgba(0, 0, 0, 0.055),
			0 4px 8px rgba(0, 0, 0, 0.05),
			0 8px 16px rgba(0, 0, 0, 0.045),
			0 16px 32px rgba(0, 0, 0, 0.04),
			0 32px 64px rgba(0, 0, 0, 0.035) !important;
		backdrop-filter: blur(18px) saturate(116%) !important;
		-webkit-backdrop-filter: blur(18px) saturate(116%) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-tool-permission-card),
	:global(html.has-frosted-glass-theme .llampart-tool-permission-card *) {
		color: #000000 !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-tool-permission-card svg),
	:global(html.has-frosted-glass-theme .llampart-tool-permission-card svg *) {
		color: #000000 !important;
		stroke: currentColor;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-tool-permission-card
			.llampart-tool-permission-allow-action
	) {
		border: 1px solid rgba(255, 255, 255, 0.2) !important;
		background: rgba(255, 255, 255, 0.18) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 1px 2px rgba(0, 0, 0, 0.05) !important;
		backdrop-filter: blur(12px) saturate(114%) !important;
		-webkit-backdrop-filter: blur(12px) saturate(114%) !important;
		color: #000000 !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-tool-permission-card
			.llampart-tool-permission-allow-action:hover
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-tool-permission-card
			.llampart-tool-permission-allow-action:focus-visible
	) {
		background: rgba(255, 255, 255, 0.22) !important;
		border-color: rgba(255, 255, 255, 0.24) !important;
	}
	/* llampart-tool-permission-deny-action-text-contrast */
	:global(
		html.has-frosted-glass-theme
			.llampart-tool-permission-card
			.llampart-tool-permission-deny-action
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-tool-permission-card
			.llampart-tool-permission-deny-action
			*
	) {
		color: #ffffff !important;
	}
</style>
