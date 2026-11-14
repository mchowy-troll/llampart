import type { DatabaseMessage } from '$lib/types/database';
import { validateInteractiveForm } from '$lib/services/interactive-forms';

/** Presentation only. The selected path and a mounted, usable form are both
 * required; absent/invalid/unavailable forms fail open. A durable result already
 * owns its user message while pending/retrying, before generation completes. */
export function hiddenFormResultIds(
	messages: DatabaseMessage[],
	renderedForms: ReadonlyMap<string, string>
): Set<string> {
	const hidden = new Set<string>();
	const selected = new Map(messages.map((message) => [message.id, message]));
	for (const owner of messages) {
		if (!owner.interactiveForm || renderedForms.get(owner.id) !== owner.interactiveForm.id)
			continue;
		try {
			const form = validateInteractiveForm(owner.interactiveForm, owner);
			if (form.sourceContent !== owner.content || !form.result) continue;
			const result = selected.get(form.result.messageId);
			if (
				!result ||
				result.role !== 'user' ||
				result.convId !== owner.convId ||
				result.content !== form.result.content ||
				result.extra?.length
			)
				continue;
			// Traverse only the selected, conversation-owned ancestry, never siblings.
			let child = result;
			const visited = new Set<string>();
			while (child.parent && !visited.has(child.id)) {
				visited.add(child.id);
				const parent = selected.get(child.parent);
				if (!parent || parent.convId !== owner.convId || !parent.children.includes(child.id)) break;
				if (parent.id === owner.id) {
					hidden.add(result.id);
					break;
				}
				child = parent;
			}
		} catch {
			// The result bubble may be the only accessible copy of the answers.
		}
	}
	return hidden;
}
