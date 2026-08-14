import { describe, expect, it } from 'vitest';
import { AttachmentType, ReasoningEffort } from '$lib/enums';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';

const exportedConversation = {
	conv: { id: 'conversation', name: 'Conversation', currNode: null, lastModified: 1 },
	messages: []
};

describe('conversation import format', () => {
	it('round-trips the versioned V1 envelope', () => {
		const envelope = createConversationExportEnvelope([exportedConversation], '1.8.2');
		expect(envelope).toMatchObject({
			type: 'llampart-conversations',
			formatVersion: 1,
			appVersion: '1.8.2'
		});
		expect(parseConversationImport(envelope)).toEqual([exportedConversation]);
	});

	it('canonicalizes historical persisted messages before a nonempty V1 round-trip', () => {
		const historical: ExportedConversation = {
			conv: {
				id: 'historical',
				name: 'Historical',
				currNode: 'assistant',
				lastModified: 2,
				pinned: true,
				thinkingEnabled: true,
				reasoningEffort: ReasoningEffort.HIGH,
				mcpServerOverrides: [{ serverId: 'mcp', enabled: true }]
			},
			messages: [
				{
					id: 'assistant',
					convId: 'historical',
					type: 'text' as const,
					timestamp: 2,
					role: 'assistant' as const,
					content: 'Persisted answer',
					parent: null,
					children: [],
					thinking: 'legacy reasoning',
					reasoningContent: 'reasoning',
					completionId: 'completion',
					model: 'model',
					extra: [{ type: AttachmentType.TEXT, name: 'note.txt', content: 'note' }],
					timings: {
						cache_n: 2,
						prompt_n: 3,
						prompt_ms: 12,
						prompt_per_token_ms: 4,
						prompt_per_second: 250,
						predicted_n: 4,
						predicted_ms: 20,
						predicted_per_token_ms: 5,
						predicted_per_second: 200,
						draft_n: 6,
						draft_n_accepted: 5,
						context_total: 9
					}
				}
			]
		};

		const envelope = createConversationExportEnvelope([historical], '1.8.2');
		expect(envelope.conversations[0].messages[0].toolCalls).toBe('');
		expect(parseConversationImport(envelope)).toEqual(envelope.conversations);
	});

	it('rejects timing fields that are not part of the canonical V1 format', () => {
		const envelope = createConversationExportEnvelope(
			[exportedConversation],
			'1.8.2'
		) as unknown as {
			conversations: Array<{ messages: Array<Record<string, unknown>> }>;
		};
		envelope.conversations[0].messages.push({
			id: 'message',
			convId: 'conversation',
			type: 'text',
			timestamp: 1,
			role: 'assistant',
			content: 'answer',
			parent: null,
			children: [],
			toolCalls: '',
			timings: { future_unknown_timing: 1 }
		});

		expect(() => parseConversationImport(envelope)).toThrow(/future_unknown_timing|unrecognized/i);
	});

	it('keeps the canonical V1 parser strict after export normalization', () => {
		const envelope = createConversationExportEnvelope(
			[
				{
					conv: { id: 'strict-message', name: 'Strict', currNode: 'message', lastModified: 1 },
					messages: [
						{
							id: 'message',
							convId: 'strict-message',
							type: 'text',
							timestamp: 1,
							role: 'assistant',
							content: 'answer',
							parent: null,
							children: []
						}
					]
				}
			],
			'1.8.2'
		);
		const withoutToolCalls = structuredClone(envelope) as unknown as {
			conversations: Array<{ messages: Array<Record<string, unknown>> }>;
		};
		delete withoutToolCalls.conversations[0].messages[0].toolCalls;

		expect(() => parseConversationImport(withoutToolCalls)).toThrow(/toolCalls/i);
	});

	it('migrates shipped single-object and array V0 exports', () => {
		expect(parseConversationImport(exportedConversation)).toEqual([exportedConversation]);
		expect(parseConversationImport([exportedConversation])).toEqual([exportedConversation]);
	});

	it('normalizes the rootless active-path shape shipped by v1.8.2', () => {
		const legacy = {
			conv: {
				id: 'legacy-v182',
				name: 'Legacy active conversation',
				currNode: 'assistant',
				lastModified: 123,
				thinkingEnabled: true
			},
			messages: [
				{
					id: 'user',
					convId: 'legacy-v182',
					type: 'text',
					role: 'user',
					content: 'Question',
					timestamp: 100,
					parent: 'omitted-root',
					children: ['hidden-branch', 'assistant'],
					toolCalls: '',
					thinking: 'legacy field'
				},
				{
					id: 'assistant',
					convId: 'legacy-v182',
					type: 'text',
					role: 'assistant',
					content: 'Answer',
					timestamp: 101,
					parent: 'user',
					children: []
				}
			]
		};

		const [normalized] = parseConversationImport(legacy);
		expect(normalized.conv).toMatchObject({ currNode: 'assistant', thinkingEnabled: true });
		expect(normalized.messages).toMatchObject([
			{ id: 'omitted-root', parent: null, children: ['user'], type: 'root' },
			{ id: 'user', parent: 'omitted-root', children: ['assistant'], thinking: 'legacy field' },
			{ id: 'assistant', parent: 'user', children: [], toolCalls: '' }
		]);
	});

	it('uses only an exact visible leaf as the legacy currNode fallback', () => {
		const rootless = {
			conv: { id: 'fallback', name: 'Fallback', currNode: 'omitted', lastModified: 1 },
			messages: [
				{
					id: 'only',
					convId: 'fallback',
					type: 'text',
					role: 'user',
					content: 'Only',
					timestamp: 1,
					parent: 'root',
					children: ['hidden'],
					toolCalls: ''
				}
			]
		};

		expect(parseConversationImport(rootless)[0].conv.currNode).toBe('only');
		expect(() =>
			parseConversationImport({
				...rootless,
				conv: { ...rootless.conv, id: 'ambiguous' },
				messages: [
					{ ...rootless.messages[0], convId: 'ambiguous' },
					{ ...rootless.messages[0], id: 'other', convId: 'ambiguous' }
				]
			})
		).toThrow(/visible leaf|ambiguous/i);
	});

	it('runtime-validates V1 records without applying legacy graph normalization', () => {
		const rootlessV1 = createConversationExportEnvelope(
			[
				{
					conv: { id: 'strict', name: 'Strict', currNode: 'user', lastModified: 1 },
					messages: [
						{
							id: 'user',
							convId: 'strict',
							type: 'text',
							role: 'user',
							content: 'Question',
							timestamp: 1,
							parent: 'missing-root',
							children: [],
							toolCalls: ''
						}
					]
				}
			],
			'1.8.2'
		);

		expect(parseConversationImport(rootlessV1)[0].messages).toHaveLength(1);
		expect(() =>
			parseConversationImport({
				...rootlessV1,
				conversations: [
					{
						...rootlessV1.conversations[0],
						messages: [{ ...rootlessV1.conversations[0].messages[0], timestamp: Infinity }]
					}
				]
			})
		).toThrow(/timestamp/i);
		expect(() =>
			parseConversationImport({
				...rootlessV1,
				conversations: [
					{
						...rootlessV1.conversations[0],
						messages: [{ ...rootlessV1.conversations[0].messages[0], role: 'invalid' }]
					}
				]
			})
		).toThrow(/role/i);
	});

	it('rejects unknown envelope versions instead of treating them as legacy', () => {
		expect(() =>
			parseConversationImport({
				type: 'llampart-conversations',
				formatVersion: 2,
				conversations: [exportedConversation]
			})
		).toThrow(/version/i);
	});
});
