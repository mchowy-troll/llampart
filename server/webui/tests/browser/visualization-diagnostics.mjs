/** 6B: REAL Chromium, UI, LayerChart, Mermaid, clipboard, downloads and IndexedDB.
 * MOCK provider HTTP/SSE only. Separate, explicitly injected module failures below.
 * Run against dev or an isolated production build (LLAMPART_TEST_PRODUCTION=1).
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40467';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/task6b-browser';
await mkdir(artifacts, { recursive: true });
const chart = {
	type: 'bar',
	title: 'Valid data',
	xKey: 'month',
	series: [{ key: 'value', label: 'Value' }],
	data: [
		{ month: 'Jan', value: 2 },
		{ month: 'Feb', value: 3 }
	]
};
const fence = (kind, source) =>
	'```' + (kind === 'chart' ? 'llampart-chart' : 'mermaid') + '\n' + source + '\n```';
const goodChart = fence('chart', JSON.stringify(chart));
const goodDiagram = fence('diagram', 'flowchart LR\nA[Start] --> B[End]');
const invalidChart = JSON.stringify({ ...chart, xKey: undefined });
const first = [
	goodChart,
	fence('chart', invalidChart),
	fence('chart', JSON.stringify({ ...chart, xKey: 'absent' })),
	fence('chart', JSON.stringify({ ...chart, series: [{ key: 'value' }] })),
	goodDiagram,
	fence('diagram', 'flowchart LR\nA['),
	fence('diagram', 'flowchart LR\nclick A callback')
].join('\n\n');
let content = first;
let calls = 0;
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const results = [];
let page;
async function setup() {
	const context = await browser.newContext({
		viewport: { width: 1600, height: 1100 },
		acceptDownloads: true,
		permissions: ['clipboard-read', 'clipboard-write']
	});
	await context.addInitScript(() => {
		if (!localStorage.getItem('LlamaCppWebui.config'))
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://diagnostics.test',
					llamaServerBaseUrl: 'http://diagnostics.test',
					interfaceLanguage: 'en',
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false
				})
			);
	});
	await context.route('**/__llampart/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/chat/completions')) {
			calls++;
			return route.fulfill({
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
			});
		}
		return route.fulfill({
			json: path.endsWith('/props')
				? {
						build_info: 'diagnostics-test',
						model_path: 'test.gguf',
						default_generation_settings: { params: {} }
					}
				: path.endsWith('/models')
					? { object: 'list', data: [{ id: 'test.gguf' }] }
					: []
		});
	});
	page = await context.newPage();
	await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
		await welcome.locator('#about-llampart-do-not-show-again').check();
		await welcome.getByRole('button', { name: 'OK', exact: true }).click();
	});
	return context;
}
async function send(label) {
	const count = await page.locator('.llampart-assistant-markdown').count();
	await page.locator('textarea').first().fill(label);
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await page.waitForFunction(
		(n) => document.querySelectorAll('.llampart-assistant-markdown').length > n,
		count
	);
	return page.locator('.llampart-assistant-markdown').last();
}
async function settled(assistant) {
	await assistant.locator('.llampart-visualization-frame').first().waitFor({ timeout: 60000 });
	await page.waitForFunction(
		() =>
			!document.querySelector('.llampart-assistant-markdown .llampart-inline-processing-status'),
		null,
		{ timeout: 60000 }
	);
	await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
}
async function stored() {
	return page.evaluate(async () => {
		const db = await new Promise((resolve, reject) => {
			const r = indexedDB.open('LlamacppWebui');
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const r = db.transaction('messages').objectStore('messages').getAll();
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
		} finally {
			db.close();
		}
	});
}
async function toggle(enabled) {
	const settings = page.locator('button[aria-label="Settings"]');
	if (!(await settings.isVisible()))
		await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
	await settings.click();
	const dialog = page.locator('.llampart-chat-settings-dialog-content');
	await dialog.getByRole('button', { name: 'Chat', exact: true }).click();
	for (const key of ['chartsEnabled', 'diagramsEnabled'])
		await page.locator('#' + key).setChecked(enabled);
	await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function stream() {
	await page.evaluate(() => {
		const original = window.fetch;
		const encoder = new TextEncoder();
		window.fetch = function (input, init) {
			if (!String(input).includes('/chat/completions')) return original.call(this, input, init);
			window.fetch = original;
			return Promise.resolve(
				new Response(
					new ReadableStream({
						start(controller) {
							init?.signal?.addEventListener(
								'abort',
								() => controller.error(new DOMException('Aborted', 'AbortError')),
								{ once: true }
							);
							window.diagnosticChunk = (content) =>
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
									)
								);
							window.diagnosticChunk('Streaming diagnostic\n\n');
							window.diagnosticEnd = () => {
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
	});
}
try {
	const context = await setup();
	await page.goto(base);
	let assistant = await send('REAL diagnostics');
	await settled(assistant);
	for (const code of ['chart.required', 'chart.columnMissing', 'diagram.syntax', 'diagram.policy'])
		await assistant.locator(`[data-problem-code="${code}"]`).first().waitFor();
	assert.equal(await assistant.locator('[data-problem-code="chart.required"]').count(), 2);
	assert.match(
		await assistant.locator('[data-problem-code="chart.columnMissing"]').textContent(),
		/absent.*missing/
	);
	assert.match(
		await assistant.locator('[data-problem-code="chart.required"]').last().textContent(),
		/series\[0\].label/
	);
	assert.equal(await assistant.locator('.llampart-chart-frame').count(), 1);
	assert((await assistant.locator('.chart-plot svg').count()) > 0);
	await assistant.locator('.diagram-surface svg').waitFor({ timeout: 60000 });
	assert.equal(await assistant.locator('.diagram-surface svg').count(), 1);
	const fallback = assistant.locator('[data-problem-code="chart.required"]').first();
	const show = fallback.getByRole('button', { name: 'Show code', exact: true });
	await show.focus();
	await page.keyboard.press('Enter');
	assert.equal(await page.locator('.visualization-source').textContent(), invalidChart);
	assert.equal(await page.locator('.llampart-code-preview-iframe').count(), 0);
	await page.keyboard.press('Escape');
	assert(await show.evaluate((el) => document.activeElement === el));
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), invalidChart);
	for (const kind of ['chart', 'diagram']) {
		const frame = assistant.locator(`.llampart-${kind}-frame`);
		await frame.locator('.visualization-preview-action').click();
		await page.locator('.visualization-preview-scroll svg').first().waitFor();
		await page.keyboard.press('Escape');
		for (const format of kind === 'chart' ? ['png', 'svg', 'csv'] : ['png', 'svg']) {
			const pending = page.waitForEvent('download');
			await frame.getByRole('button', { name: new RegExp(` ${format.toUpperCase()}$`) }).click();
			const download = await pending;
			const path = `${artifacts}/${kind}.${format}`;
			await download.saveAs(path);
			assert((await readFile(path)).length > 20);
		}
	}
	const snapshot = await stored();
	const beforeCalls = calls;
	await toggle(false);
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-visualization-fallback').length === 7
	);
	assert.equal(await assistant.locator('[data-problem-code]').count(), 0);
	assert.match(await assistant.textContent(), /disabled in Settings/);
	await toggle(true);
	await settled(assistant);
	await page.reload();
	assistant = page.locator('.llampart-assistant-markdown').first();
	await settled(assistant);
	assert.deepEqual(await stored(), snapshot);
	assert.equal(calls, beforeCalls, 'Diagnostics must never call the provider');
	results.push(
		'REAL renderers: valid/missing xKey/absent column/series/Mermaid syntax/policy; keyboard, code, clipboard, exports, master OFF/ON, persistence/reload, no extra provider call'
	);
	content = fence('chart', '{"title":"<img src=x onerror=alert(1)>",') + '\n\n' + goodChart;
	assistant = await send('Invalid JSON beside valid chart');
	await settled(assistant);
	await assistant.locator('[data-problem-code="chart.json"]').waitFor();
	assert.equal(await assistant.locator('.llampart-chart-frame').count(), 1);
	assert((await assistant.locator('.chart-plot svg').count()) > 0);
	assert.equal(await assistant.locator('.llampart-visualization-fallback img').count(), 0);
	// Streaming uses the real service with a controlled MOCK SSE transport.
	await stream();
	assistant = await send('Stream invalid and incomplete blocks');
	await page.evaluate(() => window.diagnosticChunk('```llampart-chart\n{'));
	await assistant.locator('.llampart-inline-processing-status').waitFor();
	assert.equal(await assistant.locator('[data-problem-code]').count(), 0);
	await page.evaluate(() => window.diagnosticChunk('\n```\n\n```mermaid\nflowchart LR\nA['));
	await assistant.locator('[data-problem-code="chart.json"]').waitFor();
	await assistant.locator('.llampart-inline-processing-status').waitFor();
	await page.getByRole('button', { name: 'Stop', exact: true }).click();
	await assistant.locator('[data-problem-code="diagram.incomplete"]').waitFor();
	assert.equal(await assistant.locator('[role="alert"]').count(), 0);
	await stream();
	assistant = await send('Finished incomplete block');
	await page.evaluate(() => {
		window.diagnosticChunk('```mermaid\nflowchart LR\nA[');
		window.diagnosticEnd();
	});
	await assistant.locator('[data-problem-code="diagram.incomplete"]').waitFor();
	await stream();
	assistant = await send('Complete source after further tokens');
	await page.evaluate(() => window.diagnosticChunk('```mermaid\nflowchart LR\nA['));
	await assistant.locator('.llampart-inline-processing-status').waitFor();
	await page.evaluate(() => {
		window.diagnosticChunk('Fixed] --> B\n```');
		window.diagnosticEnd();
	});
	await assistant.locator('.diagram-surface svg').waitFor({ timeout: 60000 });
	assert.equal(await assistant.locator('[data-problem-code]').count(), 0);
	results.push(
		'REAL UI + MOCK SSE: open fence pending, closed invalid fence while streaming, Stop and completed incomplete fence, no repeated alerts'
	);
	await context.close();
	// Infrastructure failures are separate from the REAL renderer cases above.
	let paths = {
		chart: '/src/lib/components/app/content/ChartFrame.svelte',
		diagram: '/src/lib/diagrams/mermaid-runtime.ts',
		engine: '/node_modules/.vite/deps/mermaid.js'
	};
	if (process.env.LLAMPART_TEST_PRODUCTION) {
		const manifest = JSON.parse(
			await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
		);
		paths = Object.fromEntries(
			Object.entries({
				chart: 'src/lib/components/app/content/ChartFrame.svelte',
				diagram: 'src/lib/diagrams/mermaid-runtime.ts',
				engine: 'node_modules/mermaid/dist/mermaid.core.mjs'
			}).map(([name, key]) => [name, '/' + manifest[key].file])
		);
	}
	for (const fault of ['chart', 'diagram', 'engine', 'chart-render']) {
		const context = await setup();
		content = goodChart + '\n\n' + goodDiagram;
		await page.route(
			(url) =>
				!url.searchParams.has('diagnosticReal') &&
				(url.pathname === paths[fault === 'chart-render' ? 'chart' : fault] ||
					(fault === 'engine' &&
						!process.env.LLAMPART_TEST_PRODUCTION &&
						url.pathname.endsWith('/deps/mermaid.js'))),
			(route) =>
				fault === 'chart-render'
					? route.fulfill({
							contentType: 'text/javascript',
							body: `import ChartFrame from ${JSON.stringify(paths.chart + '?diagnosticReal=1')};
export default function(anchor, props) { return ChartFrame(anchor, { ...props, spec: new Proxy(props.spec, { get(target, key) { if (key === 'format') throw new Error('SECRET /home/private <img onerror=alert(1)>'); return Reflect.get(target, key); } }) }); }`
						})
					: route.abort('failed')
		);
		await page.goto(base);
		const assistant = await send('Controlled infrastructure failure');
		await settled(assistant);
		const kind = fault.startsWith('chart') ? 'chart' : 'diagram';
		const code = `${kind}.${fault === 'chart-render' ? 'render' : 'module'}`;
		await assistant.locator(`[data-problem-code="${code}"]`).waitFor();
		assert.match(
			await assistant.locator(`[data-problem-code="${code}"]`).textContent(),
			fault === 'chart-render' ? /renderer failed/ : /loaded or initialized/
		);
		assert.doesNotMatch(await assistant.textContent(), /SECRET|\/home\/private|onerror/);
		assert.equal(await assistant.locator('[data-problem-category="source"]').count(), 0);
		results.push(
			fault === 'chart-render'
				? 'INJECTED renderer fault: real ChartFrame/LayerChart, safe render diagnostic'
				: `INJECTED network failure: ${fault}, real UI infrastructure diagnostic`
		);
		await context.close();
	}
	// Delay a real runtime module, then change conversation: stale syntax failures must disappear.
	const staleContext = await setup();
	content = goodDiagram;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let requested;
	const observed = new Promise((resolve) => {
		requested = resolve;
	});
	await page.route(
		(url) => url.pathname === paths.diagram,
		async (route) => {
			requested();
			await gate;
			await route.continue();
		}
	);
	await page.goto(base);
	await stream();
	assistant = await send('Stale streamed diagram');
	await page.evaluate(() => window.diagnosticChunk('```mermaid\nflowchart LR\nA[\n```'));
	await observed;
	await page.evaluate(() => window.diagnosticEnd());
	await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'hidden' });
	const oldURL = page.url();
	await toggle(false);
	await assistant.locator('.llampart-diagram-fallback:not([data-problem-code])').waitFor();
	await page.locator('[aria-label="New chat"]').click();
	await page.locator('.llampart-assistant-markdown').waitFor({ state: 'hidden' });
	release();
	await toggle(true);
	assistant = await send('New conversation, no stale syntax error');
	await settled(assistant);
	await assistant.locator('.diagram-surface svg').waitFor();
	assert.equal(await page.locator('[data-problem-code]').count(), 0);
	await page.goto(oldURL);
	await page.locator('[data-problem-code="diagram.syntax"]').waitFor({ timeout: 60000 });
	assert.equal(await page.locator('[data-problem-code="diagram.render"]').count(), 0);
	results.push(
		'REAL delayed runtime + MOCK SSE: old conversation result discarded; reload diagnoses only its own source'
	);
	await staleContext.close();
	console.log(results.map((result) => 'PASS ' + result).join('\n'));
} catch (error) {
	if (page && !page.isClosed())
		await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true }).catch(() => {});
	throw error;
} finally {
	await writeFile(
		`${artifacts}/report.json`,
		JSON.stringify(
			{ production: Boolean(process.env.LLAMPART_TEST_PRODUCTION), results, providerCalls: calls },
			null,
			2
		)
	);
	await browser.close();
}
