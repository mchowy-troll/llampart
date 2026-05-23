<script lang="ts">
	import { Plus, MessageSquare, Zap, FolderOpen } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import { FILE_TYPE_ICONS } from '$lib/constants';
	import { McpLogo } from '$lib/components/app';
	import { t } from '$lib/i18n';

	interface Props {
		class?: string;
		disabled?: boolean;
		hasAudioModality?: boolean;
		hasVisionModality?: boolean;
		hasMcpPromptsSupport?: boolean;
		hasMcpResourcesSupport?: boolean;
		onFileUpload?: () => void;
		onSystemPromptClick?: () => void;
		onMcpPromptClick?: () => void;
		onMcpSettingsClick?: () => void;
		onMcpResourcesClick?: () => void;
	}

	let {
		class: className = '',
		disabled = false,
		hasAudioModality = false,
		hasVisionModality = false,
		hasMcpPromptsSupport = false,
		hasMcpResourcesSupport = false,
		onFileUpload,
		onSystemPromptClick,
		onMcpPromptClick,
		onMcpSettingsClick,
		onMcpResourcesClick
	}: Props = $props();

	let sheetOpen = $state(false);

	function handleMcpPromptClick() {
		sheetOpen = false;
		onMcpPromptClick?.();
	}

	function handleMcpSettingsClick() {
		sheetOpen = false;
		onMcpSettingsClick?.();
	}

	function handleMcpResourcesClick() {
		sheetOpen = false;
		onMcpResourcesClick?.();
	}

	function handleSheetFileUpload() {
		sheetOpen = false;
		onFileUpload?.();
	}

	function handleSheetSystemPromptClick() {
		sheetOpen = false;
		onSystemPromptClick?.();
	}

	let fileUploadTooltipText = $derived(t('attachments.addFilesSystemPromptOrMcpServers'));

	const sheetItemClass =
		'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent active:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
</script>

<div class="llampart-composer-attachments-trigger flex items-center gap-1 {className}">
	<Sheet.Root bind:open={sheetOpen}>
		<Button
			class="llampart-composer-action-button llampart-composer-submit-button llampart-composer-plus-button h-8 w-8 rounded-full p-0"
			{disabled}
			type="button"
			onclick={() => (sheetOpen = true)}
		>
			<span class="sr-only">{fileUploadTooltipText}</span>

			<Plus class="h-12 w-12" />
		</Button>

		<Sheet.Content side="bottom" class="llampart-composer-menu-content max-h-[85vh] gap-0">
			<Sheet.Header>
				<Sheet.Title>{t('attachments.addToChat')}</Sheet.Title>

				<Sheet.Description class="sr-only">
					{t('attachments.addFilesSystemPromptOrConfigureMcpServers')}
				</Sheet.Description>
			</Sheet.Header>

			<div class="flex flex-col gap-1 overflow-y-auto px-1.5 pb-2">
				<button
					type="button"
					class={sheetItemClass}
					disabled={!hasVisionModality}
					onclick={handleSheetFileUpload}
				>
					<FILE_TYPE_ICONS.image class="h-4 w-4 shrink-0" />
					<span>{t('attachments.images')}</span>

					{#if !hasVisionModality}
						<span class="ml-auto text-xs text-muted-foreground">
							{t('attachments.requiresVisionModel')}
						</span>
					{/if}
				</button>

				<button
					type="button"
					class={sheetItemClass}
					disabled={!hasAudioModality}
					onclick={handleSheetFileUpload}
				>
					<FILE_TYPE_ICONS.audio class="h-4 w-4 shrink-0" />
					<span>{t('attachments.audioFiles')}</span>

					{#if !hasAudioModality}
						<span class="ml-auto text-xs text-muted-foreground">
							{t('attachments.requiresAudioModel')}
						</span>
					{/if}
				</button>

				<button type="button" class={sheetItemClass} onclick={handleSheetFileUpload}>
					<FILE_TYPE_ICONS.text class="h-4 w-4 shrink-0" />
					<span>{t('attachments.textFiles')}</span>
				</button>

				<button type="button" class={sheetItemClass} onclick={handleSheetFileUpload}>
					<FILE_TYPE_ICONS.pdf class="h-4 w-4 shrink-0" />
					<span>{t('attachments.pdfFiles')}</span>

					{#if !hasVisionModality}
						<span class="ml-auto text-xs text-muted-foreground">
							{t('attachments.textOnly')}
						</span>
					{/if}
				</button>

				<button type="button" class={sheetItemClass} onclick={handleSheetSystemPromptClick}>
					<MessageSquare class="h-4 w-4 shrink-0" />
					<span>{t('attachments.systemMessage')}</span>
				</button>

				<button type="button" class={sheetItemClass} onclick={handleMcpSettingsClick}>
					<McpLogo class="h-4 w-4 shrink-0" />
					<span>{t('mcp.servers')}</span>
				</button>

				{#if hasMcpPromptsSupport}
					<button type="button" class={sheetItemClass} onclick={handleMcpPromptClick}>
						<Zap class="h-4 w-4 shrink-0" />
						<span>{t('mcp.prompt')}</span>
					</button>
				{/if}

				{#if hasMcpResourcesSupport}
					<button type="button" class={sheetItemClass} onclick={handleMcpResourcesClick}>
						<FolderOpen class="h-4 w-4 shrink-0" />
						<span>{t('mcp.resources')}</span>
					</button>
				{/if}
			</div>
		</Sheet.Content>
	</Sheet.Root>
</div>
