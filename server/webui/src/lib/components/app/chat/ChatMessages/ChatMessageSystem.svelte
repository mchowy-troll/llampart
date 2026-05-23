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
			class="llampart-system-message-card w-full max-w-[80%] overflow-y-auto rounded-[1.125rem] border-none bg-primary/5 px-3.75 py-1.5 text-foreground backdrop-blur-md data-[multiline]:py-2.5 dark:bg-primary/15"
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
				<div class="llampart-system-message-footer">
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
	/* llampart-system-message-frosted-glass-card */
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

	:global(html.has-frosted-glass-theme .llampart-system-message-card) {
		border: 1px solid rgba(255, 255, 255, 0.13) !important;
		background: rgba(255, 255, 255, 0.075) !important;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.045),
			0 2px 4px rgba(0, 0, 0, 0.04),
			0 4px 8px rgba(0, 0, 0, 0.035),
			0 8px 16px rgba(0, 0, 0, 0.032),
			0 16px 32px rgba(0, 0, 0, 0.028) !important;
		backdrop-filter: blur(14px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(108%) !important;
		padding-bottom: 0.625rem !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-card),
	:global(html.has-frosted-glass-theme .llampart-system-message-card *) {
		color: #3f444a !important;
		font-weight: 400 !important;
		font-variation-settings: normal !important;
		text-shadow: none !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-system-message-card
			:is(h1, h2, h3, h4, h5, h6, strong, b)
	) {
		color: #3f444a !important;
		font-weight: 500 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-fade) {
		background: linear-gradient(to top, rgba(255, 255, 255, 0.15), transparent) !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-expand-label),
	:global(html.has-frosted-glass-theme .llampart-system-message-collapse-button) {
		background: rgba(255, 255, 255, 0.14) !important;
		border: 1px solid rgba(255, 255, 255, 0.16) !important;
		box-shadow: none !important;
		backdrop-filter: blur(10px) saturate(110%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(110%) !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-system-message-footer {
		margin-right: 0 !important;
		margin-bottom: 0.3125rem !important;
		padding-right: 0 !important;
		padding-bottom: 0 !important;
		color: #3f444a !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(*),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions *) {
		color: #3f444a !important;
		font-weight: 400 !important;
		font-variation-settings: normal !important;
		text-shadow: none !important;
		filter: none !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global([data-slot='button']),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(button),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(a),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global([role='button']) {
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
		.llampart-system-message-footer
		:global([data-slot='button']:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global([data-slot='button']:focus-visible),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(button:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(button:focus-visible),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(a:hover),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(a:focus-visible),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global([role='button']:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
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

	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(svg) {
		color: #3f444a !important;
		stroke: currentColor !important;
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
		box-shadow: none !important;
		transform: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
	}

	/* llampart-system-message-footer-match-user-icons */
	:global(html.has-frosted-glass-theme .llampart-system-message-footer) {
		margin-right: -0.3125rem !important;
		margin-bottom: 0 !important;
		padding-right: 0 !important;
		padding-bottom: 0 !important;
		color: #000000 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-footer :global(*)),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions *) {
		color: #000000 !important;
		font-weight: 400 !important;
		text-shadow: none !important;
		filter: none !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions) {
		width: 100%;
		height: auto !important;
		margin-top: 0 !important;
		display: flex;
		justify-content: flex-end;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions-icons) {
		gap: 0.125rem !important;
		transition: none !important;
	}

	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global([data-slot='button']),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(button),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(a),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global([role='button']) {
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
		.llampart-system-message-footer
		:global([data-slot='button']:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global([data-slot='button']:focus-visible),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(button:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(button:focus-visible),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(a:hover),
	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(a:focus-visible),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global([role='button']:hover),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
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

	:global(html.has-frosted-glass-theme) .llampart-system-message-footer :global(svg) {
		color: #000000 !important;
		stroke: currentColor !important;
		stroke-width: 1.65 !important;
		filter: none !important;
		text-shadow: none !important;
		box-shadow: none !important;
		transform: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
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

	:global(.dark) .llampart-system-message-label {
		background-color: color-mix(in oklch, var(--background) 84%, white 8%);
		border-color: color-mix(in oklch, var(--border) 80%, transparent);
		color: color-mix(in oklch, var(--muted-foreground) 90%, white 10%);
	}

	:global(html.has-frosted-glass-theme) .llampart-system-message-label {
		padding: 0.125rem 0.5rem !important;
		border: 1px solid rgba(255, 255, 255, 0.26) !important;
		border-radius: 0.75rem !important;
		background: rgba(255, 255, 255, 0.28) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 4px 10px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(14px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(108%) !important;
		font-size: 0.7rem !important;
		line-height: 1rem !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		color: #000000 !important;
		text-transform: uppercase !important;
		letter-spacing: 0.05em !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
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

	:global(html.has-frosted-glass-theme .llampart-system-message-card) {
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

	:global(html.has-frosted-glass-theme .llampart-system-message-card),
	:global(html.has-frosted-glass-theme .llampart-system-message-card *) {
		color: #000000 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.64),
			0 0 8px rgba(255, 255, 255, 0.5),
			0 0 16px rgba(255, 255, 255, 0.34) !important;
	}

	:global(
		html.has-frosted-glass-theme
			.llampart-system-message-card
			:is(h1, h2, h3, h4, h5, h6, strong, b)
	) {
		color: #000000 !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-footer) {
		margin-right: -0.3125rem !important;
		margin-left: 0;
		margin-bottom: 0;
		color: #000000 !important;
		text-shadow: none !important;
		filter: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-footer :global(*)),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions),
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-footer
		:global(.llampart-message-actions *) {
		color: #000000 !important;
		font-weight: 400 !important;
		text-shadow: none !important;
		filter: none !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .llampart-system-message-label) {
		background: rgba(255, 255, 255, 0.72) !important;
		border-color: rgba(255, 255, 255, 0.42) !important;
		color: #7a7a7a !important;
		text-shadow: none !important;
		backdrop-filter: blur(8px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(8px) saturate(108%) !important;
	}

	/* llampart-frosted-glass-system-radius-match-llm */
	:global(html.has-frosted-glass-theme .llampart-system-message-card) {
		border-radius: 0.75rem !important;
	}

	/* llampart-system-prompt-label-force-agentic-turn-look-final */
	.llampart-system-message-card .llampart-system-message-label,
	:global(html.has-frosted-glass-theme)
		.llampart-system-message-card
		.llampart-system-message-label,
	:global(html.has-frosted-glass-theme) .llampart-system-message-label {
		padding: 0.125rem 0.5rem !important;
		border: 1px solid rgba(255, 255, 255, 0.26) !important;
		border-radius: 0.75rem !important;
		background: rgba(255, 255, 255, 0.28) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 4px 10px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(14px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(108%) !important;
		font-size: 0.7rem !important;
		line-height: 1rem !important;
		font-weight: 400 !important;
		font-variation-settings: 'wght' 400 !important;
		color: #000000 !important;
		text-transform: uppercase !important;
		letter-spacing: 0.05em !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
	}
</style>
