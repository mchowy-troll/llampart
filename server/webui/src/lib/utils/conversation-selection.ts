export interface ConversationSelectionUpdate {
	selectedIds: string[];
	anchorId: string;
}

export interface ConversationDeletionPlan {
	deletedIds: string[];
	skippedPinnedIds: string[];
	parentUpdates: Array<{
		id: string;
		forkedFromConversationId: string | undefined;
	}>;
}

function orderSelection(selectedIds: Set<string>, visibleIds: string[]): string[] {
	const visibleIdSet = new Set(visibleIds);

	return [
		...visibleIds.filter((id) => selectedIds.has(id)),
		...[...selectedIds].filter((id) => !visibleIdSet.has(id))
	];
}

export function updateConversationSelection(
	selectedIds: string[],
	visibleIds: string[],
	targetId: string,
	anchorId: string | null,
	checked: boolean,
	extendRange: boolean
): ConversationSelectionUpdate {
	const nextSelection = new Set(selectedIds);
	const targetIndex = visibleIds.indexOf(targetId);
	const anchorIndex = anchorId ? visibleIds.indexOf(anchorId) : -1;

	if (extendRange && targetIndex !== -1 && anchorIndex !== -1) {
		const start = Math.min(anchorIndex, targetIndex);
		const end = Math.max(anchorIndex, targetIndex);

		for (const id of visibleIds.slice(start, end + 1)) {
			if (checked) nextSelection.add(id);
			else nextSelection.delete(id);
		}
	} else if (checked) {
		nextSelection.add(targetId);
	} else {
		nextSelection.delete(targetId);
	}

	return {
		selectedIds: orderSelection(nextSelection, visibleIds),
		anchorId: targetId
	};
}

export function selectAllVisibleConversations(
	selectedIds: string[],
	visibleIds: string[]
): string[] {
	return orderSelection(new Set([...selectedIds, ...visibleIds]), visibleIds);
}

export function planConversationDeletion(
	conversations: DatabaseConversation[],
	requestedIds: string[]
): ConversationDeletionPlan {
	const conversationsById = new Map(
		conversations.map((conversation) => [conversation.id, conversation])
	);
	const requestedIdSet = new Set(requestedIds);
	const skippedPinnedIds = conversations
		.filter((conversation) => requestedIdSet.has(conversation.id) && conversation.pinned)
		.map((conversation) => conversation.id);
	const pinnedIdSet = new Set(skippedPinnedIds);
	const deletedIds = [...new Set(requestedIds)].filter(
		(id) => conversationsById.has(id) && !pinnedIdSet.has(id)
	);
	const deletedIdSet = new Set(deletedIds);
	const parentUpdates: ConversationDeletionPlan['parentUpdates'] = [];

	for (const conversation of conversations) {
		if (deletedIdSet.has(conversation.id) || !conversation.forkedFromConversationId) continue;
		if (!deletedIdSet.has(conversation.forkedFromConversationId)) continue;

		let parentId: string | undefined = conversation.forkedFromConversationId;
		const visited = new Set<string>();

		while (parentId && deletedIdSet.has(parentId) && !visited.has(parentId)) {
			visited.add(parentId);
			parentId = conversationsById.get(parentId)?.forkedFromConversationId;
		}

		if (parentId && (deletedIdSet.has(parentId) || !conversationsById.has(parentId))) {
			parentId = undefined;
		}

		parentUpdates.push({ id: conversation.id, forkedFromConversationId: parentId });
	}

	return { deletedIds, skippedPinnedIds, parentUpdates };
}
