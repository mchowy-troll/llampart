/**
 * chatStore - Reactive State Store for Chat Operations
 *
 * Manages chat lifecycle, streaming, message operations, and processing state.
 *
 * **Architecture & Relationships:**
 * - **ChatService**: Stateless API layer (sendMessage, streaming)
 * - **chatStore** (this): Reactive state + business logic
 * - **conversationsStore**: Conversation persistence and navigation
 *
 * @see ChatService in services/chat.service.ts for API operations
 */

import { SvelteMap } from 'svelte/reactivity';
import { t } from '$lib/i18n';
import { DatabaseService } from '$lib/services/database.service';
import { ChatService } from '$lib/services/chat.service';
import {
	hasFormProposal,
	recoverFormProposal,
	formVisibleText,
	formFallbackText
} from '$lib/forms/form-protocol';
import { formDefaults } from '$lib/services/interactive-forms';
import type { InteractiveForm } from '$lib/types/interactive-forms';
import { getApiProvider } from '$lib/services/providers';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { contextSize, isRouterMode } from '$lib/stores/server.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { isAbortError, withAbortSignal } from '$lib/utils/abort';
import {
	filterByLeafNodeId,
	findDescendantMessages,
	findLeafNode,
	findMessageById
} from '$lib/utils/branching';
import { normalizeModelName } from '$lib/utils/model-names';
import { modelInfoForResponse } from '$lib/utils/message-model-info';
import { uuid } from '$lib/utils/uuid';
import type { AgenticMessageIdentity } from '$lib/types/agentic';
import { generateConversationTitle } from '$lib/utils/text';
import {
	MAX_INACTIVE_CONVERSATION_STATES,
	INACTIVE_CONVERSATION_STATE_MAX_AGE_MS,
	SYSTEM_MESSAGE_PLACEHOLDER,
	TITLE_GENERATION,
	getLocalizedTitleGenerationPrompt
} from '$lib/constants';
import type {
	ChatMessageTimings,
	ChatMessagePromptProgress,
	ChatStreamCallbacks,
	ErrorDialogState
} from '$lib/types/chat';
import type { ApiProcessingState, DatabaseMessage, DatabaseMessageExtra } from '$lib/types';
import type { ChatStreamCheckpoint } from '$lib/types/settings';
import type { McpServerOverride } from '$lib/types/database';
import type { OperationModel, ProviderRequestContext } from '$lib/types/provider';
import { ErrorDialogType, MessageRole, MessageType } from '$lib/enums';
import {
	hasConversationWriters,
	queuedGenerationReady,
	withConversationWriter,
	type ConversationWriterKind
} from '$lib/services/conversation-writers';

interface ConversationStateEntry {
	lastAccessed: number;
}

export interface GenerationModel {
	readonly providerRequestContext: ProviderRequestContext;
	readonly operationModel: OperationModel;
	readonly apiOptions: Readonly<Record<string, unknown>>;
}

export function resolveHistoricalContextTotal(
	message: Pick<DatabaseMessage, 'model' | 'timings'>,
	getModelContextSize: (model: string) => number | null
): number | null {
	const storedContextTotal = message.timings?.context_total;
	if (typeof storedContextTotal === 'number' && storedContextTotal > 0) {
		return storedContextTotal;
	}

	if (!message.model) return null;
	const modelContextTotal = getModelContextSize(message.model);

	return typeof modelContextTotal === 'number' && modelContextTotal > 0 ? modelContextTotal : null;
}

class ChatStore {
	activeProcessingState = $state<ApiProcessingState | null>(null);
	currentResponse = $state('');
	errorDialogState = $state<ErrorDialogState | null>(null);
	isLoading = $state(false);
	isReasoning = $state(false);
	chatLoadingStates = new SvelteMap<string, boolean>();
	chatStreamingStates = new SvelteMap<string, { response: string; messageId: string }>();
	chatReasoningStates = new SvelteMap<string, boolean>();
	private abortControllers = new SvelteMap<string, AbortController>();
	private preEncodeAbortController: AbortController | null = null;
	private processingStates = new SvelteMap<string, ApiProcessingState | null>();
	private formPreparations = new SvelteMap<
		string,
		{
			operationId: string;
			messageId: string;
			isCurrent: () => boolean;
		}
	>();

	isPreparingForm(conversationId: string, messageId: string): boolean {
		const preparation = this.formPreparations.get(conversationId);
		return preparation?.messageId === messageId && preparation.isCurrent();
	}
	private conversationStateTimestamps = new SvelteMap<string, ConversationStateEntry>();
	private resumingStreams = new Set<string>();
	private conversationOperationLocks = new Set<string>();
	private systemMessageSaveLocks = new Set<string>();
	private activeConversationId = $state<string | null>(null);
	private isStreamingActive = $state(false);
	private isEditModeActive = $state(false);
	private addFilesHandler: ((files: File[]) => void) | null = $state(null);
	pendingEditMessageId = $state<string | null>(null);
	private messageUpdateCallback:
		| ((messageId: string, updates: Partial<DatabaseMessage>) => void)
		| null = null;
	private _pendingDraftMessage = $state<string>('');
	private _pendingDraftFiles = $state<ChatUploadedFile[]>([]);

	private setChatLoading(convId: string, loading: boolean): void {
		this.touchConversationState(convId);
		if (loading) {
			this.chatLoadingStates.set(convId, true);
			if (convId === conversationsStore.activeConversation?.id) this.isLoading = true;
		} else {
			this.chatLoadingStates.delete(convId);
			if (convId === conversationsStore.activeConversation?.id) this.isLoading = false;
		}
	}
	private setChatStreaming(convId: string, response: string, messageId: string): void {
		this.touchConversationState(convId);
		this.chatStreamingStates.set(convId, { response, messageId });
		if (convId === conversationsStore.activeConversation?.id) this.currentResponse = response;
	}
	private clearChatStreaming(convId: string): void {
		this.chatStreamingStates.delete(convId);
		if (convId === conversationsStore.activeConversation?.id) this.currentResponse = '';
	}
	private setChatReasoning(convId: string, reasoning: boolean): void {
		this.touchConversationState(convId);
		if (reasoning) {
			this.chatReasoningStates.set(convId, true);
			if (convId === conversationsStore.activeConversation?.id) this.isReasoning = true;
		} else {
			this.chatReasoningStates.delete(convId);
			if (convId === conversationsStore.activeConversation?.id) this.isReasoning = false;
		}
	}
	private getChatStreaming(convId: string): { response: string; messageId: string } | undefined {
		return this.chatStreamingStates.get(convId);
	}
	syncLoadingStateForChat(convId: string): void {
		this.isLoading = this.chatLoadingStates.get(convId) || false;
		const s = this.chatStreamingStates.get(convId);
		this.currentResponse = s?.response || '';
		this.isReasoning = this.chatReasoningStates.get(convId) || false;
		this.isStreamingActive = s !== undefined;
		this.setActiveProcessingConversation(convId);
		// Sync streaming content to activeMessages so UI displays current content
		if (s?.response && s?.messageId) {
			const idx = conversationsStore.findMessageIndex(s.messageId);
			if (idx !== -1) {
				conversationsStore.updateMessageAtIndex(idx, { content: s.response });
			}
		}
	}

	clearUIState(): void {
		if (this.activeConversationId) {
			this.formPreparations.delete(this.activeConversationId);
		}
		this.isLoading = false;
		this.currentResponse = '';
		this.isReasoning = false;
		this.isStreamingActive = false;
	}

	setActiveProcessingConversation(conversationId: string | null): void {
		this.activeConversationId = conversationId;
		this.activeProcessingState = conversationId
			? this.processingStates.get(conversationId) || null
			: null;
	}

	getProcessingState(conversationId: string): ApiProcessingState | null {
		return this.processingStates.get(conversationId) || null;
	}

	private setProcessingState(conversationId: string, state: ApiProcessingState | null): void {
		if (state === null) this.processingStates.delete(conversationId);
		else this.processingStates.set(conversationId, state);
		if (conversationId === this.activeConversationId) this.activeProcessingState = state;
	}

	clearProcessingState(conversationId: string): void {
		this.formPreparations.delete(conversationId);
		this.processingStates.delete(conversationId);
		if (conversationId === this.activeConversationId) this.activeProcessingState = null;
	}

	getActiveProcessingState(): ApiProcessingState | null {
		return this.activeProcessingState;
	}

	getCurrentProcessingStateSync(): ApiProcessingState | null {
		return this.activeProcessingState;
	}

	private setStreamingActive(active: boolean): void {
		this.isStreamingActive = active;
	}

	isStreaming(): boolean {
		return this.isStreamingActive;
	}

	/** Called only on demand by repair; never subscribed to by historical Markdown. */
	isVisualizationRepairIdle(convId: string): boolean {
		const processing = this.processingStates.get(convId);
		// Writer scopes include Abort/Stop and pending persistence after UI cleanup.
		// A retained, inactive AbortController alone is not evidence of active work.
		return !(
			hasConversationWriters(convId) ||
			(processing && processing.status !== 'idle') ||
			this.chatLoadingStates.has(convId) ||
			this.chatStreamingStates.has(convId) ||
			this.resumingStreams.has(convId) ||
			this.conversationOperationLocks.has(convId) ||
			this.conversationOperationLocks.has('__new_conversation__') ||
			agenticStore.isRunning(convId) ||
			ChatService.getResumableState(convId)
		);
	}

	private withActiveConversationWriter<T>(
		operation: () => Promise<T>,
		kind: ConversationWriterKind = 'write'
	): Promise<T> {
		const conversationId = conversationsStore.activeConversation?.id;
		return withConversationWriter(
			conversationId,
			() => {
				if (conversationsStore.activeConversation?.id !== conversationId)
					throw new Error('Conversation context changed before queued operation');
				return operation();
			},
			kind
		);
	}

	private getOrCreateAbortController(convId: string): AbortController {
		let c = this.abortControllers.get(convId);
		if (!c || c.signal.aborted) {
			c = new AbortController();
			this.abortControllers.set(convId, c);
		}
		return c;
	}

	private abortRequest(convId?: string): void {
		if (convId) {
			const c = this.abortControllers.get(convId);
			if (c) {
				c.abort();
				this.abortControllers.delete(convId);
			}
		} else {
			for (const c of this.abortControllers.values()) c.abort();
			this.abortControllers.clear();
		}
	}

	handleProviderSourceSwitch(): void {
		const activeConversationIds = [...this.abortControllers.keys()];
		ChatService.invalidateProviderRequestContexts();
		this.cancelPreEncode();
		this.abortRequest();
		for (const convId of activeConversationIds) {
			void ChatService.stopResumableStream(convId);
		}
		ChatService.discardAllResumableStreams();
		for (const convId of this.chatLoadingStates.keys()) {
			this.setChatLoading(convId, false);
			this.clearChatStreaming(convId);
			this.setChatReasoning(convId, false);
			this.setProcessingState(convId, null);
		}
		this.setStreamingActive(false);
	}

	private showErrorDialog(state: ErrorDialogState | null): void {
		this.errorDialogState = state;
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : 'Unknown error';
	}

	dismissErrorDialog(): void {
		this.errorDialogState = null;
	}

	clearEditMode(): void {
		this.isEditModeActive = false;
		this.addFilesHandler = null;
	}

	isEditing(): boolean {
		return this.isEditModeActive;
	}

	setEditModeActive(handler: (files: File[]) => void): void {
		this.isEditModeActive = true;
		this.addFilesHandler = handler;
	}

	getAddFilesHandler(): ((files: File[]) => void) | null {
		return this.addFilesHandler;
	}

	clearPendingEditMessageId(): void {
		this.pendingEditMessageId = null;
	}

	savePendingDraft(message: string, files: ChatUploadedFile[]): void {
		this._pendingDraftMessage = message;
		this._pendingDraftFiles = [...files];
	}

