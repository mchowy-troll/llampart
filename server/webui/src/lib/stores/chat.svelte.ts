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
import { DatabaseService } from '$lib/services/database.service';
import { ChatService } from '$lib/services/chat.service';
import { getApiProvider } from '$lib/services/providers';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { config } from '$lib/stores/settings.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { contextSize, isRouterMode } from '$lib/stores/server.svelte';
import { selectedModelName, modelsStore } from '$lib/stores/models.svelte';
import {
	normalizeModelName,
	filterByLeafNodeId,
	findDescendantMessages,
	findLeafNode,
	findMessageById,
	isAbortError,
	generateConversationTitle
} from '$lib/utils';
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
import { ErrorDialogType, MessageRole, MessageType } from '$lib/enums';

interface ConversationStateEntry {
	lastAccessed: number;
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
	private conversationStateTimestamps = new SvelteMap<string, ConversationStateEntry>();
	private resumingStreams = new Set<string>();
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

	private showErrorDialog(state: ErrorDialogState | null): void {
		this.errorDialogState = state;
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
		return this.chatStreamingStates.has(convId);
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
		extras?: DatabaseMessageExtra[]
	): Promise<DatabaseMessage> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) throw new Error('No active conversation');
		let parentId: string | null = null;
		if (parent === '-1') {
			const am = conversationsStore.activeMessages;
			if (am.length > 0) parentId = am[am.length - 1].id;
			else {
				const all = await conversationsStore.getConversationMessages(activeConv.id);
				const r = all.find((m) => m.parent === null && m.type === 'root');
				parentId = r ? r.id : await DatabaseService.createRootMessage(activeConv.id);
			}
		} else parentId = parent;
		const message = await DatabaseService.createMessageBranch(
			{
				convId: activeConv.id,
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
		await conversationsStore.updateCurrentNode(message.id);
		conversationsStore.updateConversationTimestamp();
		return message;
	}

	async addSystemPrompt(): Promise<void> {
		let activeConv = conversationsStore.activeConversation;
		if (!activeConv) {
			await conversationsStore.createConversation();
			activeConv = conversationsStore.activeConversation;
		}
		if (!activeConv) return;
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
				this.pendingEditMessageId = existingSystemMessage.id;
				if (!conversationsStore.activeMessages.some((m) => m.id === existingSystemMessage.id))
					conversationsStore.activeMessages.unshift(existingSystemMessage);
				return;
			}
			const am = conversationsStore.activeMessages;
			const firstActiveMessage = am.find((m) => m.parent === rootId);
			const systemMessage = await DatabaseService.createSystemMessage(
				activeConv.id,
				SYSTEM_MESSAGE_PLACEHOLDER,
				rootId
			);
			if (firstActiveMessage) {
				await DatabaseService.updateMessage(firstActiveMessage.id, { parent: systemMessage.id });
				await DatabaseService.updateMessage(systemMessage.id, {
					children: [firstActiveMessage.id]
				});
				const updatedRootChildren = rootMessage
					? rootMessage.children.filter((id: string) => id !== firstActiveMessage.id)
					: [];
				await DatabaseService.updateMessage(rootId, {
					children: [
						...updatedRootChildren.filter((id: string) => id !== systemMessage.id),
						systemMessage.id
					]
				});
				const firstMsgIndex = conversationsStore.findMessageIndex(firstActiveMessage.id);
				if (firstMsgIndex !== -1)
					conversationsStore.updateMessageAtIndex(firstMsgIndex, { parent: systemMessage.id });
			}
			conversationsStore.activeMessages.unshift(systemMessage);
			this.pendingEditMessageId = systemMessage.id;
			conversationsStore.updateConversationTimestamp();
		} catch (error) {
			console.error('Failed to add system prompt:', error);
		}
	}

	async removeSystemPromptPlaceholder(messageId: string): Promise<boolean> {
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
			for (const childId of systemMessage.children) {
				await DatabaseService.updateMessage(childId, { parent: rootMessage.id });
				const childIndex = conversationsStore.findMessageIndex(childId);
				if (childIndex !== -1)
					conversationsStore.updateMessageAtIndex(childIndex, { parent: rootMessage.id });
			}
			await DatabaseService.updateMessage(rootMessage.id, {
				children: [
					...rootMessage.children.filter((id: string) => id !== messageId),
					...systemMessage.children
				]
			});
			await DatabaseService.deleteMessage(messageId);
			const systemIndex = conversationsStore.findMessageIndex(messageId);
			if (systemIndex !== -1) conversationsStore.activeMessages.splice(systemIndex, 1);
			conversationsStore.updateConversationTimestamp();
			return false;
		} catch (error) {
			console.error('Failed to remove system prompt placeholder:', error);
			return false;
		}
	}

	private async createAssistantMessage(parentId?: string): Promise<DatabaseMessage> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) throw new Error('No active conversation');
		return await DatabaseService.createMessageBranch(
			{
				convId: activeConv.id,
				type: MessageType.TEXT,
				role: MessageRole.ASSISTANT,
				content: '',
				timestamp: Date.now(),
				toolCalls: '',
				children: [],
				model: null
			},
			parentId || null
		);
	}

	async sendMessage(content: string, extras?: DatabaseMessageExtra[]): Promise<void> {
		if (!content.trim() && (!extras || extras.length === 0)) return;
		const activeConv = conversationsStore.activeConversation;
		if (activeConv && this.isChatLoadingInternal(activeConv.id)) return;

		// Cancel any in-flight pre-encode request
		this.cancelPreEncode();

		// Consume MCP resource attachments - converts them to extras and clears the live store
		const resourceExtras = mcpStore.consumeResourceAttachmentsAsExtras();
		const allExtras = resourceExtras.length > 0 ? [...(extras || []), ...resourceExtras] : extras;

		let isNewConversation = false;
		if (!activeConv) {
			await conversationsStore.createConversation();
			isNewConversation = true;
		}
		const currentConv = conversationsStore.activeConversation;
		if (!currentConv) return;
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
			const userMessage = await this.addMessage(
				MessageRole.USER,
				content,
				MessageType.TEXT,
				parentIdForUserMessage ?? '-1',
				allExtras
			);
			if (isNewConversation && content)
				await conversationsStore.updateConversationName(
					currentConv.id,
					generateConversationTitle(content, Boolean(config().titleGenerationUseFirstLine))
				);
			const assistantMessage = await this.createAssistantMessage(userMessage.id);
			conversationsStore.addMessageToActive(assistantMessage);
			await this.streamChatCompletion(
				conversationsStore.activeMessages.slice(0, -1),
				assistantMessage,
				undefined,
				undefined,
				undefined,
				config().titleGenerationUseLLM && isNewConversation ? content : undefined
			);
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
				message: error instanceof Error ? error.message : 'Unknown error',
				contextInfo
			});
		}
	}

	private async streamChatCompletion(
		allMessages: DatabaseMessage[],
		assistantMessage: DatabaseMessage,
		onComplete?: (content: string) => Promise<void>,
		onError?: (error: Error) => void,
		modelOverride?: string | null,
		firstUserMessageContent?: string
	): Promise<void> {
		let effectiveModel = modelOverride;

		if (isRouterMode() && !effectiveModel) {
			const conversationModel = this.getConversationModel(allMessages);
			effectiveModel = selectedModelName() || conversationModel;
		}

		if (isRouterMode() && effectiveModel) {
			if (!modelsStore.getModelProps(effectiveModel))
				await modelsStore.fetchModelProps(effectiveModel);
		}

		const frozenModel = effectiveModel ? normalizeModelName(effectiveModel) : null;
		const resolvedContextTotal = this.getContextTotal(frozenModel);
		const withContextTotal = (
			timings: ChatMessageTimings | undefined
		): ChatMessageTimings | undefined => {
			if (!timings || resolvedContextTotal === null) return timings;

			return { ...timings, context_total: resolvedContextTotal };
		};

		// Mutable state for the current message being streamed
		let currentMessageId = assistantMessage.id;
		let streamedContent = '';
		let streamedReasoningContent = '';
		let resolvedModel: string | null = null;
		let modelPersisted = false;
		const convId = assistantMessage.convId;
		const updateActiveMessage = (messageId: string, update: Partial<DatabaseMessage>): void => {
			if (conversationsStore.activeConversation?.id !== convId) return;
			const index = conversationsStore.findMessageIndex(messageId);
			if (index !== -1) conversationsStore.updateMessageAtIndex(index, update);
		};
		const updateConversationCurrentNode = async (messageId: string): Promise<void> => {
			if (conversationsStore.activeConversation?.id === convId) {
				await conversationsStore.updateCurrentNode(messageId);
			} else {
				await DatabaseService.updateCurrentNode(convId, messageId);
			}
		};

		const recordCompletionId = (() => {
			let completionIdRecorded = false;

			return (id: string): void => {
				if (!id || completionIdRecorded) return;
				completionIdRecorded = true;
				updateActiveMessage(currentMessageId, { completionId: id });
				DatabaseService.updateMessage(currentMessageId, { completionId: id }).catch(() => {
					completionIdRecorded = false;
				});
			};
		})();

		const recordModel = (modelName: string | null | undefined, persistImmediately = true): void => {
			if (!modelName) return;
			const n = normalizeModelName(modelName);
			if (!n || n === resolvedModel) return;
			resolvedModel = n;
			updateActiveMessage(currentMessageId, { model: n });
			if (persistImmediately && !modelPersisted) {
				modelPersisted = true;
				DatabaseService.updateMessage(currentMessageId, { model: n }).catch(() => {
					modelPersisted = false;
					resolvedModel = null;
				});
			}
		};

		if (frozenModel) recordModel(frozenModel);

		const updateStreamingUI = () => {
			this.setChatStreaming(convId, streamedContent, currentMessageId);
			updateActiveMessage(currentMessageId, { content: streamedContent });
		};

		const cleanupStreamingState = () => {
			this.setStreamingActive(false);
			this.setChatReasoning(convId, false);
			this.setChatLoading(convId, false);
			this.clearChatStreaming(convId);
			this.setProcessingState(convId, null);
		};

		this.setStreamingActive(true);
		this.setActiveProcessingConversation(convId);
		const abortController = this.getOrCreateAbortController(convId);

		const streamCallbacks: ChatStreamCallbacks = {
			onChunk: (chunk: string) => {
				streamedContent += chunk;
				updateStreamingUI();
				this.setChatReasoning(convId, false);
			},
			onReasoningChunk: (chunk: string) => {
				streamedReasoningContent += chunk;
				this.setChatStreaming(convId, streamedContent, currentMessageId);
				updateActiveMessage(currentMessageId, {
					reasoningContent: streamedReasoningContent
				});
				this.setChatReasoning(convId, true);
			},
			onToolCallsStreaming: (toolCalls) => {
				updateActiveMessage(currentMessageId, { toolCalls: JSON.stringify(toolCalls) });
			},
			onStreamCheckpoint: async (checkpoint: ChatStreamCheckpoint) => {
				streamedContent = checkpoint.content;
				streamedReasoningContent = checkpoint.reasoningContent;
				const persistedTimings = withContextTotal(checkpoint.timings);
				const toolCalls =
					checkpoint.toolCalls.length > 0 ? JSON.stringify(checkpoint.toolCalls) : '';
				const update: Partial<DatabaseMessage> = {
					content: checkpoint.content,
					reasoningContent: checkpoint.reasoningContent || undefined,
					toolCalls
				};
				if (persistedTimings) update.timings = persistedTimings;
				if (resolvedModel) update.model = resolvedModel;

				await DatabaseService.updateMessage(currentMessageId, update);
				updateActiveMessage(currentMessageId, update);
				this.setChatStreaming(convId, checkpoint.content, currentMessageId);
			},
			onAttachments: (messageId: string, extras: DatabaseMessageExtra[]) => {
				if (!extras.length) return;
				if (conversationsStore.activeConversation?.id !== convId) return;
				const idx = conversationsStore.findMessageIndex(messageId);
				if (idx === -1) return;
				const msg = conversationsStore.activeMessages[idx];
				const updatedExtras = [...(msg.extra || []), ...extras];
				conversationsStore.updateMessageAtIndex(idx, { extra: updatedExtras });
				DatabaseService.updateMessage(messageId, { extra: updatedExtras }).catch(console.error);
			},
			onModel: (modelName: string) => recordModel(modelName),
			onCompletionId: (id: string) => recordCompletionId(id),
			onTurnComplete: (intermediateTimings: ChatMessageTimings) => {
				const persistedTimings = withContextTotal(intermediateTimings);
				// Update the first assistant message with cumulative agentic timings
				updateActiveMessage(assistantMessage.id, { timings: persistedTimings });
			},
			onTimings: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => {
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
				content: string,
				reasoningContent: string | undefined,
				timings: ChatMessageTimings | undefined,
				toolCalls: import('$lib/types/api').ApiChatCompletionToolCall[] | undefined
			) => {
				const persistedTimings = withContextTotal(timings);
				const updateData: Record<string, unknown> = {
					content,
					reasoningContent: reasoningContent || undefined,
					toolCalls: toolCalls ? JSON.stringify(toolCalls) : '',
					timings: persistedTimings
				};
				if (resolvedModel && !modelPersisted) updateData.model = resolvedModel;
				await DatabaseService.updateMessage(currentMessageId, updateData);
				const uiUpdate: Partial<DatabaseMessage> = {
					content,
					reasoningContent: reasoningContent || undefined,
					toolCalls: toolCalls ? JSON.stringify(toolCalls) : ''
				};
				if (persistedTimings) uiUpdate.timings = persistedTimings;
				if (resolvedModel) uiUpdate.model = resolvedModel;
				updateActiveMessage(currentMessageId, uiUpdate);
				await updateConversationCurrentNode(currentMessageId);
			},
			createToolResultMessage: async (
				toolCallId: string,
				content: string,
				extras?: DatabaseMessageExtra[]
			) => {
				const msg = await DatabaseService.createMessageBranch(
					{
						convId,
						type: MessageType.TEXT,
						role: MessageRole.TOOL,
						content,
						toolCallId,
						timestamp: Date.now(),
						toolCalls: '',
						children: [],
						extra: extras
					},
					currentMessageId
				);
				if (conversationsStore.activeConversation?.id === convId) {
					conversationsStore.addMessageToActive(msg);
				}
				currentMessageId = msg.id;
				await updateConversationCurrentNode(msg.id);
				return msg;
			},
			createAssistantMessage: async () => {
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
						model: resolvedModel
					},
					currentMessageId
				);
				if (conversationsStore.activeConversation?.id === convId) {
					conversationsStore.addMessageToActive(msg);
				}
				currentMessageId = msg.id;
				return msg;
			},
			onFlowComplete: (finalTimings?: ChatMessageTimings) => {
				const persistedTimings = withContextTotal(finalTimings);
				if (persistedTimings) {
					updateActiveMessage(assistantMessage.id, { timings: persistedTimings });
					DatabaseService.updateMessage(assistantMessage.id, { timings: persistedTimings }).catch(
						console.error
					);
				}

				cleanupStreamingState();

				if (onComplete) onComplete(streamedContent);
				if (isRouterMode()) modelsStore.fetchRouterModels().catch(console.error);
				// Pre-encode conversation in KV cache for providers that expose llama-server slots.
				if (
					getApiProvider(String(config().apiProvider ?? '')).capabilities.supportsPreEncode &&
					config().preEncodeConversation
				) {
					this.triggerPreEncode(
						allMessages,
						assistantMessage,
						streamedContent,
						frozenModel,
						!!config().excludeReasoningFromContext
					);
				}
			},
			onError: (error: Error) => {
				this.setStreamingActive(false);
				if (isAbortError(error)) {
					cleanupStreamingState();
					return;
				}
				console.error('Streaming error:', error);
				cleanupStreamingState();
				const idx = conversationsStore.findMessageIndex(assistantMessage.id);
				if (idx !== -1) {
					const failedMessage = conversationsStore.removeMessageAtIndex(idx);
					if (failedMessage) DatabaseService.deleteMessage(failedMessage.id).catch(console.error);
				}
				const contextInfo = (
					error as Error & { contextInfo?: { n_prompt_tokens: number; n_ctx: number } }
				).contextInfo;
				this.showErrorDialog({
					type: error.name === 'TimeoutError' ? ErrorDialogType.TIMEOUT : ErrorDialogType.SERVER,
					message: error.message,
					contextInfo
				});
				if (onError) onError(error);
			}
		};

		const perChatOverrides = conversationsStore.activeConversation?.mcpServerOverrides;

		const agenticConfig = agenticStore.getConfig(config(), perChatOverrides);
		if (agenticConfig.enabled) {
			const agenticResult = await agenticStore.runAgenticFlow({
				conversationId: convId,
				messages: allMessages,
				options: { ...this.getApiOptions(), ...(frozenModel ? { model: frozenModel } : {}) },
				callbacks: streamCallbacks,
				signal: abortController.signal,
				perChatOverrides
			});
			if (agenticResult.handled) {
				if (firstUserMessageContent) {
					await this.generateTitleWithLLM(firstUserMessageContent, streamedContent, convId);
				}

				return;
			}
		}

		// Non-agentic path: direct streaming into the single assistant message
		await ChatService.sendMessage(
			allMessages,
			{
				...this.getApiOptions(),
				...(frozenModel ? { model: frozenModel } : {}),
				stream: true,
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
					const content = streamedContent || finalContent || '';
					const reasoning = streamedReasoningContent || reasoningContent;
					const updateData: Record<string, unknown> = {
						content,
						reasoningContent: reasoning || undefined,
						toolCalls: toolCalls || '',
						timings: persistedTimings
					};
					if (resolvedModel && !modelPersisted) updateData.model = resolvedModel;
					await DatabaseService.updateMessage(currentMessageId, updateData);
					const uiUpdate: Partial<DatabaseMessage> = {
						content,
						reasoningContent: reasoning || undefined,
						toolCalls: toolCalls || ''
					};
					if (persistedTimings) uiUpdate.timings = persistedTimings;
					if (resolvedModel) uiUpdate.model = resolvedModel;
					updateActiveMessage(currentMessageId, uiUpdate);
					await updateConversationCurrentNode(currentMessageId);
					cleanupStreamingState();
					if (onComplete) await onComplete(content);
					if (isRouterMode()) modelsStore.fetchRouterModels().catch(console.error);
					if (firstUserMessageContent) {
						await this.generateTitleWithLLM(firstUserMessageContent, content, convId);
					}
				},
				onError: streamCallbacks.onError
			},
			convId,
			abortController.signal
		);
	}

	private async generateTitleWithLLM(
		userContent: string,
		assistantContent: string,
		convId: string
	): Promise<void> {
		try {
			const effectiveModel =
				isRouterMode() && selectedModelName() ? selectedModelName() : undefined;
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

			const titleResponse = await ChatService.generateTitle(titleMessage, effectiveModel);

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
				await conversationsStore.updateConversationName(convId, cleanTitle);
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
		await this.savePartialResponseIfNeeded(convId);
		await ChatService.stopResumableStream(convId);
		this.setStreamingActive(false);
		this.abortRequest(convId);
		this.setChatLoading(convId, false);
		this.clearChatStreaming(convId);
		this.setProcessingState(convId, null);
	}

	async resumeStreamForChat(convId: string): Promise<void> {
		if (this.resumingStreams.has(convId) || this.isChatLoadingInternal(convId)) return;
		const state = ChatService.getResumableState(convId);
		if (!state) return;

		const messages = await conversationsStore.getConversationMessages(convId);
		const assistantMessage = messages
			.filter((message) => message.role === MessageRole.ASSISTANT)
			.sort((left, right) => right.timestamp - left.timestamp)[0];
		if (!assistantMessage) return;

		let toolCalls: import('$lib/types/api').ApiChatCompletionToolCall[] = [];
		try {
			toolCalls = assistantMessage.toolCalls ? JSON.parse(assistantMessage.toolCalls) : [];
		} catch {
			toolCalls = [];
		}

		this.resumingStreams.add(convId);
		this.setChatLoading(convId, true);
		this.setChatStreaming(convId, assistantMessage.content, assistantMessage.id);
		this.setStreamingActive(true);
		this.setActiveProcessingConversation(convId);
		const abortController = this.getOrCreateAbortController(convId);
		const resolvedContextTotal = this.getContextTotal(state.model);
		const withContextTotal = (timings?: ChatMessageTimings): ChatMessageTimings | undefined =>
			timings && resolvedContextTotal !== null
				? { ...timings, context_total: resolvedContextTotal }
				: timings;
		const cleanup = () => {
			this.resumingStreams.delete(convId);
			this.setStreamingActive(false);
			this.setChatReasoning(convId, false);
			this.setChatLoading(convId, false);
			this.clearChatStreaming(convId);
			this.setProcessingState(convId, null);
		};

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
						assistantMessage.model = normalizeModelName(model);
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
							...(state.model ? { model: state.model } : {})
						};
						const timings = withContextTotal(checkpoint.timings);
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
							...(state.model ? { model: state.model } : {}),
							timings: withContextTotal(timings)
						};
						await DatabaseService.updateMessage(assistantMessage.id, update);
						await conversationsStore.updateCurrentNode(assistantMessage.id);
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
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;
		if (this.isChatLoadingInternal(activeConv.id)) await this.stopGeneration();
		const result = this.getMessageByIdWithRole(messageId, MessageRole.USER);
		if (!result) return;
		const { message: messageToUpdate, index: messageIndex } = result;
		const originalContent = messageToUpdate.content;
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const isFirstUserMessage = rootMessage && messageToUpdate.parent === rootMessage.id;
			conversationsStore.updateMessageAtIndex(messageIndex, { content: newContent });
			await DatabaseService.updateMessage(messageId, { content: newContent });
			if (isFirstUserMessage && newContent.trim())
				await conversationsStore.updateConversationTitleWithConfirmation(
					activeConv.id,
					generateConversationTitle(newContent, Boolean(config().titleGenerationUseFirstLine))
				);
			const messagesToRemove = conversationsStore.activeMessages.slice(messageIndex + 1);
			for (const message of messagesToRemove) await DatabaseService.deleteMessage(message.id);
			conversationsStore.sliceActiveMessages(messageIndex + 1);
			conversationsStore.updateConversationTimestamp();
			this.setChatLoading(activeConv.id, true);
			this.clearChatStreaming(activeConv.id);
			const assistantMessage = await this.createAssistantMessage();
			conversationsStore.addMessageToActive(assistantMessage);
			await conversationsStore.updateCurrentNode(assistantMessage.id);
			await this.streamChatCompletion(
				conversationsStore.activeMessages.slice(0, -1),
				assistantMessage,
				undefined,
				() => {
					conversationsStore.updateMessageAtIndex(conversationsStore.findMessageIndex(messageId), {
						content: originalContent
					});
				}
			);
		} catch (error) {
			if (!isAbortError(error)) console.error('Failed to update message:', error);
		}
	}

	async regenerateMessage(messageId: string): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;
		this.cancelPreEncode();
		const result = this.getMessageByIdWithRole(messageId, MessageRole.ASSISTANT);
		if (!result) return;
		const { index: messageIndex } = result;
		try {
			const messagesToRemove = conversationsStore.activeMessages.slice(messageIndex);
			for (const message of messagesToRemove) await DatabaseService.deleteMessage(message.id);
			conversationsStore.sliceActiveMessages(messageIndex);
			conversationsStore.updateConversationTimestamp();
			this.setChatLoading(activeConv.id, true);
			this.clearChatStreaming(activeConv.id);
			const parentMessageId =
				conversationsStore.activeMessages.length > 0
					? conversationsStore.activeMessages[conversationsStore.activeMessages.length - 1].id
					: undefined;
			const assistantMessage = await this.createAssistantMessage(parentMessageId);
			conversationsStore.addMessageToActive(assistantMessage);
			await this.streamChatCompletion(
				conversationsStore.activeMessages.slice(0, -1),
				assistantMessage
			);
		} catch (error) {
			if (!isAbortError(error)) console.error('Failed to regenerate message:', error);
			this.setChatLoading(activeConv?.id || '', false);
		}
	}

	async regenerateMessageWithBranching(messageId: string, modelOverride?: string): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;
		this.cancelPreEncode();
		try {
			const idx = conversationsStore.findMessageIndex(messageId);
			if (idx === -1) return;
			const msg = conversationsStore.activeMessages[idx];
			if (msg.role !== MessageRole.ASSISTANT) return;
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
			await conversationsStore.updateCurrentNode(newAssistantMessage.id);
			conversationsStore.updateConversationTimestamp();
			await conversationsStore.refreshActiveMessages();
			const conversationPath = filterByLeafNodeId(
				allMessages,
				parentMessage.id,
				false
			) as DatabaseMessage[];
			const modelToUse = modelOverride || msg.model || undefined;
			await this.streamChatCompletion(
				conversationPath,
				newAssistantMessage,
				undefined,
				undefined,
				modelToUse
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
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;
		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const messageToDelete = findMessageById(allMessages, messageId);

			if (!messageToDelete) return;

			const currentPath = filterByLeafNodeId(allMessages, activeConv.currNode || '', false);
			const isInCurrentPath = currentPath.some((m) => m.id === messageId);

			if (isInCurrentPath && messageToDelete.parent) {
				const siblings = allMessages.filter(
					(m) => m.parent === messageToDelete.parent && m.id !== messageId
				);

				if (siblings.length > 0) {
					const latestSibling = siblings.reduce((latest, sibling) =>
						sibling.timestamp > latest.timestamp ? sibling : latest
					);

					await conversationsStore.updateCurrentNode(findLeafNode(allMessages, latestSibling.id));
				} else if (messageToDelete.parent) {
					await conversationsStore.updateCurrentNode(
						findLeafNode(allMessages, messageToDelete.parent)
					);
				}
			}

			await DatabaseService.deleteMessageCascading(activeConv.id, messageId);
			await conversationsStore.refreshActiveMessages();

			conversationsStore.updateConversationTimestamp();
		} catch (error) {
			console.error('Failed to delete message:', error);
		}
	}

	async editAssistantMessage(
		messageId: string,
		newContent: string,
		shouldBranch: boolean
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;

		const result = this.getMessageByIdWithRole(messageId, MessageRole.ASSISTANT);
		if (!result) return;

		const { message: msg, index: idx } = result;

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
						model: msg.model
					},
					msg.parent!
				);

				await conversationsStore.updateCurrentNode(newMessage.id);
			} else {
				await DatabaseService.updateMessage(msg.id, { content: newContent });
				conversationsStore.updateMessageAtIndex(idx, { content: newContent });
			}

			conversationsStore.updateConversationTimestamp();

			await conversationsStore.refreshActiveMessages();
		} catch (error) {
			console.error('Failed to edit assistant message:', error);
		}
	}

	async editUserMessagePreserveResponses(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;

		const result = this.getMessageByIdWithRole(messageId, MessageRole.USER);
		if (!result) return;

		const { message: msg, index: idx } = result;
		try {
			const updateData: Partial<DatabaseMessage> = { content: newContent };

			if (newExtras !== undefined) updateData.extra = JSON.parse(JSON.stringify(newExtras));

			await DatabaseService.updateMessage(messageId, updateData);

			conversationsStore.updateMessageAtIndex(idx, updateData);

			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);

			if (rootMessage && msg.parent === rootMessage.id && newContent.trim()) {
				await conversationsStore.updateConversationTitleWithConfirmation(
					activeConv.id,
					generateConversationTitle(newContent, Boolean(config().titleGenerationUseFirstLine))
				);
			}

			conversationsStore.updateConversationTimestamp();
		} catch (error) {
			console.error('Failed to edit user message:', error);
		}
	}

	async editMessageWithBranching(
		messageId: string,
		newContent: string,
		newExtras?: DatabaseMessageExtra[]
	): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv || this.isChatLoadingInternal(activeConv.id)) return;
		let result = this.getMessageByIdWithRole(messageId, MessageRole.USER);
		if (!result) result = this.getMessageByIdWithRole(messageId, MessageRole.SYSTEM);
		if (!result) return;
		const { message: msg, index: idx } = result;
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
				await DatabaseService.updateMessage(msg.id, updates);
				conversationsStore.updateMessageAtIndex(idx, updates);
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
				await conversationsStore.updateCurrentNode(newMessage.id);
				messageIdForResponse = newMessage.id;
			}

			conversationsStore.updateConversationTimestamp();
			if (isFirstUserMessage && newContent.trim())
				await conversationsStore.updateConversationTitleWithConfirmation(
					activeConv.id,
					generateConversationTitle(newContent, Boolean(config().titleGenerationUseFirstLine))
				);
			await conversationsStore.refreshActiveMessages();
			if (msg.role === MessageRole.USER)
				await this.generateResponseForMessage(messageIdForResponse);
		} catch (error) {
			console.error('Failed to edit message with branching:', error);
		}
	}

	private async generateResponseForMessage(userMessageId: string): Promise<void> {
		const activeConv = conversationsStore.activeConversation;
		if (!activeConv) return;

		this.showErrorDialog(null);
		this.setChatLoading(activeConv.id, true);
		this.clearChatStreaming(activeConv.id);

		try {
			const allMessages = await conversationsStore.getConversationMessages(activeConv.id);
			const conversationPath = filterByLeafNodeId(
				allMessages,
				userMessageId,
				false
			) as DatabaseMessage[];
			const assistantMessage = await DatabaseService.createMessageBranch(
				{
					convId: activeConv.id,
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

			await this.streamChatCompletion(conversationPath, assistantMessage);
		} catch (error) {
			console.error('Failed to generate response:', error);
			this.setChatLoading(activeConv.id, false);
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

		if (isRouterMode()) {
			const modelName = selectedModelName();
			if (modelName) apiOptions.model = modelName;
		}

		if (currentConfig.systemMessage) apiOptions.systemMessage = currentConfig.systemMessage;

		if (
			providerCapabilities.supportsLlamaReasoningControls &&
			currentConfig.disableReasoningParsing
		)
			apiOptions.disableReasoningParsing = true;

		if (
			providerCapabilities.supportsLlamaReasoningControls &&
			currentConfig.excludeReasoningFromContext
		)
			apiOptions.excludeReasoningFromContext = true;

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

		if (providerCapabilities.supportsLlamaReasoningControls) {
			apiOptions.enableThinking = conversationsStore.getThinkingEnabled();
			apiOptions.reasoningEffort = conversationsStore.getReasoningEffort();
		}

		if (providerCapabilities.supportsCustomJsonPayload && currentConfig.custom)
			apiOptions.custom = currentConfig.custom;

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
		model?: string | null,
		excludeReasoning?: boolean
	): Promise<void> {
		this.cancelPreEncode();
		this.preEncodeAbortController = new AbortController();

		const signal = this.preEncodeAbortController.signal;

		try {
			const allIdle = await ChatService.areAllSlotsIdle(model, signal);
			if (!allIdle || signal.aborted) return;

			const messagesWithAssistant: DatabaseMessage[] = [
				...allMessages,
				{ ...assistantMessage, content: assistantContent }
			];

			await ChatService.preEncode(messagesWithAssistant, model, excludeReasoning, signal);
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
