import { DatabaseService as db } from '$lib/services/database.service';
import { runLegacyMigration } from '$lib/utils/legacy-migration';
import { filterByLeafNodeId } from '$lib/utils/branching';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';

const doneKey = 'llama-webui-migration-v2-done';
export const legacyCall = (name = 'test_tool', args = '{"value":1}', result = 'Saved result') =>
	`<<<AGENTIC_TOOL_CALL_START>>>\n<<<TOOL_NAME:${name}>>>\n<<<TOOL_ARGS_START>>>${args}<<<TOOL_ARGS_END>>>\n${result}\n<<<AGENTIC_TOOL_CALL_END>>>`;

export function fixture(id: string, children = 1, selected = 'tail', content?: string) {
	const msg = (
		name: string,
		parent: string | null,
		childNames: string[],
		role: DatabaseMessage['role'],
		text: string,
		timestamp: number,
		type: DatabaseMessage['type'] = 'text'
	): DatabaseMessage => ({
		id: `${id}-${name}`,
		convId: id,
		parent: parent ? `${id}-${parent}` : null,
		children: childNames.map((child) => `${id}-${child}`),
		role,
		type,
		content: text,
		timestamp,
		toolCalls: ''
	});
	const messages = [
		msg('root', null, ['user', 'other'], 'system', '', 1, 'root'),
		msg('user', 'root', ['legacy'], 'user', 'Original question', 2),
		msg(
			'legacy',
			'user',
			Array.from({ length: children }, (_, i) => `next${i}`),
			'assistant',
			content ?? `Before\n${legacyCall()}\nFinal answer`,
			3
		),
		msg('other', 'root', [], 'assistant', 'Other branch', 4)
	];
	for (let i = 0; i < children; i++) {
		messages.push(
			msg(`next${i}`, 'legacy', [i === 0 ? 'tail' : `tail${i}`], 'user', `Next ${i}`, 4)
		);
		messages.push(
			msg(i === 0 ? 'tail' : `tail${i}`, `next${i}`, [], 'assistant', `Existing tail ${i}`, 5)
		);
	}
	return {
		conv: { id, name: id, lastModified: 10, currNode: `${id}-${selected}` },
		messages
	};
}

export async function readFixture(id: string) {
	return { conv: (await db.getConversation(id))!, messages: await db.getConversationMessages(id) };
}

async function migrationMatrix() {
	const inputs = [
		fixture('leaf', 0, 'legacy'),
		fixture('one'),
		fixture('branches', 3),
		fixture('selected', 1, 'legacy'),
		fixture('other', 2, 'other'),
		fixture(
			'multi',
			1,
			'tail',
			`Before\n${legacyCall()}\n${legacyCall('test_tool', '{"value":2}', 'Second result')}\nMiddle\n${legacyCall('third')}\nFinal answer`
		),
		fixture('consecutive'),
		fixture('modern', 1, 'tail', 'Modern answer'),
		fixture(
			'reasoning',
			1,
			'tail',
			'<<<reasoning_content_start>>>Thought<<<reasoning_content_end>>>Visible'
		)
	];
	inputs[6].messages.find((m) => m.id === 'consecutive-tail')!.content =
		`Later\n${legacyCall('later')}\nLater final`;
	inputs[5].messages.find((m) => m.id === 'multi-legacy')!.toolCalls = JSON.stringify([
		{ id: 'kept-a', type: 'function', function: { name: 'test_tool', arguments: '{"value":1}' } },
		{ id: 'kept-b', type: 'function', function: { name: 'test_tool', arguments: '{"value":2}' } },
		{ id: 'kept-c', type: 'function', function: { name: 'third', arguments: '{"value":1}' } }
	]);
	await db.importConversations(inputs);
	await runLegacyMigration();
	const after = await Promise.all(inputs.map((input) => readFixture(input.conv.id)));
	let exportError: string | null = null;
	try {
		await db.importConversations(
			parseConversationImport(createConversationExportEnvelope(after, '1.9.0'))
		);
	} catch (error) {
		exportError = String(error);
	}
	const done = localStorage.getItem(doneKey);
	await runLegacyMigration();
	const retry = await Promise.all(inputs.map((input) => readFixture(input.conv.id)));
	let roundtrip: unknown = null;
	if (!exportError) {
		const parsed = parseConversationImport(
			JSON.parse(JSON.stringify(createConversationExportEnvelope(after, '1.9.0')))
		);
		await db.deleteConversations(inputs.map((input) => input.conv.id));
		await db.importConversations(parsed);
		roundtrip = await Promise.all(inputs.map((input) => readFixture(input.conv.id)));
	}
	return { inputs, after, retry, done, exportError, roundtrip };
}

