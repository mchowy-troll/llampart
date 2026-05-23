<script lang="ts">
	import { t } from '$lib/i18n';
	import { Card } from '$lib/components/ui/card';
	import { ChatAttachmentsList, MarkdownContent } from '$lib/components/app';
	import { getMessageEditContext } from '$lib/contexts';
	import { config } from '$lib/stores/settings.svelte';
	import ChatMessageActions from './ChatMessageActions.svelte';
	import ChatMessageEditForm from './ChatMessageEditForm.svelte';
	import { MessageRole } from '$lib/enums';

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
		<ChatMessageEditForm />
	{:else}
		{#if message.extra && message.extra.length > 0}
			<div class="llampart-user-message-attachments mb-2 w-full max-w-[80%]">
				<ChatAttachmentsList attachments={message.extra} readonly imageHeight="h-80" />
			</div>
		{/if}

		{#if message.content.trim()}
			<Card
				class="llampart-user-message-card w-full max-w-[80%] overflow-y-auto rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-1.5 text-foreground backdrop-blur-md data-[multiline]:py-2.5 dark:bg-primary/15"
				data-multiline={isMultiline ? '' : undefined}
				style="max-height: var(--max-message-height); overflow-wrap: anywhere; word-break: break-word;"
			>
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

				{#if message.timestamp}
					<div class="llampart-user-message-footer">
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
		{:else if message.timestamp}
			<div class="w-full max-w-[80%]">
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
	/* llampart-frosted-glass-user-message */
	:global(html.has-frosted-glass-theme .llampart-user-message-card) {
		border: 1px solid rgba(255, 255, 255, 0.19) !important;
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

	:global(html.has-frosted-glass-theme .llampart-user-message-card),
	:global(html.has-frosted-glass-theme .llampart-user-message-card *) {
		color: #000000 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.64),
			0 0 8px rgba(255, 255, 255, 0.5),
			0 0 16px rgba(255, 255, 255, 0.34) !important;
	}

	:global(
		html.has-frosted-glass-theme .llampart-user-message-card :is(h1, h2, h3, h4, h5, h6, strong, b)
	) {
		color: #000000 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-user-message-card code) {
		background: rgba(255, 255, 255, 0.1) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		border-radius: 0.5rem;
	}

	:global(html.has-frosted-glass-theme .llampart-user-message-card pre),
	:global(html.has-frosted-glass-theme .llampart-user-message-card pre code) {
		background: rgba(255, 255, 255, 0.1) !important;
		border: 1px solid rgba(255, 255, 255, 0.1) !important;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-user-message-attachments [data-slot='card']),
	:global(html.has-frosted-glass-theme .llampart-user-message-attachments .card) {
		background: rgba(255, 255, 255, 0.14) !important;
		border: 1px solid rgba(255, 255, 255, 0.16) !important;
		backdrop-filter: blur(16px) saturate(112%) !important;
		-webkit-backdrop-filter: blur(16px) saturate(112%) !important;
	}

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

	:global(html.has-frosted-glass-theme) .llampart-user-message-card {
		padding-bottom: 0.875rem !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer {
		margin-right: -0.0625rem;
		margin-left: 0;
		margin-bottom: 0;
		color: #000000 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(*),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions *) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: normal !important;
		text-shadow: none !important;
		filter: none !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global([data-slot='button']),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(button),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(a),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global([role='button']) {
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
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global([data-slot='button']:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global([data-slot='button']:focus-visible),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(button:hover),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(button:focus-visible),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(a:hover),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(a:focus-visible),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global([role='button']:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global([role='button']:focus-visible) {
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
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(svg) {
		color: #000000 !important;
		stroke: currentColor !important;
		stroke-width: 2;
		filter: none !important;
		text-shadow: none !important;
		box-shadow: none !important;
		transform: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
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

	/* llampart-user-footer-restore-height-lower-icons */
	:global(html.has-frosted-glass-theme .llampart-user-message-card) {
		display: flex !important;
		min-height: 5.75rem !important;
		flex-direction: column !important;
		padding-bottom: 0.3125rem !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer {
		position: static !important;
		right: auto !important;
		bottom: auto !important;
		margin-top: auto !important;
		margin-right: -0.3125rem !important;
		margin-bottom: 0 !important;
		padding: 0 !important;
		font-weight: 400 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions-icons) {
		width: auto !important;
		height: auto !important;
		margin: 0 !important;
		padding: 0 !important;
		justify-content: flex-end !important;
		align-items: center !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer,
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(*) {
		color: #000000 !important;
		font-weight: 400 !important;
		font-variation-settings: normal !important;
		text-shadow: none !important;
		filter: none !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(button),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global([role='button']),
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(a) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border-color: transparent !important;
		box-shadow: none !important;
		font-weight: 400 !important;
		text-shadow: none !important;
		filter: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-user-message-footer :global(svg) {
		stroke-width: 1.8 !important;
		filter: none !important;
		text-shadow: none !important;
	}
	/* llampart-user-footer-regular-weight-only-final */
	:global(html.has-frosted-glass-theme .llampart-user-message-footer),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer *),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global(*)),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global(button)),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global([data-slot='button'])),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global([class*='font-'])),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global(strong)),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global(b)) {
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global(svg)),
	:global(html.has-frosted-glass-theme .llampart-user-message-footer :global(svg *)) {
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
	}

	/* llampart-user-message-radius-match-assistant */
	:global(html.has-frosted-glass-theme .llampart-user-message-card) {
		border-radius: 0.75rem !important;
	}

	/* llampart-user-footer-bottom-inset-match-llm */
	:global(html.has-frosted-glass-theme) .llampart-user-message-footer {
		margin-right: 0 !important;
		margin-bottom: 0.3125rem !important;
		padding-right: 0 !important;
		padding-bottom: 0 !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions) {
		justify-content: flex-end;
	}

	/* llampart-user-message-top-inset-equals-side-inset */
	.llampart-user-message-card {
		padding-top: 0.9375rem !important;
	}

	/* llampart-user-message-content-top-inset-match-left-inset */
	.llampart-user-message-content {
		display: block;
		margin-top: 0.5625rem;
	}

	/* llampart-frosted-glass-user-message-action-glow */
	:global(html.has-frosted-glass-theme .llampart-user-message .llampart-message-actions-icons),
	:global(
		html.has-frosted-glass-theme .llampart-user-message .llampart-message-actions-icons button
	),
	:global(
		html.has-frosted-glass-theme
			.llampart-user-message
			.llampart-message-actions-icons
			[role='button']
	) {
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-user-message .llampart-message-actions-icons svg),
	:global(
		html.has-frosted-glass-theme .llampart-user-message .llampart-message-actions-icons svg *
	) {
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.32)) !important;
	}
	/* /llampart-frosted-glass-user-message-action-glow */

	/* llampart-frosted-glass-user-footer-action-glow-final */
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions-icons button),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions-icons a),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions-icons [role='button']) {
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions-icons svg),
	:global(html.has-frosted-glass-theme)
		.llampart-user-message-footer
		:global(.llampart-message-actions-icons svg *) {
		filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.32)) !important;
	}
	/* /llampart-frosted-glass-user-footer-action-glow-final */
</style>
