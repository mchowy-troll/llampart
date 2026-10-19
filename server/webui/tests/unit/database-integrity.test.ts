import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;
let viteCacheDir: string;
const chromiumExecutable = [
	process.env.LLAMPART_CHROMIUM_PATH,
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/usr/bin/google-chrome',
	'/snap/bin/chromium'
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
const describeWithChromium = chromiumExecutable ? describe : describe.skip;

async function runScenario<T>(scenario: string): Promise<T> {
	const profile = await mkdtemp(resolve(tmpdir(), 'llampart-indexeddb-test-'));
	const url = new URL('/tests/browser/database-integrity-harness.html', baseUrl);
	url.searchParams.set('scenario', scenario);
	const chromium = spawn(
		chromiumExecutable!,
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu',
			'--disable-dev-shm-usage',
			'--no-first-run',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`,
			url.href
		],
		{ stdio: 'ignore' }
	);
	try {
		const deadline = Date.now() + 20_000;
		let port = '';
		while (!port && Date.now() < deadline) {
			try {
				port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
			} catch {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
			}
		}
		if (!port) throw new Error('Chromium did not expose its DevTools port');

		let page: { webSocketDebuggerUrl: string } | undefined;
		while (!page && Date.now() < deadline) {
			const pages = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
				response.json()
			)) as Array<{ url: string; webSocketDebuggerUrl: string }>;
			page = pages.find((candidate) => candidate.url.includes('database-integrity-harness.html'));
			if (!page) await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
		}
		if (!page) throw new Error('Chromium did not open the test harness');

		const socket = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise<void>((resolveOpen, rejectOpen) => {
			socket.addEventListener('open', () => resolveOpen(), { once: true });
			socket.addEventListener('error', () => rejectOpen(new Error('DevTools socket failed')), {
				once: true
			});
		});
		let commandId = 0;
		const evaluate = (expression: string) =>
			new Promise<string | undefined>((resolveEvaluation, rejectEvaluation) => {
				const id = ++commandId;
				const listener = (event: MessageEvent) => {
					const response = JSON.parse(String(event.data)) as {
						id?: number;
						result?: { result?: { value?: string } };
						error?: { message: string };
					};
					if (response.id !== id) return;
					socket.removeEventListener('message', listener);
					if (response.error) rejectEvaluation(new Error(response.error.message));
					else resolveEvaluation(response.result?.result?.value);
				};
				socket.addEventListener('message', listener);
				socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression } }));
			});

		let encodedResult: string | undefined;
		while ((!encodedResult || encodedResult === 'pending') && Date.now() < deadline) {
			encodedResult = await evaluate("document.querySelector('#result')?.textContent");
			if (!encodedResult || encodedResult === 'pending') {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
			}
		}
		socket.close();
		if (!encodedResult || encodedResult === 'pending') throw new Error('Browser harness timed out');
		const envelope = JSON.parse(Buffer.from(encodedResult, 'base64').toString('utf8')) as {
			ok: boolean;
			result?: T;
			error?: string;
		};
		if (!envelope.ok) throw new Error(envelope.error);
		return envelope.result as T;
	} finally {
		chromium.kill('SIGTERM');
		await new Promise<void>((resolveExit) => {
			if (chromium.exitCode !== null) resolveExit();
			else chromium.once('exit', () => resolveExit());
		});
		await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
	}
}

describeWithChromium('DatabaseService integrity on IndexedDB', () => {
	beforeAll(async () => {
		// Never replace the optimizer cache used by a running application dev server.
		viteCacheDir = await mkdtemp(resolve(tmpdir(), 'llampart-indexeddb-vite-'));
		server = await createServer({
			configFile: false,
			cacheDir: viteCacheDir,
			logLevel: 'error',
			optimizeDeps: { include: ['dexie'], noDiscovery: true },
			resolve: { alias: { $lib: resolve(process.cwd(), 'src/lib') } },
			server: { host: '127.0.0.1', port: 0 }
		});
		await server.listen();
		baseUrl = server.resolvedUrls?.local[0] ?? '';
		if (!baseUrl) throw new Error('Vite test server did not expose a local URL');
	}, 30_000);

	afterAll(async () => {
		try {
			await server?.close();
		} finally {
			if (viteCacheDir) await rm(viteCacheDir, { recursive: true, force: true });
		}
	});

	it('isolates its optimizer cache from the application dev server', () => {
		expect(server.config.cacheDir).toBe(viteCacheDir);
		expect(server.config.cacheDir).not.toBe(resolve(process.cwd(), 'node_modules/.vite'));
	});

	it('rejects message ID collisions without changing the existing conversation', async () => {
		const result = await runScenario<{
			error: string | null;
			before: unknown;
			after: unknown;
		}>('import-collision');
		expect(result.error).toMatch(/message/i);
		expect(result.after).toEqual(result.before);
	}, 30_000);

	it('preflights every imported graph before the first write', async () => {
		const result = await runScenario<{
			errors: Record<string, string | null>;
			atomicError: string | null;
			conversations: unknown[];
		}>('import-preflight');
		expect(Object.values(result.errors)).not.toContain(null);
		expect(result.atomicError).toMatch(/currNode/i);
		expect(result.conversations).toEqual([]);
	}, 30_000);

	it('rolls back every import write when IndexedDB rejects a record', async () => {
		const result = await runScenario<{
			error: string | null;
			after: { conversations: unknown[]; messages: unknown[] };
		}>('import-write-rollback');
		expect(result.error).not.toBeNull();
		expect(result.after).toEqual({ conversations: [], messages: [] });
	}, 30_000);

	it('does not mutate a foreign conversation during cascading deletion', async () => {
		const result = await runScenario<{
			error: string | null;
			before: unknown;
			after: unknown;
		}>('delete-foreign-message');
		expect(result.error).toMatch(/does not belong/i);
		expect(result.after).toEqual(result.before);
	}, 30_000);

	it('validates conversation ownership before creating graph edges', async () => {
		const result = await runScenario<{
			errors: Record<string, string | null>;
			before: unknown;
			after: unknown;
		}>('graph-owner-validation');
		expect(Object.values(result.errors)).not.toContain(null);
		expect(result.after).toEqual(result.before);
	}, 30_000);

	it('throws when an integrity update changes no record', async () => {
		const result = await runScenario<{
			conversationError: string | null;
			messageError: string | null;
		}>('strict-update-counts');
		expect(result.conversationError).toMatch(/not found/i);
		expect(result.messageError).toMatch(/not found/i);
	}, 30_000);

	it('atomically rejects foreign or missing current nodes and accepts owned root/interior/leaf nodes', async () => {
		const result = await runScenario<{
			errors: Record<string, string | null>;
			before: unknown;
			afterRejected: unknown;
			atomic: boolean;
			selections: string[];
			expectedSelections: string[];
			afterValid: { conversations: DatabaseConversation[] };
		}>('current-node-ownership');
		expect(result.errors.foreign).toMatch(/does not belong/);
		expect(result.errors.missing).toMatch(/not found/);
		expect(result.errors.missingConversation).toMatch(/not found/);
		expect(result.afterRejected).toEqual(result.before);
		expect(result.atomic).toBe(true);
		expect(result.selections).toEqual(result.expectedSelections);
		expect(result.afterValid.conversations[0].currNode).toBe('node-a-root');
	}, 30_000);

	it('commits system-prompt and edit truncation as complete graph mutations', async () => {
		const result = await runScenario<{
			beforeTimestamp: number;
			afterInsert: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
			afterRemove: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
			editResult: { deletedIds: string[] };
			afterEdit: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
		}>('atomic-graph-mutations');
		const inserted = result.afterInsert.messages;
		const system = inserted.find((item) => item.content === 'System')!;
		expect(inserted.find((item) => item.id === 'root')?.children).toEqual([system.id]);
		expect(inserted.find((item) => item.id === 'user')?.parent).toBe(system.id);
		expect(result.afterInsert.conversations[0].lastModified).toBeGreaterThan(
			result.beforeTimestamp
		);
		expect(result.afterRemove.messages.find((item) => item.id === 'root')?.children).toEqual([
			'user'
		]);
		expect(result.afterRemove.messages.find((item) => item.id === 'user')?.parent).toBe('root');
		expect(result.editResult.deletedIds).toEqual(['assistant']);
		expect(result.afterEdit.messages.map((item) => item.id).sort()).toEqual(['root', 'user']);
		expect(result.afterEdit.messages.find((item) => item.id === 'user')?.content).toBe(
			'Edited question'
		);
		expect(result.afterEdit.conversations[0].currNode).toBe('user');
	}, 30_000);

	it('imports the parsed V1 conversation payload through the strict graph preflight', async () => {
		const result = await runScenario<{
			result: { imported: number; skipped: number };
			after: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
		}>('conversation-envelope-import');
		expect(result.result).toEqual({ imported: 1, skipped: 0 });
		expect(result.after.conversations[0].id).toBe('envelope-import');
		expect(result.after.messages).toHaveLength(1);
	}, 30_000);

	it('imports a real rootless v1.8.2 active-path export after V0 normalization', async () => {
		const result = await runScenario<{
			result: { imported: number; skipped: number };
			after: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
		}>('legacy-v182-import');
		expect(result.result).toEqual({ imported: 1, skipped: 0 });
		expect(result.after.conversations[0].currNode).toBe('legacy-assistant');
		expect(result.after.messages.map((message) => message.id).sort()).toEqual([
			'legacy-assistant',
			'legacy-omitted-root',
			'legacy-user'
		]);
		expect(result.after.messages.find((message) => message.id === 'legacy-user')?.children).toEqual(
			['legacy-assistant']
		);
	}, 30_000);

	it('atomically removes a failed assistant and repairs its conversation graph', async () => {
		const result = await runScenario<{
			beforeTimestamp: number;
			after: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
		}>('failed-assistant-cleanup');
		expect(result.after.conversations[0].currNode).toBe('failed-user');
		expect(result.after.conversations[0].lastModified).toBeGreaterThan(result.beforeTimestamp);
		expect(result.after.messages.map((message) => message.id).sort()).toEqual([
			'failed-root',
			'failed-user'
		]);
		expect(result.after.messages.find((message) => message.id === 'failed-user')?.children).toEqual(
			[]
		);
	}, 30_000);

	it('rolls back currNode, parent cleanup and branch deletion on delete failure', async () => {
		const result = await runScenario<{
			error: string | null;
			before: unknown;
			after: unknown;
		}>('cascading-delete-rollback');
		expect(result.error).toMatch(/injected delete failure/i);
		expect(result.after).toEqual(result.before);
	}, 30_000);

	it('removes only a pending assistant leaf and preserves newer branches and meaningful data', async () => {
		const result = await runScenario<{
			removed: { parentId: string };
			afterRemoval: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
			newer: DatabaseMessage;
			afterNewer: { conversations: DatabaseConversation[]; messages: DatabaseMessage[] };
			protectedResults: Array<{ result: unknown; before: unknown; after: unknown }>;
		}>('pending-assistant-cleanup');
		expect(result.removed.parentId).toBe('user');
		expect(result.afterRemoval.messages.map((message) => message.id)).toEqual(['root', 'user']);
		expect(result.afterRemoval.messages.find((message) => message.id === 'user')?.children).toEqual(
			[]
		);
		expect(result.afterRemoval.conversations[0].currNode).toBe('user');
		expect(result.afterNewer.conversations[0].currNode).toBe(result.newer.id);
		expect(result.afterNewer.messages.find((message) => message.id === 'user')?.children).toEqual([
			result.newer.id
		]);
		expect(result.afterNewer.messages.find((message) => message.id === result.newer.id)).toEqual(
			result.newer
		);
		for (const item of result.protectedResults) {
			expect(item.result).toBeNull();
			expect(item.after).toEqual(item.before);
		}
	}, 30_000);

	it('rolls back pending assistant cleanup if IndexedDB rejects the deletion', async () => {
		const result = await runScenario<{ error: string; before: unknown; after: unknown }>(
			'pending-assistant-rollback'
		);
		expect(result.error).toContain('injected pending delete failure');
		expect(result.after).toEqual(result.before);
	}, 30_000);

	it('keeps a failed migration pending and retries it without duplicate graph edges', async () => {
		const result = await runScenario<{
			before: unknown;
			failureLogs: Array<{ prefix: string; isError: boolean; name: string; message: string }>;
			afterFailure: unknown;
			doneAfterFailure: string | null;
			afterSuccess: { messages: DatabaseMessage[] };
			doneAfterSuccess: string | null;
			afterCompletedRetry: unknown;
		}>('migration-retry');
		expect(result.failureLogs).toEqual([
			{
				prefix: '[Migration] Failed to migrate legacy messages:',
				isError: true,
				name: 'Error',
				message: 'injected migration failure'
			}
		]);
		expect(result.doneAfterFailure).toBeNull();
		expect(result.afterFailure).toEqual(result.before);
		expect(result.doneAfterSuccess).not.toBeNull();
		expect(result.afterCompletedRetry).toEqual(result.afterSuccess);

		const messagesById = new Map(
			result.afterSuccess.messages.map((message) => [message.id, message])
		);
		expect(messagesById.size).toBe(5);
		for (const current of messagesById.values()) {
			expect(new Set(current.children).size).toBe(current.children.length);
			for (const childId of current.children) {
				expect(messagesById.get(childId)?.parent).toBe(current.id);
			}
		}
	}, 30_000);

	it('preserves the complete legacy graph, selected branch and exported relationships', async () => {
		const result = await runScenario<{
			inputs: Array<{ conv: DatabaseConversation; messages: DatabaseMessage[] }>;
			after: Array<{ conv: DatabaseConversation; messages: DatabaseMessage[] }>;
			retry: unknown;
			done: string | null;
			exportError: string | null;
			roundtrip: unknown;
		}>('migration-matrix');
		expect(result.done).not.toBeNull();
		expect(result.exportError).toBeNull();
		expect(result.retry).toEqual(result.after);
		expect(result.roundtrip).toEqual(result.after);
		for (const [index, output] of result.after.entries()) {
			const input = result.inputs[index];
			const graph = new Map(output.messages.map((m) => [m.id, m]));
			const expectedAdded: Record<string, number> = {
				modern: 0,
				reasoning: 0,
				multi: 5,
				consecutive: 4
			};
			expect(output.messages.length - input.messages.length, input.conv.id).toBe(
				expectedAdded[input.conv.id] ?? 2
			);
			const seen = new Set<string>();
			const pending = [output.messages.find((m) => m.type === 'root')!.id];
			while (pending.length) {
				const id = pending.pop()!;
				expect(seen.has(id), `cycle or duplicate edge ${id}`).toBe(false);
				seen.add(id);
				pending.push(...graph.get(id)!.children);
			}
			expect(seen.size).toBe(output.messages.length);
			expect(output.conv.lastModified).toBe(input.conv.lastModified);
			const selected = input.messages.find((m) => m.id === input.conv.currNode)!;
			if (selected.content.includes('<<<AGENTIC_TOOL_CALL_START>>>')) {
				// An expanded message represents its entire turn, not just its first segment.
				expect(graph.get(output.conv.currNode!)?.content).toMatch(/final/i);
			} else {
				expect(output.conv.currNode).toBe(input.conv.currNode);
			}
			for (const original of input.messages) {
				expect(graph.has(original.id)).toBe(true);
				if (!original.content.includes('<<<'))
					expect(graph.get(original.id)?.content).toBe(original.content);
			}
			for (const m of output.messages) {
				expect(m.convId).toBe(input.conv.id);
				if (m.parent) expect(graph.get(m.parent)?.children).toContain(m.id);
				for (const child of m.children) expect(graph.get(child)?.parent).toBe(m.id);
			}
		}
		const multi = result.after.find((item) => item.conv.id === 'multi')!;
		expect(
			multi.messages
				.filter((m) => m.role === 'tool')
				.map((m) => m.toolCallId)
				.sort()
		).toEqual(['kept-a', 'kept-b', 'kept-c']);
		const modern = result.after.find((item) => item.conv.id === 'modern')!;
		const originalModern = result.inputs.find((item) => item.conv.id === 'modern')!;
		expect(modern.conv).toEqual(originalModern.conv);
		expect([...modern.messages].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
			[...originalModern.messages].sort((a, b) => a.id.localeCompare(b.id))
		);
	}, 30_000);

	it('rolls back every conversation on creation, reparenting, validation or precommit failure and retries safely', async () => {
		const results = await runScenario<
			Array<{
				phase: string;
				injected: boolean;
				errors: string[];
				before: unknown;
				after: unknown;
				done: string | null;
				success: unknown;
				retry: unknown;
			}>
		>('migration-failures');
		for (const result of results) {
			expect(
				result.injected || ['malformed', 'invalid-input', 'existing-result'].includes(result.phase),
				result.phase
			).toBe(true);
			expect(result.errors, result.phase).toHaveLength(1);
			expect(result.after, result.phase).toEqual(result.before);
			expect(result.done, result.phase).toBeNull();
			expect(result.retry, result.phase).toEqual(result.success);
		}
	}, 30_000);

	it('validates internal graphs without applying export-only metadata restrictions', async () => {
		const result = await runScenario<{
			metadata: Partial<DatabaseMessage>;
			before: { conv: DatabaseConversation };
			after: { conv: DatabaseConversation; messages: DatabaseMessage[] };
		}>('migration-metadata');
		expect(result.after.messages.find((m) => m.id === 'metadata-legacy')).toMatchObject(
			result.metadata
		);
		expect(result.after.conv).toEqual(result.before.conv);
	}, 30_000);

	it('never remigrates or recovers data protected by the shipped done marker', async () => {
		const result = await runScenario<{ before: unknown; after: unknown; done: string }>(
			'migration-done'
		);
		expect(result.after).toEqual(result.before);
		expect(result.done).toBe('original-marker');
	}, 30_000);

	it('preserves argument-based tool IDs and rolls back all writes on ambiguous or mismatched arguments', async () => {
		const results = await runScenario<
			Array<{
				mode: string;
				before: unknown;
				after: Array<{ conv: DatabaseConversation; messages: DatabaseMessage[] }>;
				done: string | null;
				errors: string[];
				firstConversationWrites: number;
				retry: unknown;
			}>
		>('migration-argument-matching');
		for (const result of results) {
			expect(result.retry, result.mode).toEqual(result.after);
			if (['different', 'ambiguous', 'repeated'].includes(result.mode)) {
				expect(result.errors, result.mode).toHaveLength(2);
				expect(result.errors.every((error) => /Unmatched|Ambiguous/.test(error))).toBe(true);
				expect(result.firstConversationWrites, result.mode).toBe(4);
				expect(result.after, result.mode).toEqual(result.before);
				expect(result.done, result.mode).toBeNull();
			} else {
				expect(result.errors, result.mode).toEqual([]);
				expect(result.done, result.mode).not.toBeNull();
				expect(result.firstConversationWrites, result.mode).toBe(2);
				const tools = result.after[1].messages.filter((m) => m.role === 'tool');
				expect(tools.map((m) => [m.content, m.toolCallId]).sort()).toEqual([
					['Result one', result.mode === 'id-only' ? 'only-first' : 'for-one'],
					['Result two', result.mode === 'id-only' ? 'only-second' : 'for-two']
				]);
				expect(result.after[1].conv.currNode).toBe(`z-arguments-${result.mode}-tail`);
			}
		}
	}, 30_000);

	it('supports history, fork, edit, regeneration and normal save on a migrated branched graph', async () => {
		const result = await runScenario<{
			path: string[];
			forked: { messages: DatabaseMessage[] };
			edited: { deletedIds: string[] };
			regenerated: { deletedIds: string[]; parentId: string };
			saved: DatabaseMessage;
			after: { conv: DatabaseConversation; messages: DatabaseMessage[] };
		}>('migration-consumers');
		expect(result.path).toEqual([
			'Original question',
			'Before',
			'Saved result',
			'Final answer',
			'Next 0',
			'Existing tail 0'
		]);
		expect(result.forked.messages.map((m) => m.content)).toContain('Final answer');
		expect(result.edited.deletedIds).toEqual(['consumers-tail']);
		expect(result.regenerated.deletedIds).toEqual(['consumers-tail1']);
		expect(result.regenerated.parentId).toBe('consumers-next1');
		expect(result.after.conv.currNode).toBe(result.saved.id);
		expect(result.after.messages.find((m) => m.id === 'consumers-next0')?.content).toBe(
			'Edited next question'
		);
		expect(result.after.messages.find((m) => m.id === 'consumers-next1')?.children).toEqual([
			result.saved.id
		]);
	}, 30_000);
});
