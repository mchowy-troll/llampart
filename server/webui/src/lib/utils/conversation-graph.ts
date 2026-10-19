/** Internal graph invariants. Deliberately independent of the export format schema. */
export function validateConversationGraph(
	conv: DatabaseConversation,
	messages: readonly DatabaseMessage[]
): void {
	const graph = new Map<string, DatabaseMessage>();
	for (const message of messages) {
		if (!message.id?.trim() || graph.has(message.id)) {
			throw new Error(`Invalid or duplicate message ID: ${message.id}`);
		}
		graph.set(message.id, message);
		if (message.convId !== conv.id) {
			throw new Error(`Message ${message.id} does not belong to conversation ${conv.id}`);
		}
		if (
			!Array.isArray(message.children) ||
			new Set(message.children).size !== message.children.length
		) {
			throw new Error(`Invalid or duplicate children of message ${message.id}`);
		}
	}
	if (messages.length === 0) {
		if (conv.currNode !== null && conv.currNode !== '') {
			throw new Error(`Conversation ${conv.id} currNode does not exist in its graph`);
		}
		return;
	}
	if (!conv.currNode || !graph.has(conv.currNode)) {
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
	// Iterative traversal also handles long histories without exhausting the call stack.
	const visited = new Set<string>();
	const pending = [roots[0].id];
	while (pending.length) {
		const id = pending.pop()!;
		if (visited.has(id)) throw new Error(`Conversation ${conv.id} contains a cycle`);
		visited.add(id);
		pending.push(...graph.get(id)!.children);
	}
	if (visited.size !== messages.length) {
		throw new Error(
			`Conversation ${conv.id} contains messages disconnected from its root or a cycle`
		);
	}
}
