import { describe, expect, it } from 'vitest';
import { planLegacyMessage } from '$lib/utils/legacy-migration';
import { validateConversationGraph } from '$lib/utils/conversation-graph';
import { filterByLeafNodeId, getMessageSiblings } from '$lib/utils/branching';
import { fixture, legacyCall } from '../browser/legacy-migration-harness';

const legacyMessage = (content: string): DatabaseMessage => ({
	id: 'legacy',
	convId: 'test',
	role: 'assistant',
	type: 'text',
	parent: 'user',
	children: [],
	content,
	timestamp: 1,
	toolCalls: ''
});

describe('legacy parser-only transformation', () => {
	it('preserves results verbatim, including marker-looking tool output', () => {
		const result = '<<<reasoning_content_start>>>literal<<<reasoning_content_end>>>\nPayload';
		const plan = planLegacyMessage(
			legacyMessage(`Before\n${legacyCall('test', '{}', result)}\nFinal`)
		)!;
		expect(plan.map((segment) => segment.role)).toEqual(['assistant', 'tool', 'assistant']);
		expect(plan[1].content).toBe(result);
		expect(plan[0].reasoningContent).toBeUndefined();
	});

	it('does not reuse one existing ID for repeated names and preserves call metadata', () => {
		const message = legacyMessage(`${legacyCall('same', 'a')}\n${legacyCall('same', 'b')}`);
		message.toolCalls = JSON.stringify([
			{ id: 'b', function: { name: 'same', arguments: 'b' }, extra: 'keep-b' },
			{ id: 'a', function: { name: 'same', arguments: 'a' }, extra: 'keep-a' }
		]);
		const before = structuredClone(message);
		const plan = planLegacyMessage(message)!;
		expect(
			plan.filter((segment) => segment.role === 'tool').map((segment) => segment.toolCallId)
		).toEqual(['a', 'b']);
		expect(JSON.parse(plan[0].toolCalls!)).toMatchObject([
			{ id: 'a', extra: 'keep-a' },
			{ id: 'b', extra: 'keep-b' }
		]);
		expect(message).toEqual(before);
	});

	it('allocates distinct IDs across turns and messages', () => {
		const message = legacyMessage(`${legacyCall()}\nNext\n${legacyCall()}\nFinal`);
		const first = planLegacyMessage(message)!;
		const second = planLegacyMessage({ ...message, id: 'other' })!;
		const ids = [...first, ...second]
			.filter((segment) => segment.role === 'tool')
			.map((segment) => segment.toolCallId);
		expect(new Set(ids).size).toBe(4);
		expect(planLegacyMessage(message)).toEqual(first);
	});

	it('matches reversed calculate calls by equivalent JSON arguments, not name or formatting', () => {
		const message = legacyMessage(
			`${legacyCall('calculate', '{"n":1}', 'Result for one')}\n${legacyCall('calculate', '{"n":2}', 'Result for two')}`
		);
		message.toolCalls = JSON.stringify([
			{ id: 'for-two', function: { name: 'calculate', arguments: '{ "n": 2 }' } },
			{ id: 'for-one', function: { name: 'calculate', arguments: '{\n  "n": 1\n}' } }
		]);
		const before = structuredClone(message);
		const plan = planLegacyMessage(message)!;
		expect(plan.filter((segment) => segment.role === 'tool')).toEqual([
			{ role: 'tool', content: 'Result for one', toolCallId: 'for-one' },
			{ role: 'tool', content: 'Result for two', toolCallId: 'for-two' }
		]);
		expect(JSON.parse(plan[0].toolCalls!)).toMatchObject([
			{ id: 'for-one', function: { arguments: '{"n":1}' } },
			{ id: 'for-two', function: { arguments: '{"n":2}' } }
		]);
		expect(message).toEqual(before);
	});

	it('rejects genuinely different arguments instead of borrowing a same-name ID', () => {
		const message = legacyMessage(
			`${legacyCall('calculate', '{"n":3}')}\n${legacyCall('calculate', '{"n":4}')}`
		);
		message.toolCalls = JSON.stringify([
			{ id: 'for-two', function: { name: 'calculate', arguments: '{ "n": 2 }' } },
			{ id: 'for-one', function: { name: 'calculate', arguments: '{ "n": 1 }' } }
		]);
		const before = structuredClone(message);
		expect(() => planLegacyMessage(message)).toThrow(/unmatched|ambiguous/i);
		expect(message).toEqual(before);
	});

	it('rejects multiple equivalent structured candidates rather than guessing their IDs', () => {
		const message = legacyMessage(
			`${legacyCall('calculate', '{"n":1}')}\n${legacyCall('calculate', '{"n":1}')}`
		);
		message.toolCalls = JSON.stringify([
			{ id: 'first', function: { name: 'calculate', arguments: '{"n":1}' } },
			{ id: 'second', function: { name: 'calculate', arguments: '{ "n": 1 }' } }
		]);
		const before = structuredClone(message);
		expect(() => planLegacyMessage(message)).toThrow(/ambiguous/i);
		expect(message).toEqual(before);
	});

	it('rejects a structured ID that could belong to either of two identical markers', () => {
		const message = legacyMessage(
			`${legacyCall('calculate', '{"n":1}')}\n${legacyCall('calculate', '{"n":1}')}`
		);
		message.toolCalls = JSON.stringify([
			{ id: 'unknown-occurrence', function: { name: 'calculate', arguments: '{ "n": 1 }' } }
		]);
		const before = structuredClone(message);
		expect(() => planLegacyMessage(message)).toThrow(/ambiguous/i);
		expect(message).toEqual(before);
	});

	it.each([
		[
			'{"nested":{"b":2,"a":1},"items":[true,null,"text"]}',
			'{ "items": [true,null,"text"], "nested": {"a":1,"b":2} }'
		],
		['{"__proto__":{"n":1},"constructor":2}', '{"constructor":2, "__proto__": {"n": 1}}'],
		['{"n":1}', '{"n":1.0}']
	])('matches equivalent JSON without rewriting marker arguments: %s', (marker, stored) => {
		const message = legacyMessage(legacyCall('calculate', marker));
		message.toolCalls = JSON.stringify([
			{ id: 'kept', function: { name: 'calculate', arguments: stored } }
		]);
		const plan = planLegacyMessage(message)!;
		expect(plan[1].toolCallId).toBe('kept');
		expect(JSON.parse(plan[0].toolCalls!)[0].function.arguments).toBe(marker);
	});

	it.each([
		['{"n":1}', '{"n":"1"}'],
		['{"n":true}', '{"n":1}'],
		['{"n":null}', '{"n":{}}'],
		['{"n":[1,2]}', '{"n":[2,1]}'],
		['{"n":[]}', '{"n":{}}'],
		['{"n":1}', '{"n":1,"extra":0}'],
		['{"n":0}', '{"n":-0}'],
		['not json', 'other non-json'],
		['{"n":9007199254740992}', '{"n":9007199254740993}'],
		['{"n":1e400}', '{"n":1e401}'],
		['{"n":null}', '{"n":1e400}']
	])(
		'does not infer same-name identity for different or unprovable arguments: %s vs %s',
		(marker, stored) => {
			const message = legacyMessage(legacyCall('calculate', marker));
			message.toolCalls = JSON.stringify([
				{ id: 'must-not-borrow', function: { name: 'calculate', arguments: stored } }
			]);
			const before = structuredClone(message);
			expect(() => planLegacyMessage(message)).toThrow(/unmatched/i);
			expect(message).toEqual(before);
		}
	);

	it('matches structured calls before using the compatible ordered ID-only fallback', () => {
		const message = legacyMessage(
			`${legacyCall('calculate', '{"n":1}')}\n${legacyCall('calculate', '{"n":2}')}`
		);
		message.toolCalls = JSON.stringify([
			{ id: 'id-only' },
			{ id: 'structured-for-one', function: { name: 'calculate', arguments: '{ "n": 1 }' } }
		]);
		expect(
			planLegacyMessage(message)!
				.filter((segment) => segment.role === 'tool')
				.map((segment) => segment.toolCallId)
		).toEqual(['structured-for-one', 'id-only']);
	});

	it('preserves IDs from historical ID-only call records in marker order', () => {
		const message = legacyMessage(`${legacyCall('first')}\n${legacyCall('second')}`);
		message.toolCalls = JSON.stringify([{ id: 'old-first' }, { id: 'old-second' }]);
		expect(
			planLegacyMessage(message)!
				.filter((segment) => segment.role === 'tool')
				.map((segment) => segment.toolCallId)
		).toEqual(['old-first', 'old-second']);
	});

	it.each([
		'Important <<<AGENTIC_TOOL_CALL_START>>> unfinished',
		'Important <<<reasoning_content_start>>> unfinished',
		`${legacyCall()}\n<<<AGENTIC_UNKNOWN>>> important`,
		'<<<AGENTIC_TOOL_CALL_START>>>\n<<<TOOL_NAME:unknown>>> missing args'
	])('fails closed on incomplete or unknown reserved markers: %s', (content) => {
		const message = legacyMessage(content);
		expect(() => planLegacyMessage(message)).toThrow(/marker/);
		expect(message.content).toBe(content);
	});

	it('keeps unrecognized nonlegacy text and contemporary messages unchanged', () => {
		expect(planLegacyMessage(legacyMessage('<<<UNKNOWN>>> keep'))).toBeNull();
		expect(planLegacyMessage({ ...legacyMessage(legacyCall()), role: 'user' })).toBeNull();
	});

	it('preserves existing reasoning when extracting historical reasoning', () => {
		const plan = planLegacyMessage({
			...legacyMessage('<<<reasoning_content_start>>>Old<<<reasoning_content_end>>>Visible'),
			reasoningContent: 'Structured'
		})!;
		expect(plan).toEqual([
			{ role: 'assistant', content: 'Visible', toolCalls: '', reasoningContent: 'Structured\nOld' }
		]);
	});

	it.each([
		'not json',
		'{}',
		'[null]',
		'[{"id":"x"},{"id":"x"}]',
		'[{"id":"unmatched","function":{"name":"different"}}]'
	])('retains original data on ambiguous toolCalls: %s', (toolCalls) => {
		const message = { ...legacyMessage(legacyCall()), toolCalls };
		const before = structuredClone(message);
		expect(() => planLegacyMessage(message)).toThrow();
		expect(message).toEqual(before);
	});
});

