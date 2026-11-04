/** AUD-010: real UI/stores/IndexedDB/adapters + local synthetic HTTP, fresh Chromium.
 * Not live model inference. Artifacts must be outside the repository.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium, firefox } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(out, { recursive: true });
const useFirefox = process.env.LLAMPART_TEST_BROWSER === 'firefox';
const browser = await (useFirefox ? firefox : chromium).launch({
	executablePath: useFirefox ? '/usr/bin/firefox' : '/usr/bin/chromium',
	headless: true,
	args: useFirefox ? [] : ['--no-sandbox', '--disable-background-networking']
});
const results = [];
const ids = { A: 'Qwen3.8-27B-Q8_0', B: 'Gemma-Test-B' };
function properties(version) {
	return {
		role: 'model',
		model_alias: ids[version],
		model_path: `/synthetic/models/vendor/releases/${ids[version]}.gguf`,
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
				const model =
					returnedModel ??
					(provider === 'llama-server' && v === 'A' ? properties(v).model_path : ids[v]);
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
							showMessageStats: true,
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
			// Capture the clipboard boundary, not OS permissions; the UI copy path remains real.
			await page.evaluate(() => {
				globalThis.copiedModelNames = [];
				Object.defineProperty(navigator.clipboard, 'writeText', {
					value: async (text) => copiedModelNames.push(text),
					configurable: true
				});
			});
			const footers = page.locator('.assistant-message-footer-meta');
			const badges = footers.locator('.llampart-message-model-badge');
			const footerName = async (index, name) => {
				await page.waitForFunction(
					({ index, name }) => {
						const badge = document.querySelectorAll('.llampart-message-model-badge')[index];
						return badge?.textContent.trim() === name;
					},
					{ index, name }
				);
				assert.equal(await footers.locator('.llampart-model-selector-trigger').count(), 0);
				assert.equal(await badges.nth(index).locator('svg').count(), 1);
				assert.equal(await badges.nth(index).locator('button').count(), 0);
			};
			const assertModelTooltip = async (index, name) => {
				if (
					width >= 768 &&
					(await page.locator('[data-slot="sidebar"][data-state="expanded"]').count()) > 0
				) {
					await page.keyboard.press('Control+b');
					await page
						.locator('[data-slot="sidebar"][data-state="collapsed"]')
						.waitFor({ state: 'attached' });
				}
				assert.equal(await badges.nth(index).getAttribute('title'), null, 'No native tooltip');
				await badges.nth(index).hover();
				const tooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: name });
				await tooltip.waitFor();
				assert.equal(
					(await tooltip.innerText()).trim(),
					name,
					'Standard tooltip contains only the model name'
				);
				assert.equal(await tooltip.getAttribute('data-slot'), 'tooltip-content');
				assert.equal(
					await tooltip.locator('div.rotate-45[data-side]').count(),
					1,
					'Shared tooltip arrow'
				);
				await tooltip.evaluate((el) =>
					Promise.all(el.getAnimations().map((animation) => animation.finished))
				);
				const tooltipClass = await tooltip.getAttribute('class');
				const tooltipSide = await tooltip.getAttribute('data-side');
				await page.screenshot({
					path: `${out}/${label}-model-tooltip-${router ? 'ROUTER' : 'MODEL'}.png`
				});
				await page
					.locator('.llampart-message-actions-assistant')
					.nth(index)
					.locator('button[aria-label="Download response as Markdown"]')
					.hover();
				const downloadTooltip = page
					.locator('[data-slot="tooltip-content"]')
					.filter({ hasText: 'Download response as Markdown' });
				await downloadTooltip.waitFor();
				assert.equal(
					await downloadTooltip.getAttribute('class'),
					tooltipClass,
					'Same appearance as Markdown action'
				);
				assert.equal(
					await downloadTooltip.getAttribute('data-side'),
					tooltipSide,
					'Same placement as Markdown action'
				);
				assert.equal(await downloadTooltip.locator('div.rotate-45[data-side]').count(), 1);
				await page.mouse.move(width / 2, 20);
				await page.keyboard.press('Escape');
			};
			if (
				width >= 768 &&
				(await page.locator('[data-slot="sidebar"][data-state="expanded"]').count()) > 0
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
				await footerName(index, ids[version]);
				await page.evaluate(() => new Promise(requestAnimationFrame));
				await page.waitForFunction(() => !modelAudit.models.loading && !modelAudit.models.updating);
				// Settle independent LIVE composer/catalog activity first.
				await page.waitForTimeout(250);
				await page.waitForLoadState('networkidle');
				await page.mouse.move(width / 2, 20);
				await page.keyboard.press('Escape');
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
			assert.equal(a.model, provider === 'llama-server' ? `${ids.A}.gguf` : ids.A);
			assert.equal(
				a.modelInfo.modelId,
				provider === 'llama-server' ? properties('A').model_path : ids.A
			);
			for (const showRawModelNames of [false, true]) {
				await page.evaluate(
					(value) => modelAudit.settings.updateMultipleConfig({ showRawModelNames: value }),
					showRawModelNames
				);
				await footerName(0, ids.A);
				await badges.first().press('Enter');
				assert.equal(await page.evaluate(() => copiedModelNames.at(-1)), ids.A);
				await assertModelTooltip(0, ids.A);
			}
			const modelBadgeMarkup = await badges.first().innerHTML();
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
				[a.model, ids.B]
			);
			assert.deepEqual(assistants[0].modelInfo, a.modelInfo);
			await page.evaluate(async () => modelAudit.models.refreshBackend());
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
				await footerName(0, ids.A);
				assert.equal(
					await badges.first().innerHTML(),
					modelBadgeMarkup,
					'MODEL/ROUTER badge markup'
				);
				for (const value of [false, true]) {
					await page.evaluate(
						(showRawModelNames) => modelAudit.settings.updateMultipleConfig({ showRawModelNames }),
						value
					);
					await footerName(0, ids.A);
					await assertModelTooltip(0, ids.A);
				}
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
				// Ordinary regeneration retains its existing contract: B must already be loaded.
				await search.fill(ids.B);
				option = page.getByRole('option').filter({ hasText: ids.B });
				await option.hover();
				await option.locator('button[aria-label="Load model"]').click();
				await page.waitForFunction(
					() =>
						modelAudit.models.isModelLoaded('Gemma-Test-B') &&
						!modelAudit.models.isModelOperationInProgress('Gemma-Test-B')
				);
				await page.keyboard.press('Escape');
				// Ordinary message action still regenerates B and creates a sibling branch.
				await page
					.locator('.llampart-message-actions-assistant')
					.last()
					.locator('button[aria-label="Regenerate"]')
					.press('Enter');
				await page.waitForFunction(
					(oldId) =>
						!modelAudit.chat.isLoading &&
						modelAudit.conversations.activeMessages.at(-1)?.model === 'Gemma-Test-B' &&
						modelAudit.conversations.activeMessages.at(-1)?.id !== oldId,
					assistants[1].id
				);
				assert.equal((await messages()).filter((m) => m.role === 'assistant').length, 3);
				await inspect(1, 'B', 'regenerated-ROUTER');
				assert.equal(
					(await messages()).filter(
						(m) => m.parent === assistants[1].parent && m.role === 'assistant'
					).length,
					2
				);
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
				assert.equal(await page.evaluate((id) => modelAudit.models.isFavorite(id), ids.A), true);
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
			const patchFirst = async (patch) =>
				page.evaluate(async (patch) => {
					const m = modelAudit.conversations.activeMessages.find((m) => m.role === 'assistant');
					await modelAudit.db.updateMessage(m.id, patch);
					modelAudit.conversations.updateMessageAtIndex(
						modelAudit.conversations.findMessageIndex(m.id),
						patch
					);
				}, patch);
			await patchFirst({ model: 'wrong-legacy-name' });
			await footerName(0, ids.A); // Snapshot presentation wins over message.model.
			const longName = `Qwen-${'variant-'.repeat(50)}27B-Q8_0`;
			await patchFirst({ modelInfo: { ...a.modelInfo, displayName: longName } });
			await footerName(0, longName);
			assert(
				await badges.first().evaluate((el) => {
					const rect = el.getBoundingClientRect();
					return (
						rect.right <= innerWidth &&
						rect.width <= el.closest('.assistant-message-footer-left').clientWidth
					);
				}),
				'Long name must stay inside footer/viewport'
			);
			await page.screenshot({ path: `${out}/${label}-long-name.png` });
			await page.evaluate(() =>
				Object.defineProperty(navigator.clipboard, 'writeText', {
					value: async (text) => {
						globalThis.lastCopiedName = text;
					},
					configurable: true
				})
			);
			const separated = 'org/model:variant:Q8_0';
			await patchFirst({ modelInfo: { ...a.modelInfo, displayName: separated } });
			await footerName(0, separated);
			await badges.first().press('Space');
			assert.equal(await page.evaluate(() => lastCopiedName), separated);
			if (provider === 'llama-server') {
				router = false;
				await page.evaluate(async () => modelAudit.models.refreshBackend());
			}
			assert.equal(await page.evaluate(() => modelAudit.models.singleModelName), ids.B);
			await patchFirst({
				modelInfo: {
					...a.modelInfo,
					identity: 'unavailable',
					modelId: null,
					displayName: null,
					native: undefined
				},
				timings: { predicted_n: 12, predicted_ms: 1000 }
			});
			await footerName(0, 'Unknown Model');
			assert(await badges.first().isDisabled());
			assert(await footers.first().locator('.llampart-chat-message-statistics').isVisible());
			await page.screenshot({ path: `${out}/${label}-unknown-with-stats.png` });
			await patchFirst({ modelInfo: undefined, model: undefined });
			await footerName(0, 'Unknown Model');
			assert(await badges.first().isDisabled());
			assert(await footers.first().locator('.llampart-chat-message-statistics').isVisible());
			if (provider === 'llama-server') {
				router = true;
				await page.evaluate(async () => modelAudit.models.refreshBackend());
				await footerName(0, 'Unknown Model');
			}
			await patchFirst({ model: a.model, modelInfo: a.modelInfo, timings: a.timings });
			results.push(
				`PASS ${label} footer presentation/clipboard/legacy/unknown/stats/long-name ownership`
			);
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
			const disconnected = await page.evaluate(async () => {
				try {
					await modelAudit.models.refreshBackend();
					return false;
				} catch {
					return true;
				}
			});
			assert(disconnected, 'Synthetic provider must actually be offline');
			await inspect(0, 'A', 'backend-offline');
			await inspect(1, 'B', 'backend-offline');
			await page.reload();
			await page.locator('textarea').first().waitFor();
			await setup();
			await inspect(0, 'A', 'offline-reload');
			await inspect(1, 'B', 'offline-reload');
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
			const page = context.pages()[0];
			await writeFile(
				`${out}/${label}-failure.json`,
				JSON.stringify(
					{
						error: String(error),
						requests,
						errors,
						consoleErrors,
						state: await page.evaluate(() => ({
							text: document.body.innerText,
							messages: globalThis.modelAudit?.conversations.activeMessages,
							error: globalThis.modelAudit?.chat.errorDialogState
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
			if (server.listening) await new Promise((done) => server.close(done));
		}
	}
} finally {
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
console.log(results.join('\n'));
