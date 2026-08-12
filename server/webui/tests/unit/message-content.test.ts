import { describe, expect, it } from 'vitest';
import { MessageRole, MessageType } from '$lib/enums';
import {
	generateAssistantResponseFilename,
	getMessageResponseContent
} from '$lib/utils/message-content';
import type { DatabaseMessage } from '$lib/types/database';

function makeMessage(overrides: Partial<DatabaseMessage> = {}): DatabaseMessage {
	return {
		id: overrides.id ?? 'assistant-1',
		convId: 'conversation-1',
		type: MessageType.TEXT,
		timestamp: Date.UTC(2026, 7, 12, 14, 30, 0),
		role: MessageRole.ASSISTANT,
		content: '',
		parent: null,
		children: [],
		...overrides
	};
}

describe('getMessageResponseContent', () => {
	it('preserves source Markdown for a regular assistant response', () => {
		const message = makeMessage({ content: '# Answer\n\n```ts\nconst value = 1;\n```\n' });

		expect(getMessageResponseContent(message)).toBe(message.content);
	});

	it('exports final text without reasoning when visible text is available', () => {
		const message = makeMessage({
			content: '**Final answer**',
			reasoningContent: 'Internal reasoning'
		});

		expect(getMessageResponseContent(message)).toBe('**Final answer**');
	});

	it('joins visible text from multiple agentic turns', () => {
		const firstTurn = makeMessage({
			content: 'Checking the source.',
			toolCalls: JSON.stringify([
				{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } }
			])
		});
		const toolResult = makeMessage({
			id: 'tool-1',
			role: MessageRole.TOOL,
			content: 'Source found',
			toolCallId: 'call-1'
		});
		const finalTurn = makeMessage({ id: 'assistant-2', content: '## Final result' });

		expect(getMessageResponseContent(firstTurn, [toolResult, finalTurn])).toBe(
			'Checking the source.\n\n## Final result'
		);
	});

	it('uses localized structured content when no visible response exists', () => {
		const message = makeMessage({ content: '', reasoningContent: 'Need more information.' });

		expect(
			getMessageResponseContent(message, [], {
				reasoning: 'Reasoning',
				toolCall: 'Tool call',
				arguments: 'Arguments',
				result: 'Result'
			})
		).toBe('Reasoning:\nNeed more information.');
	});
});

describe('generateAssistantResponseFilename', () => {
	it('generates a deterministic Markdown filename from the message timestamp', () => {
		expect(generateAssistantResponseFilename(Date.UTC(2026, 7, 12, 14, 30, 0))).toBe(
			'llampart-response-2026-08-12_14-30-00.md'
		);
	});
});
