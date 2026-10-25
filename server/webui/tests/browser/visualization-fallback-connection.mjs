/** Real app, Chromium, SSE, IndexedDB and backend-only outages.
 * Frontend assets remain available: an API outage is not an offline web host.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/browser/visualization-fallback-connection.mjs
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const artifacts =
	process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-fallback-connection';
await mkdir(artifacts, { recursive: true });
const fence = (language, source) => `\`\`\`${language}\n${source}\n\`\`\``;
const diagram = 'flowchart LR\n%% title: Local diagram\nA[Browser] --> B[Saved conversation]';
const chart = JSON.stringify({
	type: 'bar',
	title: 'Local chart',
	xKey: 'x',
	series: [{ key: 'y', label: 'Value' }],
	data: [{ x: 'A', y: 12 }]
});
const sources = [
	['mermaid', 'flowchart LR\n%% title: Syntax failure\nA[broken'],
	['mermaid', 'flowchart LR\n' + '%% line\n'.repeat(1201)],
	['mermaid', 'flowchart LR\n' + 'X'.repeat(50 * 1024)],
	['llampart-chart', '{"invalid":' + 'X'.repeat(16000)],
	['llampart-chart', '{"title":"Safe <img> title","type":"unsupported"}']
];
const content = [
	fence('mermaid', diagram),
	fence('llampart-chart', chart),
	...sources.map(([lang, source]) => fence(lang, source)),
	'After visualizations.'
].join('\n\n');
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
try {
	for (const [provider, label] of [
		['llama-server', 'llama-server'],
		['openai-compatible', 'OpenAI-compatible'],
		['vllm', 'vLLM']
	]) {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 1000 },
			permissions: ['clipboard-read', 'clipboard-write'],
			acceptDownloads: true
		});
		await context.addInitScript(
			({ provider }) => {
				if (!localStorage.getItem('LlamaCppWebui.config'))
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							apiProvider: provider,
							serverBaseUrl: 'http://outage.test',
							llamaServerBaseUrl: 'http://outage.test',
							openAiCompatibleBaseUrl: 'http://outage.test',
							vllmBaseUrl: 'http://outage.test',
							theme: 'frosted-glass',
							interfaceLanguage: 'en',
							titleGenerationUseLLM: false,
							askForTitleConfirmation: false
						})
					);
				sessionStorage.setItem(
					'document-loads',
					String(Number(sessionStorage.getItem('document-loads') || 0) + 1)
				);
			},
			{ provider }
		);
		let state = 'healthy',
			generations = 0;
		await context.route('**/__llampart/api/**', (route) => {
			if (state === 'offline') return route.abort('connectionrefused');
			if (state === 'auth') return route.fulfill({ status: 401, json: {} });
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/chat/completions')) {
				generations++;
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
				});
			}
			return route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'outage-test',
							model_path: 'test.gguf',
							default_generation_settings: { params: {} }
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'test.gguf', object: 'model' }] }
						: []
			});
		});
		const page = await context.newPage();
		await page.addLocatorHandler(
			page.locator('.llampart-about-dialog-content'),
			async (welcome) => {
				await welcome.locator('#about-llampart-do-not-show-again').check();
				await welcome.getByRole('button', { name: 'OK', exact: true }).click();
			}
		);
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(base);
		await page.locator('textarea').first().fill('Saved visualizations');
		await page.locator('textarea').first().press('Enter');
		const assistant = page.locator('.llampart-assistant-markdown').first();
		async function ready() {
			try {
				await assistant
					.locator('.llampart-chart-frame .chart-plot svg')
					.first()
					.waitFor({ timeout: 60000 });
			} catch (error) {
				await page.screenshot({ path: `${artifacts}/${provider}-failure.png` });
				console.error({ errors, body: (await page.locator('body').innerText()).slice(-3000) });
				throw error;
			}
			await assistant.locator('.diagram-surface svg').waitFor({ timeout: 60000 });
			await page.waitForFunction(
				() => document.querySelectorAll('.llampart-visualization-fallback').length === 5
			);
		}
		await ready();
		assert.equal(
			await assistant.locator('pre').count(),
			0,
			'Source is not automatically inserted in the message'
		);
		assert.equal(await assistant.locator('img').count(), 0, 'Unvalidated titles remain text');
		assert((await assistant.innerText()).includes('Safe <img> title'));
		if (provider === 'llama-server') {
			// Frosted Glass has a floating sidebar; close it using the real shortcut
			// before checking narrow message actions rather than forcing clicks through it.
			await page.keyboard.press('Control+b');
			for (const width of [1440, 390]) {
				await page.setViewportSize({ width, height: width === 390 ? 700 : 1000 });
				const fallbacks = assistant.locator('.llampart-visualization-fallback');
				for (let i = 0; i < sources.length; i++) {
					const fallback = fallbacks.nth(i);
					const show = fallback.getByRole('button', { name: 'Show code', exact: true });
					await show.evaluate((el) => el.scrollIntoView({ block: 'center' }));
					try {
						await show.click();
					} catch (error) {
						await page.screenshot({ path: `${artifacts}/source-action-failure-${width}.png` });
						console.error(
							await show.evaluate((el) => ({
								button: el.getBoundingClientRect().toJSON(),
								message: el
									.closest('.llampart-assistant-markdown')
									.getBoundingClientRect()
									.toJSON(),
								viewport: innerWidth
							}))
						);
						throw error;
					}
					assert.equal(await page.locator('.visualization-source').textContent(), sources[i][1]);
					const dimensions = await page.locator('.visualization-source-scroll').evaluate((el) => ({
						width: el.clientWidth,
						height: el.clientHeight,
						scrollWidth: el.scrollWidth,
						scrollHeight: el.scrollHeight,
						dialog: el.closest('[role="dialog"]').getBoundingClientRect().toJSON(),
						viewportWidth: innerWidth,
						viewportHeight: innerHeight
					}));
					assert(dimensions.dialog.width <= dimensions.viewportWidth);
					assert(dimensions.dialog.height <= dimensions.viewportHeight * 0.81);
					if (i === 1)
						assert(dimensions.scrollHeight > dimensions.height, 'Vertical source scrolling');
					if (i === 2 || i === 3)
						assert(dimensions.scrollWidth > dimensions.width, 'Unbroken source scrolling');
					if (i === 1 || i === 2)
						await page.screenshot({ path: `${artifacts}/source-${width}-${i}.png` });
					await page.keyboard.press('Escape');
					await page.locator('.visualization-source').waitFor({ state: 'hidden' });
					assert(
						await show.evaluate((el) => el === document.activeElement),
						'Focus returns to the source action'
					);
					await fallback.getByRole('button', { name: 'Copy code', exact: true }).click();
					assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sources[i][1]);
				}
				assert(
					await assistant.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
					'No message width expansion'
				);
				assert(
					await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
					'No page overflow'
				);
				await page.screenshot({ path: `${artifacts}/fallback-${width}.png` });
			}
			await page.setViewportSize({ width: 1440, height: 1000 });
		}
		await ready();
		// Remember live SVG identity before changing backend availability.
		await page.evaluate(() => {
			window.savedDiagram = document.querySelector('.diagram-surface').shadowRoot.firstElementChild;
		});
		state = 'offline';
		const check = () =>
			page.evaluate(async () => {
				const { connection } = await import('/tests/browser/charts-harness.ts');
				await connection.check();
			});
		await check();
		const notice = page.locator('.llampart-provider-connection-notice');
		try {
			await notice.waitFor();
		} catch (error) {
			await page.screenshot({ path: `${artifacts}/${provider}-notice-failure.png` });
			console.error(
				await page.evaluate(async () => {
					const { connection: store } = await import('/tests/browser/charts-harness.ts');
					return {
						status: store.status,
						disconnected: store.hasDisconnected,
						error: store.errorMessage,
						body: document.body.innerText.slice(-1500)
					};
				})
			);
			throw error;
		}
		assert.equal(await notice.count(), 1);
		assert((await notice.innerText()).includes(label));
		assert.equal(await notice.getByRole('button').count(), 2);
		assert.equal(await notice.getByText('Retry', { exact: true }).count(), 0);
		await page.screenshot({ path: `${artifacts}/${provider}-offline.png` });
		assert(
			await page.evaluate(
				() =>
					document.querySelector('.diagram-surface').shadowRoot.firstElementChild ===
					window.savedDiagram
			)
		);
		if (provider === 'llama-server') {
			await page.setViewportSize({ width: 390, height: 700 });
			assert(
				await notice.evaluate((el) => {
					const rect = el.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= innerWidth && el.scrollWidth <= el.clientWidth;
				})
			);
			await page.screenshot({ path: `${artifacts}/connection-mobile.png` });
		}
		const loads = await page.evaluate(() => Number(sessionStorage.getItem('document-loads')));
		await notice.getByRole('button', { name: 'Refresh page', exact: true }).click();
		await page.waitForFunction(
			(loads) => Number(sessionStorage.getItem('document-loads')) > loads,
			loads
		);
		await ready(); // Cold renderer imports and IndexedDB load with API still unavailable.
		await notice.waitFor();
		await notice.getByRole('button', { name: 'Connection settings', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await dialog.waitFor();
		assert((await dialog.innerText()).includes(label));
		assert.equal(
			await dialog
				.locator('input')
				.evaluateAll(
					(inputs) => inputs.filter((input) => input.value === 'http://outage.test').length
				),
			1
		);
		await page.keyboard.press('Escape');
		await dialog.waitFor({ state: 'hidden' });
		if (provider === 'llama-server') {
			state = 'healthy';
			await notice.waitFor({ state: 'hidden', timeout: 20000 });
			state = 'offline';
			await check();
			await notice.waitFor();
		}
		state = 'auth';
		await check();
		await notice.getByText(`Server authentication failed · ${label}`, { exact: true }).waitFor();
		state = 'healthy';
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await notice.waitFor({ state: 'hidden' });
		assert(!(await page.locator('textarea').first().isDisabled()));
		const saved = await page.evaluate(async () => {
			const { conversations } = await import('/tests/browser/charts-harness.ts');
			return conversations.activeMessages.find((message) => message.role === 'assistant').content;
		});
		assert.equal(saved, content, 'Original persisted content is unchanged');
		assert.equal(generations, 1, 'No automatic model repair or regeneration');
		assert.deepEqual(errors, []);
		await context.close();
		console.log(
			`PASS ${provider}: fallback, saved local visualizations during API outage, reload, matching settings, authentication and recovery`
		);
	}
} finally {
	await browser.close();
}
