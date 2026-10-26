/** AUD-010: real UI/stores/IndexedDB/adapters + local synthetic HTTP, fresh Chromium.
 * Not live model inference. Artifacts must be outside the repository.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
const ids = { A: 'Qwen-Test-A', B: 'Gemma-Test-B' };
function properties(version) {
	return {
		role: 'model',
		model_alias: ids[version],
		model_path: `/synthetic/models/${version === 'A' ? 'qwen-a' : 'gemma-b'}.gguf`,
		default_generation_settings: { n_ctx: version === 'A' ? 65536 : 32768, params: {} },
		total_slots: version === 'A' ? 2 : 4,
		build_info: `build-${version}`,
		chat_template: `template-${version}`,
		modalities: { vision: version === 'A', audio: false, video: false }
	};
}
const cases = [
	['llama-server', 'chat-completions', 1440],
	['llama-server', 'chat-completions', 390],
	['vllm', 'chat-completions', 1440],
	['vllm', 'responses', 390],
	['openai-compatible', 'chat-completions', 390],
	['openai-compatible', 'responses', 1440]
];
try {
	for (const [provider, protocol, width] of cases) {
		const label = `${provider}-${protocol}-${width}`;
		let active = 'A',
			router = false,
			returnedModel = null,
			hold = false;
		const loaded = new Set(['A']);
		const requests = [],
			errors = [],
			consoleErrors = [];
		const server = createServer(async (req, res) => {
			const url = new URL(req.url, 'http://synthetic');
			requests.push({ method: req.method, path: url.pathname + url.search });
			const json = (body) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(body));
			};
			let body = {};
			if (req.method === 'POST') {
				let raw = '';
				for await (const chunk of req) raw += chunk;
				body = JSON.parse(raw || '{}');
			}
			if (url.pathname.endsWith('/props'))
				return json(
					router && !url.searchParams.has('model')
						? { ...properties(active), role: 'router' }
						: properties(
								url.searchParams.get('model') === ids.B
									? 'B'
									: url.searchParams.get('model') === ids.A
										? 'A'
										: active
							)
				);
			if (url.pathname.endsWith('/models/load')) {
				loaded.add(body.model === ids.A ? 'A' : 'B');
				return json({ success: true });
			}
			if (url.pathname.endsWith('/models/unload')) {
				loaded.delete(body.model === ids.A ? 'A' : 'B');
				return json({ success: true });
			}
			if (url.pathname.endsWith('/models'))
				return json({
					object: 'list',
					data: (provider === 'llama-server' && !router ? [active] : ['A', 'B']).map((v) => ({
						id: ids[v],
						status: { value: loaded.has(v) ? 'loaded' : 'unloaded' },
						context_length: v === 'A' ? 65536 : 32768,
						meta: {
							n_ctx_train: v === 'A' ? 131072 : 65536,
							size: v === 'A' ? 5000000000 : 3000000000,
							n_params: v === 'A' ? 8000000000 : 4000000000,
							n_embd: 4096,
							n_vocab: 128000,
							vocab_type: 'bpe'
						},
						capabilities: protocol === 'responses' ? { required_protocol: 'responses' } : {}
					}))
				});
			if (url.pathname.endsWith('/chat/completions') || url.pathname.endsWith('/responses')) {
				const v = body.model === ids.B ? 'B' : body.model === ids.A ? 'A' : active;
				const model = returnedModel ?? ids[v];
				const content = `Synthetic answer ${v}`;
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				if (protocol === 'responses')
					res.write(
						`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'synthetic-response', model, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }] } })}\n\n`
					);
				else
					res.write(
						`data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { content, reasoning_content: `Synthetic reasoning ${v}` }, finish_reason: hold ? null : 'stop' }] })}\n\n`
					);
				if (hold) return;
				return res.end('data: [DONE]\n\n');
			}
			json([]);
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const backend = `http://127.0.0.1:${server.address().port}`;
		const context = await browser.newContext({ viewport: { width, height: 1000 } });
		try {
			await context.addInitScript(
				({ provider, backend }) => {
					globalThis.auditRejections = [];
					addEventListener('unhandledrejection', (event) =>
						auditRejections.push(String(event.reason))
					);
					if (localStorage.getItem('aud010-seeded')) return;
					localStorage.setItem('aud010-seeded', '1');
					localStorage.setItem('llama-webui-migration-v2-done', '1');
					localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							apiProvider: provider,
							serverBaseUrl: backend,
							llamaServerBaseUrl: backend,
							vllmBaseUrl: backend,
							openAiCompatibleBaseUrl: backend,
							theme: 'frosted-glass',
							interfaceLanguage: 'en',
							preEncodeConversation: false,
							titleGenerationUseLLM: false,
							askForTitleConfirmation: false,
							showThoughtInProgress: true,
							alwaysShowSidebarOnDesktop: false
						})
					);
				},
				{ provider, backend }
			);
			const page = await context.newPage();
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') consoleErrors.push(message.text());
			});
			await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
			await page.locator('textarea').first().waitFor();
			await page.waitForFunction(
				async () =>
					(await import('/tests/browser/attachment-preview-model-harness.ts')).models.models
						.length > 0
			);
			const setup = async () =>
				page.evaluate(async () => {
					const stores = await import('/tests/browser/attachment-preview-model-harness.ts');
					const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
					globalThis.modelAudit = { ...stores, db };
				});
			await setup();
			if (
				width >= 768 &&
				(await page.locator('[data-slot="sidebar"][data-state="expanded"]').isVisible())
			)
				await page.keyboard.press('Control+b');
			const messages = () =>
				page.evaluate(async () =>
					modelAudit.db.getConversationMessages(modelAudit.conversations.activeConversation.id)
				);
			const send = async (text) => {
				const before = await page.evaluate(
					() => modelAudit.conversations.activeMessages.filter((m) => m.role === 'assistant').length
				);
				await page.locator('textarea').first().fill(text);
				await page.locator('textarea').first().press('Enter');
				await page.waitForFunction(
					(before) =>
						!modelAudit.chat.isLoading &&
						modelAudit.conversations.activeMessages.filter(
							(m) => m.role === 'assistant' && m.content
						).length > before,
					before
				);
			};
			const info = page.locator('.llampart-assistant-model-info-action');
			const dialog = page
				.getByRole('dialog')
				.filter({ has: page.locator('.llampart-model-info-scroll-viewport') });
			const inspect = async (index, version, suffix, native = provider === 'llama-server') => {
				await page.evaluate(() => new Promise(requestAnimationFrame));
				await page.waitForFunction(() => !modelAudit.models.loading && !modelAudit.models.updating);
				// Branch navigation can schedule the existing selector's catalog refresh
				// after its first paint. Settle that independent LIVE activity first.
				await page.waitForTimeout(250);
				await page.waitForLoadState('networkidle');
				const before = requests.length;
				if (suffix === 'initial' || suffix === 'active-B') await info.nth(index).click();
				else await info.nth(index).press('Enter');
				await dialog.waitFor();
				const text = await dialog.innerText();
				assert(text.includes(ids[version]), text);
				if (native) {
					assert(text.includes(properties(version).model_path), text);
					assert(text.includes(`build-${version}`), text);
					await dialog.locator('summary').click();
					assert((await dialog.innerText()).includes(`template-${version}`));
				} else {
					assert(!text.includes('/synthetic/models'));
					assert(!text.includes('build-'));
				}
				assert.equal(
					requests.length,
					before,
					`Historical info ${suffix} must not fetch metadata: ${JSON.stringify(requests.slice(before))}`
				);
				await page.screenshot({ path: `${out}/${label}-${suffix}-history-${version}.png` });
				await page.keyboard.press('Escape');
				await dialog.waitFor({ state: 'hidden' });
			};
			await send('Synthetic question A');
			let all = await messages();
			const a = all.find((m) => m.role === 'assistant');
			assert.equal(a.model, ids.A);
			assert.equal(a.modelInfo.modelId, ids.A);
			await inspect(0, 'A', 'initial');
			const composer = page.locator('.llampart-chat-form-root .llampart-model-selector-trigger');
			if (provider === 'llama-server') {
				await composer.click();
				await dialog.waitFor();
				assert((await dialog.innerText()).includes('build-A'));
				await page.screenshot({ path: `${out}/${label}-composer-MODEL-A.png` });
				await page.keyboard.press('Escape');
			}
			active = 'B';
			await page.evaluate(async () => modelAudit.models.refreshBackend());
			if (provider !== 'llama-server')
				await page.evaluate(async (id) => modelAudit.models.selectModelById(id), ids.B);
			await send('Synthetic question B');
			all = await messages();
			const assistants = all.filter((m) => m.role === 'assistant');
			assert.deepEqual(
				assistants.map((m) => m.model),
				[ids.A, ids.B]
			);
			assert.deepEqual(assistants[0].modelInfo, a.modelInfo);
			await inspect(0, 'A', 'active-B');
			await inspect(1, 'B', 'active-B');
			await page.screenshot({ path: `${out}/${label}-footers-A-B.png` });
			if (provider === 'llama-server') {
				await composer.click();
				await dialog.waitFor();
				assert((await dialog.innerText()).includes('build-B'));
				await page.screenshot({ path: `${out}/${label}-composer-MODEL-B.png` });
				await page.keyboard.press('Escape');
			}
			results.push(`PASS ${label} MODEL-01/02/03/10 COMP-01/02/03 PROV native/sparse`);
			const conversationId = await page.evaluate(
				() => modelAudit.conversations.activeConversation.id
			);
			const integrity = await page.evaluate(async () => {
				const { createConversationExportEnvelope, parseConversationImport } =
					await import('/src/lib/utils/conversation-import-export.ts');
				const { db, conversations } = modelAudit;
				const conv = await db.getConversation(conversations.activeConversation.id);
				const messages = await db.getConversationMessages(conv.id);
				const envelope = createConversationExportEnvelope([{ conv, messages }], '2.0.1');
				const imported = parseConversationImport(JSON.parse(JSON.stringify(envelope)));
				await db.importConversations(imported);
				const restored = await db.getConversationMessages(conv.id);
				const fork = await db.forkConversation(conv.id, conv.currNode, {
					name: 'Synthetic fork',
					includeAttachments: true
				});
				return {
					original: messages.map((m) => m.modelInfo ?? null),
					restored: restored.map((m) => m.modelInfo ?? null),
					fork: (await db.getConversationMessages(fork.id)).map((m) => m.modelInfo ?? null)
				};
			});
			assert.deepEqual(integrity.original, integrity.restored);
			assert.deepEqual(integrity.original, integrity.fork);
			results.push(`PASS ${label} MODEL-07/09 real IDB export/import/fork`);
			if (provider === 'llama-server') {
				await page.reload();
				await page.locator('textarea').first().waitFor();
				await setup();
				await page.waitForFunction(
					() =>
						modelAudit.conversations.activeMessages.filter((m) => m.role === 'assistant').length ===
						2
				);
				await inspect(0, 'A', 'MODEL-reload');
				await inspect(1, 'B', 'MODEL-reload');
				await composer.click();
				await dialog.waitFor();
				assert((await dialog.innerText()).includes('build-B'));
				await page.screenshot({ path: `${out}/${label}-composer-MODEL-reload-B.png` });
				await page.keyboard.press('Escape');
				router = true;
				await page.evaluate(async () => modelAudit.models.refreshBackend());
				await composer.click();
				const menu = page.locator('.llampart-model-selector-menu');
				await menu.waitFor();
				const search = menu.locator('input');
				await search.fill(ids.A);
				let option = page.getByRole('option').filter({ hasText: ids.A });
				await option.hover();
				await option.locator('button[aria-label="Add to favorites"]').click();
				await search.fill(ids.B);
				option = page.getByRole('option').filter({ hasText: ids.B });
				await option.hover();
				await option.locator('button[aria-label="Load model"]').click();
				await page.waitForFunction(
					async () =>
						modelAudit.models.isModelLoaded('Gemma-Test-B') &&
						!modelAudit.models.isModelOperationInProgress('Gemma-Test-B')
				);
				await option.hover();
				await option.locator('button[aria-label="Unload model"]').click();
				await page.waitForFunction(
					() =>
						!modelAudit.models.isModelLoaded('Gemma-Test-B') &&
						!modelAudit.models.isModelOperationInProgress('Gemma-Test-B')
				);
				await page.screenshot({ path: `${out}/${label}-composer-ROUTER-search-favorites.png` });
				await search.fill(ids.A);
				option = page.getByRole('option').filter({ hasText: ids.A });
				await option.hover();
				await option.locator('button[aria-label="Model information"]').click();
				await dialog.waitFor();
				assert((await dialog.innerText()).includes('build-A'));
				await page.screenshot({ path: `${out}/${label}-ROUTER-live-info-A.png` });
				await page.keyboard.press('Escape');
				await page.keyboard.press('Escape');
				// The pre-existing footer selector still regenerates with the selected model.
				await page
					.locator('.assistant-message-footer-left .llampart-model-selector-trigger')
					.last()
					.press('Enter');
				await menu.waitFor();
				await menu.locator('input').fill(ids.A);
				await page.getByRole('option').filter({ hasText: ids.A }).click();
				await menu.waitFor({ state: 'hidden' });
				await page.waitForFunction(
					() =>
						!modelAudit.chat.isLoading &&
						modelAudit.conversations.activeMessages.at(-1)?.model === 'Qwen-Test-A'
				);
				assert.equal((await messages()).filter((m) => m.role === 'assistant').length, 3);
				await inspect(1, 'A', 'regenerated-ROUTER');
				const oldB = (await messages()).find((m) => m.model === ids.B);
				assert.equal(oldB.modelInfo.native.build_info, 'build-B');
				await page.evaluate(async (id) => {
					await modelAudit.models.unloadModel(id);
				}, ids.A);
				await inspect(0, 'A', 'unloaded-ROUTER');
				results.push(`PASS ${label} MODEL-08 PROV-02/03 COMP-04/05/06/07/08/09`);
			}
			await page.reload();
			await page.locator('textarea').first().waitFor();
			await setup();
			await page.waitForFunction(() =>
				modelAudit.conversations.activeMessages.some((m) => m.role === 'assistant')
			);
			await inspect(0, 'A', 'reload');
			if (provider === 'llama-server')
				await page.evaluate(
					async (id) => modelAudit.conversations.navigateToSibling(id),
					assistants[1].id
				);
			await inspect(1, 'B', 'reload');
			if (provider === 'llama-server') {
				await composer.click();
				await page.locator('.llampart-model-selector-menu').waitFor();
				assert.equal(await page.evaluate(() => modelAudit.models.isFavorite('Qwen-Test-A')), true);
				await page.keyboard.press('Escape');
			}
			await page.evaluate(async (id) => {
				const { conversations, db } = modelAudit;
				const other = await db.createConversation('Synthetic alternate');
				await conversations.loadConversation(other.id);
				await conversations.loadConversation(id);
			}, conversationId);
			await inspect(0, 'A', 'reopen');
			// Old messages never fall back to current global props.
			await page.evaluate(async () => {
				const m = modelAudit.conversations.activeMessages.find((m) => m.role === 'assistant');
				await modelAudit.db.updateMessage(m.id, { modelInfo: undefined });
				modelAudit.conversations.updateMessageAtIndex(
					modelAudit.conversations.findMessageIndex(m.id),
					{ modelInfo: undefined }
				);
			});
			await inspect(0, 'A', 'legacy', false);
			await page.evaluate(async (snapshot) => {
				const m = modelAudit.conversations.activeMessages.find((m) => m.role === 'assistant');
				await modelAudit.db.updateMessage(m.id, { modelInfo: snapshot });
				modelAudit.conversations.updateMessageAtIndex(
					modelAudit.conversations.findMessageIndex(m.id),
					{ modelInfo: snapshot }
				);
			}, a.modelInfo);
			if (provider === 'llama-server')
				await page.evaluate(
					async (id) => modelAudit.conversations.navigateToSibling(id),
					assistants[1].id
				);
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
			await inspect(0, 'A', 'backend-offline');
			await inspect(1, 'B', 'backend-offline');
			assert.deepEqual(errors, []);
			assert.deepEqual(await page.evaluate(() => auditRejections), []);
			assert(!consoleErrors.some((e) => /css|import|uncaught/i.test(e)), consoleErrors.join('\n'));
			results.push(
				`PASS ${label} MODEL-04/05/06/14 COMP-10 pageerror/unhandledrejection/CSS/import`
			);
			await writeFile(
				`${out}/${label}-evidence.json`,
				JSON.stringify({ results, requests, errors, consoleErrors, assistants, integrity }, null, 2)
			);
		} catch (error) {
			results.push(`FAIL ${label}: ${error.stack}`);
			throw error;
		} finally {
			await context.close();
			server.closeAllConnections();
			if (server.listening) await new Promise((done) => server.close(done));
		}
	}
} finally {
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
console.log(results.join('\n'));
