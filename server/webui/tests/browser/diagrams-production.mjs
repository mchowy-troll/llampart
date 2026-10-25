/** Production-only Chromium smoke/performance probe; serve the existing server/public build.
 * Real WebUI/renderers/downloads; synthetic provider HTTP/SSE, not live inference.
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
assert(key, 'Production manifest must contain the Mermaid core');
const core = '/' + manifest[key].file;
const elkKey = Object.keys(manifest).find((key) => /\/elk-[^/]+\.mjs$/.test(key));
assert(elkKey, 'Production manifest must contain the lazy ELK chunk');
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
	// Fresh context: close the actual welcome modal instead of guessing its version.
	// Waiting explicitly also catches an unresponsive modal before the rendering probe.
	const welcome = page.locator('.llampart-about-dialog-content');
	await welcome.waitFor({ state: 'visible', timeout: 10000 });
	await welcome.getByRole('button', { name: 'OK', exact: true }).click();
	await welcome.waitFor({ state: 'hidden' });
	const composer = page.locator('textarea').first();
	await composer.waitFor();
	await Promise.all(pending);
	assert(!sizes.has(core), 'Engine must stay lazy');
	const before = new Map(sizes);
	const prompt = 'Pokaż cztery diagramy.';
	await composer.fill(prompt);
	const started = Date.now();
	const [request, response] = await Promise.all([
		page.waitForRequest(
			(request) => request.url().endsWith('/chat/completions') && request.method() === 'POST',
			{ timeout: 10000 }
		),
		page.waitForResponse((response) => response.url().endsWith('/chat/completions'), {
			timeout: 10000
		}),
		composer.press('Enter')
	]);
	assert(
		request
			.postDataJSON()
			.messages.some((message) => message.role === 'user' && message.content === prompt),
		'Chat request must contain the submitted user message'
	);
	assert.equal(response.status(), 200, 'Synthetic provider must return the answer');
	assert.equal(await response.finished(), null, 'SSE response must finish successfully');
	const assistant = page.locator('.llampart-assistant-markdown');
	await assistant.getByRole('heading', { name: 'Przepływ żądania', exact: true }).waitFor();
	await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
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
		const svg = frame.locator('.diagram-surface svg');
		await svg.waitFor({ state: 'visible' });
		const svgBounds = await svg.boundingBox();
		assert(svgBounds.width > 0 && svgBounds.height > 0, `${type}: SVG must have visible geometry`);
		// Explicit roles: edge labels use visualizationLabelSize (0.8 × text unit),
		// Gantt uses that label size + 1px; the other families keep the body size.
		const bodySize = await page
			.locator('body')
			.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
		const labelSize = bodySize * 0.8;
		const roles =
			type === 'gantt'
				? [
						['task', 'text[class*="taskText"]'],
						['section', 'text[class*="sectionTitle"]'],
						['axis', '.tick text']
					]
				: [['node', type === 'mindmap' ? '.mindmap-node text' : '.node text']];
		if (type === 'flowchart' || type === 'state') roles.push(['edge', '.edgeLabel text']);
		for (const [role, selector] of roles) {
			const texts = frame.locator(selector);
			assert((await texts.count()) > 0, `${type}: missing ${role}`);
			for (const text of await texts.all()) {
				const style = await text.evaluate((n) => ({
					family: getComputedStyle(n).fontFamily,
					size: parseFloat(getComputedStyle(n).fontSize)
				}));
				assert(style.family.includes('Crimson Text'), `${type} ${role}: ${style.family}`);
				assert.equal(
					style.size,
					type === 'gantt' ? labelSize + 1 : role === 'edge' ? labelSize : bodySize,
					`${type} ${role}`
				);
			}
		}
		assert.equal(
			await frame.locator('.diagram-title').innerText(),
			['Przepływ żądania', 'Generowanie odpowiedzi', 'Plan wdrożenia', 'llampart'][i]
		);
		const titleStyle = await frame.locator('.diagram-title').evaluate((n) => ({
			family: getComputedStyle(n).fontFamily,
			size: parseFloat(getComputedStyle(n).fontSize),
			weight: getComputedStyle(n).fontWeight,
			medium: getComputedStyle(n).getPropertyValue('--llampart-font-medium').trim() || '500'
		}));
		assert(titleStyle.family.includes('Crimson Text'));
		assert.equal(titleStyle.size, bodySize, `${type}: header inherits body typography`);
		assert.equal(titleStyle.weight, titleStyle.medium, `${type}: header uses medium token`);
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
		backend: 'synthetic HTTP/SSE (no live inference)',
		chatRequestSent: true,
		answerReceived: true,
		renderedSvgCount: await assistant.locator('.diagram-surface svg').count(),
		fallbackCount: await assistant.locator('.llampart-diagram-fallback').count(),
		verifiedExports: transparency.length,
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
		'MOCK PASS Chromium production: submitted chat, synthetic SSE answer, four rendered SVG families, two fallbacks, lazy engine/ELK, full SVG dialogs, all PNG/SVG exports, no external requests'
	);
} finally {
	await browser.close();
}
