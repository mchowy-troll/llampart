/** Actual ChatStore, agentic flow, native Stop and HTTP resume. Synthetic models/tools only. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const results = [];
const ids = ['Qwen-Test-A', 'Gemma-Test-B'];
try {
	for (const provider of ['llama-server', 'vllm', 'openai-compatible']) {
		let hold = false,
			responseModel = null,
			toolsRemaining = 0;
		const requests = [],
			errors = [],
			heldResponses = [];
		const server = createServer(async (req, res) => {
			const url = new URL(req.url, 'http://synthetic');
			requests.push(url.pathname + url.search);
			let body = {};
			if (req.method === 'POST') {
				let raw = '';
				for await (const chunk of req) raw += chunk;
				body = JSON.parse(raw || '{}');
			}
			const json = (value) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(value));
			};
			if (url.pathname.endsWith('/props')) {
				const id = url.searchParams.get('model');
				return json({
					role: id ? 'model' : 'router',
					model_alias: id ?? ids[0],
					model_path: `/synthetic/${id ?? ids[0]}.gguf`,
					chat_template: `template-${id ?? ids[0]}`,
					build_info: `build-${id ?? ids[0]}`,
					modalities: { vision: false },
					default_generation_settings: { n_ctx: id === ids[1] ? 32768 : 65536, params: {} }
				});
			}
			if (url.pathname.endsWith('/models'))
				return json({
					object: 'list',
					data: ids.map((id) => ({
						id,
						status: { value: 'loaded' },
						context_length: id === ids[0] ? 65536 : 32768
					}))
				});
			if (url.pathname.endsWith('/streams/lookup')) return json({});
			if (url.pathname.endsWith('/stream') && req.method === 'DELETE') return json({});
			if (url.pathname.endsWith('/chat/completions') || url.pathname.endsWith('/stream')) {
				const resumed = req.method === 'GET';
				const model = resumed ? ids[0] : (responseModel ?? body.model);
				const tool = !resumed && toolsRemaining-- > 0;
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.write(
					`data: ${JSON.stringify({ model, choices: [{ index: 0, delta: tool ? { content: 'Synthetic tool plan', tool_calls: [{ index: 0, id: 'synthetic-call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }] } : { content: resumed ? ' resumed' : 'Synthetic partial or final', reasoning_content: 'Synthetic reasoning' }, finish_reason: tool ? 'tool_calls' : hold && !resumed ? null : 'stop' }] })}\n\n`
				);
				if (hold && !resumed) {
					heldResponses.push(res);
					return;
				}
				return res.end('data: [DONE]\n\n');
			}
			json([]);
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const backend = `http://127.0.0.1:${server.address().port}`;
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		try {
			await context.addInitScript(
				({ provider, backend }) => {
					localStorage.setItem('llama-webui-migration-v2-done', '1');
					localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							apiProvider: provider,
							llamaServerBaseUrl: backend,
							serverBaseUrl: backend,
							vllmBaseUrl: backend,
							openAiCompatibleBaseUrl: backend,
							interfaceLanguage: 'en',
							theme: 'frosted-glass',
							preEncodeConversation: false,
							titleGenerationUseLLM: false,
							askForTitleConfirmation: false,
							alwaysShowSidebarOnDesktop: false
						})
					);
					globalThis.auditRejections = [];
					addEventListener('unhandledrejection', (e) => auditRejections.push(String(e.reason)));
				},
				{ provider, backend }
			);
			const page = await context.newPage();
			page.on('pageerror', (e) => errors.push(e.message));
			await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
			await page.locator('textarea').first().waitFor();
			await page.evaluate(async () => {
				const h = await import('/tests/browser/attachment-preview-model-harness.ts');
				const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
				globalThis.life = { ...h, db };
				await h.models.fetch();
				await h.models.selectModelById('Qwen-Test-A');
			});
			const start = async (text) => {
				const before = await page.evaluate(
					() => life.conversations.activeMessages.filter((m) => m.role === 'assistant').length
				);
				await page.locator('textarea').first().fill(text);
				await page.locator('textarea').first().press('Enter');
				await page.waitForFunction(
					(before) =>
						life.conversations.activeMessages.filter((m) => m.role === 'assistant').length > before,
					before
				);
			};
			const done = () => page.waitForFunction(() => !life.chat.isLoading);
			const rows = () =>
				page.evaluate(async () =>
					life.db.getConversationMessages(life.conversations.activeConversation.id)
				);
			const assertFooterOwnership = async () => {
				const names = await page.evaluate(() =>
					life.conversations.activeMessages
						.filter((m) => m.role === 'assistant' && m.content)
						.map((m) => m.modelInfo.displayName)
				);
				await page.waitForFunction((names) => {
					// Agentic turns may share one rendered footer; every visible name must be owned.
					const labels = [...document.querySelectorAll('.llampart-message-model-badge')].map((b) =>
						b.textContent.trim()
					);
					return (
						labels.length > 0 &&
						labels.every((name) => names.includes(name)) &&
						labels[0] === names[0] &&
						labels.at(-1) === names.at(-1)
					);
				}, names);
				assert.equal(
					await page.locator('.assistant-message-footer .llampart-model-selector-trigger').count(),
					0
				);
			};
			hold = true;
			await start('Synthetic abort A');
			await page.waitForFunction(() =>
				life.conversations.activeMessages.some((m) => m.content === 'Synthetic partial or final')
			);
			await page.evaluate(() => life.models.selectModelById('Gemma-Test-B'));
			await page.locator('.llampart-composer-stop-action').click();
			await done();
			hold = false;
			const aborted = (await rows()).find((m) => m.role === 'assistant');
			assert.equal(aborted.model, ids[0]);
			assert.equal(aborted.modelInfo.modelId, ids[0]);
			await page.evaluate(() => life.models.selectModelById('Gemma-Test-B'));
			await start('Synthetic after abort B');
			await done();
			let all = await rows();
			const b = all.filter((m) => m.role === 'assistant').at(-1);
			assert.equal(b.model, ids[1]);
			assert.equal(b.modelInfo.modelId, ids[1]);
			assert.deepEqual(all.find((m) => m.id === aborted.id).modelInfo, aborted.modelInfo);
			await assertFooterOwnership();
			results.push(`PASS ${provider} MODEL-11: actual Stop/partial stream A, next B isolated`);
			if (provider === 'llama-server') {
				const resumed = await page.evaluate(async (message) => {
					const { ChatService } = await import('/src/lib/services/chat.service.ts');
					const { createSourceFingerprint, saveResumableStreamState } =
						await import('/src/lib/utils/resumable-stream-state.ts');
					// Synthetic persisted checkpoint, resumed by the real HTTP lookup/GET path.
					saveResumableStreamState({
						schemaVersion: 2,
						conversationId: message.convId,
						assistantMessageId: message.id,
						providerId: 'llama-server',
						sourceFingerprint: await createSourceFingerprint(
							ChatService.createProviderRequestContext()
						),
						streamIdentity: 'synthetic-resume',
						model: 'Qwen-Test-A',
						bytesReceived: 0,
						updatedAt: Date.now()
					});
					await life.chat.resumeStreamForChat(message.convId);
					return (await life.db.getConversationMessages(message.convId)).find(
						(m) => m.id === message.id
					);
				}, aborted);
				assert(resumed.content.endsWith(' resumed'));
				assert.deepEqual(resumed.modelInfo, aborted.modelInfo);
				assert.equal(resumed.model, ids[0]);
				assert(requests.some((r) => r.includes('/streams/lookup')));
				assert(requests.some((r) => r.includes('/stream?conv_id=synthetic-resume')));
				results.push(
					'PASS llama-server MODEL-12: real HTTP resume/checkpoints with selected B preserves persisted A'
				);
			}
			await page.evaluate(() => life.models.selectModelById('Qwen-Test-A'));
			responseModel = ids[1];
			await start('Synthetic mismatched identity');
			await done();
			all = await rows();
			const mismatch = all.filter((m) => m.role === 'assistant').at(-1);
			assert.equal(mismatch.model, ids[1]);
			assert.equal(mismatch.modelInfo.identity, 'response-only');
			assert.equal(mismatch.modelInfo.native, undefined);
			assert.equal(mismatch.modelInfo.contextSize, undefined);
			await assertFooterOwnership();
			results.push(`PASS ${provider} PROV-10: response B replaces requested A without A details`);
			responseModel = null;
			// Real agentic lifecycle and database, only the tool registry/executor is synthetic.
			await page.evaluate(async () => {
				const { agenticStore: agent } = await import('/src/lib/stores/agentic.svelte.ts');
				const { toolsStore: tools } = await import('/src/lib/stores/tools.svelte.ts');
				const { permissionsStore: permissions } =
					await import('/src/lib/stores/permissions.svelte.ts');
				const { mcpStore: mcp } = await import('/src/lib/stores/mcp.svelte.ts');
				agent.getConfig = () => ({ enabled: true, maxTurns: 4, maxToolPreviewLines: 10 });
				tools.hasBuiltinToolsForContext = () => true;
				tools.getEnabledToolEntriesForLLM = () => [
					{
						key: 'builtin:synthetic',
						apiName: 'synthetic',
						source: 'builtin',
						definition: {
							type: 'function',
							function: { name: 'synthetic', parameters: { type: 'object' } }
						}
					}
				];
				tools.validateToolExecution = () => {};
				permissions.hasTool = () => true;
				mcp.hasEnabledServers = () => false;
				tools.executeTool = async () => {
					life.toolEntered = true;
					await new Promise((resolve) => (life.releaseTool = resolve));
					return { content: 'Synthetic confirmed tool result' };
				};
			});
			await page.evaluate(() => life.models.selectModelById('Qwen-Test-A'));
			toolsRemaining = 1;
			await start('Synthetic agentic A');
			await page.waitForFunction(() => life.toolEntered);
			await page.evaluate(() => life.models.selectModelById('Gemma-Test-B'));
			await page.evaluate(() => life.releaseTool());
			await done();
			all = await rows();
			const agentic = all.filter((m) => m.agentic);
			assert.equal(agentic.length, 2);
			assert(agentic.every((m) => m.model === ids[0] && m.modelInfo.modelId === ids[0]));
			assert.deepEqual(agentic[0].modelInfo, agentic[1].modelInfo);
			assert(all.filter((m) => m.role === 'tool').every((m) => m.modelInfo === undefined));
			results.push(
				`PASS ${provider} MODEL-13: both real agentic assistant turns retain A through selected B, tool results have no modelInfo`
			);
			await page.evaluate(async () => {
				const { agenticStore } = await import('/src/lib/stores/agentic.svelte.ts');
				agenticStore.getConfig = () => ({ enabled: false });
				await life.models.selectModelById('Qwen-Test-A');
			});
			hold = true;
			await start('Synthetic pending provider switch');
			await page.waitForFunction(
				() => life.conversations.activeMessages.at(-1)?.content === 'Synthetic partial or final'
			);
			const pendingId = await page.evaluate(() => life.conversations.activeMessages.at(-1).id);
			const nextProvider = provider === 'openai-compatible' ? 'vllm' : 'openai-compatible';
			await page.evaluate(async (next) => {
				life.settings.updateMultipleConfig({ apiProvider: next });
				life.models.clear();
				life.server.clear();
				life.ChatService.invalidateProviderRequestContexts();
			}, nextProvider);
			hold = false;
			for (const response of heldResponses)
				if (!response.destroyed) response.end('data: [DONE]\n\n');
			await done();
			const pending = (await rows()).find((m) => m.id === pendingId);
			assert.equal(pending.modelInfo.providerId, provider);
			assert.equal(pending.modelInfo.modelId, ids[0]);
			await page.evaluate(async () => {
				await life.models.refreshBackend();
				await life.models.selectModelById('Gemma-Test-B');
			});
			await start('Synthetic new provider B');
			await done();
			all = await rows();
			const next = all.filter((m) => m.role === 'assistant').at(-1);
			assert.equal(next.modelInfo.providerId, nextProvider);
			assert.equal(next.modelInfo.modelId, ids[1]);
			assert.equal(next.modelInfo.native, undefined);
			assert.deepEqual(all.find((m) => m.id === pendingId).modelInfo, pending.modelInfo);
			await assertFooterOwnership();
			results.push(
				`PASS ${provider} PROV-09: HTTP pending A retains original provider after switch, next provider/B isolated`
			);
			assert.deepEqual(errors, []);
			assert.deepEqual(await page.evaluate(() => auditRejections), []);
			await writeFile(
				`${out}/${provider}.json`,
				JSON.stringify({ results, requests, rows: all, errors }, null, 2)
			);
		} catch (error) {
			const page = context.pages()[0];
			await writeFile(
				`${out}/${provider}-failure.json`,
				JSON.stringify(
					{
						error: String(error),
						requests,
						errors,
						state: await page.evaluate(async () => ({
							text: document.body.innerText,
							rows: await life.db.getConversationMessages(life.conversations.activeConversation.id),
							error: life.chat.errorDialogState,
							loading: life.chat.isLoading
						}))
					},
					null,
					2
				)
			);
			throw error;
		} finally {
			await context.close();
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
		}
	}
} finally {
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
console.log(results.join('\n'));