	consumePendingDraft(): { message: string; files: ChatUploadedFile[] } | null {
		if (!this._pendingDraftMessage && this._pendingDraftFiles.length === 0) return null;
		const d = { message: this._pendingDraftMessage, files: [...this._pendingDraftFiles] };
		this._pendingDraftMessage = '';
		this._pendingDraftFiles = [];
		return d;
	}

	hasPendingDraft(): boolean {
		return Boolean(this._pendingDraftMessage) || this._pendingDraftFiles.length > 0;
	}

	getAllLoadingChats(): string[] {
		return Array.from(this.chatLoadingStates.keys());
	}

	getAllStreamingChats(): string[] {
		return Array.from(this.chatStreamingStates.keys());
	}

	getChatStreamingPublic(convId: string): { response: string; messageId: string } | undefined {
		return this.getChatStreaming(convId);
	}

	isChatLoadingPublic(convId: string): boolean {
		return this.chatLoadingStates.get(convId) || false;
	}

	private isChatLoadingInternal(convId: string): boolean {
		return this.chatLoadingStates.has(convId) || this.conversationOperationLocks.has(convId);
	}

	private touchConversationState(convId: string): void {
		this.conversationStateTimestamps.set(convId, { lastAccessed: Date.now() });
	}

	cleanupOldConversationStates(activeConversationIds?: string[]): number {
		const now = Date.now();
		const activeIdsList = activeConversationIds ?? [];
		const preserveIds = this.activeConversationId
			? [...activeIdsList, this.activeConversationId]
			: activeIdsList;
		const allConvIds = [
			...new Set([
				...this.chatLoadingStates.keys(),
				...this.chatStreamingStates.keys(),
				...this.abortControllers.keys(),
				...this.processingStates.keys(),
				...this.conversationStateTimestamps.keys()
			])
		];
		const cleanupCandidates: Array<{ convId: string; lastAccessed: number }> = [];
		for (const convId of allConvIds) {
			if (preserveIds.includes(convId)) continue;
			if (this.chatLoadingStates.get(convId)) continue;
			if (this.chatStreamingStates.has(convId)) continue;
			const ts = this.conversationStateTimestamps.get(convId);
			cleanupCandidates.push({ convId, lastAccessed: ts?.lastAccessed ?? 0 });
		}
		cleanupCandidates.sort((a, b) => a.lastAccessed - b.lastAccessed);
		let cleanedUp = 0;
		for (const { convId, lastAccessed } of cleanupCandidates) {
			if (
				cleanupCandidates.length - cleanedUp > MAX_INACTIVE_CONVERSATION_STATES ||
				now - lastAccessed > INACTIVE_CONVERSATION_STATE_MAX_AGE_MS
			) {
				this.cleanupConversationState(convId);
				cleanedUp++;
			}
		}
		return cleanedUp;
	}
	private cleanupConversationState(convId: string): void {
		const c = this.abortControllers.get(convId);
		if (c && !c.signal.aborted) c.abort();
		this.chatLoadingStates.delete(convId);
		this.chatStreamingStates.delete(convId);
		this.abortControllers.delete(convId);
		this.processingStates.delete(convId);
		this.conversationStateTimestamps.delete(convId);
	}
	getTrackedConversationCount(): number {
		return new Set([
			...this.chatLoadingStates.keys(),
			...this.chatStreamingStates.keys(),
			...this.abortControllers.keys(),
			...this.processingStates.keys()
		]).size;
	}

	private getMessageByIdWithRole(
		messageId: string,
		expectedRole?: MessageRole
	): { message: DatabaseMessage; index: number } | null {
		const index = conversationsStore.findMessageIndex(messageId);
		if (index === -1) return null;
		const message = conversationsStore.activeMessages[index];
		if (expectedRole && message.role !== expectedRole) return null;
		return { message, index };
	}

	async addMessage(
		role: MessageRole,
		content: string,
		type: MessageType = MessageType.TEXT,
		parent: string = '-1',
		extras?: DatabaseMessageExtra[],
		convId = conversationsStore.activeConversation?.id
	): Promise<DatabaseMessage> {
		if (!convId) throw new Error('No active conversation');
		let parentId: string | null = null;
		if (parent === '-1') {
			const am =
				conversationsStore.activeConversation?.id === convId
					? conversationsStore.activeMessages
					: [];
			if (am.length > 0) parentId = am[am.length - 1].id;
			else {
				const conversation =
					conversationsStore.activeConversation?.id === convId
						? conversationsStore.activeConversation
						: await DatabaseService.getConversation(convId);
				const all = await conversationsStore.getConversationMessages(convId);
				const r = all.find((m) => m.parent === null && m.type === 'root');
				parentId =
					conversation?.currNode || r?.id || (await DatabaseService.createRootMessage(convId));
			}
		} else parentId = parent;
		const message = await DatabaseService.createMessageBranch(
			{
				convId,
				role,
				content,
				type,
				timestamp: Date.now(),
				toolCalls: '',
				children: [],
				extra: extras
			},
			parentId
		);
		conversationsStore.addMessageToActive(message);
		await conversationsStore.updateConversationCurrentNode(convId, message.id);
		await conversationsStore.refreshConversationTimestamp(convId);
		return message;
	}

	async addSystemPrompt(): Promise<void> {
		await this.withActiveConversationWriter(() => this.addSystemPromptImpl());
	}

