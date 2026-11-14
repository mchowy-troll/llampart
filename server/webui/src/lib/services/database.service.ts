import Dexie, { type EntityTable } from 'dexie';
import { filterByLeafNodeId, findDescendantMessages } from '$lib/utils/branching';
import { uuid } from '$lib/utils/uuid';
import { planConversationDeletion } from '$lib/utils/conversation-selection';
import { validateConversationImportRecords } from '$lib/utils/conversation-import-export';
import { validateConversationGraph } from '$lib/utils/conversation-graph';
import { messageModelInfoSnapshotSchema } from '$lib/utils/message-model-info';
import {
	validateInteractiveForm,
	parseFormValues,
	validateFormValues,
	formAnswerText
} from '$lib/services/interactive-forms';
import type { FormValues, InteractiveForm } from '$lib/types/interactive-forms';
import { LEGACY_MIGRATION_DONE_KEY, type LegacyMessagePlanner } from '$lib/types/legacy-migration';
import type { DatabaseMessageExtra, McpServerOverride } from '$lib/types/database';
import { AttachmentType } from '$lib/enums/attachment';
import type {
	AgenticMessageIdentity,
	AgenticToolOutcome,
	AgenticTerminalReason,
	ToolCallExecution
} from '$lib/types/agentic';
import {
	getPreparedVisualizationReplacement,
	type PreparedVisualizationReplacement
} from './visualization-replacement';

class LlamacppDatabase extends Dexie {
	conversations!: EntityTable<DatabaseConversation, string>;
	messages!: EntityTable<DatabaseMessage, string>;

	constructor() {
		super('llampart-db');

		this.version(1).stores({
			conversations: 'id, lastModified, currNode, name',
			messages: 'id, convId, type, role, timestamp, parent, children'
		});
	}
}

const db = new LlamacppDatabase();
import { MessageRole, MessageType } from '$lib/enums/chat';

type ConversationImport = { conv: DatabaseConversation; messages: DatabaseMessage[] };

function nextLastModified(conversation: DatabaseConversation): number {
	return Math.max(Date.now(), conversation.lastModified + 1);
}

/** Run inside the graph mutation's transaction. Removing/editing a submitted user
 * message releases its forms, never their saved answers or unrelated branches. */
async function releaseFormResults(convId: string, changedIds: Set<string>): Promise<void> {
	if (!changedIds.size) return;
	const messages = await db.messages.where('convId').equals(convId).toArray();
	for (const message of messages) {
		const form = message.interactiveForm;
		if (!form?.result || changedIds.has(message.id) || !changedIds.has(form.result.messageId))
			continue;
		await db.messages.update(message.id, {
			interactiveForm: { ...form, result: undefined, status: 'draft', revision: form.revision + 1 }
		});
	}
}

function sameConfirmedToolResult(
	persisted: DatabaseMessage,
	incoming: NonNullable<AgenticToolOutcome['result']>
): boolean {
	if (
		persisted.content === incoming.content &&
		JSON.stringify(persisted.extra) === JSON.stringify(incoming.extras)
	)
		return true;
	const oldExtras: DatabaseMessageExtra[] = persisted.extra ?? [];
	const newExtras: DatabaseMessageExtra[] = incoming.extras ?? [];
	if (!oldExtras.some((extra) => extra.type === AttachmentType.IMAGE)) return false;
	if (oldExtras.length !== newExtras.length) return false;
	if (
		!oldExtras.every((extra, index) => {
			const next = newExtras[index];
			return extra.type === AttachmentType.IMAGE && next.type === AttachmentType.IMAGE
				? extra.base64Url === next.base64Url
				: JSON.stringify(extra) === JSON.stringify(next);
		})
	)
		return false;
	if (persisted.content === incoming.content) return true;
	const normalize = (content: string, extras: DatabaseMessageExtra[]) => {
		const used = new Set<number>();
		const text = content.replace(/\[Attachment saved: ([^\]]+)\]/g, (placeholder, name: string) => {
			const index = extras.findIndex(
				(extra, i) => !used.has(i) && extra.type === AttachmentType.IMAGE && extra.name === name
			);
			if (index < 0) return placeholder;
			used.add(index);
			return `[Attachment saved: image-${index}]`;
		});
		return { text, used };
	};
	const old = normalize(persisted.content, oldExtras);
	const next = normalize(incoming.content, newExtras);
	return (
		old.text === next.text &&
		oldExtras.every(
			(extra, index) =>
				extra.type !== AttachmentType.IMAGE ||
				extra.name === newExtras[index].name ||
				(old.used.has(index) && next.used.has(index))
		)
	);
}

async function requireConversation(convId: string): Promise<DatabaseConversation> {
	const conversation = await db.conversations.get(convId);
	if (!conversation) throw new Error(`Conversation ${convId} not found`);
	return conversation;
}

async function requireOwnedMessage(convId: string, messageId: string): Promise<DatabaseMessage> {
	const message = await db.messages.get(messageId);
	if (!message) throw new Error(`Message ${messageId} not found`);
	if (message.convId !== convId) {
		throw new Error(`Message ${messageId} does not belong to conversation ${convId}`);
	}
	return message;
}

async function requireUpdated(changed: number, label: string): Promise<void> {
	if (changed !== 1) throw new Error(`${label} not found`);
}

