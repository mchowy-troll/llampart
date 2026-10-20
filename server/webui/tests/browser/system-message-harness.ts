import { DatabaseService as db } from '$lib/services/database.service';
import { chatStore as chat } from '$lib/stores/chat.svelte';
import { conversationsStore as c } from '$lib/stores/conversations.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { permissionsStore } from '$lib/stores/permissions.svelte';
import { AttachmentType, ToolSource } from '$lib/enums';
import type { ToolCallExecution } from '$lib/types/agentic';
import { validateConversationGraph } from '$lib/utils/conversation-graph';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';

function check(value: unknown, label: string): asserts value {
	if (!value) throw new Error(label);
}
const canonical = (value: unknown) =>
	JSON.stringify(value, (_key, value) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
			: value
	);
const equal = (a: unknown, b: unknown, label: string) =>
	check(canonical(a) === canonical(b), label);
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

async function fixture(name: string) {
	const conv = await db.createConversation(name);
	const root = await db.createRootMessage(conv.id);
	const system = await db.createSystemMessage(conv.id, 'Instrukcja stara', root);
	const user = await db.createMessageBranch(
		{
			convId: conv.id,
			role: 'user',
			type: 'text',
			content: 'Question',
			timestamp: 2,
			children: []
		},
		system.id
	);
	const answer = await db.createMessageBranch(
		{
			convId: conv.id,
			role: 'assistant',
			type: 'text',
			content: 'Answer',
			timestamp: 3,
			children: []
		},
		user.id
	);
	await c.loadConversations();
	await c.loadConversation(conv.id);
	return { conv, root, system, user, answer };
}