	private async addSystemPromptImpl(): Promise<void> {
		let activeConv = conversationsStore.activeConversation;
		if (!activeConv) {
			const convId = await conversationsStore.createConversation();
			activeConv =
				conversationsStore.activeConversation?.id === convId
					? conversationsStore.activeConversation
					: ((await DatabaseService.getConversation(convId)) ?? null);
		}
		if (!activeConv) return;
		const firstActiveMessage =
			conversationsStore.activeConversation?.id === activeConv.id
				? conversationsStore.activeMessages[0]
				: undefined;
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const rootId = rootMessage
				? rootMessage.id
				: await DatabaseService.createRootMessage(activeConv.id);
			const existingSystemMessage = allMessages.find(
				(m) => m.role === MessageRole.SYSTEM && m.parent === rootId
			);
			if (existingSystemMessage) {
				if (conversationsStore.activeConversation?.id !== activeConv.id) return;
				this.pendingEditMessageId = existingSystemMessage.id;
				if (!conversationsStore.activeMessages.some((m) => m.id === existingSystemMessage.id))
					conversationsStore.activeMessages.unshift(existingSystemMessage);
				return;
			}
			const systemMessage = await DatabaseService.insertSystemPrompt(
				activeConv.id,
				SYSTEM_MESSAGE_PLACEHOLDER,
				rootId,
				firstActiveMessage?.parent === rootId ? firstActiveMessage.id : undefined
			);
			if (conversationsStore.activeConversation?.id === activeConv.id) {
				if (firstActiveMessage) {
					const firstMsgIndex = conversationsStore.findMessageIndex(firstActiveMessage.id);
					if (firstMsgIndex !== -1)
						conversationsStore.updateMessageAtIndex(firstMsgIndex, { parent: systemMessage.id });
				}
				if (conversationsStore.findMessageIndex(systemMessage.id) === -1)
					conversationsStore.activeMessages.unshift(systemMessage);
				this.pendingEditMessageId = systemMessage.id;
			}
			await conversationsStore.refreshConversationTimestamp(activeConv.id);
		} catch (error) {
			console.error('Failed to add system prompt:', error);
		}
	}

	/** Edits one system prompt in place without changing an in-flight generation's history. */
	async editSystemMessage(convId: string, messageId: string, newContent: string): Promise<void> {
		await withConversationWriter(convId, () =>
			this.editSystemMessageImpl(convId, messageId, newContent)
		);
	}

	private async editSystemMessageImpl(
		convId: string,
		messageId: string,
		newContent: string
	): Promise<void> {
		if (this.systemMessageSaveLocks.has(messageId)) {
			throw new Error('System message save already in progress');
		}
		this.systemMessageSaveLocks.add(messageId);
		try {
			// Both IDs belong to the edit, never to the selection after an await.
			const messages = await conversationsStore.getConversationMessages(convId);
			const message = findMessageById(messages, messageId);
			if (
				!message ||
				message.convId !== convId ||
				message.role !== MessageRole.SYSTEM ||
				message.type === MessageType.ROOT
			) {
				throw new Error('System message not found in the target conversation');
			}
			await DatabaseService.updateConversationMessage(convId, messageId, { content: newContent });
			if (conversationsStore.activeConversation?.id === convId) {
				const index = conversationsStore.findMessageIndex(messageId);
				// Replace only content; preserve current graph metadata and operation snapshots.
				conversationsStore.updateMessageAtIndex(index, { content: newContent });
			}
			await conversationsStore.refreshConversationTimestamp(convId);
		} finally {
			this.systemMessageSaveLocks.delete(messageId);
		}
	}

	async removeSystemPromptPlaceholder(messageId: string): Promise<boolean> {
		return (
			(await this.withActiveConversationWriter(() =>
				this.removeSystemPromptPlaceholderImpl(messageId)
			)) ?? false
		);
	}

	private async removeSystemPromptPlaceholderImpl(messageId: string): Promise<boolean> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return false;
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const systemMessage = findMessageById(allMessages, messageId);
			if (!systemMessage || systemMessage.role !== MessageRole.SYSTEM) return false;
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			if (!rootMessage) return false;
			if (allMessages.length === 2 && systemMessage.children.length === 0) {
				await conversationsStore.deleteConversation(activeConv.id);
				return true;
			}
			await DatabaseService.removeSystemPrompt(activeConv.id, messageId);
			if (conversationsStore.activeConversation?.id === activeConv.id) {
				for (const childId of systemMessage.children) {
					const childIndex = conversationsStore.findMessageIndex(childId);
					if (childIndex !== -1)
						conversationsStore.updateMessageAtIndex(childIndex, { parent: rootMessage.id });
				}
				const systemIndex = conversationsStore.findMessageIndex(messageId);
				if (systemIndex !== -1) conversationsStore.activeMessages.splice(systemIndex, 1);
			}
			await conversationsStore.refreshConversationTimestamp(activeConv.id);
			return false;
		} catch (error) {
			console.error('Failed to remove system prompt placeholder:', error);
			return false;
		}
	}

	private async createAssistantMessage(convId: string, parentId: string): Promise<DatabaseMessage> {
		return await DatabaseService.createMessageBranch(
			{
				convId,
				type: MessageType.TEXT,
				role: MessageRole.ASSISTANT,
				content: '',
				timestamp: Date.now(),
				toolCalls: '',
				children: [],
				model: null
			},
			parentId
		);
	}

	async sendMessage(content: string, extras?: DatabaseMessageExtra[]): Promise<void> {
		await this.withActiveConversationWriter(
			() => this.sendMessageImpl(content, extras),
			'generation'
		);
	}

	/** Same controlled send owner as the composer; no renderer-owned network or tools. */
	async submitInteractiveForm(messageId: string, formId: string): Promise<void> {
		if (config().interactiveFormsEnabled !== true) throw new Error('Forms disabled');
		const conversationId = conversationsStore.activeConversation?.id;
		if (!conversationId || !globalThis.navigator?.locks)
			throw new Error('Safe form submission is unavailable');
		await navigator.locks.request(
			`llampart-form:${conversationId}:${formId}`,
			{ ifAvailable: true },
			async (lock) => {
				if (!lock || conversationsStore.activeConversation?.id !== conversationId)
					throw new Error('Form submission is already in progress or the conversation changed');
				await conversationsStore.flushInteractiveForm(formId);
				await this.withActiveConversationWriter(
					() => this.sendMessageImpl('', undefined, { messageId, formId }),
					'generation'
				);
			}
		);
	}

	private async sendMessageImpl(
		content: string,
		extras?: DatabaseMessageExtra[],
		formSubmission?: { messageId: string; formId: string }
	): Promise<void> {
		if (!formSubmission && !content.trim() && (!extras || extras.length === 0)) return;
		const activeConv = conversationsStore.activeConversation;
		if (
			formSubmission &&
			(!activeConv ||
				config().interactiveFormsEnabled !== true ||
				this.isChatLoadingInternal(activeConv.id))
		)
			throw new Error('Conversation unavailable or busy');
		const operationKey = activeConv?.id ?? '__new_conversation__';
		if (this.conversationOperationLocks.has('__new_conversation__')) return;
		if (this.conversationOperationLocks.has(operationKey)) return;
		if (activeConv && this.isChatLoadingInternal(activeConv.id)) return;
		this.conversationOperationLocks.add(operationKey);
		let lockedConversationId: string | null = activeConv?.id ?? null;
		let generationModel = this.captureGenerationModel();

		try {
			// Cancel any in-flight pre-encode request
			this.cancelPreEncode();

			// Consume MCP resource attachments - converts them to extras and clears the live store
			const resourceExtras = formSubmission ? [] : mcpStore.consumeResourceAttachmentsAsExtras();
			const allExtras = resourceExtras.length > 0 ? [...(extras || []), ...resourceExtras] : extras;

			let isNewConversation = false;
			if (!activeConv) {
				lockedConversationId = await conversationsStore.createConversation();
				isNewConversation = true;
			}
			const currentConv =
				activeConv ??
				(conversationsStore.activeConversation?.id === lockedConversationId
					? conversationsStore.activeConversation
					: lockedConversationId
						? await DatabaseService.getConversation(lockedConversationId)
						: null);
			if (!currentConv) return;
			// Capture ownership before message persistence, so even an early manual
			// rename takes precedence over both standard and LLM naming.
			let firstTitleNameVersion = conversationsStore.getNameUpdateVersion(currentConv.id);
			if (!generationModel.operationModel.conversationId) {
				generationModel = Object.freeze({
					...generationModel,
					operationModel: Object.freeze({
						...generationModel.operationModel,
						conversationId: currentConv.id
					})
				});
			}
			const perChatOverrides = currentConv.mcpServerOverrides?.map(
				(override: McpServerOverride) => ({ ...override })
			);
			this.conversationOperationLocks.add(currentConv.id);
			lockedConversationId = currentConv.id;
			this.showErrorDialog(null);
			this.setChatLoading(currentConv.id, true);
			this.clearChatStreaming(currentConv.id);
			try {
				let parentIdForUserMessage: string | undefined;
				if (isNewConversation) {
					const rootId = await DatabaseService.createRootMessage(currentConv.id);
					const currentConfig = config();
					const systemPrompt = currentConfig.systemMessage?.toString().trim();
					if (systemPrompt) {
						const systemMessage = await DatabaseService.createSystemMessage(
							currentConv.id,
							systemPrompt,
							rootId
						);
						conversationsStore.addMessageToActive(systemMessage);
						parentIdForUserMessage = systemMessage.id;
					} else parentIdForUserMessage = rootId;
				}
				const preparedForm = formSubmission
					? await DatabaseService.prepareInteractiveFormSubmission(
							currentConv.id,
							formSubmission.messageId,
							formSubmission.formId
						)
					: undefined;
				if (preparedForm) {
					content = preparedForm.user.content;
					if (conversationsStore.activeConversation?.id === currentConv.id) {
						const index = conversationsStore.findMessageIndex(preparedForm.owner.id);
						if (index !== -1)
							conversationsStore.updateMessageAtIndex(index, {
								interactiveForm: preparedForm.owner.interactiveForm
							});
						// The transaction advanced currNode to the reserved user message.
						// Reload that pointer too, so the first Submit shows its user result.
						await conversationsStore.loadConversation(currentConv.id);
					}
				}
				const userMessage =
					preparedForm?.user ??
					(await this.addMessage(
						MessageRole.USER,
						content,
						MessageType.TEXT,
						parentIdForUserMessage ?? '-1',
						allExtras,
						currentConv.id
					));
				if (
					isNewConversation &&
					content &&
					conversationsStore.getNameUpdateVersion(currentConv.id) === firstTitleNameVersion
				) {
					firstTitleNameVersion += 1;
					await conversationsStore
						.updateConversationName(
							currentConv.id,
							generateConversationTitle(content, Boolean(config().titleGenerationUseFirstLine))
						)
						.catch((error) => {
							// Naming is best-effort: the user message is already persisted.
							console.warn('Failed to name new conversation:', error);
						});
				}
				const assistantMessage = await this.createAssistantMessage(currentConv.id, userMessage.id);
				conversationsStore.addMessageToActive(assistantMessage);
				const history = await conversationsStore.getConversationMessages(currentConv.id);
				await this.streamChatCompletion(
					filterByLeafNodeId(history, userMessage.id, false) as DatabaseMessage[],
					assistantMessage,
					formSubmission
						? async () => {
								const saved = await DatabaseService.completeInteractiveFormSubmission(
									currentConv.id,
									formSubmission.messageId,
									formSubmission.formId,
									userMessage.id
								);
								if (conversationsStore.activeConversation?.id === currentConv.id) {
									const index = conversationsStore.findMessageIndex(saved.id);
									if (index !== -1)
										conversationsStore.updateMessageAtIndex(index, {
											interactiveForm: saved.interactiveForm
										});
								}
							}
						: undefined,
					undefined,
					generationModel,
					config().titleGenerationUseLLM && isNewConversation
						? { userContent: content, nameVersion: firstTitleNameVersion }
						: undefined,
					perChatOverrides
				);
				if (formSubmission) {
					const owner = (await conversationsStore.getConversationMessages(currentConv.id)).find(
						(m) => m.id === formSubmission.messageId
					);
					if (owner?.interactiveForm?.status !== 'submitted')
						throw new Error('Answers not sent; retry the saved submission');
				}
			} catch (error) {
				if (isAbortError(error)) {
					this.setChatLoading(currentConv.id, false);
					return;
				}
				console.error('Failed to send message:', error);
				this.setChatLoading(currentConv.id, false);
				const dialogType =
					error instanceof Error && error.name === 'TimeoutError'
						? ErrorDialogType.TIMEOUT
						: ErrorDialogType.SERVER;
				const contextInfo = (
					error as Error & { contextInfo?: { n_prompt_tokens: number; n_ctx: number } }
				).contextInfo;
				this.showErrorDialog({
					type: dialogType,
					message: this.getErrorMessage(error),
					contextInfo
				});
				if (formSubmission) throw error;
			}
		} finally {
			this.conversationOperationLocks.delete(operationKey);
			if (lockedConversationId) this.conversationOperationLocks.delete(lockedConversationId);
		}
	}

	private async cancelPendingAssistant(
		assistant: DatabaseMessage,
		controller: AbortController
	): Promise<void> {
		const convId = assistant.convId;
		try {
			const removed = assistant.parent
				? await DatabaseService.deleteEmptyAssistantMessage(convId, assistant.id, assistant.parent)
				: null;
			if (!removed) return;
			const repair = (conversation: DatabaseConversation): DatabaseConversation => ({
				...conversation,
				currNode: conversation.currNode === assistant.id ? removed.parentId : conversation.currNode,
				lastModified: Math.max(conversation.lastModified, removed.lastModified)
			});
			if (conversationsStore.activeConversation?.id === convId) {
				conversationsStore.activeMessages = conversationsStore.activeMessages
					.filter((message) => message.id !== assistant.id)
					.map((message) =>
						message.children.includes(assistant.id)
							? {
									...message,
									children: message.children.filter((id: string) => id !== assistant.id)
								}
							: message
					);
				conversationsStore.activeConversation = repair(conversationsStore.activeConversation);
			}
			conversationsStore.conversations = conversationsStore.conversations.map((conversation) =>
				conversation.id === convId ? repair(conversation) : conversation
			);
		} catch (error) {
			console.error('Failed to remove cancelled pending assistant:', error);
		} finally {
			// Never clear loading/streaming owned by a replacement request (even in the same chat).
			if (this.abortControllers.get(convId) === controller) {
				this.abortControllers.delete(convId);
				this.setChatLoading(convId, false);
				this.clearChatStreaming(convId);
				this.setChatReasoning(convId, false);
				this.setProcessingState(convId, null);
				if (conversationsStore.activeConversation?.id === convId) this.setStreamingActive(false);
			}
		}
	}

	private captureGenerationModel(
		modelOverride?: string | null,
		messages = conversationsStore.activeMessages
	): GenerationModel {
		const providerRequestContext = ChatService.createProviderRequestContext();
		return Object.freeze({
			providerRequestContext,
			apiOptions: Object.freeze(this.getApiOptions()),
			operationModel: ChatService.captureOperationModel(
				providerRequestContext,
				modelOverride,
				this.getConversationModel(messages),
				{
					conversationId: conversationsStore.activeConversation?.id ?? null
				}
			)
		});
	}

	private async streamChatCompletion(
		allMessages: DatabaseMessage[],
		assistantMessage: DatabaseMessage,
		onComplete: ((content: string) => Promise<void>) | undefined,
		onError: ((error: Error) => void) | undefined,
		generationModel: GenerationModel,
		firstTitle?: { userContent: string; nameVersion: number },
		perChatOverrides?: McpServerOverride[]
	): Promise<void> {
		const requestBinding = generationModel;
		const { providerRequestContext, operationModel } = requestBinding;
		if (operationModel.conversationId && operationModel.conversationId !== assistantMessage.convId)
			throw new Error('Generation belongs to a different conversation');
		const effectiveModel = operationModel.model;
		const apiOptions = requestBinding.apiOptions;
		const abortController = new AbortController();
		this.abortControllers.set(assistantMessage.convId, abortController);
		queuedGenerationReady(assistantMessage.convId);

		if (isRouterMode() && effectiveModel) {
			try {
				await withAbortSignal(operationModel.capabilities, abortController.signal);
			} catch (error) {
				if (!isAbortError(error)) throw error;
			}
		}
		// The promise belongs to this synchronous operation owner, not the later
		// selected model. Discovery failures remain handled by sendMessage's barrier.
		const verifiedModelInfo = await withAbortSignal(
			operationModel.modelInfo,
			abortController.signal
		).catch(() => null);
		if (
			abortController.signal.aborted ||
			!ChatService.isProviderRequestContextCurrent(providerRequestContext)
		) {
			await this.cancelPendingAssistant(assistantMessage, abortController);
			return;
		}

		// Request identity is exact; historical display normalization stays in recordModel().
		const frozenModel = effectiveModel;
		const shouldPreEncode =
			getApiProvider(providerRequestContext.providerId).capabilities.supportsPreEncode &&
			Boolean(config().preEncodeConversation);
		const excludeReasoningFromPreEncode = Boolean(config().excludeReasoningFromContext);
		const resolvedContextTotal = this.getContextTotal(frozenModel);
		const withContextTotal = (
			timings: ChatMessageTimings | undefined
		): ChatMessageTimings | undefined => {
			if (!timings || resolvedContextTotal === null) return timings;

			return { ...timings, context_total: resolvedContextTotal };
		};

		// Mutable state for the current message being streamed
		let currentAssistantMessageId = assistantMessage.id;
		let branchTailId = assistantMessage.id;
		const operationId = uuid();
		const assistants = new SvelteMap([[assistantMessage.id, assistantMessage]]);
		const persistedResultIds: string[] = [];
		let flowFinalized = false;
		const assertIdentity = (identity: AgenticMessageIdentity): void => {
			if (
				identity.conversationId !== assistantMessage.convId ||
				identity.operationId !== operationId ||
				!assistants.has(identity.assistantMessageId)
			) {
				throw new Error('Stale or foreign agentic callback');
			}
		};
		let streamedContent = '';
		let streamedReasoningContent = '';
		let formDecisionCompleted = false;
		let formDecisionRefused = false;
		let resolvedModel: string | null = null;
		let currentModelInfo = verifiedModelInfo ?? undefined;
		let modelWrites = Promise.resolve();
		let completionWrite = Promise.resolve();
		const convId = assistantMessage.convId;
		// Selection/branch restoration replaces this array. Returning to the same
		// conversation later must not revive an abandoned auxiliary form request.
		const formMessages = conversationsStore.activeMessages;
		let formNode = conversationsStore.activeConversation?.currNode;
		let pendingFormNode: string | undefined;
		const isFormPreparationCurrent = () =>
			!abortController.signal.aborted &&
			this.abortControllers.get(convId) === abortController &&
			ChatService.isProviderRequestContextCurrent(providerRequestContext) &&
			operationModel.chatInstructions?.interactiveFormsEnabled === true &&
			config().interactiveFormsEnabled === true &&
			operationModel.interactiveFormsEpoch === settingsStore.interactiveFormsEpoch &&
			conversationsStore.activeConversation?.id === convId &&
			(conversationsStore.activeConversation.currNode === formNode ||
				conversationsStore.activeConversation.currNode === pendingFormNode) &&
			conversationsStore.activeMessages === formMessages;
		const clearFormPreparation = () => {
			if (this.formPreparations.get(convId)?.operationId === operationId) {
				this.formPreparations.delete(convId);
			}
		};
		abortController.signal.addEventListener('abort', clearFormPreparation, { once: true });
		const recognizeForm = () => {
			if (
				hasFormProposal(streamedContent) &&
				!this.formPreparations.has(convId) &&
				isFormPreparationCurrent()
			) {
				this.formPreparations.set(convId, {
					operationId,
					messageId: currentAssistantMessageId,
					isCurrent: isFormPreparationCurrent
				});
			}
		};
		const completeForm = async (
			raw: string,
			messageId: string
		): Promise<
			| {
					update: { content: string; interactiveForm?: InteractiveForm };
					isCurrent: () => boolean;
			  }
			| undefined
		> => {
			const text = () =>
				formVisibleText(raw, true) || (raw ? t('interactiveForms.proposalFailed') : '');
			if (!hasFormProposal(raw)) return { update: { content: text() }, isCurrent: () => true };
			const selectedNode = conversationsStore.activeConversation?.currNode;
			const isCurrent = () =>
				!abortController.signal.aborted &&
				this.abortControllers.get(convId) === abortController &&
				ChatService.isProviderRequestContextCurrent(providerRequestContext) &&
				config().interactiveFormsEnabled === true &&
				operationModel.interactiveFormsEpoch === settingsStore.interactiveFormsEpoch &&
				conversationsStore.activeConversation?.id === convId &&
				conversationsStore.activeConversation.currNode === selectedNode &&
				conversationsStore.activeMessages === formMessages &&
				formMessages.some((m) => m.id === messageId && m.convId === convId && m.content === raw);
			if (!isCurrent()) return;
			// The main request has ended. Keep its context, but do not present its
			// last generation speed as activity in the independent specification request.
			const processing = this.getProcessingState(convId);
			if (processing)
				this.setProcessingState(convId, {
					...processing,
					status: 'idle',
					hasNextToken: false,
					tokensPerSecond: undefined,
					promptProgress: undefined
				});
			if (!formDecisionCompleted) return { update: { content: text() }, isCurrent };
			const proposal = recoverFormProposal(raw);
			if (!proposal)
				return { update: { content: t('interactiveForms.proposalFailed') }, isCurrent };
			const content = formFallbackText(proposal);
			if (content.length > 12000) return { update: { content }, isCurrent };
			const spec = await ChatService.generateInteractiveForm(
				proposal,
				operationModel,
				abortController.signal,
				isCurrent
			);
			if (!isCurrent()) return;
			if (!spec) return { update: { content }, isCurrent };
			const introduction = proposal?.structured ? proposal.intro : content;
			return {
				isCurrent,
				update: {
					content: introduction,
					interactiveForm: {
						id: uuid(),
						messageId,
						conversationId: convId,
						sourceContent: introduction,
						spec,
						values: formDefaults(spec),
						revision: 0,
						status: 'draft'
					}
				}
			};
		};
		let titleAttempted = false;
		const generateFirstTitle = async (content: string): Promise<void> => {
			if (
				titleAttempted ||
				!firstTitle?.userContent ||
				!content.trim() ||
				abortController.signal.aborted ||
				conversationsStore.getNameUpdateVersion(convId) !== firstTitle.nameVersion
			)
				return;
			titleAttempted = true;
			await this.generateTitleWithLLM(
				firstTitle.userContent,
				content,
				convId,
				requestBinding,
				firstTitle.nameVersion,
				abortController.signal
			);
		};
		const updateActiveMessage = (messageId: string, update: Partial<DatabaseMessage>): void => {
			if (conversationsStore.activeConversation?.id !== convId) return;
			const index = conversationsStore.findMessageIndex(messageId);
			if (index !== -1) conversationsStore.updateMessageAtIndex(index, update);
		};
		const updateConversationCurrentNode = async (messageId: string): Promise<void> => {
			// Only a still-current operation may advance its expected branch. Accept
			// both endpoints while IDB awaits and the owned UI pointer is published.
			const advancesFormBranch = isFormPreparationCurrent();
			if (advancesFormBranch) pendingFormNode = messageId;
			try {
				await conversationsStore.updateConversationCurrentNode(convId, messageId);
				if (advancesFormBranch) formNode = messageId;
			} finally {
				pendingFormNode = undefined;
			}
		};

		const recordCompletionId = (() => {
			let completionIdRecorded = false;

			return (id: string): void => {
				if (!id || completionIdRecorded) return;
				completionIdRecorded = true;
				updateActiveMessage(currentAssistantMessageId, { completionId: id });
				completionWrite = DatabaseService.updateMessage(currentAssistantMessageId, {
					completionId: id
				}).catch(() => {
					completionIdRecorded = false;
				});
			};
		})();

		const recordModel = (modelName: string | null | undefined): void => {
			if (!modelName) return;
			const n =
				providerRequestContext.providerId === 'llama-server'
					? normalizeModelName(modelName)
					: modelName;
			const info = verifiedModelInfo
				? modelInfoForResponse(verifiedModelInfo, modelName)
				: undefined;
			if (!n || (n === resolvedModel && JSON.stringify(info) === JSON.stringify(currentModelInfo)))
				return;
			resolvedModel = n;
			currentModelInfo = info;
			const messageId = currentAssistantMessageId;
			const update = { model: n, ...(info ? { modelInfo: info } : {}) };
			updateActiveMessage(messageId, update);
			// Capture the exact ID and value before scheduling, including agentic turns.
			// Recover only the previous (already logged) failure so this write can run.
			// The latest promise stays rejected on failure for the existing await barriers.
			modelWrites = modelWrites
				.catch(() => undefined)
				.then(() => DatabaseService.updateMessage(messageId, update));
			void modelWrites.catch((error) => {
				console.error('Failed to persist message model:', messageId, error);
			});
		};

		if (verifiedModelInfo) {
			await DatabaseService.updateMessage(assistantMessage.id, {
				modelInfo: verifiedModelInfo,
				...(verifiedModelInfo.displayName ? { model: verifiedModelInfo.displayName } : {})
			});
			updateActiveMessage(assistantMessage.id, {
				modelInfo: verifiedModelInfo,
				...(verifiedModelInfo.displayName ? { model: verifiedModelInfo.displayName } : {})
			});
			resolvedModel = verifiedModelInfo.displayName;
		} else if (frozenModel) recordModel(frozenModel);

		const updateStreamingUI = () => {
			this.setChatStreaming(convId, streamedContent, currentAssistantMessageId);
			updateActiveMessage(currentAssistantMessageId, { content: streamedContent });
		};

		const cleanupStreamingState = () => {
			clearFormPreparation();
			if (this.abortControllers.get(convId) !== abortController) return;
			if (conversationsStore.activeConversation?.id === convId) this.setStreamingActive(false);
			this.setChatReasoning(convId, false);
			this.setChatLoading(convId, false);
			this.clearChatStreaming(convId);
			this.setProcessingState(convId, null);
		};

		if (conversationsStore.activeConversation?.id === convId) {
			this.setStreamingActive(true);
			this.setActiveProcessingConversation(convId);
		}

		const streamCallbacks: ChatStreamCallbacks = {
			onFlowStart: async (identity) => {
				assertIdentity(identity);
				const saved = await DatabaseService.completeAgenticAssistant(identity, {
					content: '',
					toolCalls: ''
				});
				updateActiveMessage(saved.id, { agentic: saved.agentic });
			},
			onChunk: (chunk: string) => {
				streamedContent += chunk;
				recognizeForm();
				updateStreamingUI();
				this.setChatReasoning(convId, false);
			},
			onReasoningChunk: (chunk: string) => {
				streamedReasoningContent += chunk;
				this.setChatStreaming(convId, streamedContent, currentAssistantMessageId);
				updateActiveMessage(currentAssistantMessageId, {
					reasoningContent: streamedReasoningContent
				});
				this.setChatReasoning(convId, true);
			},
			onToolCallsStreaming: (toolCalls) => {
				updateActiveMessage(currentAssistantMessageId, { toolCalls: JSON.stringify(toolCalls) });
			},
			onStreamCheckpoint: async (checkpoint: ChatStreamCheckpoint) => {
				await modelWrites;
				streamedContent = checkpoint.content;
				recognizeForm();
				streamedReasoningContent = checkpoint.reasoningContent;
				const persistedTimings = withContextTotal(checkpoint.timings);
				const toolCalls =
					checkpoint.toolCalls.length > 0 ? JSON.stringify(checkpoint.toolCalls) : '';
				const update: Partial<DatabaseMessage> = {
					providerContinuation: checkpoint.providerContinuation,
					content: checkpoint.content,
					reasoningContent: checkpoint.reasoningContent || undefined,
					toolCalls
				};
				if (persistedTimings) update.timings = persistedTimings;
				if (resolvedModel) update.model = resolvedModel;
				if (currentModelInfo) update.modelInfo = currentModelInfo;

				await DatabaseService.updateMessage(currentAssistantMessageId, update);
				updateActiveMessage(currentAssistantMessageId, update);
				this.setChatStreaming(convId, checkpoint.content, currentAssistantMessageId);
			},
			onModel: (modelName: string) => recordModel(modelName),
			onCompletionId: (id: string) => recordCompletionId(id),
			onTurnComplete: (intermediateTimings: ChatMessageTimings) => {
				const persistedTimings = withContextTotal(intermediateTimings);
				// Update the first assistant message with cumulative agentic timings
				updateActiveMessage(assistantMessage.id, { timings: persistedTimings });
			},
			onTimings: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => {
				if (
					abortController.signal.aborted ||
					this.abortControllers.get(convId) !== abortController ||
					(hasFormProposal(streamedContent) && !isFormPreparationCurrent())
				)
					return;
				const tokensPerSecond =
					timings?.predicted_ms && timings?.predicted_n
						? (timings.predicted_n / timings.predicted_ms) * 1000
						: 0;
				this.updateProcessingStateFromTimings(
					{
						prompt_n: timings?.prompt_n || 0,
						prompt_ms: timings?.prompt_ms,
						predicted_n: timings?.predicted_n || 0,
						predicted_per_second: tokensPerSecond,
						cache_n: timings?.cache_n || 0,
						prompt_progress: promptProgress
					},
					convId,
					resolvedContextTotal
				);
			},
			onAssistantTurnComplete: async (
				identity: AgenticMessageIdentity,
				content: string,
				reasoningContent: string | undefined,
				timings: ChatMessageTimings | undefined,
				toolCalls: import('$lib/types/api').ApiChatCompletionToolCall[] | undefined,
				providerContinuation?: import('$lib/types/provider').ProviderContinuation
			) => {
				assertIdentity(identity);
				const persistedTimings = withContextTotal(timings);
				const updateData: Partial<DatabaseMessage> & Pick<DatabaseMessage, 'content'> = {
					providerContinuation,
					content,
					reasoningContent: reasoningContent || undefined,
					toolCalls: toolCalls ? JSON.stringify(toolCalls) : '',
					timings: persistedTimings
				};
				await modelWrites;
				if (resolvedModel) updateData.model = resolvedModel;
				if (currentModelInfo) updateData.modelInfo = currentModelInfo;
				const saved = await DatabaseService.completeAgenticAssistant(identity, updateData);
				const uiUpdate: Partial<DatabaseMessage> = {
					providerContinuation,
					content,
					reasoningContent: reasoningContent || undefined,
					toolCalls: toolCalls ? JSON.stringify(toolCalls) : ''
				};
				if (persistedTimings) uiUpdate.timings = persistedTimings;
				if (resolvedModel) uiUpdate.model = resolvedModel;
				if (currentModelInfo) uiUpdate.modelInfo = currentModelInfo;
				updateActiveMessage(identity.assistantMessageId, { ...uiUpdate, agentic: saved.agentic });
				await updateConversationCurrentNode(branchTailId);
			},
			onToolCallState: async (identity, toolCallId, outcome) => {
				assertIdentity(identity);
				const { assistant, result } = await DatabaseService.transitionAgenticToolCall(
					identity,
					toolCallId,
					outcome,
					branchTailId
				);
				updateActiveMessage(assistant.id, {
					agentic: assistant.agentic,
					children: assistant.children
				});
				if (result) {
					if (!flowFinalized && conversationsStore.activeConversation?.id === convId)
						conversationsStore.addMessageToActive(result);
					if (
						!flowFinalized &&
						!persistedResultIds.includes(result.id) &&
						this.abortControllers.get(convId) === abortController
					) {
						persistedResultIds.push(result.id);
						branchTailId = result.id;
						await updateConversationCurrentNode(result.id);
					}
				}
				return result;
			},
			createAssistantMessage: async () => {
				formDecisionCompleted = false;
				formDecisionRefused = false;
				await modelWrites;
				// Reset streaming state for new message
				streamedContent = '';
				streamedReasoningContent = '';

				const msg = await DatabaseService.createMessageBranch(
					{
						convId,
						type: MessageType.TEXT,
						role: MessageRole.ASSISTANT,
						content: '',
						timestamp: Date.now(),
						toolCalls: '',
						children: [],
						model: resolvedModel,
						modelInfo: currentModelInfo,
						agentic: { operationId, calls: [] }
					},
					branchTailId
				);
				if (conversationsStore.activeConversation?.id === convId) {
					conversationsStore.addMessageToActive(msg);
				}
				currentAssistantMessageId = msg.id;
				branchTailId = msg.id;
				assistants.set(msg.id, msg);
				return msg;
			},
			onFlowComplete: async ({ identity, reason, timings }) => {
				assertIdentity(identity);
				if (flowFinalized) return;
				flowFinalized = true;
				const terminal = await DatabaseService.finishAgenticTurn(identity, reason);
				if (reason === 'completed' && !terminal.toolCalls) {
					const completedForm = await completeForm(terminal.content, terminal.id);
					if (!completedForm?.isCurrent()) {
						cleanupStreamingState();
						return;
					}
					const formUpdate = completedForm.update;
					if (formUpdate.content !== terminal.content || formUpdate.interactiveForm) {
						await DatabaseService.updateMessage(terminal.id, formUpdate, completedForm.isCurrent);
						if (!completedForm.isCurrent()) {
							cleanupStreamingState();
							return;
						}
						updateActiveMessage(terminal.id, formUpdate);
						Object.assign(terminal, formUpdate);
					}
				}
				updateActiveMessage(terminal.id, { agentic: terminal.agentic });
				const persistedTimings = withContextTotal(timings);
				if (persistedTimings) {
					updateActiveMessage(assistantMessage.id, { timings: persistedTimings });
					await DatabaseService.updateMessage(assistantMessage.id, { timings: persistedTimings });
				}

				cleanupStreamingState();

				if (reason === 'completed' && !abortController.signal.aborted && onComplete)
					await onComplete(streamedContent);
				if (isRouterMode()) modelsStore.fetchRouterModels().catch(console.error);
				if (reason === 'completed') await generateFirstTitle(terminal.content);
				// Pre-encode conversation in KV cache for providers that expose llama-server slots.
				if (shouldPreEncode && reason === 'completed') {
					const history = filterByLeafNodeId(
						await conversationsStore.getConversationMessages(convId),
						branchTailId,
						false
					) as DatabaseMessage[];
					this.triggerPreEncode(
						history.slice(0, -1),
						terminal,
						terminal.content,
						operationModel,
						excludeReasoningFromPreEncode,
						providerRequestContext
					);
				}
			},
			onError: async (error: Error) => {
				await modelWrites.catch(() => undefined);
				if (conversationsStore.activeConversation?.id === convId) this.setStreamingActive(false);
				if (isAbortError(error)) {
					cleanupStreamingState();
					return;
				}
				console.error('Streaming error:', error);
				cleanupStreamingState();
				if (streamedContent || streamedReasoningContent) {
					await DatabaseService.updateMessage(currentAssistantMessageId, {
						content: streamedContent,
						reasoningContent: streamedReasoningContent || undefined
					});
				}
				await this.cancelPendingAssistant(
					assistants.get(currentAssistantMessageId)!,
					abortController
				);
				const contextInfo = (
					error as Error & { contextInfo?: { n_prompt_tokens: number; n_ctx: number } }
				).contextInfo;
				this.showErrorDialog({
					type: error.name === 'TimeoutError' ? ErrorDialogType.TIMEOUT : ErrorDialogType.SERVER,
					message: this.getErrorMessage(error),
					contextInfo
				});
				if (onError) await onError(error);
			}
		};

		try {
			const agenticConfig = agenticStore.getConfig(config(), perChatOverrides);
			if (agenticConfig.enabled) {
				const agenticResult = await agenticStore.runAgenticFlow({
					conversationId: convId,
					messages: allMessages,
					options: {
						...apiOptions,
						...(frozenModel ? { model: frozenModel } : {}),
						assistantMessageId: assistantMessage.id,
						operationId,
						operationModel,
						onProviderResult: (
							event: import('$lib/types/provider').ProviderChatCompletionStreamEvent
						) => {
							if (event.refusal || event.toolCalls?.length) formDecisionRefused = true;
							if (event.finishReason)
								formDecisionCompleted =
									['stop', 'end_turn', 'completed'].includes(event.finishReason) &&
									!formDecisionRefused;
						},
						providerRequestContext
					},
					callbacks: streamCallbacks,
					signal: abortController.signal,
					perChatOverrides
				});
				if (agenticResult.handled) {
					return;
				}
			}

			// Non-agentic path: direct streaming into the single assistant message
			await ChatService.sendMessage(
				allMessages,
				{
					...apiOptions,
					...(frozenModel ? { model: frozenModel } : {}),
					assistantMessageId: assistantMessage.id,
					operationModel,
					providerRequestContext,
					stream: true,
					onProviderResult: (event) => {
						if (event.refusal || event.toolCalls?.length) formDecisionRefused = true;
						if (event.finishReason)
							formDecisionCompleted =
								['stop', 'end_turn', 'completed'].includes(event.finishReason) &&
								!formDecisionRefused;
					},
					onChunk: streamCallbacks.onChunk,
					onReasoningChunk: streamCallbacks.onReasoningChunk,
					onModel: streamCallbacks.onModel,
					onCompletionId: streamCallbacks.onCompletionId,
					onTimings: streamCallbacks.onTimings,
					onStreamCheckpoint: streamCallbacks.onStreamCheckpoint,
					onComplete: async (
						finalContent?: string,
						reasoningContent?: string,
						timings?: ChatMessageTimings,
						toolCalls?: string
					) => {
						const persistedTimings = withContextTotal(timings);
						const completedForm = await completeForm(
							streamedContent || finalContent || '',
							currentAssistantMessageId
						);
						if (!completedForm?.isCurrent()) {
							cleanupStreamingState();
							return;
						}
						const formUpdate = completedForm.update;
						const content = formUpdate.content;
						const reasoning = streamedReasoningContent || reasoningContent;
						const updateData: Record<string, unknown> = {
							...(formUpdate.interactiveForm
								? { interactiveForm: formUpdate.interactiveForm }
								: {}),
							content,
							reasoningContent: reasoning || undefined,
							toolCalls: toolCalls || '',
							timings: persistedTimings
						};
						await modelWrites;
						if (!completedForm.isCurrent()) {
							cleanupStreamingState();
							return;
						}
						if (resolvedModel) updateData.model = resolvedModel;
						if (currentModelInfo) updateData.modelInfo = currentModelInfo;
						await DatabaseService.updateMessage(
							currentAssistantMessageId,
							updateData,
							completedForm.isCurrent
						);
						if (!completedForm.isCurrent()) {
							cleanupStreamingState();
							return;
						}
						const uiUpdate: Partial<DatabaseMessage> = {
							...(formUpdate.interactiveForm
								? { interactiveForm: formUpdate.interactiveForm }
								: {}),
							content,
							reasoningContent: reasoning || undefined,
							toolCalls: toolCalls || ''
						};
						if (persistedTimings) uiUpdate.timings = persistedTimings;
						if (resolvedModel) uiUpdate.model = resolvedModel;
						if (currentModelInfo) uiUpdate.modelInfo = currentModelInfo;
						updateActiveMessage(currentAssistantMessageId, uiUpdate);
						await updateConversationCurrentNode(currentAssistantMessageId);
						cleanupStreamingState();
						if (!abortController.signal.aborted && onComplete) await onComplete(content);
						if (isRouterMode()) modelsStore.fetchRouterModels().catch(console.error);
						await generateFirstTitle(content);
						if (shouldPreEncode) {
							void this.triggerPreEncode(
								allMessages,
								assistantMessage,
								content,
								operationModel,
								excludeReasoningFromPreEncode,
								providerRequestContext
							);
						}
					},
					onError: streamCallbacks.onError
				},
				convId,
				abortController.signal
			);
		} finally {
			clearFormPreparation();
			abortController.signal.removeEventListener('abort', clearFormPreparation);
			// Abort/Stop can clear loading before queued metadata writes settle.
			await Promise.all([modelWrites.catch(() => undefined), completionWrite]);
		}
	}

	private async generateTitleWithLLM(
		userContent: string,
		assistantContent: string,
		convId: string,
		requestBinding: GenerationModel,
		titleNameVersion: number,
		signal: AbortSignal
	): Promise<void> {
		try {
			const currentConfig = config();
			const titlePromptTemplate = getLocalizedTitleGenerationPrompt(
				String(currentConfig.interfaceLanguage || 'en')
			);

			const titlePrompt = titlePromptTemplate
				.split('{{USER}}')
				.join(String(userContent || ''))
				.split('{{ASSISTANT}}')
				.join(String(assistantContent || ''));

			const titleMessage: ApiChatMessageData = {
				role: MessageRole.USER,
				content: titlePrompt
			};

			const titleResponse = await ChatService.generateTitle(
				titleMessage,
				requestBinding.operationModel.model,
				signal,
				requestBinding
			);

			if (!titleResponse) return;

			let cleanTitle = titleResponse.trim();
			cleanTitle = cleanTitle
				.replace(TITLE_GENERATION.PREFIX_PATTERN, '')
				.replace(TITLE_GENERATION.QUOTE_PATTERN, '')
				.trim();

			if (!cleanTitle || cleanTitle.length < TITLE_GENERATION.MIN_LENGTH) {
				const firstLine = userContent.split('\n').find((line) => line.trim().length > 0);
				cleanTitle = firstLine
					? generateConversationTitle(
							firstLine.trim(),
							Boolean(currentConfig.titleGenerationUseFirstLine)
						)
					: TITLE_GENERATION.FALLBACK;
			}

			if (cleanTitle && cleanTitle.length >= TITLE_GENERATION.MIN_LENGTH) {
				await conversationsStore.updateConversationName(convId, cleanTitle, titleNameVersion);
			}
		} catch (error) {
			console.warn('[ChatStore] Failed to generate LLM conversation title:', error);
		}
	}

	async stopGeneration(): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;
		await this.stopGenerationForChat(activeConv.id);
	}
	async stopGenerationForChat(convId: string): Promise<void> {
		await withConversationWriter(convId, () => this.stopGenerationForChatImpl(convId), 'stop');
	}

	private async stopGenerationForChatImpl(convId: string): Promise<void> {
		const agenticRunning = agenticStore.isRunning(convId);
		// Cancel synchronously, before persistence/transport awaits can admit another tool.
		this.abortControllers.get(convId)?.abort();
		await this.savePartialResponseIfNeeded(convId);
		await ChatService.stopResumableStream(convId);
		if (agenticRunning) return; // The owning flow drains confirmed results and finalizes once.
		if (conversationsStore.activeConversation?.id === convId) this.setStreamingActive(false);
		this.abortRequest(convId);
		this.setChatLoading(convId, false);
		this.clearChatStreaming(convId);
		this.setProcessingState(convId, null);
	}

	async resumeStreamForChat(convId: string): Promise<void> {
		await withConversationWriter(convId, () => this.resumeStreamForChatImpl(convId), 'generation');
	}

	private async resumeStreamForChatImpl(convId: string): Promise<void> {
		if (this.resumingStreams.has(convId) || this.isChatLoadingInternal(convId)) return;
		const state = ChatService.getResumableState(convId);
		if (!state) return;
		if (!(await ChatService.canResumeStream(state))) return;

		const messages = await conversationsStore.getConversationMessages(convId);
		if (!(await ChatService.canResumeStream(state))) return;
		const assistantMessage = messages.find(
			(message) =>
				message.id === state.assistantMessageId &&
				message.convId === convId &&
				message.role === MessageRole.ASSISTANT
		);
		if (!assistantMessage) {
			ChatService.discardResumableStream(convId);
			return;
		}

		let toolCalls: import('$lib/types/api').ApiChatCompletionToolCall[] = [];
		try {
			toolCalls = assistantMessage.toolCalls ? JSON.parse(assistantMessage.toolCalls) : [];
		} catch {
			toolCalls = [];
		}

		this.resumingStreams.add(convId);
		this.setChatLoading(convId, true);
		this.setChatStreaming(convId, assistantMessage.content, assistantMessage.id);
		if (conversationsStore.activeConversation?.id === convId) {
			this.setStreamingActive(true);
			this.setActiveProcessingConversation(convId);
		}
		const abortController = this.getOrCreateAbortController(convId);
		queuedGenerationReady(convId);
		const resolvedContextTotal = this.getContextTotal(state.model);
		const withContextTotal = (timings?: ChatMessageTimings): ChatMessageTimings | undefined =>
			timings && resolvedContextTotal !== null
				? { ...timings, context_total: resolvedContextTotal }
				: timings;
		const cleanup = () => {
			this.resumingStreams.delete(convId);
			if (conversationsStore.activeConversation?.id === convId) this.setStreamingActive(false);
			this.setChatReasoning(convId, false);
			this.setChatLoading(convId, false);
			this.clearChatStreaming(convId);
			this.setProcessingState(convId, null);
		};
		let resumeSeedModel = true;

		try {
			const resumed = await ChatService.resumeStream(
				state,
				{
					resumeSeed: {
						content: assistantMessage.content,
						reasoningContent: assistantMessage.reasoningContent ?? '',
						toolCalls,
						timings: assistantMessage.timings
					},
					onChunk: (chunk) => {
						assistantMessage.content += chunk;
						this.setChatReasoning(convId, false);
					},
					onReasoningChunk: (chunk) => {
						assistantMessage.reasoningContent = (assistantMessage.reasoningContent ?? '') + chunk;
						this.setChatReasoning(convId, true);
					},
					onToolCallChunk: (serialized) => {
						assistantMessage.toolCalls = serialized;
					},
					onModel: (model) => {
						// resumeStream first echoes the original request identity, not a new
						// backend identification. Keep the persisted response evidence.
						if (resumeSeedModel) {
							resumeSeedModel = false;
							if (model === state.model && assistantMessage.model) return;
						}
						assistantMessage.model = normalizeModelName(model);
						if (assistantMessage.modelInfo)
							assistantMessage.modelInfo = modelInfoForResponse(assistantMessage.modelInfo, model);
					},
					onTimings: (timings, promptProgress) => {
						const tokensPerSecond =
							timings?.predicted_ms && timings.predicted_n
								? (timings.predicted_n / timings.predicted_ms) * 1000
								: 0;
						this.updateProcessingStateFromTimings(
							{
								prompt_n: timings?.prompt_n || 0,
								prompt_ms: timings?.prompt_ms,
								predicted_n: timings?.predicted_n || 0,
								predicted_per_second: tokensPerSecond,
								cache_n: timings?.cache_n || 0,
								prompt_progress: promptProgress
							},
							convId,
							resolvedContextTotal
						);
					},
					onStreamCheckpoint: async (checkpoint) => {
						const update: Partial<DatabaseMessage> = {
							content: checkpoint.content,
							reasoningContent: checkpoint.reasoningContent || undefined,
							toolCalls:
								checkpoint.toolCalls.length > 0 ? JSON.stringify(checkpoint.toolCalls) : '',
							...(assistantMessage.model ? { model: assistantMessage.model } : {}),
							...(assistantMessage.modelInfo ? { modelInfo: assistantMessage.modelInfo } : {})
						};
						const timings = withContextTotal(checkpoint.timings);
						update.providerContinuation = checkpoint.providerContinuation;
						if (timings) update.timings = timings;
						await DatabaseService.updateMessage(assistantMessage.id, update);
						Object.assign(assistantMessage, update);
						const idx = conversationsStore.findMessageIndex(assistantMessage.id);
						if (idx === -1 && conversationsStore.activeConversation?.id === convId) {
							conversationsStore.addMessageToActive(assistantMessage);
						} else if (idx !== -1) {
							conversationsStore.updateMessageAtIndex(idx, update);
						}
						this.setChatStreaming(convId, checkpoint.content, assistantMessage.id);
					},
					onComplete: async (content, reasoningContent, timings, serializedToolCalls) => {
						const update: Partial<DatabaseMessage> = {
							content,
							reasoningContent,
							toolCalls: serializedToolCalls ?? '',
							...(assistantMessage.model ? { model: assistantMessage.model } : {}),
							...(assistantMessage.modelInfo ? { modelInfo: assistantMessage.modelInfo } : {}),
							timings: withContextTotal(timings)
						};
						await DatabaseService.updateMessage(assistantMessage.id, update);
						await conversationsStore.updateConversationCurrentNode(convId, assistantMessage.id);
						const idx = conversationsStore.findMessageIndex(assistantMessage.id);
						if (idx !== -1) conversationsStore.updateMessageAtIndex(idx, update);
						cleanup();
					},
					onError: () => {
						cleanup();
					}
				},
				abortController.signal
			);
			if (!resumed) cleanup();
		} catch (error) {
			cleanup();
			if (!isAbortError(error)) console.warn('Failed to resume chat stream:', error);
		}
	}
	private async savePartialResponseIfNeeded(convId?: string): Promise<void> {
		const conversationId = convId || conversationsStore.activeConversation?.id;
		if (!conversationId) return;
		const streamingState = this.getChatStreaming(conversationId);
		if (!streamingState || !streamingState.response.trim()) return;
		const messages =
			conversationId === conversationsStore.activeConversation?.id
				? conversationsStore.activeMessages
				: await conversationsStore.getConversationMessages(conversationId);
		if (!messages.length) return;
		const streamingMessage = messages.find((message) => message.id === streamingState.messageId);
		if (streamingMessage?.role === MessageRole.ASSISTANT) {
			try {
				const updateData: { content: string; timings?: ChatMessageTimings } = {
					content: streamingState.response
				};
				const lastKnownState = this.getProcessingState(conversationId);
				if (lastKnownState) {
					updateData.timings = {
						prompt_n: lastKnownState.promptTokens || 0,
						prompt_ms: lastKnownState.promptMs,
						predicted_n: lastKnownState.tokensDecoded || 0,
						cache_n: lastKnownState.cacheTokens || 0,
						predicted_ms:
							lastKnownState.tokensPerSecond && lastKnownState.tokensDecoded
								? (lastKnownState.tokensDecoded / lastKnownState.tokensPerSecond) * 1000
								: undefined,
						context_total:
							typeof lastKnownState.contextTotal === 'number' && lastKnownState.contextTotal > 0
								? lastKnownState.contextTotal
								: undefined
					};
				}
				await DatabaseService.updateMessage(streamingMessage.id, updateData);
				streamingMessage.content = streamingState.response;
				if (updateData.timings) streamingMessage.timings = updateData.timings;
			} catch (error) {
				streamingMessage.content = streamingState.response;
				console.error('Failed to save partial response:', error);
			}
		}
	}

	async updateMessage(messageId: string, newContent: string): Promise<void> {
		await this.withActiveConversationWriter(
			() => this.updateMessageImpl(messageId, newContent),
			'generation'
		);
	}

	private async updateMessageImpl(messageId: string, newContent: string): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;
		const perChatOverrides = activeConv.mcpServerOverrides?.map((override: McpServerOverride) => ({
			...override
		}));
		const result = this.getMessageByIdWithRole(messageId, MessageRole.USER);
		if (!result) return;
		const { message: messageToUpdate, index: messageIndex } = result;
		const conversationPath = conversationsStore.activeMessages
			.slice(0, messageIndex)
			.concat({ ...messageToUpdate, content: newContent, children: [] });
		const generationModel = this.captureGenerationModel(undefined, conversationPath);
		// This writer already owns generation startup; a nested queued Stop would
		// otherwise wait for the controller this same operation has yet to create.
		if (this.isChatLoadingInternal(activeConv.id))
			await this.stopGenerationForChatImpl(activeConv.id);
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const isFirstUserMessage = rootMessage && messageToUpdate.parent === rootMessage.id;
			await DatabaseService.replaceUserMessageAndTruncateBranch(
				activeConv.id,
				messageId,
				newContent,
				messageToUpdate.extra
			);
			if (conversationsStore.activeConversation?.id === activeConv.id) {
				await conversationsStore.loadConversation(activeConv.id);
			}
			if (isFirstUserMessage && newContent.trim())
				await conversationsStore
					.updateConversationTitleWithConfirmation(
						activeConv.id,
						generateConversationTitle(newContent, Boolean(config().titleGenerationUseFirstLine))
					)
					.catch((error) => console.warn('Failed to update conversation title:', error));
			await conversationsStore.refreshConversationTimestamp(activeConv.id);
			this.setChatLoading(activeConv.id, true);
			this.clearChatStreaming(activeConv.id);
			const assistantMessage = await this.createAssistantMessage(activeConv.id, messageId);
			conversationsStore.addMessageToActive(assistantMessage);
			await conversationsStore.updateConversationCurrentNode(activeConv.id, assistantMessage.id);
			await this.streamChatCompletion(
				conversationPath,
				assistantMessage,
				undefined,
				undefined,
				generationModel,
				undefined,
				perChatOverrides
			);
		} catch (error) {
			if (!isAbortError(error)) console.error('Failed to update message:', error);
		}
	}

	async regenerateMessage(messageId: string): Promise<void> {
		await this.withActiveConversationWriter(
			() => this.regenerateMessageImpl(messageId),
			'generation'
		);
	}

	private async regenerateMessageImpl(messageId: string): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;
		const perChatOverrides = activeConv.mcpServerOverrides?.map((override: McpServerOverride) => ({
			...override
		}));
		this.cancelPreEncode();
		const result = this.getMessageByIdWithRole(messageId, MessageRole.ASSISTANT);
		if (!result) return;
		const { index: messageIndex } = result;
		const conversationPath = conversationsStore.activeMessages.slice(0, messageIndex);
		const generationModel = this.captureGenerationModel(undefined, conversationPath);
		try {
			const { parentId } = await DatabaseService.truncateBranchForRegeneration(
				activeConv.id,
				messageId
			);
			if (conversationsStore.activeConversation?.id === activeConv.id)
				await conversationsStore.loadConversation(activeConv.id);
			await conversationsStore.refreshConversationTimestamp(activeConv.id);
			this.setChatLoading(activeConv.id, true);
			this.clearChatStreaming(activeConv.id);
			const assistantMessage = await this.createAssistantMessage(activeConv.id, parentId);
			conversationsStore.addMessageToActive(assistantMessage);
			await this.streamChatCompletion(
				conversationPath,
				assistantMessage,
				undefined,
				undefined,
				generationModel,
				undefined,
				perChatOverrides
			);
		} catch (error) {
			if (!isAbortError(error)) console.error('Failed to regenerate message:', error);
			this.setChatLoading(activeConv?.id || '', false);
		}
	}

	async regenerateMessageWithBranching(messageId: string, modelOverride?: string): Promise<void> {
		await this.withActiveConversationWriter(
			() => this.regenerateMessageWithBranchingImpl(messageId, modelOverride),
			'generation'
		);
	}

	private async regenerateMessageWithBranchingImpl(
		messageId: string,
		modelOverride?: string
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;
		const perChatOverrides = activeConv.mcpServerOverrides?.map((override: McpServerOverride) => ({
			...override
		}));
		this.cancelPreEncode();
		try {
			const idx = conversationsStore.findMessageIndex(messageId);
			if (idx === -1) return;
			const msg = conversationsStore.activeMessages[idx];
			if (msg.role !== MessageRole.ASSISTANT) return;
			const generationModel = this.captureGenerationModel(
				modelOverride || msg.model,
				conversationsStore.activeMessages.slice(0, idx)
			);
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const parentMessage = findMessageById(allMessages, msg.parent);
			if (!parentMessage) return;
			this.setChatLoading(activeConv.id, true);
			this.clearChatStreaming(activeConv.id);
			const newAssistantMessage = await DatabaseService.createMessageBranch(
				{
					convId: msg.convId,
					type: msg.type,
					timestamp: Date.now(),
					role: msg.role,
					content: '',
					toolCalls: '',
					children: [],
					model: null
				},
				parentMessage.id
			);
			await conversationsStore.updateConversationCurrentNode(activeConv.id, newAssistantMessage.id);
			await conversationsStore.refreshConversationTimestamp(activeConv.id);
			await conversationsStore.refreshActiveMessages(activeConv.id);
			const conversationPath = filterByLeafNodeId(
				allMessages,
				parentMessage.id,
				false
			) as DatabaseMessage[];
			await this.streamChatCompletion(
				conversationPath,
				newAssistantMessage,
				undefined,
				undefined,
				generationModel,
				undefined,
				perChatOverrides
			);
		} catch (error) {
			if (!isAbortError(error))
				console.error('Failed to regenerate message with branching:', error);
			this.setChatLoading(activeConv?.id || '', false);
		}
	}

	async getDeletionInfo(messageId: string): Promise<{
		totalCount: number;
		userMessages: number;
		assistantMessages: number;
		messageTypes: string[];
	}> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv)
			return { totalCount: 0, userMessages: 0, assistantMessages: 0, messageTypes: [] };
		const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
		const messageToDelete = findMessageById(allMessages, messageId);

		// For system messages, don't count descendants as they will be preserved (reparented to root)
		if (messageToDelete?.role === MessageRole.SYSTEM) {
			const messagesToDelete = allMessages.filter((m) => m.id === messageId);
			let userMessages = 0,
				assistantMessages = 0;
			const messageTypes: string[] = [];

			for (const msg of messagesToDelete) {
				if (msg.role === MessageRole.USER) {
					userMessages++;
					if (!messageTypes.includes('user message')) messageTypes.push('user message');
				} else if (msg.role === MessageRole.ASSISTANT) {
					assistantMessages++;
					if (!messageTypes.includes('assistant response')) messageTypes.push('assistant response');
				}
			}

			return { totalCount: 1, userMessages, assistantMessages, messageTypes };
		}

		const descendants = findDescendantMessages(allMessages, messageId);
		const allToDelete = [messageId, ...descendants];
		const messagesToDelete = allMessages.filter((m) => allToDelete.includes(m.id));
		let userMessages = 0,
			assistantMessages = 0;
		const messageTypes: string[] = [];

		for (const msg of messagesToDelete) {
			if (msg.role === MessageRole.USER) {
				userMessages++;
				if (!messageTypes.includes('user message')) messageTypes.push('user message');
			} else if (msg.role === MessageRole.ASSISTANT) {
				assistantMessages++;
				if (!messageTypes.includes('assistant response')) messageTypes.push('assistant response');
			}
		}

		return { totalCount: allToDelete.length, userMessages, assistantMessages, messageTypes };
	}

	async deleteMessage(messageId: string): Promise<void> {
		await this.withActiveConversationWriter(() => this.deleteMessageImpl(messageId));
	}

	private async deleteMessageImpl(messageId: string): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const messageToDelete = findMessageById(allMessages, messageId);

			if (!messageToDelete) return;

			const currentPath = filterByLeafNodeId(allMessages, activeConv.currNode || '', false);
			const isInCurrentPath = currentPath.some((m) => m.id === messageId);

			let replacementCurrentNode = activeConv.currNode;
			if (isInCurrentPath && messageToDelete.parent) {
				const siblings = allMessages.filter(
					(m) => m.parent === messageToDelete.parent && m.id !== messageId
				);

				if (siblings.length > 0) {
					const latestSibling = siblings.reduce((latest, sibling) =>
						sibling.timestamp > latest.timestamp ? sibling : latest
					);

					replacementCurrentNode = findLeafNode(allMessages, latestSibling.id);
				} else if (messageToDelete.parent) {
					replacementCurrentNode = messageToDelete.parent;
				}
			}

			if (!replacementCurrentNode) throw new Error('Cannot delete a branch without a replacement');
			await DatabaseService.deleteMessageCascading(
				activeConv.id,
				messageId,
				replacementCurrentNode
			);
			if (conversationsStore.activeConversation?.id === activeConv.id) {
				conversationsStore.activeConversation = {
					...conversationsStore.activeConversation,
					currNode: replacementCurrentNode
				};
			}
			await conversationsStore.refreshActiveMessages(activeConv.id);

			await conversationsStore.refreshConversationTimestamp(activeConv.id);
		} catch (error) {
			console.error('Failed to delete message:', error);
		}
	}

	async editAssistantMessage(
		messageId: string,
		newContent: string,
		shouldBranch: boolean
	): Promise<void> {
		await this.withActiveConversationWriter(() =>
			this.editAssistantMessageImpl(messageId, newContent, shouldBranch)
		);
	}

	private async editAssistantMessageImpl(
		messageId: string,
		newContent: string,
		shouldBranch: boolean
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;

		const result = this.getMessageByIdWithRole(messageId, MessageRole.ASSISTANT);
		if (!result) return;

		const { message: msg } = result;

		try {
			if (shouldBranch) {
				const newMessage = await DatabaseService.createMessageBranch(
					{
						convId: msg.convId,
						type: msg.type,
						timestamp: Date.now(),
						role: msg.role,
						content: newContent,
						toolCalls: msg.toolCalls || '',
						children: [],
						model: msg.model,
						modelInfo: msg.modelInfo
					},
					msg.parent!
				);

				await conversationsStore.updateConversationCurrentNode(activeConv.id, newMessage.id);
			} else {
				await DatabaseService.updateConversationMessage(activeConv.id, msg.id, {
					content: newContent
				});
			}

			await conversationsStore.refreshConversationTimestamp(activeConv.id);

			await conversationsStore.refreshActiveMessages(activeConv.id);
		} catch (error) {
			console.error('Failed to edit assistant message:', error);
		}
	}

	async editUserMessagePreserveResponses(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		await this.withActiveConversationWriter(() =>
			this.editUserMessagePreserveResponsesImpl(messageId, newContent, newExtras)
		);
	}

	private async editUserMessagePreserveResponsesImpl(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;

		const result = this.getMessageByIdWithRole(messageId, MessageRole.USER);
		if (!result) return;

		const { message: msg } = result;
		try {
			const updateData: Partial<DatabaseMessage> = { content: newContent };

			if (newExtras !== undefined) updateData.extra = JSON.parse(JSON.stringify(newExtras));

			await DatabaseService.updateConversationMessage(activeConv.id, messageId, updateData);

			if (conversationsStore.activeConversation?.id === activeConv.id)
				conversationsStore.updateMessageAtIndex(
					conversationsStore.findMessageIndex(messageId),
					updateData
				);

			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);

			if (rootMessage && msg.parent === rootMessage.id && newContent.trim()) {
				await conversationsStore
					.updateConversationTitleWithConfirmation(
						activeConv.id,
						generateConversationTitle(newContent, Boolean(config().titleGenerationUseFirstLine))
					)
					.catch((error) => console.warn('Failed to update conversation title:', error));
			}

			await conversationsStore.refreshConversationTimestamp(activeConv.id);
		} catch (error) {
			console.error('Failed to edit user message:', error);
		}
	}

	async editMessageWithBranching(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		await this.withActiveConversationWriter(
			() => this.editMessageWithBranchingImpl(messageId, newContent, newExtras),
			'generation'
		);
	}

	private async editMessageWithBranchingImpl(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;
		const perChatOverrides = activeConv.mcpServerOverrides?.map((override: McpServerOverride) => ({
			...override
		}));
		let result = this.getMessageByIdWithRole(messageId, MessageRole.USER);
		if (!result) result = this.getMessageByIdWithRole(messageId, MessageRole.SYSTEM);
		if (!result) return;
		const { message: msg } = result;
		const generationModel =
			msg.role === MessageRole.USER
				? this.captureGenerationModel(
						undefined,
						conversationsStore.activeMessages.slice(0, result.index)
					)
				: undefined;
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const isFirstUserMessage =
				msg.role === MessageRole.USER && rootMessage && msg.parent === rootMessage.id;
			const extrasToUse =
				newExtras !== undefined
					? JSON.parse(JSON.stringify(newExtras))
					: msg.extra
						? JSON.parse(JSON.stringify(msg.extra))
						: undefined;

			let messageIdForResponse: string;

			const dbMsg = findMessageById(allMessages, msg.id);
			const hasChildren = dbMsg ? dbMsg.children.length > 0 : msg.children.length > 0;

			if (!hasChildren) {
				// No responses after this message — update in place instead of branching
				const updates: Partial<DatabaseMessage> = {
					content: newContent,
					timestamp: Date.now(),
					extra: extrasToUse
				};
				await DatabaseService.updateConversationMessage(activeConv.id, msg.id, updates);
				messageIdForResponse = msg.id;
			} else {
				// Has children — create a new branch as sibling
				const parentId = msg.parent || rootMessage?.id;
				if (!parentId) return;
				const newMessage = await DatabaseService.createMessageBranch(
					{
						convId: msg.convId,
						type: msg.type,
						timestamp: Date.now(),
						role: msg.role,
						content: newContent,
						toolCalls: msg.toolCalls || '',
						children: [],
						extra: extrasToUse,
						model: msg.model
					},
					parentId
				);
				await conversationsStore.updateConversationCurrentNode(activeConv.id, newMessage.id);
				messageIdForResponse = newMessage.id;
			}

			await conversationsStore.refreshConversationTimestamp(activeConv.id);
			if (isFirstUserMessage && newContent.trim())
				await conversationsStore
					.updateConversationTitleWithConfirmation(
						activeConv.id,
						generateConversationTitle(newContent, Boolean(config().titleGenerationUseFirstLine))
					)
					.catch((error) => console.warn('Failed to update conversation title:', error));
			await conversationsStore.refreshActiveMessages(activeConv.id);
			if (msg.role === MessageRole.USER)
				await this.generateResponseForMessage(
					activeConv.id,
					messageIdForResponse,
					perChatOverrides,
					generationModel!
				);
		} catch (error) {
			console.error('Failed to edit message with branching:', error);
		}
	}

	private async generateResponseForMessage(
		convId: string,
		userMessageId: string,
		perChatOverrides: McpServerOverride[] | undefined,
		generationModel: GenerationModel
	): Promise<void> {
		this.showErrorDialog(null);
		this.setChatLoading(convId, true);
		this.clearChatStreaming(convId);

		try {
			const allMessages = await conversationsStore.getConversationMessages(convId);
			const conversationPath = filterByLeafNodeId(
				allMessages,
				userMessageId,
				false
			) as DatabaseMessage[];
			const assistantMessage = await DatabaseService.createMessageBranch(
				{
					convId,
					type: MessageType.TEXT,
					timestamp: Date.now(),
					role: MessageRole.ASSISTANT,
					content: '',
					toolCalls: '',
					children: [],
					model: null
				},
				userMessageId
			);

			conversationsStore.addMessageToActive(assistantMessage);

			await this.streamChatCompletion(
				conversationPath,
				assistantMessage,
				undefined,
				undefined,
				generationModel,
				undefined,
				perChatOverrides
			);
		} catch (error) {
			console.error('Failed to generate response:', error);
			this.setChatLoading(convId, false);
		}
	}

	private getContextTotal(modelName?: string | null): number | null {
		if (isRouterMode()) {
			const modelContextSize = modelName ? modelsStore.getModelContextSize(modelName) : null;

			if (typeof modelContextSize === 'number' && modelContextSize > 0) {
				return modelContextSize;
			}
		} else {
			const propsContextSize = contextSize();

			if (typeof propsContextSize === 'number' && propsContextSize > 0) {
				return propsContextSize;
			}
		}

		return null;
	}

	updateProcessingStateFromTimings(
		timingData: {
			prompt_n: number;
			prompt_ms?: number;
			predicted_n: number;
			predicted_per_second: number;
			cache_n: number;
			prompt_progress?: ChatMessagePromptProgress;
		},
		conversationId?: string,
		contextTotal?: number | null
	): void {
		const processingState = this.parseTimingData(timingData, contextTotal);

		if (processingState === null) {
			console.warn('Failed to parse timing data - skipping update');
			return;
		}

		const targetId = conversationId || this.activeConversationId;
		if (targetId) {
			this.setProcessingState(targetId, processingState);
		}
	}

	private parseTimingData(
		timingData: Record<string, unknown>,
		contextTotal: number | null = null
	): ApiProcessingState | null {
		const promptTokens = (timingData.prompt_n as number) || 0,
			promptMs = (timingData.prompt_ms as number) || undefined,
			predictedTokens = (timingData.predicted_n as number) || 0,
			tokensPerSecond = (timingData.predicted_per_second as number) || 0,
			cacheTokens = (timingData.cache_n as number) || 0;
		const promptProgress = timingData.prompt_progress as
			| { total: number; cache: number; processed: number; time_ms: number }
			| undefined;
		const currentConfig = config();
		const outputTokensMax = currentConfig.max_tokens || -1;
		const contextUsed = promptTokens + cacheTokens + predictedTokens,
			outputTokensUsed = predictedTokens;
		const progressCache = promptProgress?.cache || 0,
			progressActualDone = (promptProgress?.processed ?? 0) - progressCache,
			progressActualTotal = (promptProgress?.total ?? 0) - progressCache;
		const progressPercent = promptProgress
			? Math.round((progressActualDone / progressActualTotal) * 100)
			: undefined;
		return {
			status: predictedTokens > 0 ? 'generating' : promptProgress ? 'preparing' : 'idle',
			tokensDecoded: predictedTokens,
			tokensRemaining: outputTokensMax - predictedTokens,
			contextUsed,
			contextTotal,
			outputTokensUsed,
			outputTokensMax,
			hasNextToken: predictedTokens > 0,
			tokensPerSecond,
			temperature: currentConfig.temperature ?? 0.8,
			topP: currentConfig.top_p ?? 0.95,
			speculative: false,
			progressPercent,
			promptProgress,
			promptTokens,
			promptMs,
			cacheTokens
		};
	}

	restoreProcessingStateFromMessages(messages: DatabaseMessage[], conversationId: string): void {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message.role === MessageRole.ASSISTANT && message.timings) {
				const contextTotal = resolveHistoricalContextTotal(message, (model) =>
					modelsStore.getModelContextSize(model)
				);
				const restoredState = this.parseTimingData(
					{
						prompt_n: message.timings.prompt_n || 0,
						prompt_ms: message.timings.prompt_ms,
						predicted_n: message.timings.predicted_n || 0,
						predicted_per_second:
							message.timings.predicted_n && message.timings.predicted_ms
								? (message.timings.predicted_n / message.timings.predicted_ms) * 1000
								: 0,
						cache_n: message.timings.cache_n || 0
					},
					contextTotal
				);
				if (restoredState) {
					this.setProcessingState(conversationId, restoredState);
					return;
				}
			}
		}
	}

	getConversationModel(messages: DatabaseMessage[]): string | null {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message.role === MessageRole.ASSISTANT && message.model) return message.model;
		}
		return null;
	}

	private getApiOptions(): Record<string, unknown> {
		const currentConfig = config();
		const providerCapabilities = getApiProvider(
			String(currentConfig.apiProvider ?? '')
		).capabilities;
		const hasValue = (value: unknown): boolean =>
			value !== undefined && value !== null && value !== '';
		const apiOptions: Record<string, unknown> = { stream: true, timings_per_token: true };

		if (currentConfig.systemMessage) apiOptions.systemMessage = currentConfig.systemMessage;

		if (currentConfig.excludeReasoningFromContext) apiOptions.excludeReasoningFromContext = true;

		if (providerCapabilities.supportsTemperature && hasValue(currentConfig.temperature))
			apiOptions.temperature = Number(currentConfig.temperature);

		if (providerCapabilities.supportsMaxTokens && hasValue(currentConfig.max_tokens))
			apiOptions.max_tokens = Number(currentConfig.max_tokens);

		if (providerCapabilities.supportsDynamicTemperature && hasValue(currentConfig.dynatemp_range))
			apiOptions.dynatemp_range = Number(currentConfig.dynatemp_range);

		if (
			providerCapabilities.supportsDynamicTemperature &&
			hasValue(currentConfig.dynatemp_exponent)
		)
			apiOptions.dynatemp_exponent = Number(currentConfig.dynatemp_exponent);

		if (providerCapabilities.supportsTopK && hasValue(currentConfig.top_k))
			apiOptions.top_k = Number(currentConfig.top_k);

		if (providerCapabilities.supportsTopP && hasValue(currentConfig.top_p))
			apiOptions.top_p = Number(currentConfig.top_p);

		if (providerCapabilities.supportsMinP && hasValue(currentConfig.min_p))
			apiOptions.min_p = Number(currentConfig.min_p);

		if (providerCapabilities.supportsXtc && hasValue(currentConfig.xtc_probability))
			apiOptions.xtc_probability = Number(currentConfig.xtc_probability);

		if (providerCapabilities.supportsXtc && hasValue(currentConfig.xtc_threshold))
			apiOptions.xtc_threshold = Number(currentConfig.xtc_threshold);

		if (providerCapabilities.supportsTypicalP && hasValue(currentConfig.typ_p))
			apiOptions.typ_p = Number(currentConfig.typ_p);

		if (providerCapabilities.supportsRepeatPenalty && hasValue(currentConfig.repeat_last_n))
			apiOptions.repeat_last_n = Number(currentConfig.repeat_last_n);

		if (providerCapabilities.supportsRepeatPenalty && hasValue(currentConfig.repeat_penalty))
			apiOptions.repeat_penalty = Number(currentConfig.repeat_penalty);

		if (providerCapabilities.supportsPresencePenalty && hasValue(currentConfig.presence_penalty))
			apiOptions.presence_penalty = Number(currentConfig.presence_penalty);

		if (providerCapabilities.supportsFrequencyPenalty && hasValue(currentConfig.frequency_penalty))
			apiOptions.frequency_penalty = Number(currentConfig.frequency_penalty);

		if (providerCapabilities.supportsDryPenalty && hasValue(currentConfig.dry_multiplier))
			apiOptions.dry_multiplier = Number(currentConfig.dry_multiplier);

		if (providerCapabilities.supportsDryPenalty && hasValue(currentConfig.dry_base))
			apiOptions.dry_base = Number(currentConfig.dry_base);

		if (providerCapabilities.supportsDryPenalty && hasValue(currentConfig.dry_allowed_length))
			apiOptions.dry_allowed_length = Number(currentConfig.dry_allowed_length);

		if (providerCapabilities.supportsDryPenalty && hasValue(currentConfig.dry_penalty_last_n))
			apiOptions.dry_penalty_last_n = Number(currentConfig.dry_penalty_last_n);

		if (providerCapabilities.supportsSamplerOrder && currentConfig.samplers)
			apiOptions.samplers = currentConfig.samplers;

		if (providerCapabilities.supportsBackendSampling)
			apiOptions.backend_sampling = currentConfig.backend_sampling;

		if (currentConfig.custom) apiOptions.custom = currentConfig.custom;

		return apiOptions;
	}

	private cancelPreEncode(): void {
		if (this.preEncodeAbortController) {
			this.preEncodeAbortController.abort();
			this.preEncodeAbortController = null;
		}
	}

	private async triggerPreEncode(
		allMessages: DatabaseMessage[],
		assistantMessage: DatabaseMessage,
		assistantContent: string,
		operationModel: OperationModel,
		excludeReasoning: boolean | undefined,
		providerRequestContext: import('$lib/types/provider').ProviderRequestContext
	): Promise<void> {
		this.cancelPreEncode();
		this.preEncodeAbortController = new AbortController();

		const signal = this.preEncodeAbortController.signal;

		try {
			const allIdle = await ChatService.areAllSlotsIdle(
				providerRequestContext,
				operationModel.model,
				signal
			);
			if (!allIdle || signal.aborted) return;

			const messagesWithAssistant: DatabaseMessage[] = [
				...allMessages,
				{ ...assistantMessage, content: assistantContent }
			];

			await ChatService.preEncode(
				messagesWithAssistant,
				providerRequestContext,
				operationModel.model,
				excludeReasoning,
				signal,
				operationModel
			);
		} catch (err) {
			if (!isAbortError(err)) {
				console.warn('[ChatStore] Pre-encode failed:', err);
			}
		}
	}
}

export const chatStore = new ChatStore();

export const activeProcessingState = () => chatStore.activeProcessingState;
export const currentResponse = () => chatStore.currentResponse;
export const errorDialog = () => chatStore.errorDialogState;
export const getAddFilesHandler = () => chatStore.getAddFilesHandler();
export const getAllLoadingChats = () => chatStore.getAllLoadingChats();
export const getAllStreamingChats = () => chatStore.getAllStreamingChats();
export const getChatStreaming = (convId: string) => chatStore.getChatStreamingPublic(convId);
export const isChatLoading = (convId: string) => chatStore.isChatLoadingPublic(convId);
export const isChatStreaming = () => chatStore.isStreaming();
export const isEditing = () => chatStore.isEditing();
export const isLoading = () => chatStore.isLoading;
export const isReasoning = () => chatStore.isReasoning;
export const pendingEditMessageId = () => chatStore.pendingEditMessageId;