async function migrationFailures() {
	const results = [];
	for (const phase of [
		'create',
		'reparent',
		'validate',
		'precommit',
		'malformed',
		'invalid-input',
		'existing-result'
	]) {
		localStorage.removeItem(doneKey);
		const ids = [`a-${phase}`, `z-${phase}`];
		await db.importConversations(ids.map((id) => fixture(id)));
		if (phase === 'malformed')
			await db.updateMessage(`${ids[1]}-legacy`, {
				content: 'Important <<<AGENTIC_TOOL_CALL_START>>> unfinished'
			});
		if (phase === 'invalid-input') await db.updateMessage(`${ids[1]}-legacy`, { children: [] });
		if (phase === 'existing-result') {
			await db.updateMessage(`${ids[1]}-legacy`, { toolCalls: '[{"id":"hybrid-call"}]' });
			await db.updateMessage(`${ids[1]}-next0`, { role: 'tool', toolCallId: 'hybrid-call' });
		}
		const before = await Promise.all(ids.map(readFixture));
		const add = IDBObjectStore.prototype.add;
		const put = IDBObjectStore.prototype.put;
		const log = console.error;
		const errors: string[] = [];
		let injected = false;
		try {
			console.error = (...args) => errors.push(args.map(String).join(' '));
			IDBObjectStore.prototype.add = function (value, key) {
				if (phase === 'create' && value.convId === ids[1]) {
					injected = true;
					throw new Error('injected create failure');
				}
				return add.call(this, value, key);
			};
			IDBObjectStore.prototype.put = function (value, key) {
				if (value.id === `${ids[1]}-next0` && phase === 'reparent') {
					injected = true;
					throw new Error('injected reparent failure');
				}
				if (value.id === `${ids[1]}-legacy` && phase === 'validate') {
					injected = true;
					value = { ...value, children: [] };
				}
				if (value.id === ids[1] && phase === 'precommit') {
					injected = true;
					this.transaction.abort();
				}
				return put.call(this, value, key);
			};
			await runLegacyMigration();
		} finally {
			IDBObjectStore.prototype.add = add;
			IDBObjectStore.prototype.put = put;
			console.error = log;
		}
		const after = await Promise.all(ids.map(readFixture));
		const done = localStorage.getItem(doneKey);
		if (phase === 'malformed')
			await db.updateMessage(`${ids[1]}-legacy`, {
				content: fixture(ids[1]).messages.find((m) => m.id.endsWith('-legacy'))!.content
			});
		if (phase === 'invalid-input')
			await db.updateMessage(`${ids[1]}-legacy`, { children: [`${ids[1]}-next0`] });
		if (phase === 'existing-result')
			await db.updateMessage(`${ids[1]}-next0`, { role: 'user', toolCallId: undefined });
		await runLegacyMigration();
		const success = await Promise.all(ids.map(readFixture));
		// Simulate a crash after commit but before the localStorage cache was written.
		localStorage.removeItem(doneKey);
		await runLegacyMigration();
		results.push({
			phase,
			injected,
			errors,
			before,
			after,
			done,
			success,
			retry: await Promise.all(ids.map(readFixture))
		});
	}
	return results;
}

async function migrationMetadata() {
	const data: { conv: DatabaseConversation; messages: DatabaseMessage[] } = fixture('metadata');
	data.conv.pinned = true;
	data.conv.mcpServerOverrides = [{ serverId: 'synthetic', enabled: false }];
	data.conv.forkedFromConversationId = 'original-parent';
	await db.importConversations([data]);
	const metadata = {
		providerContinuation: {
			providerId: 'openai',
			protocol: 'responses',
			sourceFingerprint: 'synthetic',
			model: 'test',
			reasoningItems: [{ opaque: 'unchanged' }]
		},
		timings: { provider: { source: 'synthetic' } },
		model: 'original-model',
		completionId: 'original-completion',
		thinking: 'original-thinking',
		reasoningContent: 'Already structured'
	} as Partial<DatabaseMessage>;
	await db.updateMessage('metadata-legacy', metadata);
	const before = await readFixture('metadata');
	await runLegacyMigration();
	const after = await readFixture('metadata');
	return { metadata, before, after };
}

