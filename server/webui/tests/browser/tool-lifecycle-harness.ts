import { DatabaseService as db } from '$lib/services/database.service';
import { validateConversationGraph } from '$lib/utils/conversation-graph';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';
import type { AgenticMessageIdentity, ToolCallExecution } from '$lib/types/agentic';

export async function toolLifecycleScenario() {
	const stable = (value: unknown) =>
		JSON.stringify(value, (_key, item) =>
			item && typeof item === 'object' && !Array.isArray(item)
				? Object.fromEntries(
						Object.keys(item)
							.sort()
							.map((key) => [key, item[key]])
					)
				: item
		);
	const assert = (condition: unknown, label: string) => {
		if (!condition) throw new Error(label);
	};
	const rejected = async (operation: () => Promise<unknown>) => {
		try {
			await operation();
			return false;
		} catch {
			return true;
		}
	};
	const conv = await db.createConversation('Isolated lifecycle');
	const root = await db.createRootMessage(conv.id);
	const assistant = await db.createMessageBranch(
		{
			convId: conv.id,
			role: 'assistant',
			type: 'text',
			content: '',
			parent: root,
			children: [],
			timestamp: 1,
			toolCalls: ''
		},
		root
	);
	const identity: AgenticMessageIdentity = {
		conversationId: conv.id,
		operationId: 'operation',
		assistantMessageId: assistant.id
	};
	const calls = ['one', 'two', 'three', 'four'].map((id) => ({
		id,
		type: 'function',
		function: { name: 'synthetic', arguments: '{}' }
	}));
	await db.completeAgenticAssistant(identity, {
		content: 'Preserved',
		toolCalls: JSON.stringify(calls)
	});
	const registered = await db.getConversationMessages(conv.id);
	assert(
		registered
			.find((m) => m.id === assistant.id)!
			.agentic!.calls.every((c: ToolCallExecution) => c.status === 'not_started'),
		'initial registration'
	);
	const before = JSON.stringify(registered);
	for (const invalid of [
		{ ...identity, operationId: 'foreign' },
		{ ...identity, conversationId: 'foreign' },
		{ ...identity, assistantMessageId: root }
	]) {
		assert(
			await rejected(() =>
				db.transitionAgenticToolCall(invalid, 'one', { status: 'started' }, assistant.id)
			),
			'identity must reject'
		);
	}
	assert(
		JSON.stringify(await db.getConversationMessages(conv.id)) === before,
		'rejected writes mutated DB'
	);
	await db.transitionAgenticToolCall(identity, 'one', { status: 'started' }, assistant.id);
	await db.transitionAgenticToolCall(
		identity,
		'one',
		{ status: 'interrupted_unknown' },
		assistant.id
	);
	const outcome = { status: 'completed' as const, result: { content: 'CONFIRMED' } };
	const concurrent = await Promise.all([
		db.transitionAgenticToolCall(identity, 'one', outcome, assistant.id),
		db.transitionAgenticToolCall(identity, 'one', outcome, assistant.id)
	]);
	assert(concurrent[0].result!.id === concurrent[1].result!.id, 'duplicate confirmed output');
	const tail = concurrent[0].result!.id;
	await db.transitionAgenticToolCall(
		identity,
		'one',
		{ status: 'interrupted_unknown' },
		assistant.id
	);
	assert(
		await rejected(() =>
			db.transitionAgenticToolCall(
				identity,
				'one',
				{ status: 'completed', result: { content: 'WRONG' } },
				tail
			)
		),
		'result overwritten'
	);
	await db.transitionAgenticToolCall(identity, 'two', { status: 'denied' }, tail);
	await db.transitionAgenticToolCall(
		identity,
		'three',
		{ status: 'error', error: 'parse error' },
		tail
	);
	await db.transitionAgenticToolCall(identity, 'four', { status: 'started' }, tail);
	const beforeRollback = stable(await db.getConversationMessages(conv.id));
	const originalPut = IDBObjectStore.prototype.put;
	let injected = false;
	try {
		IDBObjectStore.prototype.put = function (value, key) {
			if (
				this.name === 'messages' &&
				value.id === assistant.id &&
				value.agentic?.calls.some(
					(call: ToolCallExecution) => call.toolCallId === 'four' && call.resultMessageId
				)
			) {
				injected = true;
				throw new DOMException('Synthetic lifecycle commit failure', 'AbortError');
			}
			return originalPut.call(this, value, key);
		};
		assert(
			await rejected(() =>
				db.transitionAgenticToolCall(
					identity,
					'four',
					{ status: 'completed', result: { content: 'ROLLBACK' } },
					tail
				)
			),
			'expected commit failure'
		);
	} finally {
		IDBObjectStore.prototype.put = originalPut;
	}
	assert(
		injected && stable(await db.getConversationMessages(conv.id)) === beforeRollback,
		'partial tool result/edges survived rollback'
	);
	await db.finishAgenticTurn(identity, 'stopped');
	await db.finishAgenticTurn(identity, 'stopped');
	assert(
		await rejected(() =>
			db.transitionAgenticToolCall(identity, 'two', { status: 'started' }, tail)
		),
		'restart after terminal'
	);
	const rows = await db.getConversationMessages(conv.id);
	validateConversationGraph((await db.getConversation(conv.id))!, rows);
	assert(rows.filter((m) => m.role === 'tool').length === 1, 'fake denied/error/cancelled outputs');
	const states = rows
		.find((m) => m.id === assistant.id)!
		.agentic!.calls.map((c: ToolCallExecution) => c.status);
	assert(
		JSON.stringify(states) ===
			JSON.stringify(['completed', 'denied', 'error', 'interrupted_unknown']),
		'states'
	);
	const envelope = createConversationExportEnvelope(
		[{ conv: (await db.getConversation(conv.id))!, messages: rows }],
		'1.9.0'
	);
	const imported = parseConversationImport(JSON.parse(JSON.stringify(envelope)));
	assert(stable(imported[0].messages) === stable(rows), 'V2 loss');
	assert(
		await rejected(() =>
			db.completeAgenticAssistant(identity, { content: 'wrong', toolCalls: JSON.stringify(calls) })
		),
		'late completion overwrote assistant'
	);
	const fork = await db.forkConversation(conv.id, tail, {
		name: 'Complete fork',
		includeAttachments: true
	});
	const forkRows = await db.getConversationMessages(fork.id);
	validateConversationGraph(fork, forkRows);
	createConversationExportEnvelope([{ conv: fork, messages: forkRows }], '1.9.0');
	const truncated = await db.forkConversation(conv.id, assistant.id, {
		name: 'Call-only fork',
		includeAttachments: true
	});
	createConversationExportEnvelope(
		[{ conv: truncated, messages: await db.getConversationMessages(truncated.id) }],
		'1.9.0'
	);
	// Reimport the exact V2 fixture into an empty isolated database conversation.
	await db.deleteConversation(conv.id);
	await db.importConversations(imported);
	const reloaded = await db.getConversationMessages(conv.id);
	assert(stable(reloaded) === stable(rows), 'DB reimport loss');
	const nextUser = await db.createMessageBranch(
		{
			convId: conv.id,
			role: 'user',
			type: 'text',
			content: 'Next question',
			parent: tail,
			children: [],
			timestamp: 3,
			toolCalls: ''
		},
		tail
	);
	const late = await db.transitionAgenticToolCall(
		identity,
		'four',
		{ status: 'completed', result: { content: 'LATE_CONFIRMED' } },
		tail
	);
	const afterLate = await db.getConversationMessages(conv.id),
		afterConv = (await db.getConversation(conv.id))!;
	validateConversationGraph(afterConv, afterLate);
	assert(afterConv.currNode === nextUser.id, 'late callback stole newer currNode');
	assert(
		afterLate.find((m) => m.id === nextUser.id)!.parent === tail,
		'late result reparented newer history'
	);
	assert(
		afterLate.some((m) => m.id === late.result!.id && m.content === 'LATE_CONFIRMED'),
		'late result lost'
	);
	createConversationExportEnvelope([{ conv: afterConv, messages: afterLate }], '1.9.0');
	const v1Envelope = {
		...createConversationExportEnvelope([{ conv: afterConv, messages: afterLate }], '1.9.0'),
		formatVersion: 1
	};
	v1Envelope.conversations[0].messages = v1Envelope.conversations[0].messages.map((row) => {
		const legacy = { ...row };
		delete legacy.agentic;
		return legacy;
	});
	const v1 = parseConversationImport(v1Envelope);
	await db.deleteConversation(conv.id);
	await db.importConversations(v1);
	const v1Rows = await db.getConversationMessages(conv.id);
	assert(
		v1Rows.every((row) => row.agentic === undefined),
		'V1 import backfilled lifecycle'
	);
	assert(stable(v1Rows) === stable(v1[0].messages), 'V1 DB roundtrip loss');
	return {
		states,
		results: reloaded.filter((m) => m.role === 'tool').map((m) => m.content),
		version: envelope.formatVersion,
		idempotent: true
	};
}
