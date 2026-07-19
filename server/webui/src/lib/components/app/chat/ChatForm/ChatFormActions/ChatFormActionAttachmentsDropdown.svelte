<script lang="ts">
	import { page } from '$app/state';
	import { Plus, MessageSquare, Settings, Zap, FolderOpen } from '@lucide/svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/components/ui/utils';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Switch } from '$lib/components/ui/switch';
	import { FILE_TYPE_ICONS, TOOLTIP_DELAY_DURATION } from '$lib/constants';
	import { McpLogo, DropdownMenuSearchable } from '$lib/components/app';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { HealthCheckStatus } from '$lib/enums';
	import type { MCPServerSettingsEntry } from '$lib/types';
	import { t } from '$lib/i18n';
	import ChatFormActionToolsSubmenu from './ChatFormActionToolsSubmenu.svelte';

	interface Props {
		class?: string;
		disabled?: boolean;
		hasAudioModality?: boolean;
		hasVideoModality?: boolean;
		hasVisionModality?: boolean;
		hasMcpPromptsSupport?: boolean;
		hasMcpResourcesSupport?: boolean;
		showModelDrivenAttachmentOptions?: boolean;
		showToolCallingOptions?: boolean;
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
		hasVideoModality = false,
		hasVisionModality = false,
		hasMcpPromptsSupport = false,
		hasMcpResourcesSupport = false,
		showModelDrivenAttachmentOptions = true,
		showToolCallingOptions = true,
		onFileUpload,
		onSystemPromptClick,
		onMcpPromptClick,
		onMcpSettingsClick,
		onMcpResourcesClick
	}: Props = $props();

	let isNewChat = $derived(!page.params.id);

	let systemMessageTooltip = $derived(
		isNewChat
			? t('attachments.addCustomSystemMessageNewConversation')
			: t('attachments.injectCustomSystemMessageConversation')
	);

	let dropdownOpen = $state(false);
	let mcpServersSubmenuOpenedInSession = $state(false);
	let attachmentMenuTooltipsEnabled = $state(false);
	let imagesTooltipOpen = $state(false);
	let audioTooltipOpen = $state(false);
	let videoTooltipOpen = $state(false);
	let pdfTooltipOpen = $state(false);
	let systemTooltipOpen = $state(false);

	let mcpServers = $derived(mcpStore.getServersSorted().filter((s) => s.enabled));
	let hasMcpServers = $derived(showToolCallingOptions && mcpServers.length > 0);
	let mcpSearchQuery = $state('');
	let filteredMcpServers = $derived.by(() => {
		const query = mcpSearchQuery.toLowerCase().trim();
		if (!query) return mcpServers;
		return mcpServers.filter((s) => {
			const name = getServerLabel(s).toLowerCase();
			const url = s.url.toLowerCase();
			return name.includes(query) || url.includes(query);
		});
	});

	function getServerLabel(server: MCPServerSettingsEntry): string {
		return mcpStore.getServerLabel(server);
	}

	function isServerEnabledForChat(serverId: string): boolean {
		return conversationsStore.isMcpServerEnabledForChat(serverId);
	}

	async function toggleServerForChat(serverId: string) {
		await conversationsStore.toggleMcpServerForChat(serverId);
	}

	function closeFirstLevelAttachmentTooltips() {
		imagesTooltipOpen = false;
		audioTooltipOpen = false;
		videoTooltipOpen = false;
		pdfTooltipOpen = false;
		systemTooltipOpen = false;
	}

	function handleMcpServersSubmenuIntent() {
		attachmentMenuTooltipsEnabled = false;
		closeFirstLevelAttachmentTooltips();

		if (mcpServersSubmenuOpenedInSession) return;

		mcpServersSubmenuOpenedInSession = true;
		mcpSearchQuery = '';
		mcpStore.runHealthChecksForServers(mcpServers);
	}

	function handleMcpPromptClick() {
		dropdownOpen = false;
		onMcpPromptClick?.();
	}

	function handleMcpSettingsClick() {
		dropdownOpen = false;
		onMcpSettingsClick?.();
	}

	function handleMcpResourcesClick() {
		dropdownOpen = false;
		onMcpResourcesClick?.();
	}

	let fileUploadTooltipText = $derived(t('attachments.addFilesSystemPromptOrMcpServers'));

	// llampart-reset-mcp-submenu-session-when-closed
	$effect(() => {
		if (!dropdownOpen) {
			mcpServersSubmenuOpenedInSession = false;
			mcpSearchQuery = '';
			attachmentMenuTooltipsEnabled = false;
			closeFirstLevelAttachmentTooltips();
		}
	});

	// llampart-delay-attachment-menu-tooltips-after-open
	$effect(() => {
		if (!dropdownOpen) return;

		attachmentMenuTooltipsEnabled = false;
		imagesTooltipOpen = false;
		audioTooltipOpen = false;
		videoTooltipOpen = false;
		pdfTooltipOpen = false;
		systemTooltipOpen = false;

		const timeout = window.setTimeout(() => {
			if (!mcpServersSubmenuOpenedInSession && showToolCallingOptions) {
				attachmentMenuTooltipsEnabled = true;
			}
		}, 250);

		return () => window.clearTimeout(timeout);
	});