export async function systemMessageStoreScenarios() {
	// Before/after each async boundary, including the timestamp refresh after commit.
	let interleavings = 0;
	for (const boundary of ['read', 'write', 'timestamp'] as const) {
		for (const phase of ['before', 'after']) {
			for (const navigation of ['B', 'A-B-A', 'clear']) {
				const a = await fixture(`interleaving-${interleavings}`);
				const b = await fixture('B isolated');
				await c.loadConversation(a.conv.id);
				const bRows = await db.getConversationMessages(b.conv.id);
				const bConv = await db.getConversation(b.conv.id);
				const ready = deferred(),
					gate = deferred();
				const originalRead = db.getConversationMessages,
					originalWrite = db.updateConversationMessage,
					originalTimestamp = db.getConversation;
				const pause = async <T>(operation: () => Promise<T>) => {
					if (phase === 'before') {
						ready.resolve();
						await gate.promise;
					}
					const result = await operation();
					if (phase === 'after') {
						ready.resolve();
						await gate.promise;
					}
					return result;
				};
				if (boundary === 'read')
					db.getConversationMessages = (...args) => pause(() => originalRead.apply(db, args));
				if (boundary === 'write')
					db.updateConversationMessage = (...args) => pause(() => originalWrite.apply(db, args));
				if (boundary === 'timestamp')
					db.getConversation = (...args) => pause(() => originalTimestamp.apply(db, args));
				const pending = chat.editSystemMessage(a.conv.id, a.system.id, 'Instrukcja nowa');
				await ready.promise;
				// Restore wrappers for navigation itself; the in-flight operation retains its gate.
				db.getConversationMessages = originalRead;
				db.updateConversationMessage = originalWrite;
				db.getConversation = originalTimestamp;
				await c.loadConversation(b.conv.id);
				if (navigation === 'A-B-A') await c.loadConversation(a.conv.id);
				if (navigation === 'clear') c.clearActiveConversation();
				const visible = JSON.stringify(c.activeMessages),
					current = c.activeConversation?.currNode;
				gate.resolve();
				await pending;
				check(c.activeConversation?.currNode === current, 'save changed active currNode');
				if (navigation !== 'A-B-A')
					check(JSON.stringify(c.activeMessages) === visible, 'foreign visible update');
				equal(await db.getConversationMessages(b.conv.id), bRows, 'B message mutation');
				equal(await db.getConversation(b.conv.id), bConv, 'B metadata mutation');
				await c.loadConversation(a.conv.id);
				check(
					c.activeMessages.find((row) => row.id === a.system.id)?.content === 'Instrukcja nowa',
					'A reload stale'
				);
				interleavings++;
			}
		}
	}

	const f = await fixture('graph and compatibility');
	const sibling = await db.createMessageBranch(
		{
			convId: f.conv.id,
			role: 'user',
			type: 'text',
			content: 'Sibling',
			timestamp: 4,
			children: []
		},
		f.system.id
	);
	const branchSystem = await db.createSystemMessage(f.conv.id, 'Other branch instruction', f.root);
	await db.updateCurrentNode(f.conv.id, f.answer.id);
	const identity = {
		conversationId: f.conv.id,
		assistantMessageId: f.answer.id,
		operationId: 'own008-fixture'
	};
	await db.completeAgenticAssistant(identity, {
		content: 'Answer',
		toolCalls: JSON.stringify([
			{ id: 'call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
		])
	});
	await db.transitionAgenticToolCall(identity, 'call', { status: 'started' }, f.answer.id);
	const outcome = await db.transitionAgenticToolCall(
		identity,
		'call',
		{
			status: 'completed',
			result: {
				content: '[Attachment saved: keep.png]',
				extras: [
					{
						type: AttachmentType.IMAGE,
						name: 'keep.png',
						base64Url:
							'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
					}
				]
			}
		},
		f.answer.id
	);
	await db.finishAgenticTurn(identity, 'completed');
	check(outcome.result, 'fixture result missing');
	await c.loadConversation(f.conv.id);
	const beforeRows = await db.getConversationMessages(f.conv.id),
		beforeConv = (await db.getConversation(f.conv.id))!;
	await chat.editSystemMessage(f.conv.id, f.system.id, 'Instrukcja nowa');
	const afterRows = await db.getConversationMessages(f.conv.id),
		afterConv = (await db.getConversation(f.conv.id))!;
	equal(
		afterRows,
		beforeRows.map((row) =>
			row.id === f.system.id ? { ...row, content: 'Instrukcja nowa' } : row
		),
		'graph/extra/tool lifecycle changed'
	);
	check(afterConv.currNode === beforeConv.currNode, 'currNode changed');
	validateConversationGraph(afterConv, afterRows);
	await c.navigateToSibling(sibling.id);
	check(
		c.activeMessages.find((row) => row.id === f.system.id)?.content === 'Instrukcja nowa',
		'shared ancestor stale'
	);
	await c.navigateToSibling(branchSystem.id);
	check(
		c.activeMessages.find((row) => row.id === branchSystem.id)?.content ===
			'Other branch instruction',
		'other system branch changed'
	);
	await c.loadConversation(f.conv.id);
	const records = [
		{
			conv: (await db.getConversation(f.conv.id))!,
			messages: await db.getConversationMessages(f.conv.id)
		}
	];
	const envelope = createConversationExportEnvelope(records, '1.9.0');
	check(envelope.formatVersion === 2, 'wrong format');
	await db.deleteConversation(f.conv.id);
	await db.importConversations(parseConversationImport(JSON.parse(JSON.stringify(envelope))));
	equal(await db.getConversationMessages(f.conv.id), records[0].messages, 'V2 roundtrip loss');
	await c.loadConversation(f.conv.id);
	await chat.editSystemMessage(f.conv.id, f.system.id, 'After V2 import');
	validateConversationGraph(
		(await db.getConversation(f.conv.id))!,
		await db.getConversationMessages(f.conv.id)
	);

	const v1 = await fixture('V1 system edit');
	const oldRecords = [
		{
			conv: (await db.getConversation(v1.conv.id))!,
			messages: await db.getConversationMessages(v1.conv.id)
		}
	];
	await db.deleteConversation(v1.conv.id);
	await db.importConversations(
		parseConversationImport({
			type: 'llampart-conversations',
			formatVersion: 1,
			appVersion: '1.9.0',
			exportedAt: new Date().toISOString(),
			conversations: oldRecords
		})
	);
	await c.loadConversation(v1.conv.id);
	await chat.editSystemMessage(v1.conv.id, v1.system.id, 'After V1 import');
	check(
		(await db.getConversationMessages(v1.conv.id)).find((row) => row.id === v1.system.id)
			?.content === 'After V1 import',
		'V1 edit failed'
	);

	// Real ChatStore → AgenticStore → ChatService, only provider I/O and tool execution synthetic.
	const operation = await fixture('generation snapshot');
	const ready = deferred(),
		gate = deferred();
	const originals = {
		fetch: globalThis.fetch,
		getConfig: agenticStore.getConfig,
		hasBuiltin: toolsStore.hasBuiltinToolsForContext,
		entries: toolsStore.getEnabledToolEntriesForLLM,
		validate: toolsStore.validateToolExecution,
		execute: toolsStore.executeTool,
		mcp: mcpStore.hasEnabledServers,
		permission: permissionsStore.hasTool
	};
	const payloads: { messages: { role: string; content: string }[] }[] = [];
	const instruction = (body: (typeof payloads)[number]) =>
		body.messages
			.find((row) => row.role === 'system')
			?.content.match(/Instrukcja (stara|nowa)/)?.[0];
	try {
		agenticStore.getConfig = () => ({ enabled: true, maxTurns: 4, maxToolPreviewLines: 10 });
		toolsStore.hasBuiltinToolsForContext = () => true;
		toolsStore.getEnabledToolEntriesForLLM = () => [
			{
				key: 'builtin:synthetic',
				apiName: 'synthetic',
				source: ToolSource.BUILTIN,
				registryGeneration: 1,
				definition: { type: 'function', function: { name: 'synthetic', parameters: {} } }
			}
		];
		toolsStore.validateToolExecution = () => undefined;
		toolsStore.executeTool = async () => {
			ready.resolve();
			await gate.promise;
			return { content: 'CONFIRMED', isError: false };
		};
		mcpStore.hasEnabledServers = () => false;
		permissionsStore.hasTool = () => true;
		globalThis.fetch = async (_input, init) => {
			check(init?.body, 'unexpected non-generation fetch');
			const body = JSON.parse(String(init.body));
			payloads.push(body);
			const tool = payloads.length === 1;
			const event = {
				choices: [
					{
						delta: tool
							? {
									tool_calls: [
										{
											index: 0,
											id: 'own008-call',
											type: 'function',
											function: { name: 'synthetic', arguments: '{}' }
										}
									]
								}
							: { content: 'FINAL' },
						finish_reason: tool ? 'tool_calls' : 'stop'
					}
				]
			};
			return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
				headers: { 'Content-Type': 'text/event-stream' }
			});
		};
		const pending = chat.sendMessage('Operation old instruction');
		await Promise.race([
			ready.promise,
			pending.then(() => {
				throw new Error(`generation ended before tool: ${chat.errorDialogState?.message}`);
			})
		]);
		await chat.editSystemMessage(operation.conv.id, operation.system.id, 'Instrukcja nowa');
		gate.resolve();
		await pending;
		check(payloads.length === 2, 'agentic continuation missing');
		check(
			payloads.every((body) => instruction(body) === 'Instrukcja stara'),
			'ongoing operation adopted new instruction'
		);
		await chat.sendMessage('Next explicit operation');
		check(instruction(payloads.at(-1)!) === 'Instrukcja nowa', 'next operation stale');
		const rows = await db.getConversationMessages(operation.conv.id);
		const tool = rows.find((row) => row.toolCallId === 'own008-call');
		check(tool?.content === 'CONFIRMED', 'tool result lost');
		check(
			rows.some((row) =>
				row.agentic?.calls.some(
					(call: ToolCallExecution) =>
						call.resultMessageId === tool.id && call.status === 'completed'
				)
			),
			'tool linkage lost'
		);
		validateConversationGraph((await db.getConversation(operation.conv.id))!, rows);
		await chat.regenerateMessageWithBranching(c.activeMessages.at(-1)!.id);
		check(instruction(payloads.at(-1)!) === 'Instrukcja nowa', 'regenerate stale');
		await chat.editMessageWithBranching(operation.user.id, 'Branch edit');
		check(instruction(payloads.at(-1)!) === 'Instrukcja nowa', 'edit-with-branching stale');
		validateConversationGraph(
			(await db.getConversation(operation.conv.id))!,
			await db.getConversationMessages(operation.conv.id)
		);
	} finally {
		gate.resolve();
		globalThis.fetch = originals.fetch;
		agenticStore.getConfig = originals.getConfig;
		toolsStore.hasBuiltinToolsForContext = originals.hasBuiltin;
		toolsStore.getEnabledToolEntriesForLLM = originals.entries;
		toolsStore.validateToolExecution = originals.validate;
		toolsStore.executeTool = originals.execute;
		mcpStore.hasEnabledServers = originals.mcp;
		permissionsStore.hasTool = originals.permission;
	}
	return {
		interleavings,
		graph: true,
		v1: true,
		v2: true,
		generationSystemContents: payloads.map(instruction)
	};
}
