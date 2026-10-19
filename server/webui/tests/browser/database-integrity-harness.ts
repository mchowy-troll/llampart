import { DatabaseService } from '$lib/services/database.service';
import { runLegacyMigration } from '$lib/utils/legacy-migration';
import { legacyScenarios } from './legacy-migration-harness';
import { toolLifecycleScenario } from './tool-lifecycle-harness';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';

const MIGRATION_DONE_KEY = 'llama-webui-migration-v2-done';

function conversation(id: string, currNode: string | null): DatabaseConversation {
	return { id, name: id, currNode, lastModified: 1 };
}

function message(
	convId: string,
	id: string,
	parent: string | null,
	children: string[],
	type: DatabaseMessage['type'] = 'text',
	role: DatabaseMessage['role'] = 'user',
	content = id
): DatabaseMessage {
	return { id, convId, type, role, content, parent, children, timestamp: 1, toolCalls: '' };
}

function graph(convId: string, rootId = `${convId}-root`) {
	return {
		conv: conversation(convId, rootId),
		messages: [message(convId, rootId, null, [], 'root', 'system', '')]
	};
}

async function snapshot(convIds: string[]) {
	const conversations: DatabaseConversation[] = (
		await Promise.all(convIds.map((id) => DatabaseService.getConversation(id)))
	).filter(
		(item: DatabaseConversation | undefined): item is DatabaseConversation => item !== undefined
	);
	const messages = (
		await Promise.all(convIds.map((id) => DatabaseService.getConversationMessages(id)))
	).flat();
	return {
		conversations: conversations.sort((left, right) => left.id.localeCompare(right.id)),
		messages: messages.sort((left, right) => left.id.localeCompare(right.id))
	};
}