</script>

<div class="llampart-composer-attachments-trigger flex items-center gap-1 {className}">
	<DropdownMenu.Root bind:open={dropdownOpen}>
		<Tooltip.Root delayDuration={1200}>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<span
						{...props}
						class="llampart-composer-attachment-trigger-shell inline-flex h-8 min-h-8 w-8 min-w-8 shrink-0 items-center justify-center rounded-full"
					>
						<DropdownMenu.Trigger
							name={t('attachments.attachFiles')}
							{disabled}
							class={cn(
								buttonVariants({ variant: 'default' }),
								'llampart-composer-attachment-menu-trigger llampart-composer-attachment-menu-button llampart-composer-neutral-action-button llampart-composer-action-button llampart-composer-submit-button inline-flex h-8 min-h-8 w-8 min-w-8 cursor-pointer items-center justify-center rounded-full p-0 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
							)}
							aria-label={fileUploadTooltipText}
						>
							<span class="sr-only">{fileUploadTooltipText}</span>
							<Plus class="h-4 w-4 shrink-0" />
						</DropdownMenu.Trigger>
					</span>
				{/snippet}
			</Tooltip.Trigger>

			<Tooltip.Content>
				<p>{fileUploadTooltipText}</p>
			</Tooltip.Content>
		</Tooltip.Root>

		<DropdownMenu.Content
			align="start"
			class="llampart-composer-menu-content llampart-composer-main-menu w-72 overflow-visible"
		>
			{#if showModelDrivenAttachmentOptions && hasVisionModality}
				<DropdownMenu.Item
					class="images-button flex cursor-pointer items-center gap-2"
					onclick={() => onFileUpload?.()}
				>
					<FILE_TYPE_ICONS.image class="h-4 w-4" />
					<span>{t('attachments.images')}</span>
				</DropdownMenu.Item>
			{:else if showModelDrivenAttachmentOptions}
				<Tooltip.Root
					delayDuration={TOOLTIP_DELAY_DURATION}
					bind:open={imagesTooltipOpen}
					onOpenChange={(open) => {
						imagesTooltipOpen =
							attachmentMenuTooltipsEnabled && !mcpServersSubmenuOpenedInSession && open;
					}}
				>
					<Tooltip.Trigger class="w-full">
						<DropdownMenu.Item
							class="images-button flex cursor-pointer items-center gap-2"
							disabled
						>
							<FILE_TYPE_ICONS.image class="h-4 w-4" />
							<span>{t('attachments.images')}</span>
						</DropdownMenu.Item>
					</Tooltip.Trigger>

					<Tooltip.Content side="right">
						<p>{t('attachments.imageProcessingRequiresVisionModel')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			{#if showModelDrivenAttachmentOptions && hasAudioModality}
				<DropdownMenu.Item
					class="audio-button flex cursor-pointer items-center gap-2"
					onclick={() => onFileUpload?.()}
				>
					<FILE_TYPE_ICONS.audio class="h-4 w-4" />
					<span>{t('attachments.audioFiles')}</span>
				</DropdownMenu.Item>
			{:else if showModelDrivenAttachmentOptions}
				<Tooltip.Root
					delayDuration={TOOLTIP_DELAY_DURATION}
					bind:open={audioTooltipOpen}
					onOpenChange={(open) => {
						audioTooltipOpen =
							attachmentMenuTooltipsEnabled && !mcpServersSubmenuOpenedInSession && open;
					}}
				>
					<Tooltip.Trigger class="w-full">
						<DropdownMenu.Item class="audio-button flex cursor-pointer items-center gap-2" disabled>
							<FILE_TYPE_ICONS.audio class="h-4 w-4" />
							<span>{t('attachments.audioFiles')}</span>
						</DropdownMenu.Item>
					</Tooltip.Trigger>

					<Tooltip.Content side="right">
						<p>{t('attachments.audioFilesRequireAudioModel')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			{#if showModelDrivenAttachmentOptions && hasVideoModality}
				<DropdownMenu.Item
					class="video-button flex cursor-pointer items-center gap-2"
					onclick={() => onFileUpload?.()}
				>
					<FILE_TYPE_ICONS.video class="h-4 w-4" />
					<span>{t('attachments.videoFiles')}</span>
				</DropdownMenu.Item>
			{:else if showModelDrivenAttachmentOptions}
				<Tooltip.Root
					delayDuration={TOOLTIP_DELAY_DURATION}
					bind:open={videoTooltipOpen}
					onOpenChange={(open) => {
						videoTooltipOpen =
							attachmentMenuTooltipsEnabled && !mcpServersSubmenuOpenedInSession && open;
					}}
				>
					<Tooltip.Trigger class="w-full">
						<DropdownMenu.Item class="video-button flex cursor-pointer items-center gap-2" disabled>
							<FILE_TYPE_ICONS.video class="h-4 w-4" />
							<span>{t('attachments.videoFiles')}</span>
						</DropdownMenu.Item>
					</Tooltip.Trigger>

					<Tooltip.Content side="right">
						<p>{t('attachments.videoFilesRequireVideoModel')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			<DropdownMenu.Item
				class="flex cursor-pointer items-center gap-2"
				onclick={() => onFileUpload?.()}
			>
				<FILE_TYPE_ICONS.text class="h-4 w-4" />
				<span>{t('attachments.textFiles')}</span>
			</DropdownMenu.Item>

			{#if hasVisionModality}
				<DropdownMenu.Item
					class="flex cursor-pointer items-center gap-2"
					onclick={() => onFileUpload?.()}
				>
					<FILE_TYPE_ICONS.pdf class="h-4 w-4" />
					<span>{t('attachments.pdfFiles')}</span>
				</DropdownMenu.Item>
			{:else}
				<Tooltip.Root
					delayDuration={TOOLTIP_DELAY_DURATION}
					bind:open={pdfTooltipOpen}
					onOpenChange={(open) => {
						pdfTooltipOpen =
							attachmentMenuTooltipsEnabled && !mcpServersSubmenuOpenedInSession && open;
					}}
				>
					<Tooltip.Trigger class="w-full">
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2"
							onclick={() => onFileUpload?.()}
						>
							<FILE_TYPE_ICONS.pdf class="h-4 w-4" />
							<span>{t('attachments.pdfFiles')}</span>
						</DropdownMenu.Item>
					</Tooltip.Trigger>

					<Tooltip.Content side="right">
						<p>{t('attachments.pdfsConvertedToTextHint')}</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			<Tooltip.Root
				delayDuration={TOOLTIP_DELAY_DURATION}
				bind:open={systemTooltipOpen}
				onOpenChange={(open) => {
					systemTooltipOpen =
						attachmentMenuTooltipsEnabled && !mcpServersSubmenuOpenedInSession && open;
				}}
			>
				<Tooltip.Trigger class="w-full">
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2"
						onclick={() => onSystemPromptClick?.()}
					>
						<MessageSquare class="h-4 w-4" />
						<span>{t('attachments.systemMessage')}</span>
					</DropdownMenu.Item>
				</Tooltip.Trigger>

				<Tooltip.Content side="right">
					<p>{systemMessageTooltip}</p>
				</Tooltip.Content>
			</Tooltip.Root>

			{#if showToolCallingOptions}
				<DropdownMenu.Separator />

				<ChatFormActionToolsSubmenu
					onSubmenuIntent={() => {
						attachmentMenuTooltipsEnabled = false;
						closeFirstLevelAttachmentTooltips();
					}}
				/>

				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger
						class="llampart-composer-mcp-submenu-trigger flex w-full cursor-pointer items-center gap-2"
						onpointerenter={handleMcpServersSubmenuIntent}
						onfocus={handleMcpServersSubmenuIntent}
						onclick={handleMcpServersSubmenuIntent}
					>
						<McpLogo class="h-4 w-4" />
						<span>{t('mcp.servers')}</span>
					</DropdownMenu.SubTrigger>

					<DropdownMenu.SubContent
						class="llampart-composer-menu-content llampart-composer-mcp-submenu w-80 max-w-[calc(100vw-1rem)] p-1.5"
					>
						<DropdownMenuSearchable
							placeholder={t('mcp.searchServers')}
							bind:searchValue={mcpSearchQuery}
							emptyMessage={hasMcpServers ? t('mcp.noServersFound') : t('mcp.noServersConfigured')}
							isEmpty={filteredMcpServers.length === 0}
						>
							<div class="llampart-mcp-server-list max-h-64 overflow-y-auto">
								{#each filteredMcpServers as server (server.id)}
									{@const healthState = mcpStore.getHealthCheckState(server.id)}
									{@const hasError = healthState.status === HealthCheckStatus.ERROR}
									{@const isEnabledForChat = isServerEnabledForChat(server.id)}

									<button
										type="button"
										class="llampart-mcp-server-item flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
										onclick={() => !hasError && toggleServerForChat(server.id)}
										disabled={hasError}
									>
										<div class="flex min-w-0 flex-1 items-center gap-2">
											{#if mcpStore.getServerFavicon(server.id)}
												<img
													src={mcpStore.getServerFavicon(server.id)}
													alt=""
													class="h-4 w-4 shrink-0 rounded-sm"
													onerror={(e) => {
														(e.currentTarget as HTMLImageElement).style.display = 'none';
													}}
												/>
											{/if}

											<span class="truncate text-sm">{getServerLabel(server)}</span>

											{#if hasError}
												<span
													class="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive"
												>
													{t('mcp.error')}
												</span>
											{/if}
										</div>

										<Switch
											class="llampart-composer-switch"
											checked={isEnabledForChat}
											disabled={hasError}
											onclick={(e: MouseEvent) => e.stopPropagation()}
											onCheckedChange={() => toggleServerForChat(server.id)}
										/>
									</button>
								{/each}
							</div>

							{#snippet footer()}
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2"
									onclick={handleMcpSettingsClick}
								>
									<Settings class="h-4 w-4" />
									<span>{t('mcp.manageServers')}</span>
								</DropdownMenu.Item>
							{/snippet}
						</DropdownMenuSearchable>
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
			{/if}

			{#if hasMcpPromptsSupport}
				<DropdownMenu.Item
					class="flex cursor-pointer items-center gap-2"
					onclick={handleMcpPromptClick}
				>
					<Zap class="h-4 w-4" />
					<span>{t('mcp.prompt')}</span>
				</DropdownMenu.Item>
			{/if}

			{#if hasMcpResourcesSupport}
				<DropdownMenu.Item
					class="flex cursor-pointer items-center gap-2"
					onclick={handleMcpResourcesClick}
				>
					<FolderOpen class="h-4 w-4" />
					<span>{t('mcp.resources')}</span>
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>

<style>
	:global([data-slot='dropdown-menu-content'].llampart-composer-main-menu) {
		max-height: none;
		overflow: visible;
	}

	:global([data-slot='dropdown-menu-sub-content'].llampart-composer-mcp-submenu) {
		box-sizing: border-box;
		width: min(20rem, calc(100vw - 1rem));
		max-height: min(24rem, calc(100vh - 2rem));
		overflow: hidden;
	}
</style>
