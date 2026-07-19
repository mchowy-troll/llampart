<script lang="ts">
	import { t } from '$lib/i18n';
	import { Check, X } from '@lucide/svelte';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { MarkdownContent } from '$lib/components/app';
	import { getMessageEditContext } from '$lib/contexts';
	import { INPUT_CLASSES } from '$lib/constants';
	import { config } from '$lib/stores/settings.svelte';
	import { isIMEComposing } from '$lib/utils';
	import ChatMessageActions from './ChatMessageActions.svelte';
	import { KeyboardKey, MessageRole } from '$lib/enums';

	interface Props {
		class?: string;
		message: DatabaseMessage;
		siblingInfo?: ChatMessageSiblingInfo | null;
		showDeleteDialog: boolean;
		deletionInfo: {
			totalCount: number;
			userMessages: number;
			assistantMessages: number;
			messageTypes: string[];
		} | null;
		onCopy: () => void;
		onEdit: () => void;
		onDelete: () => void;
		onConfirmDelete: () => void;
		onNavigateToSibling?: (siblingId: string) => void;
		onShowDeleteDialogChange: (show: boolean) => void;
		textareaElement?: HTMLTextAreaElement;
	}

	let {
		class: className = '',
		message,
		siblingInfo = null,
		showDeleteDialog,
		deletionInfo,
		onCopy,
		onEdit,
		onDelete,
		onConfirmDelete,
		onNavigateToSibling,
		onShowDeleteDialogChange,
		textareaElement = $bindable()
	}: Props = $props();

	const editCtx = getMessageEditContext();

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === KeyboardKey.ENTER && !event.shiftKey && !isIMEComposing(event)) {
			event.preventDefault();

			editCtx.save();
		} else if (event.key === KeyboardKey.ESCAPE) {
			event.preventDefault();

			editCtx.cancel();
		}
	}

	let isMultiline = $state(false);
	let messageElement: HTMLElement | undefined = $state();
	let isExpanded = $state(false);
	let contentHeight = $state(0);

	const MAX_HEIGHT = 200; // pixels
	const currentConfig = config();

	let showExpandButton = $derived(contentHeight > MAX_HEIGHT);

	$effect(() => {
		if (!messageElement || !message.content.trim()) return;

		if (message.content.includes('\n')) {
			isMultiline = true;
		}

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const element = entry.target as HTMLElement;
				const estimatedSingleLineHeight = 24;

				isMultiline = element.offsetHeight > estimatedSingleLineHeight * 1.5;
				contentHeight = element.scrollHeight;
			}
		});

		resizeObserver.observe(messageElement);

		return () => {
			resizeObserver.disconnect();
		};
	});

	function toggleExpand() {
		isExpanded = !isExpanded;
	}
</script>

<div
	aria-label={t('messages.systemMessageWithActions')}
	class="llampart-system-message group flex flex-col items-end gap-3 md:gap-2 {className}"
	role="group"
