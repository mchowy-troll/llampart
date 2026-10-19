import { describe, expect, it } from 'vitest';
import { projectToolHistory, toolExecutionDescription } from '$lib/utils/tool-lifecycle';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';
import type { ApiChatMessageData } from '$lib/types/api';
import type { ToolExecutionStatus } from '$lib/types/agentic';

const call = { id: 'call', type: 'function' as const, function: { name: 'test', arguments: '{}' } };
const states: ToolExecutionStatus[] = [
	'not_started',
	'denied',
	'started',
	'completed',
	'error',
	'interrupted_unknown'
];

describe('typed tool lifecycle projection', () => {
	it.each(['FIRST', 'SECOND'])(
		'rejects duplicate actual outputs even when the second is %s',
		(second) => {
			const history: ApiChatMessageData[] = [
				{ role: 'assistant', content: '', tool_calls: [call] },
				{ role: 'tool', tool_call_id: call.id, content: 'FIRST' },
				{ role: 'tool', tool_call_id: call.id, content: second }
			];
			const before = structuredClone(history);
			expect(() => projectToolHistory(history)).toThrow(/duplicate tool result.*call/i);
			expect(history).toEqual(before);
		}
	);

	it.each([false, true])(
		'rejects duplicate assistant call IDs with actual output=%s',
		(withOutput) => {
			const history: ApiChatMessageData[] = [
				{ role: 'assistant', content: '', tool_calls: [call, structuredClone(call)] },
				...(withOutput ? [{ role: 'tool' as const, tool_call_id: call.id, content: 'ACTUAL' }] : [])
			];
			const before = structuredClone(history);
			expect(() => projectToolHistory(history)).toThrow(/duplicate assistant tool call.*call/i);
			expect(history).toEqual(before);
		}
	);

	it('detects duplicate IDs before filtering an incomplete call', () => {
		expect(() =>
			projectToolHistory([
				{
					role: 'assistant',
					content: 'partial',
					tool_calls: [call, { ...call, function: { ...call.function, arguments: '{' } }]
				}
			])
		).toThrow(/duplicate assistant tool call/i);
	});

	it('preserves two distinct calls and both actual results, including reversed output order', () => {
		const first: ApiChatMessageData = { role: 'tool', tool_call_id: 'call', content: 'FIRST' };
		const second: ApiChatMessageData = { role: 'tool', tool_call_id: 'second', content: '' };
		const history: ApiChatMessageData[] = [
			{ role: 'assistant', content: 'text', tool_calls: [call, { ...call, id: 'second' }] },
			second,
			first
		];
		const before = structuredClone(history);
		const projected = projectToolHistory(history);
		expect(projected.slice(1)).toEqual([first, second]);
		expect(projected[1]).toBe(first);
		expect(projected[2]).toBe(second);
		expect(projectToolHistory(projected)).toEqual(projected);
		expect(history).toEqual(before);
	});

	it('keeps call identity local to its assistant turn, not global across history', () => {
		const history: ApiChatMessageData[] = [
			{ role: 'assistant', content: '', tool_calls: [call] },
			{ role: 'tool', tool_call_id: call.id, content: 'FIRST TURN' },
			{ role: 'assistant', content: '', tool_calls: [call] },
			{ role: 'tool', tool_call_id: call.id, content: 'SECOND TURN' }
		];
		expect(projectToolHistory(history)).toEqual(history);
	});

	it('omits an incomplete stopped call only when it has no actual output', () => {
		const history: ApiChatMessageData[] = [
			{
				role: 'assistant',
				content: 'partial',
				tool_calls: [{ ...call, function: { ...call.function, arguments: '{' } }],
				agentic: {
					operationId: 'op',
					terminalReason: 'stopped',
					calls: [{ toolCallId: call.id, status: 'not_started' }]
				}
			}
		];
		const before = structuredClone(history);
		expect(projectToolHistory(history)).toEqual([{ ...history[0], tool_calls: undefined }]);
		expect(history).toEqual(before);
	});
	it.each(states)('projects %s without modifying stored content or continuation', (status) => {
		const continuation = {
			protocol: 'responses' as const,
			providerId: 'openai-compatible' as const,
			sourceFingerprint: 'source',
			model: 'model',
			reasoningItems: [{ type: 'reasoning', encrypted_content: 'opaque' }]
		};
		const history: ApiChatMessageData[] = [
			{
				role: 'assistant',
				content: 'text',
				tool_calls: [call],
				providerContinuation: continuation,
				agentic: { operationId: 'op', calls: [{ toolCallId: 'call', status }] }
			}
		];
		const before = structuredClone(history);
		const projected = projectToolHistory(history);
		expect(projected[0].providerContinuation).toEqual(continuation);
		expect(projected[1]).toMatchObject({ role: 'tool', tool_call_id: 'call' });
		expect(projected[1].content).not.toMatch(/success/i);
		expect(history).toEqual(before);
	});

	it('always prefers the actual output, including an empty confirmed result', () => {
		const output: ApiChatMessageData = { role: 'tool', tool_call_id: 'call', content: '' };
		const projected = projectToolHistory([
			{
				role: 'assistant',
				content: '',
				tool_calls: [call],
				agentic: {
					operationId: 'op',
					calls: [{ toolCallId: 'call', status: 'interrupted_unknown' }]
				}
			},
			output,
			{ role: 'user', content: 'next' }
		]);
		expect(projected[1]).toEqual(output);
		expect(projected).toHaveLength(3);
	});

	it('never interprets historical missing outputs as not executed', () => {
		const projected = projectToolHistory([{ role: 'assistant', content: '', tool_calls: [call] }]);
		expect(projected[1].content).toContain('unknown');
		expect(projected[1].content).not.toContain('not executed');
		expect(toolExecutionDescription({ toolCallId: 'call', status: 'started' })).toContain(
			'unknown'
		);
	});

	it('projects incomplete unexecuted stream calls but refuses to drop an actual unmatched output', () => {
		const partial: ApiChatMessageData = {
			role: 'assistant',
			content: 'partial text',
			tool_calls: [{ ...call, function: { name: 'test', arguments: '{' } }]
		};
		expect(projectToolHistory([partial])[0]).toMatchObject({
			content: 'partial text',
			tool_calls: undefined
		});
		expect(() =>
			projectToolHistory([partial, { role: 'tool', content: 'REAL', tool_call_id: 'call' }])
		).toThrow(/matching/);
	});

	it('closes multiple calls before the next user without losing completed output', () => {
		const projected = projectToolHistory([
			{ role: 'assistant', content: '', tool_calls: [call, { ...call, id: 'second' }] },
			{ role: 'tool', tool_call_id: 'call', content: 'ACTUAL' },
			{ role: 'user', content: 'next' }
		]);
		expect(projected.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
		expect(projected[1].content).toBe('ACTUAL');
		expect(projected[2].tool_call_id).toBe('second');
	});
});

describe('lifecycle export contract', () => {
	it.each([0, 1, 2])(
		'preserves imported V%s history without lifecycle and refuses ambiguous projection only',
		(version) => {
			const messages: import('$lib/types/database').DatabaseMessage[] = [
				{
					id: 'root',
					convId: 'c',
					type: 'root',
					role: 'system',
					content: '',
					parent: null,
					children: ['a'],
					timestamp: 1,
					toolCalls: ''
				},
				{
					id: 'a',
					convId: 'c',
					type: 'text',
					role: 'assistant',
					content: '',
					parent: 'root',
					children: ['t1'],
					timestamp: 2,
					toolCalls: JSON.stringify([call])
				},
				{
					id: 't1',
					convId: 'c',
					type: 'text',
					role: 'tool',
					content: 'FIRST',
					parent: 'a',
					children: ['t2'],
					timestamp: 3,
					toolCalls: '',
					toolCallId: call.id
				},
				{
					id: 't2',
					convId: 'c',
					type: 'text',
					role: 'tool',
					content: 'SECOND',
					parent: 't1',
					children: [],
					timestamp: 4,
					toolCalls: '',
					toolCallId: call.id
				}
			];
			const conversations = [
				{ conv: { id: 'c', name: 'Historical', currNode: 't2', lastModified: 4 }, messages }
			];
			const imported = parseConversationImport(
				version === 0
					? conversations
					: {
							type: 'llampart-conversations',
							formatVersion: version,
							appVersion: '1.9.0',
							exportedAt: 'now',
							conversations
						}
			);
			expect(imported).toEqual(conversations);
			expect(imported[0].messages.every((message) => message.agentic === undefined)).toBe(true);
			const history: ApiChatMessageData[] = imported[0].messages.map((message) => ({
				role: message.role,
				content: message.content,
				tool_call_id: message.toolCallId,
				tool_calls: message.toolCalls ? JSON.parse(message.toolCalls) : undefined
			}));
			expect(() => projectToolHistory(history)).toThrow(/duplicate tool result/i);
			expect(imported).toEqual(conversations);
			const valid = history.slice(0, -1);
			expect(projectToolHistory(valid)).toEqual(valid);
			expect(projectToolHistory(history.slice(0, 2))[2].content).toContain('unknown');
		}
	);
	it('keeps lifecycle strongly typed on database messages', () => {
		const record: Pick<import('$lib/types/database').DatabaseMessage, 'agentic'> = {
			agentic: {
				operationId: 'op',
				calls: [
					// @ts-expect-error Unknown statuses must not leak through the persistence type.
					{ toolCallId: 'call', status: 'cancelled_safely' }
				]
			}
		};
		expect(record.agentic?.operationId).toBe('op');
	});
	const fixture = (status: ToolExecutionStatus) => [
		{
			conv: { id: 'c', name: 'c', currNode: 'a', lastModified: 1 },
			messages: [
				{
					id: 'a',
					convId: 'c',
					type: 'text' as const,
					role: 'assistant' as const,
					content: '',
					parent: null,
					children: [],
					timestamp: 1,
					toolCalls: JSON.stringify([call]),
					agentic: {
						operationId: 'op',
						calls: [
							{
								toolCallId: 'call',
								status,
								...(status === 'completed' ? { resultMessageId: 'result' } : {})
							}
						]
					}
				},
				...(status === 'completed'
					? [
							{
								id: 'result',
								convId: 'c',
								type: 'text' as const,
								role: 'tool' as const,
								content: 'actual',
								parent: 'a',
								children: [],
								timestamp: 2,
								toolCalls: '',
								toolCallId: 'call'
							}
						]
					: [])
			]
		}
	];
	it.each(states)('roundtrips %s in V2', (status) => {
		const envelope = createConversationExportEnvelope(fixture(status), '1.9.0');
		expect(envelope.formatVersion).toBe(2);
		expect(parseConversationImport(JSON.parse(JSON.stringify(envelope)))).toEqual(fixture(status));
	});
	it('imports V1 without inventing lifecycle', () => {
		const conversations = fixture('not_started');
		const { agentic: _agentic, ...old } = conversations[0].messages[0];
		expect(_agentic).toBeDefined();
		const imported = parseConversationImport({
			type: 'llampart-conversations',
			formatVersion: 1,
			appVersion: '1.9.0',
			exportedAt: 'now',
			conversations: [{ ...conversations[0], messages: [old] }]
		});
		expect(imported[0].messages[0].agentic).toBeUndefined();
	});
	it('rejects unsupported lifecycle and never silently exports it', () => {
		const broken = fixture('not_started');
		Object.assign(broken[0].messages[0].agentic!.calls[0], { status: 'cancelled_safely' });
		expect(() => createConversationExportEnvelope(broken, '1.9.0')).toThrow();
	});
});
