import { describe, expect, it } from 'vitest';
import {
	planConversationDeletion,
	selectAllVisibleConversations,
	updateConversationSelection
} from '$lib/utils/conversation-selection';

function conversation(id: string, parent?: string, pinned = false): DatabaseConversation {
	return {
		id,
		name: id,
		currNode: null,
		lastModified: 0,
		forkedFromConversationId: parent,
		pinned: pinned || undefined
	};
}

describe('conversation selection', () => {
	it('extends a selection through the visible flattened order', () => {
		const result = updateConversationSelection(
			['fork-a'],
			['root', 'fork-a', 'fork-b', 'other'],
			'other',
			'fork-a',
			true,
			true
		);

		expect(result.selectedIds).toEqual(['fork-a', 'fork-b', 'other']);
		expect(result.anchorId).toBe('other');
	});

	it('uses a normal toggle when the range anchor is no longer visible', () => {
		expect(
			updateConversationSelection(['hidden'], ['root', 'fork'], 'fork', 'hidden', true, true)
				.selectedIds
		).toEqual(['fork', 'hidden']);
	});

	it('selects all visible conversations without dropping existing hidden selections', () => {
		expect(selectAllVisibleConversations(['hidden'], ['root', 'fork'])).toEqual([
			'root',
			'fork',
			'hidden'
		]);
	});
});

describe('conversation deletion planner', () => {
	it('skips pinned requests and rewires survivors to the nearest surviving ancestor', () => {
		const plan = planConversationDeletion(
			[
				conversation('root'),
				conversation('middle', 'root'),
				conversation('leaf', 'middle'),
				conversation('pinned-leaf', 'middle', true),
				conversation('grandchild', 'leaf')
			],
			['middle', 'leaf', 'pinned-leaf']
		);

		expect(plan.deletedIds).toEqual(['middle', 'leaf']);
		expect(plan.skippedPinnedIds).toEqual(['pinned-leaf']);
		expect(plan.parentUpdates).toEqual([
			{ id: 'pinned-leaf', forkedFromConversationId: 'root' },
			{ id: 'grandchild', forkedFromConversationId: 'root' }
		]);
	});

	it('promotes a surviving fork to a root when every ancestor is deleted', () => {
		const plan = planConversationDeletion(
			[conversation('root'), conversation('middle', 'root'), conversation('leaf', 'middle')],
			['root', 'middle']
		);

		expect(plan.parentUpdates).toEqual([{ id: 'leaf', forkedFromConversationId: undefined }]);
	});
});
