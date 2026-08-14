import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;
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
		server = await createServer({
			configFile: false,
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
		await server?.close();
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

	it('keeps a failed migration pending and retries it without duplicate graph edges', async () => {
		const result = await runScenario<{
			before: unknown;
			afterFailure: unknown;
			doneAfterFailure: string | null;
			afterSuccess: { messages: DatabaseMessage[] };
			doneAfterSuccess: string | null;
			afterCompletedRetry: unknown;
		}>('migration-retry');
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
});
