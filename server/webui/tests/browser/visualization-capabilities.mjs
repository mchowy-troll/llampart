/** REAL UI/DOM, renderers, downloads and IndexedDB; MOCK HTTP/SSE provider.
 * Run against dev or production (LLAMPART_TEST_PRODUCTION=1).
 * Requires LLAMPART_PLAYWRIGHT_MODULE; never uses a user's browser profile.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40367';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/task6a-capabilities';
await mkdir(artifacts, { recursive: true });
const production = Boolean(process.env.LLAMPART_TEST_PRODUCTION);
const paths = {
	chart: [
		'/src/lib/charts/chart-schema.ts',
		'/src/lib/components/app/content/ChartBlock.svelte',
		'/src/lib/components/app/content/ChartFrame.svelte'
	],
	diagram: [
		'/src/lib/components/app/content/DiagramBlock.svelte',
		'/src/lib/diagrams/mermaid-policy.ts',
		'/src/lib/diagrams/mermaid-runtime.ts',
		'/node_modules/.vite/deps/mermaid.js'
	]
};
let productionChunks;
if (production) {
	const manifest = JSON.parse(
		await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
	);
	function entry(key) {
		assert(Object.hasOwn(manifest, key), `Lazy-loading manifest: missing entry ${key}`);
		const chunk = manifest[key];
		assert(
			typeof chunk?.file === 'string' && /^_app\/immutable\/.+\.js$/.test(chunk.file),
			`Lazy-loading manifest: invalid JS chunk for ${key}`
		);
		for (const field of ['imports', 'dynamicImports'])
			assert(
				chunk[field] === undefined ||
					(Array.isArray(chunk[field]) && chunk[field].every((key) => typeof key === 'string')),
				`Lazy-loading manifest: invalid ${field} for ${key}`
			);
		return chunk;
	}
	function closure(keys, dynamic = true, seen = new Set(), boundaries = new Set()) {
		for (const key of keys) {
			if (seen.has(key) || boundaries.has(key)) continue;
			const chunk = entry(key);
			seen.add(key);
			closure(chunk.imports || [], dynamic, seen, boundaries);
			if (dynamic) closure(chunk.dynamicImports || [], dynamic, seen, boundaries);
		}
		return [...seen].map((key) => '/' + entry(key).file);
	}
	// Dynamic source entries are keyed by source path; a shared static module
	// such as mermaid-policy instead has a hashed key and a stable `name`.
	const policyKeys = Object.keys(manifest).filter((key) => manifest[key].name === 'mermaid-policy');
	assert.equal(policyKeys.length, 1, 'Lazy-loading manifest: expected one mermaid-policy chunk');
	const roots = {
		chart: paths.chart.map((path) => path.slice(1)),
		diagram: [
			'src/lib/components/app/content/DiagramBlock.svelte',
			'src/lib/diagrams/mermaid-runtime.ts',
			'node_modules/mermaid/dist/mermaid.core.mjs',
			...policyKeys
		]
	};
	const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
	assert(entries.length > 0, 'Lazy-loading manifest: no application entries');
	const eager = new Set(closure(entries, false));
	// Ordinary Markdown can also lazy-load shared dependencies (e.g. KaTeX).
	// Traverse the application graph without crossing either renderer boundary,
	// rather than incorrectly treating every renderer dependency as exclusive.
	const nonRenderer = new Set(
		closure(entries, true, new Set(), new Set(Object.values(roots).flat()))
	);
	productionChunks = { roots: {}, eager: [...eager], nonRenderer: [...nonRenderer] };
	for (const [kind, keys] of Object.entries(roots)) {
		productionChunks.roots[kind] = [...new Set(keys.map((key) => '/' + entry(key).file))];
		for (const path of productionChunks.roots[kind])
			assert(
				!eager.has(path) && !nonRenderer.has(path),
				`Lazy-loading manifest: ${kind} root is eager or not independently verifiable: ${path}`
			);
		paths[kind] = [...new Set(closure(keys))].filter((path) => !nonRenderer.has(path));
		assert(paths[kind].length > 0, `Lazy-loading manifest: no monitored ${kind} chunks`);
	}
	productionChunks.monitored = paths;
	await writeFile(`${artifacts}/lazy-chunks.json`, JSON.stringify(productionChunks, null, 2));
	console.log(
		`PASS lazy-loading manifest: chart=${paths.chart.length}, diagram=${paths.diagram.length}`
	);
}
const chart = JSON.stringify({
	type: 'bar',
	title: 'Revenue \\(raw\\)',
	xKey: 'name',
	series: [{ key: 'value', label: 'Value' }],
	data: [
		{ name: 'A', value: 12 },
		{ name: 'B', value: 18 }
	]
});
const diagram = 'flowchart LR\nA[Start] --> B[End]';
const content =
	'\\(x\\) before\n\n```llampart-chart\n' +
	chart +
	'\n```\n\n```mermaid\n' +
	diagram +
	'\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst safe = true;\n```';
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const reports = [];
try {
	for (const legacy of [false, true]) {
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		if (legacy)
			await context.addInitScript(() => {
				if (!localStorage.getItem('LlamaCppWebui.config'))
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({ responsePrefCharts: true, responsePrefDiagrams: true })
					);
			});
		await context.route('**/__llampart/api/**', (route) =>
			route.fulfill({
				json: {
					build_info: 'defaults-test',
					model_path: 'test.gguf',
					default_generation_settings: { params: {} }
				}
			})
		);
		const page = await context.newPage();
		await page.addLocatorHandler(
			page.locator('.llampart-about-dialog-content'),
			async (welcome) => {
				await welcome.locator('#about-llampart-do-not-show-again').check();
				await welcome.getByRole('button', { name: 'OK', exact: true }).click();
			}
		);
		await page.goto(base);
		for (const reload of [false, true]) {
			if (reload) await page.reload();
			// Wait for hydration before deciding whether the sidebar is collapsed.
			await page.locator('button[aria-label="Settings"]').waitFor({ state: 'attached' });
			if (!(await page.locator('button[aria-label="Settings"]').isVisible()))
				await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
			await page.locator('button[aria-label="Settings"]').click();
			const dialog = page.locator('.llampart-chat-settings-dialog-content');
			await dialog.getByRole('button', { name: 'Chat', exact: true }).click();
			for (const key of ['chartsEnabled', 'diagramsEnabled'])
				assert.equal(await page.locator('#' + key).getAttribute('aria-checked'), 'true');
			await page.screenshot({
				path: `${artifacts}/defaults-${legacy ? 'legacy' : 'fresh'}-${reload ? 'reload' : 'initial'}.png`
			});
			await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
			await dialog.waitFor({ state: 'hidden' });
			const saved = await page.evaluate(() =>
				JSON.parse(localStorage.getItem('LlamaCppWebui.config'))
			);
			assert.equal(saved.chartsEnabled, true);
			assert.equal(saved.diagramsEnabled, true);
		}
		await context.close();
		console.log(
			`PASS defaults ${legacy ? 'legacy migration' : 'fresh installation'}: draft/committed/reload ON`
		);
	}
	for (const chartsEnabled of [false, true])
		for (const diagramsEnabled of [false, true]) {
			const report = { chartsEnabled, diagramsEnabled, requests: [], pageerrors: [] };
			reports.push(report);
			const context = await browser.newContext({
				viewport: { width: 1600, height: 1100 },
				acceptDownloads: true,
				permissions: ['clipboard-read', 'clipboard-write']
			});
			await context.addInitScript(
				(flags) => {
					if (!localStorage.getItem('LlamaCppWebui.config'))
						localStorage.setItem(
							'LlamaCppWebui.config',
							JSON.stringify({
								...flags,
								responsePrefCharts: true,
								responsePrefDiagrams: true,
								apiProvider: 'llama-server',
								serverBaseUrl: 'http://capabilities.test',
								llamaServerBaseUrl: 'http://capabilities.test',
								interfaceLanguage: 'en',
								titleGenerationUseLLM: false,
								askForTitleConfirmation: false
							})
						);
				},
				{ chartsEnabled, diagramsEnabled }
			);
			const bodies = [];
			await context.route('**/__llampart/api/**', (route) => {
				const path = new URL(route.request().url()).pathname;
				if (path.endsWith('/chat/completions')) {
					bodies.push(route.request().postDataJSON());
					return route.fulfill({
						contentType: 'text/event-stream',
						body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
					});
				}
				return route.fulfill({
					json: path.endsWith('/props')
						? {
								build_info: 'capabilities-test',
								model_path: 'test.gguf',
								default_generation_settings: { params: {} }
							}
						: path.endsWith('/models')
							? { object: 'list', data: [{ id: 'test.gguf' }] }
							: []
				});
			});
			const page = await context.newPage();
			page.on('request', (request) => report.requests.push(new URL(request.url()).pathname));
			page.on('pageerror', (error) => report.pageerrors.push(error.message));
			await page.addLocatorHandler(
				page.locator('.llampart-about-dialog-content'),
				async (welcome) => {
					await welcome.locator('#about-llampart-do-not-show-again').check();
					await welcome.getByRole('button', { name: 'OK', exact: true }).click();
				}
			);
			const dialog = page.locator('.llampart-chat-settings-dialog-content');
			async function settings(section) {
				await page.locator('button[aria-label="Settings"]').click();
				await dialog.getByRole('button', { name: section, exact: true }).click();
			}
			async function save() {
				await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
				await dialog.waitFor({ state: 'hidden' });
			}
			async function renderState(charts, diagrams) {
				await page.waitForFunction(
					({ charts, diagrams }) => {
						const el = document.querySelector('.llampart-assistant-markdown');
						return (
							el &&
							Boolean(el.querySelector('.llampart-chart-frame .chart-plot svg')) === charts &&
							Boolean(
								el
									.querySelector('.llampart-diagram-frame .diagram-surface')
									?.shadowRoot?.querySelector('svg')
							) === diagrams &&
							el.querySelectorAll('.llampart-visualization-fallback').length ===
								Number(!charts) + Number(!diagrams) &&
							!el.querySelector('.llampart-inline-processing-status')
						);
					},
					{ charts, diagrams },
					{ timeout: 60000 }
				);
			}
			async function storedMessages() {
				return page.evaluate(async () => {
					const db = await new Promise((resolve, reject) => {
						const request = indexedDB.open('LlamacppWebui');
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					try {
						return await new Promise((resolve, reject) => {
							const request = db.transaction('messages').objectStore('messages').getAll();
							request.onsuccess = () => resolve(request.result);
							request.onerror = () => reject(request.error);
						});
					} finally {
						db.close();
					}
				});
			}
			await page.goto(base);
			await page.locator('textarea').first().fill('Capabilities smoke');
			await page.locator('textarea').first().press('Enter');
			await renderState(chartsEnabled, diagramsEnabled);
			const snapshot = await storedMessages();
			assert(
				snapshot.some((message) => message.role === 'assistant' && message.content === content)
			);
			const system = bodies[0].messages.find((message) => message.role === 'system')?.content || '';
			assert.equal(system.includes('llampart chart format ('), chartsEnabled);
			assert.equal(system.includes('llampart diagram format ('), diagramsEnabled);
			const assistant = page.locator('.llampart-assistant-markdown').first();
			assert.equal(await assistant.locator('table').count(), 1);
			assert.equal(await assistant.locator('.katex').count(), 1);
			assert.equal(
				await assistant.locator('code.language-js').textContent(),
				'const safe = true;\n'
			);
			for (const [kind, enabled, source] of [
				['chart', chartsEnabled, chart],
				['diagram', diagramsEnabled, diagram]
			]) {
				// A dependency shared with the enabled renderer is allowed to load.
				// With both OFF, the union of both renderer graphs must stay unloaded.
				const other = kind === 'chart' ? 'diagram' : 'chart';
				const otherEnabled = kind === 'chart' ? diagramsEnabled : chartsEnabled;
				const monitored = paths[kind].filter(
					(path) => !otherEnabled || !paths[other].includes(path)
				);
				assert(monitored.length > 0, `Lazy-loading: no independently verifiable ${kind} chunks`);
				if (production && enabled)
					for (const path of productionChunks.roots[kind])
						assert(
							report.requests.includes(path),
							`${kind} expected chunk was not observed: ${path}`
						);
				if (!enabled) {
					assert(
						!report.requests.some((path) => monitored.includes(path)),
						`${kind} module loaded while OFF`
					);
					const fallback = assistant.locator(`.llampart-${kind}-fallback`);
					assert.match(await fallback.textContent(), /disabled in Settings/);
					assert.equal(await fallback.locator('.visualization-preview-action').count(), 0);
					await fallback.getByRole('button', { name: 'Show code', exact: true }).click();
					assert.equal(await page.locator('.visualization-source').textContent(), source);
					assert.equal(await page.locator('.llampart-code-preview-iframe').count(), 0);
					await page.keyboard.press('Escape');
					await fallback.getByRole('button', { name: 'Copy code', exact: true }).click();
					assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
					assert(
						!report.requests.some((path) => monitored.includes(path)),
						`${kind} code controls bypassed OFF`
					);
				}
			}
			await settings('General');
			for (const key of ['responsePrefCharts', 'responsePrefDiagrams']) {
				assert(await page.locator('#' + key).isVisible());
				assert.equal(await page.locator('#' + key).getAttribute('aria-checked'), 'true');
			}
			await dialog.getByRole('button', { name: 'Chat', exact: true }).click();
			await page.locator('#chartsEnabled').setChecked(!chartsEnabled);
			await page.locator('#diagramsEnabled').setChecked(!diagramsEnabled);
			await renderState(chartsEnabled, diagramsEnabled);
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await renderState(chartsEnabled, diagramsEnabled);
			await settings('Chat');
			await page.locator('#chartsEnabled').setChecked(false);
			await page.locator('#diagramsEnabled').setChecked(false);
			await save();
			await renderState(false, false);
			await page.reload();
			await renderState(false, false);
			await settings('Chat');
			await page.locator('#chartsEnabled').setChecked(true);
			await page.locator('#diagramsEnabled').setChecked(true);
			await save();
			await renderState(true, true);
			for (const [kind, formats] of [
				['chart', ['png', 'svg', 'csv']],
				['diagram', ['png', 'svg']]
			]) {
				const frame = assistant.locator(`.llampart-${kind}-frame`);
				await frame.locator('.visualization-preview-action').click();
				await page.locator('.visualization-preview-scroll svg').first().waitFor();
				await page.keyboard.press('Escape');
				for (const format of formats) {
					const pending = page.waitForEvent('download');
					await frame
						.getByRole('button', { name: new RegExp(` ${format.toUpperCase()}$`) })
						.click();
					const download = await pending;
					const path = `${artifacts}/${Number(chartsEnabled)}${Number(diagramsEnabled)}-${kind}.${format}`;
					await download.saveAs(path);
					assert((await readFile(path)).length > 20);
				}
			}
			await page.reload();
			await renderState(true, true);
			assert.deepEqual(
				await storedMessages(),
				snapshot,
				'Settings/reload must not rewrite old messages'
			);
			await settings('Chat');
			await page.locator('#chartsEnabled').setChecked(chartsEnabled);
			await page.locator('#diagramsEnabled').setChecked(diagramsEnabled);
			await save();
			for (const [kind, language, source, enabled] of [
				['chart', 'llampart-chart', chart, chartsEnabled],
				['diagram', 'mermaid', diagram, diagramsEnabled]
			]) {
				console.log(`Checking stream ${kind}: ${chartsEnabled}/${diagramsEnabled}`);
				await page.evaluate(
					({ language, source }) => {
						const original = window.fetch;
						const encoder = new TextEncoder();
						window.fetch = function (input, init) {
							if (!String(input).includes('/chat/completions'))
								return original.call(this, input, init);
							window.fetch = original;
							return Promise.resolve(
								new Response(
									new ReadableStream({
										start(controller) {
											const chunk = (content) =>
												encoder.encode(
													`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
												);
											controller.enqueue(chunk('```' + language + '\n' + source));
											window.finishCapabilityStream = () => {
												controller.enqueue(chunk('\n```'));
												controller.enqueue(
													encoder.encode(
														'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
													)
												);
												controller.close();
											};
										}
									}),
									{ headers: { 'Content-Type': 'text/event-stream' } }
								)
							);
						};
					},
					{ language, source }
				);
				const count = await page.locator('.llampart-assistant-markdown').count();
				await page.locator('textarea').first().fill(`Stream ${kind}`);
				// Wait for the real submit control to become enabled after the preceding
				// turn's asynchronous persistence, rather than racing a second Enter.
				await page.getByRole('button', { name: 'Send', exact: true }).click();
				await page.waitForFunction(
					(count) => document.querySelectorAll('.llampart-assistant-markdown').length > count,
					count
				);
				const tail = page.locator('.llampart-assistant-markdown').last();
				await tail
					.locator(enabled ? '.llampart-inline-processing-status' : `.llampart-${kind}-fallback`)
					.waitFor();
				if (!enabled) {
					assert.equal(await tail.locator('.llampart-inline-processing-status').count(), 0);
					await tail.getByRole('button', { name: 'Show code', exact: true }).click();
					assert.equal(await page.locator('.visualization-source').textContent(), source);
					await page.keyboard.press('Escape');
				}
				await page.evaluate(() => window.finishCapabilityStream());
				await page
					.getByRole('button', { name: 'Stop generating', exact: true })
					.waitFor({ state: 'hidden' });
				await tail
					.locator(enabled ? `.llampart-${kind}-frame` : `.llampart-${kind}-fallback`)
					.waitFor();
			}
			const afterStreaming = await storedMessages();
			// New turns legitimately append graph children to the old leaf, but must
			// not change any previously saved source content.
			assert.deepEqual(
				afterStreaming.filter((message) => snapshot.some((old) => old.id === message.id)),
				snapshot.map((old) => ({
					...old,
					children: afterStreaming.find((message) => message.id === old.id).children
				}))
			);
			for (const operation of ['regenerate', 'edit']) {
				console.log(`Checking ${operation} payload: ${chartsEnabled}/${diagramsEnabled}`);
				const response = page.waitForResponse(
					(response) =>
						response.url().includes('/chat/completions') && response.request().method() === 'POST'
				);
				void response.catch(() => undefined);
				if (operation === 'regenerate')
					await page.locator('button[aria-label="Regenerate"]').last().click();
				else {
					await page
						.locator('.llampart-message-actions-user button[aria-label="Edit"]')
						.first()
						.click();
					const input = page.locator('.llampart-message-edit-form textarea');
					await input.fill('Edited capabilities question');
					await page
						.locator('.llampart-message-edit-form')
						.getByRole('button', { name: 'Send', exact: true })
						.click();
				}
				await response;
				await page
					.getByRole('button', { name: 'Stop generating', exact: true })
					.waitFor({ state: 'hidden' });
				const system =
					bodies.at(-1).messages.find((message) => message.role === 'system')?.content || '';
				assert.equal(system.includes('llampart chart format ('), chartsEnabled, operation);
				assert.equal(system.includes('llampart diagram format ('), diagramsEnabled, operation);
			}
			assert.deepEqual(report.pageerrors, []);
			await context.close();
			console.log(
				`PASS REAL UI/DOM + MOCK provider: ${chartsEnabled}/${diagramsEnabled}, payload, lazy modules, source controls, Save/Cancel, OFF/reload/ON, exports, unchanged IndexedDB`
			);
		}
} finally {
	await writeFile(`${artifacts}/report.json`, JSON.stringify({ production, reports }, null, 2));
	await browser.close();
}