async function captureError(operation: () => Promise<unknown>): Promise<string | null> {
	try {
		await operation();
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

async function importCollision() {
	const existing = {
		conv: conversation('a', 'shared'),
		messages: [message('a', 'shared', null, [], 'root', 'system', 'original')]
	};
	await DatabaseService.importConversations([existing]);
	const before = await snapshot(['a', 'b']);
	const error = await captureError(() =>
		DatabaseService.importConversations([
			{
				conv: conversation('b', 'shared'),
				messages: [message('b', 'shared', null, [], 'root', 'system', 'replacement')]
			}
		])
	);
	return { error, before, after: await snapshot(['a', 'b']) };
}

async function importPreflight() {
	const invalidPayloads: Array<{
		name: string;
		data: { conv: DatabaseConversation; messages: DatabaseMessage[] }[];
	}> = [
		{
			name: 'empty conversation id',
			data: [
				{
					conv: conversation('', 'root-empty-conv'),
					messages: [message('', 'root-empty-conv', null, [], 'root', 'system')]
				}
			]
		},
		{
			name: 'empty message id',
			data: [
				{
					conv: conversation('empty-message', ''),
					messages: [message('empty-message', '', null, [], 'root', 'system')]
				}
			]
		},
		{
			name: 'foreign convId',
			data: [
				{
					conv: conversation('owner', 'foreign-root'),
					messages: [message('foreign', 'foreign-root', null, [], 'root', 'system')]
				}
			]
		},
		{
			name: 'duplicate message id',
			data: [
				{
					conv: conversation('duplicate-message', 'duplicate'),
					messages: [
						message('duplicate-message', 'duplicate', null, [], 'root', 'system'),
						message('duplicate-message', 'duplicate', null, [])
					]
				}
			]
		},
		{
			name: 'dangling parent',
			data: [
				{
					conv: conversation('dangling-parent', 'child'),
					messages: [
						message('dangling-parent', 'root-parent', null, [], 'root', 'system'),
						message('dangling-parent', 'child', 'missing', [])
					]
				}
			]
		},
		{
			name: 'dangling child',
			data: [
				{
					conv: conversation('dangling-child', 'root-child'),
					messages: [message('dangling-child', 'root-child', null, ['missing'], 'root', 'system')]
				}
			]
		},
		{
			name: 'non-reciprocal relationship',
			data: [
				{
					conv: conversation('reciprocity', 'reciprocity-child'),
					messages: [
						message('reciprocity', 'reciprocity-root', null, [], 'root', 'system'),
						message('reciprocity', 'reciprocity-child', 'reciprocity-root', [])
					]
				}
			]
		},
		{
			name: 'bad currNode',
			data: [
				{
					conv: conversation('curr-node', 'missing'),
					messages: [message('curr-node', 'curr-root', null, [], 'root', 'system')]
				}
			]
		},
		{
			name: 'cycle',
			data: [
				{
					conv: conversation('cycle', 'cycle-a'),
					messages: [
						message('cycle', 'cycle-root', null, [], 'root', 'system'),
						message('cycle', 'cycle-a', 'cycle-b', ['cycle-b']),
						message('cycle', 'cycle-b', 'cycle-a', ['cycle-a'])
					]
				}
			]
		},
		{
			name: 'disconnected graph',
			data: [
				{
					conv: conversation('disconnected', 'disconnected-root'),
					messages: [
						message('disconnected', 'disconnected-root', null, [], 'root', 'system'),
						message('disconnected', 'detached-a', 'detached-b', ['detached-b']),
						message('disconnected', 'detached-b', 'detached-a', ['detached-a'])
					]
				}
			]
		},
		{
			name: 'duplicate conversation id',
			data: [
				graph('duplicate-conversation', 'duplicate-root-a'),
				graph('duplicate-conversation', 'duplicate-root-b')
			]
		}
	];

	const errors: Record<string, string | null> = {};
	for (const payload of invalidPayloads) {
		errors[payload.name] = await captureError(() =>
			DatabaseService.importConversations(payload.data)
		);
	}

	const atomicError = await captureError(() =>
		DatabaseService.importConversations([
			graph('atomic-valid'),
			{
				conv: conversation('atomic-invalid', 'missing'),
				messages: [message('atomic-invalid', 'atomic-invalid-root', null, [], 'root', 'system')]
			}
		])
	);

	return {
		errors,
		atomicError,
		conversations: await DatabaseService.getAllConversations()
	};
}

async function importWriteRollback() {
	const data = graph('write-rollback');
	(data.messages[0] as DatabaseMessage & { invalid?: unknown }).invalid = () => undefined;
	const error = await captureError(() => DatabaseService.importConversations([data]));
	return { error, after: await snapshot(['write-rollback']) };
}

async function deleteForeignMessage() {
	await DatabaseService.importConversations([
		graph('delete-a'),
		{
			conv: conversation('delete-b', 'delete-b-child'),
			messages: [
				message('delete-b', 'delete-b-root', null, ['delete-b-child'], 'root', 'system'),
				message('delete-b', 'delete-b-child', 'delete-b-root', [])
			]
		}
	]);
	const before = await snapshot(['delete-a', 'delete-b']);
	const error = await captureError(() =>
		DatabaseService.deleteMessageCascading('delete-a', 'delete-b-child', 'delete-a-root')
	);
	return { error, before, after: await snapshot(['delete-a', 'delete-b']) };
}

async function graphOwnerValidation() {
	await DatabaseService.importConversations([graph('owner-a'), graph('owner-b')]);
	const before = await snapshot(['owner-a', 'owner-b']);
	const foreignBranchInput: Omit<DatabaseMessage, 'id'> = {
		...message('owner-a', 'ignored', null, []),
		id: undefined
	} as unknown as Omit<DatabaseMessage, 'id'>;
	const branchForeignParent = await captureError(() =>
		DatabaseService.createMessageBranch(foreignBranchInput, 'owner-b-root')
	);
	const missingOwnerBranchInput: Omit<DatabaseMessage, 'id'> = {
		...message('missing-owner', 'ignored', null, []),
		id: undefined
	} as unknown as Omit<DatabaseMessage, 'id'>;
	const missingConversation = await captureError(() =>
		DatabaseService.createMessageBranch(missingOwnerBranchInput, 'owner-a-root')
	);
	const systemForeignParent = await captureError(() =>
		DatabaseService.createSystemMessage('owner-a', 'System', 'owner-b-root')
	);
	const systemMissingParent = await captureError(() =>
		DatabaseService.createSystemMessage('owner-a', 'System', 'missing-parent')
	);

	return {
		errors: { branchForeignParent, missingConversation, systemForeignParent, systemMissingParent },
		before,
		after: await snapshot(['owner-a', 'owner-b'])
	};
}

async function strictUpdateCounts() {
	return {
		conversationError: await captureError(() =>
			DatabaseService.updateConversation('missing-conversation', { name: 'No-op' })
		),
		messageError: await captureError(() =>
			DatabaseService.updateMessage('missing-message', { content: 'No-op' })
		)
	};
}

async function atomicGraphMutations() {
	await DatabaseService.importConversations([
		{
			conv: conversation('atomic-graph', 'assistant'),
			messages: [
				message('atomic-graph', 'root', null, ['user'], 'root', 'system', ''),
				message('atomic-graph', 'user', 'root', ['assistant'], 'text', 'user', 'Question'),
				message('atomic-graph', 'assistant', 'user', [], 'text', 'assistant', 'Answer')
			]
		}
	]);
	const beforeTimestamp = (await DatabaseService.getConversation('atomic-graph'))!.lastModified;
	const system = await DatabaseService.insertSystemPrompt('atomic-graph', 'System', 'root', 'user');
	const afterInsert = await snapshot(['atomic-graph']);
	await DatabaseService.removeSystemPrompt('atomic-graph', system.id);
	const afterRemove = await snapshot(['atomic-graph']);
	const editResult = await DatabaseService.replaceUserMessageAndTruncateBranch(
		'atomic-graph',
		'user',
		'Edited question'
	);
	const afterEdit = await snapshot(['atomic-graph']);

	return { beforeTimestamp, afterInsert, afterRemove, editResult, afterEdit };
}

async function conversationEnvelopeImport() {
	const data = graph('envelope-import');
	const envelope = createConversationExportEnvelope([data], '1.8.2');
	const result = await DatabaseService.importConversations(parseConversationImport(envelope));
	return { result, after: await snapshot(['envelope-import']) };
}

async function legacyV182Import() {
	const parsed = parseConversationImport({
		conv: conversation('legacy-v182', 'legacy-assistant'),
		messages: [
			message(
				'legacy-v182',
				'legacy-user',
				'legacy-omitted-root',
				['hidden-assistant', 'legacy-assistant'],
				'text',
				'user',
				'Question'
			),
			message('legacy-v182', 'legacy-assistant', 'legacy-user', [], 'text', 'assistant', 'Answer')
		]
	});
	const result = await DatabaseService.importConversations(parsed);
	return { result, after: await snapshot(['legacy-v182']) };
}

async function failedAssistantCleanup() {
	await DatabaseService.importConversations([
		{
			conv: conversation('failed-stream', 'failed-assistant'),
			messages: [
				message('failed-stream', 'failed-root', null, ['failed-user'], 'root', 'system', ''),
				message('failed-stream', 'failed-user', 'failed-root', ['failed-assistant']),
				message('failed-stream', 'failed-assistant', 'failed-user', [], 'text', 'assistant', '')
			]
		}
	]);
	const beforeTimestamp = (await DatabaseService.getConversation('failed-stream'))!.lastModified;
	await DatabaseService.deleteMessageCascading('failed-stream', 'failed-assistant', 'failed-user');
	return { beforeTimestamp, after: await snapshot(['failed-stream']) };
}

async function pendingAssistantCleanup() {
	const id = 'pending';
	await DatabaseService.importConversations([
		{
			conv: conversation(id, 'old'),
			messages: [
				message(id, 'root', null, ['user'], 'root', 'system'),
				message(id, 'user', 'root', ['old']),
				message(id, 'old', 'user', [], 'text', 'assistant', '')
			]
		}
	]);
	const removed = await DatabaseService.deleteEmptyAssistantMessage(id, 'old', 'user');
	const afterRemoval = await snapshot([id]);
	const old = await DatabaseService.createMessageBranch(
		message(id, 'ignored', 'user', [], 'text', 'assistant', ''),
		'user'
	);
	const newer = await DatabaseService.createMessageBranch(
		message(id, 'ignored', 'user', [], 'text', 'assistant', 'new response'),
		'user'
	);
	await DatabaseService.deleteEmptyAssistantMessage(id, old.id, 'user');
	const afterNewer = await snapshot([id]);
	const protections: Array<Partial<DatabaseMessage>> = [
		{ content: 'already completed' },
		{ reasoningContent: 'reasoning' },
		{ toolCalls: '[{}]' },
		{ extra: [{ type: 'text', name: 'file', content: 'data' } as DatabaseMessageExtra] },
		{ completionId: 'in-flight' },
		{ model: 'already-started' },
		{ timings: {} as ChatMessageTimings },
		{ role: 'user' },
		{ thinking: 'legacy reasoning' }
	];
	const protectedResults = [];
	for (const update of protections) {
		const item = await DatabaseService.createMessageBranch(
			{ ...message(id, 'ignored', 'user', [], 'text', 'assistant', ''), ...update },
			'user'
		);
		const before = await snapshot([id]);
		const result = await DatabaseService.deleteEmptyAssistantMessage(id, item.id, 'user');
		protectedResults.push({ result, before, after: await snapshot([id]) });
	}
	const ancestor = await DatabaseService.createMessageBranch(
		message(id, 'ignored', 'user', [], 'text', 'assistant', ''),
		'user'
	);
	await DatabaseService.createMessageBranch(
		message(id, 'ignored', ancestor.id, [], 'text', 'user', 'new question'),
		ancestor.id
	);
	const before = await snapshot([id]);
	const result = await DatabaseService.deleteEmptyAssistantMessage(id, ancestor.id, 'user');
	protectedResults.push({ result, before, after: await snapshot([id]) });
	return { removed, afterRemoval, newer, afterNewer, protectedResults };
}

async function pendingAssistantRollback() {
	await DatabaseService.importConversations([
		{
			conv: conversation('pending-rollback', 'assistant'),
			messages: [
				message('pending-rollback', 'root', null, ['user'], 'root', 'system'),
				message('pending-rollback', 'user', 'root', ['assistant']),
				message('pending-rollback', 'assistant', 'user', [], 'text', 'assistant', '')
			]
		}
	]);
	const before = await snapshot(['pending-rollback']);
	const originalDelete = IDBObjectStore.prototype.delete;
	let error: string | null;
	try {
		IDBObjectStore.prototype.delete = function () {
			throw new Error('injected pending delete failure');
		};
		error = await captureError(() =>
			DatabaseService.deleteEmptyAssistantMessage('pending-rollback', 'assistant', 'user')
		);
	} finally {
		IDBObjectStore.prototype.delete = originalDelete;
	}
	return { error, before, after: await snapshot(['pending-rollback']) };
}

async function cascadingDeleteRollback() {
	await DatabaseService.importConversations([
		{
			conv: conversation('delete-rollback', 'rollback-assistant'),
			messages: [
				message('delete-rollback', 'rollback-root', null, ['rollback-user'], 'root', 'system'),
				message('delete-rollback', 'rollback-user', 'rollback-root', ['rollback-assistant']),
				message('delete-rollback', 'rollback-assistant', 'rollback-user', [], 'text', 'assistant')
			]
		}
	]);
	const before = await snapshot(['delete-rollback']);
	const originalDelete = IDBObjectStore.prototype.delete;
	let error: string | null;
	try {
		IDBObjectStore.prototype.delete = function () {
			throw new Error('injected delete failure');
		};
		error = await captureError(() =>
			DatabaseService.deleteMessageCascading(
				'delete-rollback',
				'rollback-assistant',
				'rollback-user'
			)
		);
	} finally {
		IDBObjectStore.prototype.delete = originalDelete;
	}
	return { error, before, after: await snapshot(['delete-rollback']) };
}

async function migrationRetry() {
	const legacyContent =
		'Before\n<<<AGENTIC_TOOL_CALL_START>>>\n<<<TOOL_NAME:test_tool>>>\n' +
		'<<<TOOL_ARGS_START>>>{"value":1}<<<TOOL_ARGS_END>>>result' +
		'<<<AGENTIC_TOOL_CALL_END>>>\nFinal';
	await DatabaseService.importConversations([
		{
			conv: conversation('migration', 'original-user'),
			messages: [
				message('migration', 'migration-root', null, ['legacy'], 'root', 'system', ''),
				message(
					'migration',
					'legacy',
					'migration-root',
					['original-user'],
					'text',
					'assistant',
					legacyContent
				),
				message('migration', 'original-user', 'legacy', [], 'text', 'user', 'Continue')
			]
		}
	]);

	const before = await snapshot(['migration']);
	const originalAdd = IDBObjectStore.prototype.add;
	const originalConsoleError = console.error;
	const expectedPrefix = '[Migration] Failed to migrate legacy messages:';
	const injectedFailure = new Error('injected migration failure');
	const errorLogs: unknown[][] = [];
	let createCalls = 0;
	let failureLog: { prefix: string; isError: boolean; name: string; message: string };
	try {
		console.error = (...args: unknown[]) => {
			errorLogs.push(args);
			if (args.length !== 2 || args[0] !== expectedPrefix || args[1] !== injectedFailure)
				originalConsoleError(...args);
		};
		IDBObjectStore.prototype.add = function (value, key) {
			createCalls++;
			if (createCalls === 2) throw injectedFailure;
			return originalAdd.call(this, value, key);
		};
		await runLegacyMigration();
		if (errorLogs.length !== 1)
			throw new Error(`Expected one injected migration error log, received ${errorLogs.length}`);
		const [prefix, error] = errorLogs[0];
		if (
			errorLogs[0].length !== 2 ||
			prefix !== expectedPrefix ||
			!(error instanceof Error) ||
			error !== injectedFailure ||
			error.name !== 'Error' ||
			error.message !== 'injected migration failure'
		)
			throw new Error('Unexpected console.error during the first legacy migration');
		failureLog = {
			prefix,
			isError: error instanceof Error,
			name: error.name,
			message: error.message
		};
	} finally {
		console.error = originalConsoleError;
		IDBObjectStore.prototype.add = originalAdd;
	}

	const afterFailure = await snapshot(['migration']);
	const doneAfterFailure = localStorage.getItem(MIGRATION_DONE_KEY);
	await runLegacyMigration();
	const afterSuccess = await snapshot(['migration']);
	const doneAfterSuccess = localStorage.getItem(MIGRATION_DONE_KEY);
	await runLegacyMigration();

	return {
		before,
		failureLogs: [failureLog],
		afterFailure,
		doneAfterFailure,
		afterSuccess,
		doneAfterSuccess,
		afterCompletedRetry: await snapshot(['migration'])
	};
}

async function currentNodeOwnership() {
	await DatabaseService.importConversations([graph('node-a'), graph('node-b')]);
	const before = await snapshot(['node-a', 'node-b']);
	const errors = {
		foreign: await captureError(() => DatabaseService.updateCurrentNode('node-a', 'node-b-root')),
		missing: await captureError(() => DatabaseService.updateCurrentNode('node-a', 'missing')),
		missingConversation: await captureError(() =>
			DatabaseService.updateCurrentNode('missing', 'node-a-root')
		)
	};
	const afterRejected = await snapshot(['node-a', 'node-b']);
	const transactions: IDBTransaction[] = [];
	const originalGet = IDBObjectStore.prototype.get;
	const originalPut = IDBObjectStore.prototype.put;
	try {
		IDBObjectStore.prototype.get = function (key) {
			transactions.push(this.transaction);
			return originalGet.call(this, key);
		};
		IDBObjectStore.prototype.put = function (value, key) {
			transactions.push(this.transaction);
			return originalPut.call(this, value, key);
		};
		await DatabaseService.updateCurrentNode('node-a', 'node-a-root');
	} finally {
		IDBObjectStore.prototype.get = originalGet;
		IDBObjectStore.prototype.put = originalPut;
	}
	const child = await DatabaseService.createMessageBranch(
		message('node-a', 'ignored', 'node-a-root', []),
		'node-a-root'
	);
	const leaf = await DatabaseService.createMessageBranch(
		message('node-a', 'ignored', child.id, []),
		child.id
	);
	const selections = [];
	for (const nodeId of [child.id, leaf.id, 'node-a-root']) {
		await DatabaseService.updateCurrentNode('node-a', nodeId);
		selections.push((await DatabaseService.getConversation('node-a'))!.currNode);
	}
	return {
		errors,
		before,
		afterRejected,
		atomic: transactions.length >= 3 && new Set(transactions).size === 1,
		selections,
		expectedSelections: [child.id, leaf.id, 'node-a-root'],
		afterValid: await snapshot(['node-a', 'node-b'])
	};
}

const scenarios: Record<string, () => Promise<unknown>> = {
	'tool-lifecycle': toolLifecycleScenario,
	...legacyScenarios,
	'current-node-ownership': currentNodeOwnership,
	'import-collision': importCollision,
	'import-preflight': importPreflight,
	'import-write-rollback': importWriteRollback,
	'delete-foreign-message': deleteForeignMessage,
	'graph-owner-validation': graphOwnerValidation,
	'strict-update-counts': strictUpdateCounts,
	'atomic-graph-mutations': atomicGraphMutations,
	'conversation-envelope-import': conversationEnvelopeImport,
	'legacy-v182-import': legacyV182Import,
	'failed-assistant-cleanup': failedAssistantCleanup,
	'pending-assistant-cleanup': pendingAssistantCleanup,
	'pending-assistant-rollback': pendingAssistantRollback,
	'cascading-delete-rollback': cascadingDeleteRollback,
	'migration-retry': migrationRetry
};

const resultElement = document.querySelector('#result');
const scenario = new URLSearchParams(location.search).get('scenario') ?? '';

try {
	const run = scenarios[scenario];
	if (!run) throw new Error(`Unknown scenario: ${scenario}`);
	const result = await run();
	resultElement!.textContent = btoa(JSON.stringify({ ok: true, result }));
} catch (error) {
	resultElement!.textContent = btoa(
		JSON.stringify({
			ok: false,
			error:
				error instanceof Error
					? `${error.name}: ${error.message}\n${error.stack ?? ''}`
					: String(error)
		})
	);
}
