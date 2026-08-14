<script lang="ts">
	import { Edit, Copy, Download, RefreshCw, Trash2, GitBranch } from '@lucide/svelte';
	import ActionIcon from '$lib/components/app/actions/ActionIcon.svelte';
	import ChatMessageBranchingControls from '$lib/components/app/chat/ChatMessages/ChatMessageBranchingControls.svelte';
	import DialogConfirmation from '$lib/components/app/dialogs/DialogConfirmation.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { MessageRole } from '$lib/enums';
	import { activeConversation } from '$lib/stores/conversations.svelte';
	import { t } from '$lib/i18n';

	interface Props {
		role: MessageRole.USER | MessageRole.ASSISTANT;
		justify: 'start' | 'end';
		actionsPosition: 'left' | 'right';
		siblingInfo?: ChatMessageSiblingInfo | null;
		showDeleteDialog: boolean;
		deletionInfo: {
			totalCount: number;
			userMessages: number;
			assistantMessages: number;
			messageTypes: string[];
		} | null;
		onCopy: () => void;
		onDownload?: () => void;
		onEdit?: () => void;
		onRegenerate?: () => void;
		onForkConversation?: (options: { name: string; includeAttachments: boolean }) => void;
		onDelete: () => void;
		onConfirmDelete: () => void;
		onNavigateToSibling?: (siblingId: string) => void;
		onShowDeleteDialogChange: (show: boolean) => void;
	}

	let {
		actionsPosition,
		deletionInfo,
		justify,
		onCopy,
		onDownload,
		onEdit,
		onConfirmDelete,
		onDelete,
		onForkConversation,
		onNavigateToSibling,
		onShowDeleteDialogChange,
		onRegenerate,
		role,
		siblingInfo = null,
		showDeleteDialog
	}: Props = $props();

	let showForkDialog = $state(false);
	let forkName = $state('');
	let forkIncludeAttachments = $state(true);

	function handleConfirmDelete() {
		onConfirmDelete();
		onShowDeleteDialogChange(false);
	}

	function handleOpenForkDialog() {
		const conv = activeConversation();

		forkName = t('messages.forkOfConversation').replace(
			'{name}',
			conv?.name ?? t('messages.conversation')
		);
		forkIncludeAttachments = true;
		showForkDialog = true;
	}

	function handleConfirmFork() {
		onForkConversation?.({ name: forkName.trim(), includeAttachments: forkIncludeAttachments });
		showForkDialog = false;
	}
</script>

<div
	class="llampart-message-actions llampart-message-actions-{role.toLowerCase()} relative {justify ===
	'start'
		? 'mt-2'
		: ''} flex h-6 items-center justify-between"
>
	<div
		class="{actionsPosition === 'left'
			? 'left-0'
			: 'right-0'} flex items-center gap-2 opacity-100 transition-opacity"
	>
		{#if siblingInfo && siblingInfo.totalSiblings > 1}
			<ChatMessageBranchingControls {siblingInfo} {onNavigateToSibling} />
		{/if}

		<div
			class="llampart-message-actions-icons pointer-events-auto inset-0 flex items-center gap-1 opacity-100 transition-all duration-150"
		>
			{#if role === MessageRole.ASSISTANT && onDownload}
				<ActionIcon
					icon={Download}
					iconSize="size-3.5"
					tooltip={t('messages.downloadResponseAsMarkdown')}
					onclick={onDownload}
				/>
			{/if}

			<ActionIcon icon={Copy} iconSize="size-3.5" tooltip={t('common.copy')} onclick={onCopy} />

			{#if onEdit}
				<ActionIcon icon={Edit} iconSize="size-3.5" tooltip={t('common.edit')} onclick={onEdit} />
			{/if}

			{#if role === MessageRole.ASSISTANT && onRegenerate}
				<ActionIcon
					icon={RefreshCw}
					iconSize="size-3.5"
					tooltip={t('messages.regenerate')}
					onclick={() => onRegenerate()}
				/>
			{/if}

			{#if onForkConversation}
				<ActionIcon
					icon={GitBranch}
					iconSize="size-3.5"
					tooltip={t('messages.forkConversation')}
					onclick={handleOpenForkDialog}
				/>
			{/if}

			<ActionIcon
				icon={Trash2}
				iconSize="size-3.5"
				tooltip={t('common.delete')}
				onclick={onDelete}
			/>
		</div>
	</div>
</div>

<DialogConfirmation
	bind:open={showDeleteDialog}
	title={t('messages.deleteMessageTitle')}
	description={deletionInfo && deletionInfo.totalCount > 1
		? t('messages.deleteMessagesDescription')
				.replace('{totalCount}', String(deletionInfo.totalCount))
				.replace('{userMessages}', String(deletionInfo.userMessages))
				.replace(
					'{userMessageLabel}',
					deletionInfo.userMessages > 1 ? t('messages.userMessages') : t('messages.userMessage')
				)
				.replace('{assistantMessages}', String(deletionInfo.assistantMessages))
				.replace(
					'{assistantMessageLabel}',
					deletionInfo.assistantMessages > 1
						? t('messages.assistantResponses')
						: t('messages.assistantResponse')
				)
		: t('messages.deleteMessageDescription')}
	confirmText={deletionInfo && deletionInfo.totalCount > 1
		? t('messages.deleteCountMessages').replace('{count}', String(deletionInfo.totalCount))
		: t('common.delete')}
	cancelText={t('common.cancel')}
	variant="destructive"
	icon={Trash2}
	onConfirm={handleConfirmDelete}
	onCancel={() => onShowDeleteDialogChange(false)}
/>

<DialogConfirmation
	bind:open={showForkDialog}
	title={t('messages.forkConversationTitle')}
	description={t('messages.forkConversationDescription')}
	confirmText={t('messages.fork')}
	cancelText={t('common.cancel')}
	icon={GitBranch}
	onConfirm={handleConfirmFork}
	onCancel={() => (showForkDialog = false)}
>
	<div class="flex flex-col gap-4 py-2">
		<div class="flex flex-col gap-2">
			<Label for="fork-name">{t('common.title')}</Label>

			<Input
				id="fork-name"
				class="text-foreground"
				placeholder={t('messages.enterForkName')}
				type="text"
				bind:value={forkName}
			/>
		</div>

		<div class="flex items-center gap-2">
			<Checkbox
				id="fork-attachments"
				checked={forkIncludeAttachments}
				onCheckedChange={(checked) => {
					forkIncludeAttachments = checked === true;
				}}
			/>

			<Label for="fork-attachments" class="cursor-pointer text-sm font-normal">
				{t('messages.includeAllAttachments')}
			</Label>
		</div>
	</div>
</DialogConfirmation>
