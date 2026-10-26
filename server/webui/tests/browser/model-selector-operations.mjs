/** Synthetic selector regression: search, favorites persistence, native load/unload. */
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
try {
	for (const provider of ['llama-server', 'vllm', 'openai-compatible'])
		for (const width of [1440, 390]) {
			const requests = [],
				errors = [];
			let loaded = false;
			const server = createServer(async (req, res) => {
				const url = new URL(req.url, 'http://synthetic');
				requests.push({ method: req.method, path: url.pathname + url.search });
				const json = (body) => {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(body));
				};
				if (url.pathname.endsWith('/props'))
					return json({
						role: 'router',
						build_info: 'synthetic-selector',
						default_generation_settings: { n_ctx: 8192, params: {} },
						modalities: { vision: false }
					});
				if (url.pathname.endsWith('/models/load')) {
					loaded = true;
					return json({ success: true });
				}
				if (url.pathname.endsWith('/models/unload')) {
					loaded = false;
					return json({ success: true });
				}
				if (url.pathname.endsWith('/models'))
					return json({
						object: 'list',
						data: ['model-A', 'model-B'].map((id, i) => ({
							id,
							status: { value: i === 0 || loaded ? 'loaded' : 'unloaded' }
						}))
					});
				return json([]);
			});
			await new Promise((done) => server.listen(0, '127.0.0.1', done));
			const backend = `http://127.0.0.1:${server.address().port}`;
			const context = await browser.newContext({ viewport: { width, height: 1000 } });
			try {
				await context.addInitScript(
					({ provider, backend }) => {
						globalThis.auditRejections = [];
						addEventListener('unhandledrejection', (e) => auditRejections.push(String(e.reason)));
						localStorage.setItem('llama-webui-migration-v2-done', '1');
						localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
						if (localStorage.getItem('audit-selector-seeded')) return;
						localStorage.setItem('audit-selector-seeded', '1');
						localStorage.setItem(
							'LlamaCppWebui.config',
							JSON.stringify({
								apiProvider: provider,
								serverBaseUrl: backend,
								llamaServerBaseUrl: backend,
								vllmBaseUrl: backend,
								openAiCompatibleBaseUrl: backend,
								interfaceLanguage: 'en',
								theme: 'frosted-glass',
								titleGenerationUseLLM: false
							})
						);
					},
					{ provider, backend }
				);
				const page = await context.newPage();
				page.on('pageerror', (e) => errors.push(e.message));
				await page.goto(process.env.LLAMPART_TEST_URL);
				await page.waitForFunction(
					async () =>
						(await import('/tests/browser/attachment-preview-model-harness.ts')).models.models
							.length === 2
				);
				await page.waitForLoadState('networkidle');
				const trigger = page.locator('.llampart-chat-form-root .llampart-model-selector-trigger');
				assert.equal(await trigger.count(), 1);
				await trigger.click();
				const menu = page.locator('.llampart-model-selector-menu');
				const search = menu.locator('input');
				await search.fill('model-B');
				assert.equal(await page.getByRole('option').count(), 1);
				let option = page.getByRole('option').filter({ hasText: 'model-B' });
				await option.hover();
				await option.locator('button[aria-label="Add to favorites"]').click();
				await page.waitForFunction(async () =>
					(await import('/tests/browser/attachment-preview-model-harness.ts')).models.isFavorite(
						'model-B'
					)
				);
				option = page.getByRole('option').filter({ hasText: 'model-B' });
				if (provider === 'llama-server') {
					await option.hover();
					await option.locator('button[aria-label="Load model"]').click();
					await page.waitForFunction(async () => {
						const { models: m } =
							await import('/tests/browser/attachment-preview-model-harness.ts');
						return m.isModelLoaded('model-B') && !m.isModelOperationInProgress('model-B');
					});
					await option.hover();
					await option.locator('button[aria-label="Unload model"]').click();
					await page.waitForFunction(async () => {
						const { models: m } =
							await import('/tests/browser/attachment-preview-model-harness.ts');
						return !m.isModelLoaded('model-B') && !m.isModelOperationInProgress('model-B');
					});
					assert.equal(requests.filter((r) => r.path.endsWith('/models/load')).length, 1);
					assert.equal(requests.filter((r) => r.path.endsWith('/models/unload')).length, 1);
				} else {
					assert.equal(
						await menu.getByRole('button', { name: /^(Load|Unload) model$/ }).count(),
						0
					);
					assert(!requests.some((r) => r.path.includes('/props')));
				}
				await page.screenshot({ path: `${out}/${provider}-${width}-favorites-search.png` });
				await search.fill('model-A');
				await page.getByRole('option').filter({ hasText: 'model-A' }).click();
				await menu.waitFor({ state: 'hidden' });
				await page.reload();
				await trigger.waitFor();
				await page.waitForLoadState('networkidle');
				assert.equal(
					await page.evaluate(async () =>
						(await import('/tests/browser/attachment-preview-model-harness.ts')).models.isFavorite(
							'model-B'
						)
					),
					true
				);
				assert.equal(await page.locator('.llampart-reasoning-trigger').count(), 0);
				// Keep keyboard selection, focus restoration and model tooltip
				// covered independently of mouse search/favorites/load/unload above.
				await trigger.focus();
				await trigger.press('Enter');
				await search.fill('model-A');
				await search.press('ArrowDown');
				await search.press('ArrowUp');
				await search.press('Enter');
				await menu.waitFor({ state: 'hidden' });
				// Paired HEAD/final inspection confirms the menu restores focus to
				// its trigger in both versions (not to the textarea).
				await page.waitForFunction(() =>
					document.activeElement?.classList.contains('llampart-model-selector-trigger')
				);
				assert.equal(await trigger.getAttribute('aria-label'), 'model-A');
				await trigger.locator('span').first().hover();
				const tooltip = page
					.locator('[data-slot="tooltip-content"]')
					.filter({ hasText: 'model-A' });
				await tooltip.waitFor({ state: 'visible' });
				assert.match(await tooltip.innerText(), /model-A/);
				await page.screenshot({ path: `${out}/${provider}-${width}-keyboard-tooltip.png` });
				await page.mouse.move(1, 1);
				assert.deepEqual(errors, []);
				assert.deepEqual(await page.evaluate(() => auditRejections), []);
				results.push({ provider, width, result: 'PASS', requests, errors });
				console.log(`PASS ${provider} ${width}`);
			} catch (error) {
				for (const page of context.pages()) {
					await page.screenshot({ path: `${out}/${provider}-${width}-failure.png` });
					console.log(
						provider,
						width,
						await page.evaluate(async () => {
							const { models, server } =
								await import('/tests/browser/attachment-preview-model-harness.ts');
							return {
								role: server.role,
								loading: models.loading,
								selected: models.selectedModelName,
								text: document.body.innerText,
								dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) => d.textContent)
							};
						})
					);
				}
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