async function migrationDone() {
	await db.importConversations([fixture('already-done')]);
	// Previously corrupted data must not be scanned/repaired under the old marker.
	await db.updateMessage('already-done-legacy', { children: [] });
	localStorage.setItem(doneKey, 'original-marker');
	const before = await readFixture('already-done');
	await runLegacyMigration();
	return { before, after: await readFixture('already-done'), done: localStorage.getItem(doneKey) };
}

async function migrationConsumers() {
	await db.importConversations([fixture('consumers', 2)]);
	await runLegacyMigration();
	const migrated = await readFixture('consumers');
	const path = filterByLeafNodeId(migrated.messages, 'consumers-tail').map((m) => m.content);
	const fork = await db.forkConversation('consumers', 'consumers-tail', {
		name: 'Migrated fork',
		includeAttachments: true
	});
	const forked = await readFixture(fork.id);
	const edited = await db.replaceUserMessageAndTruncateBranch(
		'consumers',
		'consumers-next0',
		'Edited next question'
	);
	const regenerated = await db.truncateBranchForRegeneration('consumers', 'consumers-tail1');
	const saved = await db.createMessageBranch(
		{
			convId: 'consumers',
			type: 'text',
			role: 'assistant',
			content: 'Regenerated answer',
			timestamp: 6,
			parent: 'consumers-next1',
			children: [],
			toolCalls: ''
		},
		'consumers-next1'
	);
	const after = await readFixture('consumers');
	// The strict import preflight also runs for skipped existing records.
	await db.importConversations(
		parseConversationImport(createConversationExportEnvelope([after, forked], '1.9.0'))
	);
	return { path, forked, edited, regenerated, saved, after };
}

async function migrationArgumentMatching() {
	const results = [];
	for (const mode of ['equivalent', 'different', 'ambiguous', 'repeated', 'id-only']) {
		localStorage.removeItem(doneKey);
		const ids = [`a-arguments-${mode}`, `z-arguments-${mode}`];
		const secondArgument = mode === 'repeated' ? '{"n":1}' : '{"n":2}';
		const data = fixture(
			ids[1],
			2,
			'tail',
			`Before\n${legacyCall('calculate', '{"n":1}', 'Result one')}\n${legacyCall('calculate', secondArgument, 'Result two')}\nFinal`
		);
		let calls: Array<{ id: string; function?: { name: string; arguments: string } }> = [
			{ id: 'for-two', function: { name: 'calculate', arguments: '{ "n": 2 }' } },
			{ id: 'for-one', function: { name: 'calculate', arguments: '{\n "n": 1\n}' } }
		];
		if (mode === 'different')
			calls = calls.map((call, i) => ({
				...call,
				function: { name: 'calculate', arguments: JSON.stringify({ n: i + 3 }) }
			}));
		if (mode === 'ambiguous')
			calls = calls.map((call) => ({
				...call,
				function: { name: 'calculate', arguments: '{ "n": 1 }' }
			}));
		if (mode === 'repeated') calls = [calls[1]];
		if (mode === 'id-only') calls = [{ id: 'only-first' }, { id: 'only-second' }];
		data.messages.find((m) => m.id === `${ids[1]}-legacy`)!.toolCalls = JSON.stringify(calls);
		await db.importConversations([fixture(ids[0]), data]);
		const before = await Promise.all(ids.map(readFixture));
		const log = console.error;
		const add = IDBObjectStore.prototype.add;
		const errors: string[] = [];
		let firstConversationWrites = 0;
		try {
			console.error = (...args) => errors.push(args.map(String).join(' '));
			IDBObjectStore.prototype.add = function (value, key) {
				if (this.name === 'messages' && value.convId === ids[0]) firstConversationWrites++;
				return add.call(this, value, key);
			};
			await runLegacyMigration();
			const after = await Promise.all(ids.map(readFixture));
			const done = localStorage.getItem(doneKey);
			await runLegacyMigration();
			results.push({
				mode,
				before,
				after,
				done,
				errors,
				firstConversationWrites,
				retry: await Promise.all(ids.map(readFixture))
			});
		} finally {
			console.error = log;
			IDBObjectStore.prototype.add = add;
		}
		// Each mode owns its synthetic fixtures; a rejected fixture must not mask the next one.
		await db.deleteConversations(ids);
	}
	return results;
}

export const legacyScenarios = {
	'migration-argument-matching': migrationArgumentMatching,
	'migration-matrix': migrationMatrix,
	'migration-failures': migrationFailures,
	'migration-metadata': migrationMetadata,
	'migration-done': migrationDone,
	'migration-consumers': migrationConsumers
};
