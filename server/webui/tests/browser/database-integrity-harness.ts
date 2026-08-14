import { DatabaseService } from '$lib/services/database.service';
import { runLegacyMigration } from '$lib/utils/legacy-migration';
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
	const originalCreateMessageBranch = DatabaseService.createMessageBranch;
	let createCalls = 0;
	DatabaseService.createMessageBranch = async (newMessage, parentId) => {
		createCalls++;
		if (createCalls === 2) throw new Error('injected migration failure');
		return await originalCreateMessageBranch.call(DatabaseService, newMessage, parentId);
	};
	await runLegacyMigration();
	DatabaseService.createMessageBranch = originalCreateMessageBranch;

	const afterFailure = await snapshot(['migration']);
	const doneAfterFailure = localStorage.getItem(MIGRATION_DONE_KEY);
	await runLegacyMigration();
	const afterSuccess = await snapshot(['migration']);
	const doneAfterSuccess = localStorage.getItem(MIGRATION_DONE_KEY);
	await runLegacyMigration();

	return {
		before,
		afterFailure,
		doneAfterFailure,
		afterSuccess,
		doneAfterSuccess,
		afterCompletedRetry: await snapshot(['migration'])
	};
}

const scenarios: Record<string, () => Promise<unknown>> = {
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
