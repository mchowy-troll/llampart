import Dexie, { type EntityTable } from 'dexie';
import { filterByLeafNodeId, findDescendantMessages } from '$lib/utils/branching';
import { uuid } from '$lib/utils/uuid';
import { planConversationDeletion } from '$lib/utils/conversation-selection';
import { validateConversationImportRecords } from '$lib/utils/conversation-import-export';
import type { McpServerOverride } from '$lib/types/database';

class LlamacppDatabase extends Dexie {
	conversations!: EntityTable<DatabaseConversation, string>;
	messages!: EntityTable<DatabaseMessage, string>;

	constructor() {
		super('LlamacppWebui');

		this.version(1).stores({
			conversations: 'id, lastModified, currNode, name',
			messages: 'id, convId, type, role, timestamp, parent, children'
		});
	}
}

const db = new LlamacppDatabase();
import { MessageRole } from '$lib/enums/chat';

type ConversationImport = { conv: DatabaseConversation; messages: DatabaseMessage[] };

function nextLastModified(conversation: DatabaseConversation): number {
	return Math.max(Date.now(), conversation.lastModified + 1);
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
		const graph = new Map<string, DatabaseMessage>();
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
			graph.set(message.id, message);

			if (message.convId !== conv.id) {
				throw new Error(`Message ${message.id} does not belong to conversation ${conv.id}`);
			}
			if (message.parent !== null) {
				assertNonEmptyId(message.parent, `Parent of message ${message.id}`);
			}
			if (!Array.isArray(message.children)) {
				throw new Error(`Children of message ${message.id} must be an array`);
			}
			const uniqueChildren = new Set<string>();
			for (const childId of message.children) {
				assertNonEmptyId(childId, `Child of message ${message.id}`);
				if (uniqueChildren.has(childId)) {
					throw new Error(`Message ${message.id} contains duplicate child ${childId}`);
				}
				uniqueChildren.add(childId);
			}
		}

		if (messages.length === 0) {
			if (conv.currNode !== null && conv.currNode !== '') {
				throw new Error(`Conversation ${conv.id} currNode does not exist in its graph`);
			}
			imports.push({ conv, messages });
			continue;
		}

		assertNonEmptyId(conv.currNode, `Conversation ${conv.id} currNode`);
		if (!graph.has(conv.currNode)) {
			throw new Error(`Conversation ${conv.id} currNode does not exist in its graph`);
		}

		const roots = messages.filter((message) => message.parent === null);
		if (roots.length !== 1 || roots[0].type !== 'root') {
			throw new Error(`Conversation ${conv.id} must contain exactly one root message`);
		}
		for (const message of messages) {
			if (message.type === 'root' && message !== roots[0]) {
				throw new Error(`Root message ${message.id} must have a null parent`);
			}

			if (message.parent !== null) {
				const parent = graph.get(message.parent);
				if (!parent) throw new Error(`Message ${message.id} has a dangling parent`);
				if (!parent.children.includes(message.id)) {
					throw new Error(`Parent/children relationship is not reciprocal for ${message.id}`);
				}
			}

			for (const childId of message.children) {
				const child = graph.get(childId);
				if (!child) throw new Error(`Message ${message.id} has a dangling child`);
				if (child.parent !== message.id) {
					throw new Error(`Parent/children relationship is not reciprocal for ${childId}`);
				}
			}
		}

		const visiting = new Set<string>();
		const visited = new Set<string>();
		const visit = (messageId: string): void => {
			if (visiting.has(messageId)) throw new Error(`Conversation ${conv.id} contains a cycle`);
			if (visited.has(messageId)) return;
			visiting.add(messageId);
			for (const childId of graph.get(messageId)!.children) visit(childId);
			visiting.delete(messageId);
			visited.add(messageId);
		};
		visit(roots[0].id);
		if (visited.size !== messages.length) {
			throw new Error(`Conversation ${conv.id} contains messages disconnected from its root`);
		}

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
			await requireOwnedMessage(convId, messageId);
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
			await db.messages.delete(messageId);
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
		await this.updateConversation(convId, {
			currNode: nodeId
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
		updates: Partial<Omit<DatabaseMessage, 'id'>>
	): Promise<void> {
		await requireUpdated(await db.messages.update(id, updates), `Message ${id}`);
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

	/** Runs one legacy conversation migration as a single graph transaction. */
	static async runConversationGraphTransaction<T>(operation: () => Promise<T>): Promise<T> {
		return await db.transaction('rw', [db.conversations, db.messages], async (transaction) => {
			try {
				return await operation();
			} catch (error) {
				transaction.abort();
				throw error;
			}
		});
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
