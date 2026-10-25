/** Original visualization payloads, persistence and stale lazy-module diagnostics.
 * Same scenario in Chromium dev and production (LLAMPART_TEST_PRODUCTION=1).
 * Network faults below are deliberate reproductions, not proof of a historical failed request.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const artifacts =
	process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-visualization-lifecycle';
await mkdir(artifacts, { recursive: true });
const fixture = await readFile(
	new URL('../fixtures/visualization-lifecycle.md', import.meta.url),
	'utf8'
);
const code = '<h1>Łódź i kod</h1>\n';
const content =
	fixture + '\n\n```html\n' + code + '```\n\n| Miasto | Liczba |\n|---|---|\n| Łódź | 42 |\n';
let paths = {
	chart: '/src/lib/components/app/content/ChartFrame.svelte',
	schema: '/src/lib/charts/chart-schema.ts',
	module: '/src/lib/diagrams/mermaid-runtime.ts',
	engine: '/node_modules/.vite/deps/mermaid.js'
};
if (process.env.LLAMPART_TEST_PRODUCTION) {
	const manifest = JSON.parse(
		await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
	);
	paths = Object.fromEntries(
		Object.entries({
			chart: 'src/lib/components/app/content/ChartFrame.svelte',
			schema: 'src/lib/charts/chart-schema.ts',
			module: 'src/lib/diagrams/mermaid-runtime.ts',
			engine: 'node_modules/mermaid/dist/mermaid.core.mjs'
		}).map(([name, key]) => [name, '/' + manifest[key].file])
	);
}
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const reports = [];
try {
	for (const fault of [
		'none',
		'chart-schema',
		'chart-import',
		'chart-render',
		'mermaid-module',
		'mermaid-engine'
	]) {
		if (process.env.LLAMPART_TEST_FAULT && process.env.LLAMPART_TEST_FAULT !== fault) continue;
		const context = await browser.newContext({
			viewport: { width: 1600, height: 1200 },
			acceptDownloads: true,
			permissions: ['clipboard-read', 'clipboard-write']
		});
		await context.addInitScript(() => {
			if (!localStorage.getItem('LlamaCppWebui.config'))
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({
						apiProvider: 'llama-server',
						serverBaseUrl: 'http://lifecycle.test',
						llamaServerBaseUrl: 'http://lifecycle.test',
						theme: 'frosted-glass',
						interfaceLanguage: 'pl',
						fontFamily: 'merriweather',
						fontVariant: '400',
						titleGenerationUseLLM: false,
						askForTitleConfirmation: false
					})
				);
		});
		await context.route('**/__llampart/api/**', (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/chat/completions'))
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
				});
			return route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'lifecycle-test',
							model_path: 'test.gguf',
							default_generation_settings: { params: {} }
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'test.gguf' }] }
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
		const report = { fault, errors: [], network: [], pageerrors: [] };
		reports.push(report);
		page.on('console', (event) => {
			if (event.type() === 'error') report.errors.push(event.text());
		});
		page.on('pageerror', (error) => report.pageerrors.push(error.message));
		page.on('requestfailed', (request) =>
			report.network.push({ url: request.url(), failure: request.failure() })
		);
		const failedPath =
			fault === 'chart-schema'
				? paths.schema
				: fault.startsWith('chart')
					? paths.chart
					: fault === 'mermaid-module'
						? paths.module
						: paths.engine;
		const matcher = (url) =>
			!url.searchParams.has('lifecycleReal') &&
			(url.pathname === failedPath ||
				(!process.env.LLAMPART_TEST_PRODUCTION &&
					fault === 'mermaid-engine' &&
					url.pathname.endsWith('/deps/mermaid.js')));
		if (fault !== 'none')
			await page.route(matcher, (route) =>
				fault === 'chart-render'
					? route.fulfill({
							contentType: 'text/javascript',
							// Fail in real axis-formatting effects, not an uncompiled component stub.
							body: `import ChartFrame from ${JSON.stringify(failedPath + '?lifecycleReal=1')};
export default function(anchor, props) {
 return ChartFrame(anchor, { ...props, spec: new Proxy(props.spec, {
  get(target, key) {
   if (key === 'format') throw new Error('lifecycle renderer sentinel');
   return Reflect.get(target, key);
  }
 }) });
}`
						})
					: route.abort('failed')
			);
		await page.goto(base);
		await page.locator('textarea').first().fill('Test zapisu i wizualizacji');
		await page.locator('textarea').first().press('Enter');
		const assistant = page.locator('.llampart-assistant-markdown').first();
		await assistant.locator('.table-csv-button').waitFor();
		async function healthy() {
			await page.waitForFunction(
				() => {
					const el = document.querySelector('.llampart-assistant-markdown');
					return (
						el &&
						el.querySelectorAll('.llampart-chart-frame .chart-plot svg').length >= 4 &&
						el.querySelectorAll('.llampart-chart-frame').length === 4 &&
						[...el.querySelectorAll('.llampart-diagram-frame .diagram-surface')].filter((surface) =>
							surface.shadowRoot?.querySelector('svg')
						).length === 4 &&
						!el.querySelector(
							'.llampart-chart-fallback,.llampart-diagram-fallback,.llampart-inline-processing-status'
						)
					);
				},
				null,
				{ timeout: 60000 }
			);
		}
		if (fault !== 'none') {
			const chart = fault.startsWith('chart');
			await page.waitForFunction(
				({ chart, expected }) =>
					document.querySelectorAll(
						chart ? '.llampart-chart-fallback' : '.llampart-diagram-fallback'
					).length === expected,
				{ chart, expected: fault === 'chart-render' ? 3 : 4 }
			);
			const label =
				fault === 'chart-schema'
					? 'Chart validation module failed:'
					: fault === 'chart-import'
						? 'Chart renderer import failed:'
						: fault === 'chart-render'
							? 'Chart rendering failed:'
							: fault === 'mermaid-module'
								? 'Mermaid module failed:'
								: 'Mermaid render failed:';
			assert(
				report.errors.some((message) => message.includes(label)),
				`Diagnostic: ${label}`
			);
			if (fault === 'chart-render')
				assert(report.errors.some((message) => message.includes('lifecycle renderer sentinel')));
			else assert(report.network.some((request) => matcher(new URL(request.url))));
			const fallback = assistant
				.locator(chart ? '.llampart-chart-fallback' : '.llampart-diagram-fallback')
				.first();
			const original = fixture.match(
				new RegExp('```' + (chart ? 'llampart-chart' : 'mermaid') + '\\n([\\s\\S]*?)\\n```')
			)[1];
			assert.equal(await fallback.locator('pre').count(), 0);
			const show = fallback.getByRole('button', { name: 'Pokaż kod', exact: true });
			await show.evaluate((el) => el.scrollIntoView({ block: 'center' }));
			await show.click();
			assert.equal(await page.locator('.visualization-source').textContent(), original);
			await page.keyboard.press('Escape');
			await page.locator('.visualization-source').waitFor({ state: 'hidden' });
			await fallback.getByRole('button', { name: 'Kopiuj kod', exact: true }).click();
			assert.equal(await page.evaluate(() => navigator.clipboard.readText()), original);
			await page.unroute(matcher);
			// A full document reload must discard failed module promises/boundaries without editing stored Markdown.
			await page.reload();
		}
		await healthy();
		const errorsAfterRecovery = report.errors.length;
		await page.reload();
		await healthy();
		assert.equal(report.errors.length, errorsAfterRecovery, 'No errors after a clean reload');
		if (fault === 'none') {
			const url = page.url();
			await page.close();
			const reopened = await context.newPage();
			await reopened.goto(url);
			await reopened
				.locator('.llampart-assistant-markdown .llampart-diagram-frame')
				.nth(3)
				.locator('.diagram-surface svg')
				.waitFor({ timeout: 60000 });
			assert.equal(
				await reopened.locator('.llampart-assistant-markdown .llampart-chart-frame').count(),
				4
			);
			for (const selector of ['.llampart-chart-frame', '.llampart-diagram-frame']) {
				const frames = reopened.locator('.llampart-assistant-markdown').first().locator(selector);
				for (let i = 0; i < 4; i++) {
					const frame = frames.nth(i);
					await frame.locator('.visualization-preview-action').click();
					await reopened.locator('.visualization-preview-scroll svg').first().waitFor();
					await reopened.keyboard.press('Escape');
					const pending = reopened.waitForEvent('download');
					await frame.getByRole('button', { name: / SVG$/ }).click();
					const download = await pending;
					assert(download.suggestedFilename().endsWith('.svg'));
					await download.saveAs(
						`${artifacts}/${i}-${selector.includes('chart') ? 'chart' : 'diagram'}.svg`
					);
				}
			}
			const block = reopened
				.locator('.llampart-assistant-markdown .code-block-wrapper:not(.llampart-chart-fallback)')
				.first();
			const pending = reopened.waitForEvent('download');
			await block.locator('.download-code-btn').click();
			const download = await pending;
			await download.saveAs(`${artifacts}/code.html`);
			assert.equal(await readFile(`${artifacts}/code.html`, 'utf8'), code);
			await block.locator('.copy-code-btn').click();
			assert.equal(await reopened.evaluate(() => navigator.clipboard.readText()), code);
			await block.locator('.preview-code-btn').click();
			await reopened
				.frameLocator('.llampart-code-preview-iframe')
				.getByText('Łódź i kod')
				.waitFor();
			await reopened.keyboard.press('Escape');
			await reopened.screenshot({ path: `${artifacts}/reopened.png` });
			assert.deepEqual(report.errors, []);
		}
		assert.deepEqual(report.pageerrors, [], 'Boundaries must handle visualization failures');
		await context.close();
		console.log(`PASS: ${fault}, original sources, persisted message and reload recovery`);
	}
} finally {
	await writeFile(`${artifacts}/report.json`, JSON.stringify(reports, null, 2));
	await browser.close();
}
