import { describe, expect, it } from 'vitest';
import { formatConversationDocumentTitle } from '$lib/utils/document-title';

describe('formatConversationDocumentTitle', () => {
	it('keeps short conversation titles before the app suffix', () => {
		expect(formatConversationDocumentTitle('Plan', 'Chat')).toBe('Plan - llampart');
	});

	it('keeps the full conversation title before the app suffix', () => {
		expect(formatConversationDocumentTitle('Chat 21.06.2026, 11:53:58', 'Chat')).toBe(
			'Chat 21.06.2026, 11:53:58 - llampart'
		);
	});

	it('normalizes whitespace before adding the app suffix', () => {
		expect(formatConversationDocumentTitle('  Chat   title  ', 'Chat')).toBe(
			'Chat title - llampart'
		);
	});

	it('falls back to the provided chat label', () => {
		expect(formatConversationDocumentTitle('', 'Chat')).toBe('Chat - llampart');
	});
});
