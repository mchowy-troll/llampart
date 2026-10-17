/** Production-only smoke/performance probe; serve server/public locally after build.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/browser/diagrams-production.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTransparentExport } from './export-transparency.mjs';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40141';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-final-diagrams';
await mkdir(artifacts, { recursive: true });
const manifest = JSON.parse(
	await readFile('.svelte-kit/output/client/.vite/manifest.json', 'utf8')
);
const key = Object.keys(manifest).find((key) => key.endsWith('/mermaid.core.mjs'));
const core = '/' + manifest[key].file;
const elkKey = Object.keys(manifest).find((key) => /\/elk-[^/]+\.mjs$/.test(key));
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage({
	viewport: { width: 1600, height: 1000 },
	acceptDownloads: true
});
const errors = [],
	transparency = [],
	external = [],
	pending = [],
	sizes = new Map();
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
	if (!request.url().startsWith(base) && !/^(blob|data):/.test(request.url()))
		external.push(request.url());
});
page.on('response', (response) => {
	if (response.url().includes('.js'))
		pending.push(
			response
				.body()
				.then((bytes) => sizes.set(new URL(response.url()).pathname, bytes.length))
				.catch(() => {})
		);
});
await page.addInitScript(() => {
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://diagrams.test',
			llamaServerBaseUrl: 'http://diagrams.test',
			theme: 'frosted-glass',
			interfaceLanguage: 'pl',
			fontFamily: 'crimson-text',
			fontVariant: '600',
			fontSize: '16',
			titleGenerationUseLLM: false,
			askForTitleConfirmation: false
		})
	);
	localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
});
const sources = [
	'flowchart LR\nA[Użytkownik] --> B{Lokalnie?}\nB -->|Tak| C[Łódź]\nB -->|Nie| D[Klaster GPU]',
	'stateDiagram-v2\n%% title: Generowanie odpowiedzi\n[*] --> Gotowy\nGotowy --> Koniec: Wyślij\nKoniec --> Gotowy: Ponów',
	'gantt\ntitle Plan wdrożenia\ndateFormat YYYY-MM-DD\nsection Testy\nŁódź :a,2026-10-01,5d\nOdbiór :milestone,m,after a,0d\nWdrożenie :after m,3d',
	'mindmap\n%% title: llampart\nroot((llampart))\n Rozmowa\n  Markdown\n Prywatność\n  Lokalne dane'
];
const content =
	'### Przepływ żądania\n\n' +
	sources.map((source) => '```mermaid\n' + source + '\n```').join('\n\n') +
	'\n\n```mermaid\nsequenceDiagram\nA->>B: fallback\n```\n\n```mermaid\nerDiagram\nA ||--o{ B : fallback\n```';
await page.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	if (path.endsWith('/chat/completions'))
		return route.fulfill({
			contentType: 'text/event-stream',
			body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
		});
	return route.fulfill({
		json: path.endsWith('/props')
			? {
					build_info: 'diagrams-test',
					model_path: 'local.gguf',
					default_generation_settings: { params: {} }
				}
			: path.endsWith('/models')
				? { object: 'list', data: [{ id: 'local.gguf' }] }
				: []
	});
});
try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	await Promise.all(pending);
	assert(!sizes.has(core), 'Engine must stay lazy');
	const before = new Map(sizes);
	await page.locator('textarea').first().fill('Pokaż cztery diagramy.');
	const started = Date.now();
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(
		() =>
			document.querySelectorAll('.llampart-assistant-markdown .llampart-diagram-frame').length ===
			4,
		null,
		{ timeout: 60000 }
	);
	const renderMs = Date.now() - started;
	await Promise.all(pending);
	assert(sizes.has(core));
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-diagram-fallback').length === 2
	);
	for (const [i, type] of ['flowchart', 'state', 'gantt', 'mindmap'].entries()) {
		const frame = page.locator('.llampart-diagram-frame').nth(i);
		assert(
			(
				await frame
					.locator('text')
					.first()
					.evaluate((text) => getComputedStyle(text).fontFamily)
			).includes('Crimson Text')
		);
		assert.equal(
			await frame
				.locator('text')
				.first()
				.evaluate((text) => getComputedStyle(text).fontSize),
			'16px'
		);
		assert.equal(
			await frame.locator('.diagram-title').innerText(),
			['Przepływ żądania', 'Generowanie odpowiedzi', 'Plan wdrożenia', 'llampart'][i]
		);
		await frame.getByRole('button', { name: 'Podgląd diagramu', exact: true }).click();
		const dialog = page.locator('.diagram-preview-dialog-content');
		await dialog.locator('svg[role="img"]').waitFor();
		const bounds = await dialog.boundingBox();
		assert(bounds.width <= 1281 && bounds.height <= 801);
		assert.equal(await dialog.locator('img,canvas').count(), 0);
		if (type === 'gantt')
			assert.equal(await dialog.locator('text').filter({ hasText: 'Plan wdrożenia' }).count(), 0);
		if (type === 'mindmap')
			assert.equal(await dialog.locator('.section-root > rect.basic').count(), 1);
		await page.screenshot({ path: `${artifacts}/production-${type}-preview.png` });
		await page.keyboard.press('Escape');
		for (const format of ['SVG', 'PNG']) {
			const download = page.waitForEvent('download');
			await frame
				.getByRole('button', { name: `Eksportuj diagram jako ${format}`, exact: true })
				.click();
			const path = `${artifacts}/production-${type}.${format.toLowerCase()}`;
			await (await download).saveAs(path);
			transparency.push({
				type,
				...(await assertTransparentExport(page, await readFile(path), format))
			});
		}
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(external, []);
	const added = [...sizes].filter(([path]) => !before.has(path));
	const removedTypeChunks = Object.entries(manifest)
		.filter(([key]) => /\/(?:sequenceDiagram|erDiagram)[^/]*\.mjs$/.test(key))
		.map(([, value]) => '/' + value.file);
	assert(
		!removedTypeChunks.some((path) => sizes.has(path)),
		'Removed diagram families must not be requested'
	);
	const report = {
		initialJsBytes: [...before.values()].reduce((a, b) => a + b, 0),
		fourDiagramsAdditionalJsBytes: added.reduce((sum, [, bytes]) => sum + bytes, 0),
		renderMs,
		noEngineBeforeAnswer: !before.has(core),
		requestedElk: sizes.has('/' + manifest[elkKey].file),
		errors,
		external
	};
	await writeFile(`${artifacts}/production-results.json`, JSON.stringify(report, null, 2));
	await writeFile(`${artifacts}/transparency.json`, JSON.stringify(transparency, null, 2));
	console.log(JSON.stringify(report, null, 2));
	console.log(
		'PASS production: four families, lazy engine/ELK, full SVG dialogs, all PNG/SVG exports, no external requests'
	);
} finally {
	await browser.close();
}