function assertNonEmptyId(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${label} must be a non-empty string`);
	}
}

function validateConversationImports(data: unknown): ConversationImport[] {
	const validatedData = validateConversationImportRecords(data);

	const conversationIds = new Set<string>();
	const messageIds = new Set<string>();
	const imports: ConversationImport[] = [];

	for (const [itemIndex, value] of validatedData.entries()) {
		if (!value || typeof value !== 'object') {
			throw new Error(`Import item ${itemIndex} must be an object`);
		}

		const item = value as Partial<ConversationImport>;
		if (!item.conv || typeof item.conv !== 'object') {
			throw new Error(`Import item ${itemIndex} must contain a conversation`);
		}
		if (!Array.isArray(item.messages)) {
			throw new Error(`Import item ${itemIndex} messages must be an array`);
		}

		const conv = item.conv;
		assertNonEmptyId(conv.id, `Conversation ID at item ${itemIndex}`);
		if (conversationIds.has(conv.id)) {
			throw new Error(`Duplicate conversation ID in import: ${conv.id}`);
		}
		conversationIds.add(conv.id);

		if (conv.currNode !== null && typeof conv.currNode !== 'string') {
			throw new Error(`Conversation ${conv.id} currNode must be a string or null`);
		}

		const messages = item.messages as DatabaseMessage[];
		for (const [messageIndex, messageValue] of messages.entries()) {
			if (!messageValue || typeof messageValue !== 'object') {
				throw new Error(`Message ${messageIndex} in conversation ${conv.id} must be an object`);
			}

			const message = messageValue as DatabaseMessage;
			assertNonEmptyId(message.id, `Message ID at item ${itemIndex}:${messageIndex}`);
			if (messageIds.has(message.id)) {
				throw new Error(`Duplicate message ID in import: ${message.id}`);
			}
			messageIds.add(message.id);
		}
		validateConversationGraph(conv, messages);
		imports.push({ conv, messages });
	}

	return imports;
}

export class DatabaseService {
	/**
	 *
	 *
	 * Conversations
	 *
	 *
	 */

	/**
	 * Creates a new conversation.
	 *
	 * @param name - Name of the conversation
	 * @returns The created conversation
	 */
	static async createConversation(name: string): Promise<DatabaseConversation> {
		const conversation: DatabaseConversation = {
			id: uuid(),
			name,
			lastModified: Date.now(),
			currNode: ''
		};

		await db.conversations.add(conversation);
		return conversation;
	}

	/**
	 *
	 *
	 * Messages
	 *
	 *
	 */

	/**
	 * Creates a new message branch by adding a message and updating parent/child relationships.
	 * Also updates the conversation's currNode to point to the new message.
	 *
	 * @param message - Message to add (without id)
	 * @param parentId - Parent message ID to attach to
	 * @returns The created message
	 */
	static async createMessageBranch(
		message: Omit<DatabaseMessage, 'id'>,
		parentId: string | null
	): Promise<DatabaseMessage> {
		if (message.modelInfo) {
			if (message.role !== 'assistant')
				throw new Error('Model information must belong to an assistant');
			message = { ...message, modelInfo: messageModelInfoSnapshotSchema.parse(message.modelInfo) };
		}
		const operation = async (): Promise<DatabaseMessage> => {
			const conversation = await requireConversation(message.convId);
			const parentMessage =
				parentId === null ? null : await requireOwnedMessage(message.convId, parentId);

			const newMessage: DatabaseMessage = {
				...message,
				id: uuid(),
				parent: parentId,
				toolCalls: message.toolCalls ?? '',
				children: []
			};

			await db.messages.add(newMessage);

			// Update parent's children array if parent exists
			if (parentMessage) {
				await requireUpdated(
					await db.messages.update(parentMessage.id, {
						children: [...parentMessage.children, newMessage.id]
					}),
					`Parent message ${parentMessage.id}`
				);
			}

			await requireUpdated(
				await db.conversations.update(message.convId, {
					currNode: newMessage.id,
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${message.convId}`
			);

			return newMessage;
		};

		if (Dexie.currentTransaction) return await operation();
		return await db.transaction('rw', [db.conversations, db.messages], operation);
	}

	/**
	 * Creates a root message for a new conversation.
	 * Root messages are not displayed but serve as the tree root for branching.
	 *
	 * @param convId - Conversation ID
	 * @returns The created root message
	 */
	static async createRootMessage(convId: string): Promise<string> {
		const rootMessage: DatabaseMessage = {
			id: uuid(),
			convId,
			type: 'root',
			timestamp: Date.now(),
			role: MessageRole.SYSTEM,
			content: '',
			parent: null,
			toolCalls: '',
			children: []
		};

		await db.messages.add(rootMessage);
		return rootMessage.id;
	}

	/**
	 * Creates a system prompt message for a conversation.
	 *
	 * @param convId - Conversation ID
	 * @param systemPrompt - The system prompt content (must be non-empty)
	 * @param parentId - Parent message ID (typically the root message)
	 * @returns The created system message
	 * @throws Error if systemPrompt is empty
	 */
	static async createSystemMessage(
		convId: string,
		systemPrompt: string,
		parentId: string
	): Promise<DatabaseMessage> {
		const trimmedPrompt = systemPrompt.trim();
		if (!trimmedPrompt) {
			throw new Error('Cannot create system message with empty content');
		}

		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const parentMessage = await requireOwnedMessage(convId, parentId);
			const systemMessage: DatabaseMessage = {
				id: uuid(),
				convId,
				type: MessageRole.SYSTEM,
				timestamp: Date.now(),
				role: MessageRole.SYSTEM,
				content: trimmedPrompt,
				parent: parentId,
				toolCalls: '',
				children: []
			};

			await db.messages.add(systemMessage);
			await requireUpdated(
				await db.messages.update(parentId, {
					children: [...parentMessage.children, systemMessage.id]
				}),
				`Parent message ${parentId}`
			);
			await requireUpdated(
				await db.conversations.update(convId, {
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${convId}`
			);

			return systemMessage;
		});
	}

	/** Inserts a system prompt between the root and the selected first message. */
	static async insertSystemPrompt(
		convId: string,
		systemPrompt: string,
		rootId: string,
		firstMessageId?: string
	): Promise<DatabaseMessage> {
		const trimmedPrompt = systemPrompt.trim();
		if (!trimmedPrompt) throw new Error('Cannot create system message with empty content');

		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const root = await requireOwnedMessage(convId, rootId);
			if (root.parent !== null || root.type !== 'root') throw new Error('Invalid root message');
			const firstMessage = firstMessageId
				? await requireOwnedMessage(convId, firstMessageId)
				: undefined;
			if (
				firstMessage &&
				(firstMessage.parent !== rootId || !root.children.includes(firstMessage.id))
			) {
				throw new Error(`Message ${firstMessage.id} is not a child of root ${rootId}`);
			}

			const systemMessage: DatabaseMessage = {
				id: uuid(),
				convId,
				type: MessageRole.SYSTEM,
				timestamp: Date.now(),
				role: MessageRole.SYSTEM,
				content: trimmedPrompt,
				parent: rootId,
				toolCalls: '',
				children: firstMessage ? [firstMessage.id] : []
			};
			await db.messages.add(systemMessage);
			if (firstMessage) {
				await requireUpdated(
					await db.messages.update(firstMessage.id, { parent: systemMessage.id }),
					`Message ${firstMessage.id}`
				);
			}
			await requireUpdated(
				await db.messages.update(rootId, {
					children: [
						...root.children.filter(
							(id: string) => id !== firstMessage?.id && id !== systemMessage.id
						),
						systemMessage.id
					]
				}),
				`Root message ${rootId}`
			);
			await requireUpdated(
				await db.conversations.update(convId, {
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${convId}`
			);
			return systemMessage;
		});
	}

	/** Removes a system prompt and reconnects all of its children to the root. */
	static async removeSystemPrompt(convId: string, messageId: string): Promise<void> {
		await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const systemMessage = await requireOwnedMessage(convId, messageId);
			if (systemMessage.role !== MessageRole.SYSTEM || !systemMessage.parent) {
				throw new Error(`Message ${messageId} is not a removable system prompt`);
			}
			const root = await requireOwnedMessage(convId, systemMessage.parent);
			for (const childId of systemMessage.children) {
				const child = await requireOwnedMessage(convId, childId);
				if (child.parent !== messageId) throw new Error(`Invalid child ${childId}`);
				await requireUpdated(
					await db.messages.update(childId, { parent: root.id }),
					`Message ${childId}`
				);
			}
			await requireUpdated(
				await db.messages.update(root.id, {
					children: [
						...root.children.filter((id: string) => id !== messageId),
						...systemMessage.children.filter((id: string) => !root.children.includes(id))
					]
				}),
				`Root message ${root.id}`
			);
			await db.messages.delete(messageId);
			await requireUpdated(
				await db.conversations.update(convId, {
					currNode: conversation.currNode === messageId ? root.id : conversation.currNode,
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${convId}`
			);
		});
	}

	/** Updates a message and its conversation timestamp in one transaction. */
	static async updateConversationMessage(
		convId: string,
		messageId: string,
		updates: Partial<Omit<DatabaseMessage, 'id' | 'convId'>>
	): Promise<void> {
		await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const message = await requireOwnedMessage(convId, messageId);
			if (
				message.role === MessageRole.USER &&
				updates.content !== undefined &&
				updates.content !== message.content
			)
				await releaseFormResults(convId, new Set([messageId]));
			await requireUpdated(await db.messages.update(messageId, updates), `Message ${messageId}`);
			await requireUpdated(
				await db.conversations.update(convId, {
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${convId}`
			);
		});
	}

	/** Replaces a user message and removes its selected response branch atomically. */
	static async replaceUserMessageAndTruncateBranch(
		convId: string,
		messageId: string,
		content: string,
		extra?: DatabaseMessage['extra']
	): Promise<{ deletedIds: string[]; lastModified: number }> {
		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const target = await requireOwnedMessage(convId, messageId);
			if (target.role !== MessageRole.USER)
				throw new Error(`Message ${messageId} is not a user message`);
			const allMessages = await db.messages.where('convId').equals(convId).toArray();
			const deletedIds = findDescendantMessages(allMessages, messageId);
			const deletedIdSet = new Set(deletedIds);
			await releaseFormResults(
				convId,
				new Set([...deletedIds, ...(content !== target.content ? [messageId] : [])])
			);
			for (const candidate of allMessages) {
				if (candidate.id === messageId || deletedIdSet.has(candidate.id)) continue;
				const nextChildren = candidate.children.filter((id: string) => !deletedIdSet.has(id));
				if (nextChildren.length === candidate.children.length) continue;
				await requireUpdated(
					await db.messages.update(candidate.id, { children: nextChildren }),
					`Message ${candidate.id}`
				);
			}
			await requireUpdated(
				await db.messages.update(messageId, { content, extra, children: [] }),
				`Message ${messageId}`
			);
			if (deletedIds.length > 0) await db.messages.bulkDelete(deletedIds);
			const lastModified = nextLastModified(conversation);
			await requireUpdated(
				await db.conversations.update(convId, { currNode: messageId, lastModified }),
				`Conversation ${convId}`
			);
			return { deletedIds, lastModified };
		});
	}

	/** Removes an assistant response branch and selects its parent for regeneration. */
	static async truncateBranchForRegeneration(
		convId: string,
		messageId: string
	): Promise<{ parentId: string; deletedIds: string[]; lastModified: number }> {
		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const target = await requireOwnedMessage(convId, messageId);
			if (target.role !== MessageRole.ASSISTANT || !target.parent) {
				throw new Error(`Message ${messageId} is not a regeneratable assistant message`);
			}
			const parent = await requireOwnedMessage(convId, target.parent);
			if (!parent.children.includes(messageId))
				throw new Error(`Invalid parent for message ${messageId}`);
			const allMessages = await db.messages.where('convId').equals(convId).toArray();
			const deletedIds = [messageId, ...findDescendantMessages(allMessages, messageId)];
			await releaseFormResults(convId, new Set(deletedIds));
			await requireUpdated(
				await db.messages.update(parent.id, {
					children: parent.children.filter((id: string) => id !== messageId)
				}),
				`Parent message ${parent.id}`
			);
			await db.messages.bulkDelete(deletedIds);
			const lastModified = nextLastModified(conversation);
			await requireUpdated(
				await db.conversations.update(convId, { currNode: parent.id, lastModified }),
				`Conversation ${convId}`
			);
			return { parentId: parent.id, deletedIds, lastModified };
		});
	}

	/**
	 * Deletes a conversation and all its messages.
	 *
	 * @param id - Conversation ID
	 */
	static async deleteConversation(
		id: string,
		options?: { deleteWithForks?: boolean }
	): Promise<void> {
		await db.transaction('rw', [db.conversations, db.messages], async () => {
			if (options?.deleteWithForks) {
				// Recursively collect all descendant IDs
				const idsToDelete: string[] = [];
				const queue = [id];

				while (queue.length > 0) {
					const parentId = queue.pop()!;
					const children = await db.conversations
						.filter((c) => c.forkedFromConversationId === parentId)
						.toArray();

					for (const child of children) {
						idsToDelete.push(child.id);
						queue.push(child.id);
					}
				}

				for (const forkId of idsToDelete) {
					await db.conversations.delete(forkId);
					await db.messages.where('convId').equals(forkId).delete();
				}
			} else {
				// Reparent direct children to deleted conv's parent
				const conv = await db.conversations.get(id);
				const newParent = conv?.forkedFromConversationId;
				const directChildren = await db.conversations
					.filter((c) => c.forkedFromConversationId === id)
					.toArray();

				for (const child of directChildren) {
					await requireUpdated(
						await db.conversations.update(child.id, {
							forkedFromConversationId: newParent ?? undefined
						}),
						`Conversation ${child.id}`
					);
				}
			}

			await db.conversations.delete(id);
			await db.messages.where('convId').equals(id).delete();
		});
	}

	/**
	 * Deletes unpinned conversations and their messages in one transaction.
	 * Surviving forks are attached to their nearest surviving ancestor.
	 */
	static async deleteConversations(ids: string[]): Promise<{
		deletedIds: string[];
		skippedPinnedIds: string[];
	}> {
		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversations = await db.conversations.toArray();
			const plan = planConversationDeletion(conversations, ids);

			for (const update of plan.parentUpdates) {
				await requireUpdated(
					await db.conversations.update(update.id, {
						forkedFromConversationId: update.forkedFromConversationId
					}),
					`Conversation ${update.id}`
				);
			}

			if (plan.deletedIds.length > 0) {
				await db.conversations.bulkDelete(plan.deletedIds);
				await db.messages.where('convId').anyOf(plan.deletedIds).delete();
			}

			return {
				deletedIds: plan.deletedIds,
				skippedPinnedIds: plan.skippedPinnedIds
			};
		});
	}

	/**
	 * Deletes a message and removes it from its parent's children array.
	 *
	 * @param messageId - ID of the message to delete
	 */
	static async deleteMessage(messageId: string): Promise<void> {
		await db.transaction('rw', db.messages, async () => {
			const message = await db.messages.get(messageId);
			if (!message) return;

			// Remove this message from its parent's children array
			if (message.parent) {
				const parent = await db.messages.get(message.parent);
				if (parent) {
					parent.children = parent.children.filter((childId: string) => childId !== messageId);
					await db.messages.put(parent);
				}
			}

			// Delete the message
			await releaseFormResults(message.convId, new Set([messageId]));
			await db.messages.delete(messageId);
		});
	}

	/** Remove only an unused assistant leaf, never a completed response or a newer branch. */
	static async deleteEmptyAssistantMessage(
		conversationId: string,
		messageId: string,
		expectedParent: string
	): Promise<{ parentId: string; lastModified: number } | null> {
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await db.conversations.get(conversationId);
			const message = await db.messages.get(messageId);
			if (
				!conversation ||
				!message ||
				message.convId !== conversationId ||
				message.parent !== expectedParent ||
				message.role !== MessageRole.ASSISTANT ||
				message.type !== 'text' ||
				message.content ||
				message.interactiveForm ||
				message.reasoningContent ||
				message.thinking ||
				message.toolCalls ||
				message.toolCallId ||
				message.extra?.length ||
				message.children.length ||
				message.completionId ||
				message.model ||
				message.timings ||
				message.providerContinuation ||
				(await db.messages.where('parent').equals(messageId).count())
			)
				return null;

			const parent = await requireOwnedMessage(conversationId, expectedParent);
			const lastModified = nextLastModified(conversation);
			await requireUpdated(
				await db.messages.update(parent.id, {
					children: parent.children.filter((id: string) => id !== messageId)
				}),
				`Parent message ${parent.id}`
			);
			await db.messages.delete(messageId);
			await requireUpdated(
				await db.conversations.update(conversationId, {
					// A newer request/navigation may already own currNode.
					...(conversation.currNode === messageId ? { currNode: parent.id } : {}),
					lastModified
				}),
				`Conversation ${conversationId}`
			);
			return { parentId: parent.id, lastModified };
		});
	}

	/**
	 * Deletes a message and all its descendant messages (cascading deletion).
	 * This removes the entire branch starting from the specified message.
	 *
	 * @param conversationId - ID of the conversation containing the message
	 * @param messageId - ID of the root message to delete (along with all descendants)
	 * @returns Array of all deleted message IDs
	 */
	static async deleteMessageCascading(
		conversationId: string,
		messageId: string,
		replacementCurrentNode: string
	): Promise<string[]> {
		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(conversationId);
			const message = await db.messages.get(messageId);
			if (!message) return [];
			if (message.convId !== conversationId) {
				throw new Error('Message does not belong to conversation');
			}

			// Get all messages in the conversation to find descendants
			const allMessages = await db.messages.where('convId').equals(conversationId).toArray();

			// Find all descendant messages
			const descendants = findDescendantMessages(allMessages, messageId);
			const allToDelete = [...new Set([messageId, ...descendants])];
			const replacement = await requireOwnedMessage(conversationId, replacementCurrentNode);
			if (allToDelete.includes(replacement.id)) {
				throw new Error('Replacement current node cannot be deleted with the branch');
			}

			// Get the message to delete for parent cleanup
			if (message.parent) {
				const parent = await requireOwnedMessage(conversationId, message.parent);
				await requireUpdated(
					await db.messages.update(parent.id, {
						children: parent.children.filter((childId: string) => childId !== messageId)
					}),
					`Parent message ${parent.id}`
				);
			}

			// Delete all messages in the branch
			await releaseFormResults(conversationId, new Set(allToDelete));
			await db.messages.bulkDelete(allToDelete);
			await requireUpdated(
				await db.conversations.update(conversationId, {
					currNode: replacement.id,
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${conversationId}`
			);

			return allToDelete;
		});
	}

	/**
	 * Gets all conversations, sorted by last modified time (newest first).
	 *
	 * @returns Array of conversations
	 */
	static async getAllConversations(): Promise<DatabaseConversation[]> {
		return await db.conversations.orderBy('lastModified').reverse().toArray();
	}

	/**
	 * Gets a conversation by ID.
	 *
	 * @param id - Conversation ID
	 * @returns The conversation if found, otherwise undefined
	 */
	static async getConversation(id: string): Promise<DatabaseConversation | undefined> {
		return await db.conversations.get(id);
	}

	/**
	 * Gets all messages in a conversation, sorted by timestamp (oldest first).
	 *
	 * @param convId - Conversation ID
	 * @returns Array of messages in the conversation
	 */
	static async getConversationMessages(convId: string): Promise<DatabaseMessage[]> {
		return await db.messages.where('convId').equals(convId).sortBy('timestamp');
	}

	/**
	 * Updates a conversation.
	 *
	 * @param id - Conversation ID
	 * @param updates - Partial updates to apply
	 * @returns Promise that resolves when the conversation is updated
	 */
	static async updateConversation(
		id: string,
		updates: Partial<Omit<DatabaseConversation, 'id'>>
	): Promise<void> {
		await db.transaction('rw', db.conversations, async () => {
			const conversation = await requireConversation(id);
			await requireUpdated(
				await db.conversations.update(id, {
					...updates,
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${id}`
			);
		});
	}

	/**
	 * Updates only the pinned state of a conversation.
	 * This intentionally preserves lastModified so pinning does not change chronological sorting.
	 *
	 * @param id - Conversation ID
	 * @param pinned - Whether the conversation should be pinned
	 */
	static async updateConversationPinned(id: string, pinned: boolean): Promise<void> {
		await requireUpdated(
			await db.conversations.update(id, {
				pinned: pinned ? true : undefined
			}),
			`Conversation ${id}`
		);
	}

	/** Updates the pinned state of multiple conversations atomically. */
	static async updateConversationsPinned(ids: string[], pinned: boolean): Promise<void> {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) return;

		await db.transaction('rw', db.conversations, async () => {
			for (const id of uniqueIds) {
				await requireUpdated(
					await db.conversations.update(id, {
						pinned: pinned ? true : undefined
					}),
					`Conversation ${id}`
				);
			}
		});
	}

	/**
	 *
	 *
	 * Navigation
	 *
	 *
	 */

	/**
	 * Updates the conversation's current node (active branch).
	 * This determines which conversation path is currently being viewed.
	 *
	 * @param convId - Conversation ID
	 * @param nodeId - Message ID to set as current node
	 */
	static async updateCurrentNode(convId: string, nodeId: string): Promise<void> {
		await db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			await requireOwnedMessage(convId, nodeId);
			await requireUpdated(
				await db.conversations.update(convId, {
					currNode: nodeId,
					lastModified: nextLastModified(conversation)
				}),
				`Conversation ${convId}`
			);
		});
	}

	/**
	 * Updates a message.
	 *
	 * @param id - Message ID
	 * @param updates - Partial updates to apply
	 * @returns Promise that resolves when the message is updated
	 */
	static async updateMessage(
		id: string,
		updates: Partial<Omit<DatabaseMessage, 'id'>>,
		isCurrent: () => boolean = () => true
	): Promise<void> {
		if (!isCurrent()) return;
		if (updates.interactiveForm) {
			const message = await db.messages.get(id);
			if (!message) throw new Error('Missing form owner');
			updates = {
				...updates,
				interactiveForm: validateInteractiveForm(updates.interactiveForm, message)
			};
		}
		if (updates.modelInfo) {
			const message = await db.messages.get(id);
			if (message?.role !== 'assistant')
				throw new Error('Model information must belong to an assistant');
			updates = { ...updates, modelInfo: messageModelInfoSnapshotSchema.parse(updates.modelInfo) };
		}
		// Form completion can be abandoned while owner/model validation awaits IDB.
		// Check again at the existing atomic message-write boundary, not in a new writer.
		if (!isCurrent()) return;
		await requireUpdated(await db.messages.update(id, updates), `Message ${id}`);
	}

	/** Field-only CAS: never write a stale message snapshot over streaming/graph data. */
	static async saveInteractiveFormValues(
		convId: string,
		messageId: string,
		formId: string,
		values: FormValues,
		revision: number
	): Promise<InteractiveForm> {
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			await requireConversation(convId);
			const message = await requireOwnedMessage(convId, messageId);
			const form = validateInteractiveForm(message.interactiveForm, message);
			if (
				form.id !== formId ||
				form.sourceContent !== message.content ||
				form.revision !== revision ||
				form.status !== 'draft' ||
				form.result
			)
				throw new Error('Form changed or is locked');
			const next = { ...form, values: parseFormValues(form.spec, values), revision: revision + 1 };
			await db.messages.update(messageId, { interactiveForm: next });
			return next;
		});
	}

	/** Reserve the existing send pipeline's user message and result together. Retries
	 * reuse its ID; neither a second tab nor a double click can create a duplicate.
	 */
	static async prepareInteractiveFormSubmission(
		convId: string,
		messageId: string,
		formId: string
	): Promise<{ owner: DatabaseMessage; user: DatabaseMessage }> {
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			const conversation = await requireConversation(convId);
			const owner = await requireOwnedMessage(convId, messageId);
			const form = validateInteractiveForm(owner.interactiveForm, owner);
			if (form.id !== formId || owner.content !== form.sourceContent || form.status !== 'draft')
				throw new Error('Form changed or already submitted');
			const path = filterByLeafNodeId(
				await db.messages.where('convId').equals(convId).toArray(),
				conversation.currNode ?? '',
				true
			);
			if (!path.some((m) => m.id === messageId))
				throw new Error('Form is not on the selected branch');
			if (form.result) {
				const user = await requireOwnedMessage(convId, form.result.messageId);
				if (
					user.role !== 'user' ||
					user.content !== form.result.content ||
					!path.some((m) => m.id === user.id)
				)
					throw new Error('Saved submission changed or is on a different branch');
				return { owner, user };
			}
			const checked = validateFormValues(form.spec, form.values);
			if (!checked.valid) throw new Error('Invalid form answers');
			const user = await this.createMessageBranch(
				{
					convId,
					role: MessageRole.USER,
					type: MessageType.TEXT,
					content: formAnswerText(form.spec, checked.values),
					timestamp: Date.now(),
					children: [],
					toolCalls: ''
				},
				conversation.currNode
			);
			const next: InteractiveForm = {
				...form,
				revision: form.revision + 1,
				result: { values: checked.values, content: user.content, messageId: user.id }
			};
			await db.messages.update(messageId, { interactiveForm: next });
			return { owner: { ...owner, interactiveForm: next }, user };
		});
	}

	static async completeInteractiveFormSubmission(
		convId: string,
		messageId: string,
		formId: string,
		userMessageId: string
	): Promise<DatabaseMessage> {
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			await requireConversation(convId);
			const owner = await requireOwnedMessage(convId, messageId);
			const form = validateInteractiveForm(owner.interactiveForm, owner);
			const user = await requireOwnedMessage(convId, userMessageId);
			if (
				form.id !== formId ||
				form.sourceContent !== owner.content ||
				!form.result ||
				form.result.messageId !== user.id ||
				form.result.content !== user.content ||
				user.role !== 'user'
			)
				throw new Error('Submission identity changed');
			const next: InteractiveForm = { ...form, status: 'submitted', revision: form.revision + 1 };
			await db.messages.update(messageId, { interactiveForm: next });
			return { ...owner, interactiveForm: next };
		});
	}

	/** Content-only CAS. Writer-drain/finished-message gating belongs to the caller. */
	static async replaceVisualizationBlock(
		prepared: PreparedVisualizationReplacement,
		{ isIdle }: { isIdle: () => boolean }
	): Promise<void> {
		const snapshot = getPreparedVisualizationReplacement(prepared);
		// A nested transaction could resolve before its outer transaction commits.
		if (Dexie.currentTransaction)
			throw new Error('Visualization replacement requires a standalone transaction');
		const requireIdle = () => {
			if (isIdle() !== true) throw new Error('Conversation is not idle');
		};
		requireIdle();
		await db.transaction('rw', [db.conversations, db.messages], async () => {
			requireIdle();
			const {
				conversationId,
				messageId,
				originalContent,
				rawStart,
				rawEnd,
				exactOriginalFence,
				newContent
			} = snapshot;
			await requireConversation(conversationId);
			const message = await requireOwnedMessage(conversationId, messageId);
			if (
				message.role !== MessageRole.ASSISTANT ||
				message.type !== MessageType.TEXT ||
				message.content !== originalContent
			)
				throw new Error('Visualization owner or original message content changed');
			if (
				!Number.isInteger(rawStart) ||
				!Number.isInteger(rawEnd) ||
				rawStart < 0 ||
				rawEnd <= rawStart ||
				rawEnd > message.content.length ||
				message.content.slice(rawStart, rawEnd) !== exactOriginalFence
			)
				throw new Error('Original visualization range changed');
			requireIdle();
			const changed = await db.messages.update(messageId, { content: newContent });
			if (changed !== 1) throw new Error('Visualization message was not updated');
			// A writer may have queued while IndexedDB serviced the update. Throw
			// inside this still-open transaction so the content write rolls back.
			requireIdle();
		});
	}

	/** Assistant identity and call registration are committed together, before permission/execution. */
	static async completeAgenticAssistant(
		identity: AgenticMessageIdentity,
		updates: Pick<DatabaseMessage, 'content'> &
			Partial<
				Pick<DatabaseMessage, 'reasoningContent' | 'timings' | 'toolCalls' | 'providerContinuation'>
			>
	): Promise<DatabaseMessage> {
		assertNonEmptyId(identity.operationId, 'Agentic operation ID');
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			await requireConversation(identity.conversationId);
			const message = await requireOwnedMessage(
				identity.conversationId,
				identity.assistantMessageId
			);
			if (
				message.role !== MessageRole.ASSISTANT ||
				(message.agentic && message.agentic.operationId !== identity.operationId)
			) {
				throw new Error('Invalid agentic assistant identity');
			}
			if (message.agentic?.terminalReason) {
				for (const key of [
					'content',
					'reasoningContent',
					'toolCalls',
					'providerContinuation'
				] as const) {
					if (JSON.stringify(message[key]) !== JSON.stringify(updates[key]))
						throw new Error('Cannot replace a terminal assistant turn');
				}
				return message;
			}
			const calls = updates.toolCalls ? (JSON.parse(updates.toolCalls) as { id: string }[]) : [];
			if (
				new Set(calls.map((call) => call.id)).size !== calls.length ||
				calls.some((call) => !call.id)
			) {
				throw new Error('Invalid or duplicate tool call identity');
			}
			if (message.agentic?.calls.length && message.toolCalls !== updates.toolCalls) {
				throw new Error('Cannot replace registered tool calls');
			}
			const agentic = message.agentic ?? { operationId: identity.operationId, calls: [] };
			if (!agentic.calls.length)
				agentic.calls = calls.map((call) => ({ toolCallId: call.id, status: 'not_started' }));
			const updated = { ...message, ...updates, agentic };
			await db.messages.put(updated);
			return updated;
		});
	}

	/** No external execution inside this transaction. A confirmed result can supersede unknown, never vice versa. */
	static async transitionAgenticToolCall(
		identity: AgenticMessageIdentity,
		toolCallId: string,
		outcome: AgenticToolOutcome,
		parentId: string
	): Promise<{ assistant: DatabaseMessage; result?: DatabaseMessage }> {
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			await requireConversation(identity.conversationId);
			const assistant = await requireOwnedMessage(
				identity.conversationId,
				identity.assistantMessageId
			);
			if (
				assistant.role !== MessageRole.ASSISTANT ||
				assistant.agentic?.operationId !== identity.operationId
			) {
				throw new Error('Invalid agentic operation identity');
			}
			const execution = assistant.agentic.calls.find(
				(call: ToolCallExecution) => call.toolCallId === toolCallId
			);
			if (!execution) throw new Error('Unknown tool call identity');
			if (execution.resultMessageId) {
				const result = await requireOwnedMessage(
					identity.conversationId,
					execution.resultMessageId
				);
				if (outcome.result && !sameConfirmedToolResult(result, outcome.result)) {
					throw new Error('Cannot replace a confirmed tool result');
				}
				return { assistant, result };
			}
			if (outcome.status === 'completed' && !outcome.result)
				throw new Error('Completed call requires a confirmed output');
			if (outcome.result && !['completed', 'error'].includes(outcome.status))
				throw new Error('Only confirmed outcomes may contain output');
			if (outcome.result && !['started', 'interrupted_unknown'].includes(execution.status))
				throw new Error('Cannot confirm an execution that never started');
			const allowed =
				execution.status === outcome.status ||
				(execution.status === 'not_started' &&
					['started', 'denied', 'error'].includes(outcome.status)) ||
				(execution.status === 'started' &&
					['completed', 'error', 'interrupted_unknown'].includes(outcome.status)) ||
				(execution.status === 'interrupted_unknown' &&
					['completed', 'error'].includes(outcome.status));
			if (!allowed || (assistant.agentic.terminalReason && outcome.status === 'started')) {
				throw new Error(
					`Invalid tool lifecycle transition: ${execution.status} → ${outcome.status}`
				);
			}
			let result: DatabaseMessage | undefined;
			if (outcome.result) {
				let parent = await requireOwnedMessage(identity.conversationId, parentId);
				const previousCurrentNode = (await requireConversation(identity.conversationId)).currNode;
				const visited = new Set<string>();
				while (parent.id !== assistant.id) {
					if (
						visited.has(parent.id) ||
						parent.role !== MessageRole.TOOL ||
						!parent.parent ||
						!assistant.agentic.calls.some(
							(call: ToolCallExecution) => call.resultMessageId === parent.id
						)
					) {
						throw new Error('Tool result parent does not belong to this assistant turn');
					}
					visited.add(parent.id);
					parent = await requireOwnedMessage(identity.conversationId, parent.parent);
				}
				result = await this.createMessageBranch(
					{
						convId: identity.conversationId,
						role: MessageRole.TOOL,
						type: 'text',
						content: outcome.result.content,
						extra: outcome.result.extras,
						toolCallId,
						toolCalls: '',
						timestamp: Date.now(),
						parent: parentId,
						children: []
					},
					parentId
				);
				// Preserve existing branches and their causal context. A late result
				// must not reparent/select a newer user message or continuation.
				if (previousCurrentNode !== parentId) {
					await requireUpdated(
						await db.conversations.update(identity.conversationId, {
							currNode: previousCurrentNode
						}),
						`Conversation ${identity.conversationId}`
					);
				}
			}
			execution.status = outcome.status;
			execution.error = outcome.error;
			if (result) execution.resultMessageId = result.id;
			await requireUpdated(
				await db.messages.update(assistant.id, { agentic: assistant.agentic }),
				`Assistant ${assistant.id}`
			);
			return {
				assistant: await requireOwnedMessage(identity.conversationId, assistant.id),
				result
			};
		});
	}

	static async finishAgenticTurn(
		identity: AgenticMessageIdentity,
		reason: AgenticTerminalReason
	): Promise<DatabaseMessage> {
		return db.transaction('rw', [db.conversations, db.messages], async () => {
			const message = await requireOwnedMessage(
				identity.conversationId,
				identity.assistantMessageId
			);
			if (
				message.role !== MessageRole.ASSISTANT ||
				message.agentic?.operationId !== identity.operationId
			) {
				throw new Error('Invalid terminal agentic identity');
			}
			if (message.agentic.terminalReason && message.agentic.terminalReason !== reason)
				throw new Error('Agentic turn already terminated');
			message.agentic.terminalReason = reason;
			for (const call of message.agentic.calls)
				if (call.status === 'started') call.status = 'interrupted_unknown';
			await db.messages.put(message);
			return message;
		});
	}

	/**
	 *
	 *
	 * Import
	 *
	 *
	 */

	/**
	 * Imports multiple conversations and their messages.
	 * Skips conversations that already exist.
	 *
	 * @param data - Array of { conv, messages } objects
	 */
	static async importConversations(
		data: { conv: DatabaseConversation; messages: DatabaseMessage[] }[]
	): Promise<{ imported: number; skipped: number }> {
		const imports = validateConversationImports(data);

		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const existingConversations = await db.conversations.bulkGet(
				imports.map(({ conv }) => conv.id)
			);
			const importable = imports.filter((item, index) => {
				if (!existingConversations[index]) return true;
				console.warn(`Conversation "${item.conv.name}" already exists, skipping...`);
				return false;
			});
			const messages = importable.flatMap((item) => item.messages);
			const collisions = await db.messages.bulkGet(messages.map((message) => message.id));
			const collisionIndex = collisions.findIndex((message) => message !== undefined);
			if (collisionIndex !== -1) {
				throw new Error(`Message ID already exists in database: ${messages[collisionIndex].id}`);
			}

			await db.conversations.bulkAdd(importable.map((item) => item.conv));
			await db.messages.bulkAdd(messages);

			return { imported: importable.length, skipped: imports.length - importable.length };
		});
	}

	/**
	 * Apply parser-only plans. All conversations roll back together on any failure.
	 * The shipped localStorage marker is a post-commit cache, never a transaction record.
	 * If writing it fails (or the app stops first), retry sees already structured messages.
	 */
	static async migrateLegacyMessages(planMessage: LegacyMessagePlanner): Promise<void> {
		try {
			if (localStorage.getItem(LEGACY_MIGRATION_DONE_KEY)) return;
		} catch {
			return;
		}
		await db.transaction('rw', [db.conversations, db.messages], async () => {
			for (const conversation of await db.conversations.toArray()) {
				const messages = await db.messages.where('convId').equals(conversation.id).toArray();
				const plans = messages.map((message) => ({
					message,
					segments: planMessage({
						id: message.id,
						role: message.role,
						content: message.content,
						reasoningContent: message.reasoningContent,
						toolCalls: message.toolCalls
					})
				}));
				if (!plans.some(({ segments }) => segments !== null)) continue;
				validateConversationGraph(conversation, messages);
				const graph = new Map(messages.map((message) => [message.id, message]));
				for (const { message, segments } of plans) {
					if (!segments) continue;
					if (
						!segments.length ||
						segments[0].role !== 'assistant' ||
						message.role !== 'assistant'
					) {
						throw new Error(`Invalid legacy transformation for ${message.id}`);
					}
					const children = [...message.children];
					const resultIds = new Set(
						segments
							.filter((segment) => segment.role === 'tool')
							.map((segment) => segment.toolCallId)
					);
					const existingTools = [...children];
					while (existingTools.length) {
						const child = graph.get(existingTools.pop()!)!;
						if (child.role !== 'tool') continue;
						if (resultIds.has(child.toolCallId)) {
							throw new Error(`Ambiguous existing tool result for legacy message ${message.id}`);
						}
						existingTools.push(...child.children);
					}
					message.content = segments[0].content;
					message.reasoningContent = segments[0].reasoningContent;
					message.toolCalls = segments[0].toolCalls;
					let tail = message;
					for (const segment of segments.slice(1)) {
						const next: DatabaseMessage = {
							...segment,
							id: uuid(),
							convId: conversation.id,
							type: 'text',
							timestamp: message.timestamp,
							toolCalls: segment.toolCalls ?? '',
							model: message.model,
							modelInfo: segment.role === 'assistant' ? message.modelInfo : undefined,
							parent: tail.id,
							children: []
						};
						await db.messages.add(next);
						tail.children = [next.id];
						await db.messages.put(tail);
						graph.set(next.id, next);
						tail = next;
					}
					tail.children = children;
					for (const childId of children) {
						const child = graph.get(childId)!;
						child.parent = tail.id;
						await requireUpdated(
							await db.messages.update(childId, { parent: tail.id }),
							`Message ${childId}`
						);
					}
					await db.messages.put(tail);
					// Explicit mapping: selection of the whole old message means its last segment.
					if (conversation.currNode === message.id) conversation.currNode = tail.id;
				}
				await db.conversations.put(conversation); // Preserve lastModified, pinned and all metadata.
				// Validate persisted records, not merely the in-memory plan, before commit.
				validateConversationGraph(
					await requireConversation(conversation.id),
					await db.messages.where('convId').equals(conversation.id).toArray()
				);
			}
		});
		try {
			localStorage.setItem(LEGACY_MIGRATION_DONE_KEY, String(Date.now()));
		} catch {
			// Committed transformations are idempotent; a later startup may retry safely.
		}
	}

	/**
	 *
	 *
	 * Forking
	 *
	 *
	 */

	/**
	 * Forks a conversation at a specific message, creating a new conversation
	 * containing all messages from the root up to (and including) the target message.
	 *
	 * @param sourceConvId - The source conversation ID
	 * @param atMessageId - The message ID to fork at (the new conversation ends here)
	 * @param options - Fork options (name and whether to include attachments)
	 * @returns The newly created conversation
	 */
	static async forkConversation(
		sourceConvId: string,
		atMessageId: string,
		options: { name: string; includeAttachments: boolean }
	): Promise<DatabaseConversation> {
		return await db.transaction('rw', [db.conversations, db.messages], async () => {
			const sourceConv = await db.conversations.get(sourceConvId);
			if (!sourceConv) {
				throw new Error(`Source conversation ${sourceConvId} not found`);
			}

			const allMessages = await db.messages.where('convId').equals(sourceConvId).toArray();

			const pathMessages = filterByLeafNodeId(allMessages, atMessageId, true) as DatabaseMessage[];
			if (pathMessages.length === 0) {
				throw new Error(`Could not resolve message path to ${atMessageId}`);
			}

			const idMap = new Map<string, string>();

			for (const msg of pathMessages) {
				idMap.set(msg.id, uuid());
			}

			const newConvId = uuid();
			const clonedMessages: DatabaseMessage[] = pathMessages.map((msg) => {
				const newId = idMap.get(msg.id)!;
				const newParent = msg.parent ? (idMap.get(msg.parent) ?? null) : null;
				const newChildren = msg.children
					.filter((childId: string) => idMap.has(childId))
					.map((childId: string) => idMap.get(childId)!);

				return {
					...msg,
					...(msg.interactiveForm
						? {
								interactiveForm: (() => {
									const form = validateInteractiveForm(msg.interactiveForm, msg);
									const resultId = form.result ? idMap.get(form.result.messageId) : undefined;
									return {
										...form,
										id: uuid(),
										messageId: newId,
										conversationId: newConvId,
										revision: 0,
										status: resultId ? form.status : ('draft' as const),
										result:
											resultId && form.result ? { ...form.result, messageId: resultId } : undefined
									};
								})()
							}
						: {}),
					agentic: msg.agentic
						? {
								...msg.agentic,
								calls: msg.agentic.calls.map((call: ToolCallExecution) => ({
									...call,
									resultMessageId: call.resultMessageId
										? idMap.get(call.resultMessageId)
										: undefined
								}))
							}
						: undefined,
					id: newId,
					convId: newConvId,
					parent: newParent,
					children: newChildren,
					extra: options.includeAttachments ? msg.extra : undefined
				};
			});

			const lastClonedMessage = clonedMessages[clonedMessages.length - 1];
			const newConv: DatabaseConversation = {
				id: newConvId,
				name: options.name,
				lastModified: Date.now(),
				currNode: lastClonedMessage.id,
				forkedFromConversationId: sourceConvId,
				mcpServerOverrides: sourceConv.mcpServerOverrides
					? sourceConv.mcpServerOverrides.map((o: McpServerOverride) => ({
							serverId: o.serverId,
							enabled: o.enabled
						}))
					: undefined
			};

			await db.conversations.add(newConv);

			for (const msg of clonedMessages) {
				await db.messages.add(msg);
			}

			return newConv;
		});
	}
}