describe('shared internal graph contract and history consumers', () => {
	it('uses graph order with equal or out-of-order clocks and preserves branch navigation', () => {
		const data = fixture('order', 2);
		for (const message of data.messages) message.timestamp = 1;
		expect(filterByLeafNodeId(data.messages, 'order-tail').map((m) => m.id)).toEqual([
			'order-user',
			'order-legacy',
			'order-next0',
			'order-tail'
		]);
		data.messages.find((m) => m.id === 'order-next0')!.timestamp = 1000;
		expect(filterByLeafNodeId(data.messages, 'order-tail').map((m) => m.id)).toEqual([
			'order-user',
			'order-legacy',
			'order-next0',
			'order-tail'
		]);
		expect(getMessageSiblings(data.messages, 'order-next0')?.siblingIds).toEqual([
			'order-tail',
			'order-tail1'
		]);
	});

	it.each([
		'owner',
		'root',
		'parent',
		'child',
		'cycle',
		'selection',
		'duplicate-child',
		'duplicate-id'
	])('rejects %s corruption without export schema restrictions', (kind) => {
		const data = fixture('invalid');
		const node = data.messages.find((m) => m.id === 'invalid-legacy')!;
		if (kind === 'owner') node.convId = 'foreign';
		if (kind === 'root') data.messages[0].type = 'text';
		if (kind === 'parent') node.parent = 'missing';
		if (kind === 'child') node.children = [];
		if (kind === 'selection') data.conv.currNode = 'missing';
		if (kind === 'duplicate-child') node.children.push(node.children[0]);
		if (kind === 'duplicate-id') data.messages.push({ ...node });
		if (kind === 'cycle') {
			data.messages[1].children = [];
			node.parent = 'invalid-tail';
			data.messages.find((m) => m.id === 'invalid-tail')!.children = [node.id];
		}
		expect(() => validateConversationGraph(data.conv, data.messages)).toThrow();
	});
});
