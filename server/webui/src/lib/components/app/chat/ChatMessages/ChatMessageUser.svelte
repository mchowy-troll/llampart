<script lang="ts">
	import { t } from '$lib/i18n';
	import { Card } from '$lib/components/ui/card';
	import { ChatAttachmentsList, MarkdownContent } from '$lib/components/app';
	import { getMessageEditContext } from '$lib/contexts';
	import { config } from '$lib/stores/settings.svelte';
	import ChatMessageActions from './ChatMessageActions.svelte';
	import ChatMessageEditForm from './ChatMessageEditForm.svelte';
	import { MessageRole } from '$lib/enums';
	import { isAttachmentOnlyMessage } from '$lib/utils';

	interface Props {
		class?: string;
		message: DatabaseMessage;
		siblingInfo?: ChatMessageSiblingInfo | null;
		deletionInfo: {
			totalCount: number;
			userMessages: number;
			assistantMessages: number;
			messageTypes: string[];
		} | null;
		showDeleteDialog: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onConfirmDelete: () => void;
		onForkConversation?: (options: { name: string; includeAttachments: boolean }) => void;
		onShowDeleteDialogChange: (show: boolean) => void;
		onNavigateToSibling?: (siblingId: string) => void;
		onCopy: () => void;
	}

	let {
		class: className = '',
		message,
		siblingInfo = null,
		deletionInfo,
		showDeleteDialog,
		onEdit,
		onDelete,
		onConfirmDelete,
		onForkConversation,
		onShowDeleteDialogChange,
		onNavigateToSibling,
		onCopy
	}: Props = $props();

	// Get contexts
	const editCtx = getMessageEditContext();

	let isMultiline = $state(false);
	let messageElement: HTMLElement | undefined = $state();
	const currentConfig = config();
	let hideAttachmentOnlyActions = $derived(isAttachmentOnlyMessage(message.content, message.extra));

	$effect(() => {
		if (!messageElement || !message.content.trim()) return;

		if (message.content.includes('\n')) {
			isMultiline = true;
			return;
		}

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const element = entry.target as HTMLElement;
				const estimatedSingleLineHeight = 24; // Typical line height for text-md

				isMultiline = element.offsetHeight > estimatedSingleLineHeight * 1.5;
			}
		});

		resizeObserver.observe(messageElement);

		return () => {
			resizeObserver.disconnect();
		};
	});
</script>

<div
	aria-label={t('messages.userMessageWithActions')}
	class="llampart-user-message group flex flex-col items-end gap-3 md:gap-2 {className}"
	role="group"
>
	{#if editCtx.isEditing}
		<Card
			class="llampart-message-shell-card llampart-user-message-card llampart-user-message-edit-card w-full llampart-user-message-width overflow-hidden rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-2.5 text-foreground backdrop-blur-md"
			style="overflow-wrap: anywhere; word-break: break-word;"
		>
			<ChatMessageEditForm class="llampart-user-message-edit-form w-full" />
		</Card>
	{:else}
		{#if message.extra && message.extra.length > 0}
			<div class="llampart-user-message-attachments mb-2 w-full llampart-user-message-width">
				<ChatAttachmentsList attachments={message.extra} readonly imageHeight="h-80" />
			</div>
		{/if}

		{#if message.content.trim()}
			<Card
				class="llampart-message-shell-card llampart-user-message-card w-full llampart-user-message-width overflow-hidden rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-1.5 text-foreground backdrop-blur-md data-[multiline]:py-2.5"
				data-multiline={isMultiline ? '' : undefined}
				style="max-height: var(--max-message-height); overflow-wrap: anywhere; word-break: break-word;"
			>
				<div class="llampart-user-message-scroll-area">
					{#if currentConfig.renderUserContentAsMarkdown}
						<div bind:this={messageElement} class="llampart-user-message-content">
							<MarkdownContent class="markdown-user-content -my-4" content={message.content} />
						</div>
					{:else}
						<span
							bind:this={messageElement}
							class="llampart-user-message-content text-md whitespace-pre-wrap"
						>
							{message.content}
						</span>
					{/if}
				</div>

				{#if message.timestamp}
					<div class="llampart-message-shell-footer llampart-user-message-footer">
						<ChatMessageActions
							actionsPosition="right"
							{deletionInfo}
							justify="end"
							{onConfirmDelete}
							{onCopy}
							{onDelete}
							{onEdit}
							{onForkConversation}
							{onNavigateToSibling}
							{onShowDeleteDialogChange}
							{siblingInfo}
							{showDeleteDialog}
							role={MessageRole.USER}
						/>
					</div>
				{/if}
			</Card>
		{:else if message.timestamp && !hideAttachmentOnlyActions}
			<div class="w-full llampart-user-message-width">
				<ChatMessageActions
					actionsPosition="right"
					{deletionInfo}
					justify="end"
					{onConfirmDelete}
					{onCopy}
					{onDelete}
					{onEdit}
					{onForkConversation}
					{onNavigateToSibling}
					{onShowDeleteDialogChange}
					{siblingInfo}
					{showDeleteDialog}
					role={MessageRole.USER}
				/>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* llampart-user-message-footer-inside-card */
	.llampart-user-message-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.09375rem;
	}

	.llampart-user-message-footer :global(.llampart-message-actions) {
		width: 100%;
		height: auto !important;
		margin-top: 0 !important;
		display: flex;
		justify-content: flex-end;
	}

	.llampart-user-message-footer :global(.llampart-message-actions-icons) {
		gap: 0.125rem !important;
		transition: none !important;
	}

	/* llampart-user-message-footer-icon-only-all-themes */
	.llampart-user-message-footer :global([data-slot='button']),
	.llampart-user-message-footer :global(button),
	.llampart-user-message-footer :global(a),
	.llampart-user-message-footer :global([role='button']) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border: 0 !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		filter: none !important;
		text-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		transform: none !important;
	}

	.llampart-user-message-footer :global([data-slot='button']:hover),
	.llampart-user-message-footer :global([data-slot='button']:focus-visible),
	.llampart-user-message-footer :global(button:hover),
	.llampart-user-message-footer :global(button:focus-visible),
	.llampart-user-message-footer :global(a:hover),
	.llampart-user-message-footer :global(a:focus-visible),
	.llampart-user-message-footer :global([role='button']:hover),
	.llampart-user-message-footer :global([role='button']:focus-visible) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		filter: none !important;
		text-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		transform: none !important;
	}

	.llampart-user-message-footer :global(svg) {
		filter: none !important;
		text-shadow: none !important;
		box-shadow: none !important;
	}

	/* llampart-user-message-scroll-area-stable-actions
	   Only message text scrolls; the message-shell footer stays owned by the shared action layout primitive. */
	.llampart-user-message-scroll-area {
		max-height: calc(
			var(--max-message-height) - var(--llampart-message-shell-top-inset) -
				var(--llampart-message-shell-bottom-action-inset)
		);
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	/* /llampart-user-message-scroll-area-stable-actions */

	/* llampart-user-message-top-inset-equals-side-inset */
	.llampart-user-message-card {
		padding-top: 0.9375rem !important;
	}

	/* llampart-user-message-content-top-inset-match-left-inset */
	.llampart-user-message-content {
		display: block;
		margin-top: 0.5625rem;
	}
</style>