>
	{#if editCtx.isEditing}
		<div class="w-full max-w-[80%]">
			<textarea
				bind:this={textareaElement}
				value={editCtx.editedContent}
				class="min-h-[60px] w-full resize-none rounded-2xl px-3 py-2 text-sm {INPUT_CLASSES}"
				onkeydown={handleEditKeydown}
				oninput={(e) => editCtx.setContent(e.currentTarget.value)}
				placeholder={t('messages.editSystemMessagePlaceholder')}
			></textarea>

			<div class="mt-2 flex justify-end gap-2">
				<Button class="h-8 px-3" onclick={editCtx.cancel} size="sm" variant="outline">
					<X class="mr-1 h-3 w-3" />

					{t('common.cancel')}
				</Button>

				<Button
					class="h-8 px-3"
					onclick={editCtx.save}
					disabled={!editCtx.editedContent.trim()}
					size="sm"
				>
					<Check class="mr-1 h-3 w-3" />

					{t('common.save')}
				</Button>
			</div>
		</div>
	{:else if message.content.trim()}
		<Card
			class="llampart-message-shell-card llampart-system-message-card w-full max-w-[80%] overflow-y-auto rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-1.5 text-foreground backdrop-blur-md data-[multiline]:py-2.5"
			data-multiline={isMultiline ? '' : undefined}
			style="max-height: var(--max-message-height); overflow-wrap: anywhere; word-break: break-word;"
		>
			<span class="llampart-system-message-label">
				{t('messages.systemPromptLabel')}
			</span>
			<button
				class="group/expand llampart-system-message-expand-trigger w-full text-left {!isExpanded &&
				showExpandButton
					? 'cursor-pointer'
					: 'cursor-auto'}"
				onclick={showExpandButton && !isExpanded ? toggleExpand : undefined}
				type="button"
			>
				<div
					class="llampart-system-message-content relative transition-all duration-300 {isExpanded
						? 'cursor-text select-text'
						: 'select-none'}"
					style={!isExpanded && showExpandButton
						? `max-height: ${MAX_HEIGHT}px;`
						: 'max-height: none;'}
				>
					{#if currentConfig.renderUserContentAsMarkdown}
						<div bind:this={messageElement} class={isExpanded ? 'cursor-text' : ''}>
							<MarkdownContent class="markdown-system-content -my-4" content={message.content} />
						</div>
					{:else}
						<span
							bind:this={messageElement}
							class="text-md whitespace-pre-wrap {isExpanded ? 'cursor-text' : ''}"
						>
							{message.content}
						</span>
					{/if}

					{#if !isExpanded && showExpandButton}
						<div
							class="llampart-system-message-fade pointer-events-none absolute right-0 bottom-0 left-0 h-48"
						></div>

						<div
							class="pointer-events-none absolute right-0 bottom-4 left-0 flex justify-center opacity-0 transition-opacity group-hover/expand:opacity-100"
						>
							<span
								class="llampart-system-message-expand-label rounded-full px-4 py-1.5 text-xs shadow-md"
							>
								Show full system message
							</span>
						</div>
					{/if}
				</div>
			</button>

			{#if isExpanded && showExpandButton}
				<div class="mb-2 flex justify-center">
					<Button
						class="llampart-system-message-collapse-button rounded-full px-4 py-1.5 text-xs"
						onclick={(e) => {
							e.stopPropagation();
							toggleExpand();
						}}
						size="sm"
						variant="outline"
					>
						Collapse System Message
					</Button>
				</div>
			{/if}

			{#if message.timestamp}
				<div class="llampart-message-shell-footer llampart-system-message-footer">
					<ChatMessageActions
						actionsPosition="right"
						{deletionInfo}
						justify="end"
						{onConfirmDelete}
						{onCopy}
						{onDelete}
						{onEdit}
						{onNavigateToSibling}
						{onShowDeleteDialogChange}
						{siblingInfo}
						{showDeleteDialog}
						role={MessageRole.USER}
					/>
				</div>
			{/if}
		</Card>
	{/if}
</div>

<style>
	/* System-message surface geometry */
	.llampart-system-message-card {
		border-radius: 0.75rem;
	}

	.llampart-system-message-expand-trigger {
		display: block;
		background: transparent;
		border: 0;
		padding: 0;
		color: inherit;
	}

	.llampart-system-message-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.09375rem;
	}

	.llampart-system-message-footer :global(.llampart-message-actions) {
		width: 100%;
		height: auto !important;
		margin-top: 0 !important;
		display: flex;
		justify-content: flex-end;
	}

	.llampart-system-message-footer :global(.llampart-message-actions-icons) {
		gap: 0.125rem !important;
		transition: none !important;
	}

	/* llampart-system-prompt-label-all-themes */
	.llampart-system-message-card {
		position: relative;
	}

	.llampart-system-message-content {
		padding-top: 1.625rem;
	}

	.llampart-system-message-label {
		position: absolute;
		top: 0.75rem;
		left: 0.875rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		background-color: color-mix(in oklch, var(--background) 90%, white 10%);
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		border-radius: 0.375rem;
		box-shadow: none;
		font-size: 0.7rem;
		line-height: 1rem;
		font-weight: 500;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
		z-index: 2;
		pointer-events: none;
	}

	/* llampart-system-message-match-user-card-and-system-label */
	.llampart-system-message-card {
		position: relative;
		padding-top: 0.9375rem !important;
	}

	.llampart-system-message-content {
		padding-top: 3.0625rem !important;
	}

	.llampart-system-message-label {
		position: absolute;
		top: 0.9375rem;
		left: 0.9375rem;
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		background: color-mix(in oklch, var(--background) 92%, white 8%);
		border: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
		border-radius: 0.5rem;
		box-shadow: none;
		font-size: 0.7rem;
		line-height: 1rem;
		font-weight: 500;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		white-space: nowrap;
		z-index: 1;
	}

	.llampart-system-message-footer {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.09375rem;
	}

	.llampart-system-message-footer :global(.llampart-message-actions) {
		width: 100%;
		height: auto !important;
		margin-top: 0 !important;
		display: flex;
		justify-content: flex-end;
	}

	.llampart-system-message-footer :global(.llampart-message-actions-icons) {
		gap: 0.125rem !important;
		transition: none !important;
	}

	.llampart-system-message-footer :global([data-slot='button']),
	.llampart-system-message-footer :global(button),
	.llampart-system-message-footer :global(a),
	.llampart-system-message-footer :global([role='button']) {
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

	.llampart-system-message-footer :global([data-slot='button']:hover),
	.llampart-system-message-footer :global([data-slot='button']:focus-visible),
	.llampart-system-message-footer :global(button:hover),
	.llampart-system-message-footer :global(button:focus-visible),
	.llampart-system-message-footer :global(a:hover),
	.llampart-system-message-footer :global(a:focus-visible),
	.llampart-system-message-footer :global([role='button']:hover),
	.llampart-system-message-footer :global([role='button']:focus-visible) {
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

	.llampart-system-message-footer :global(svg) {
		filter: none !important;
		text-shadow: none !important;
		box-shadow: none !important;
		stroke-width: 1.65 !important;
	}
</style>
