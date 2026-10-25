/** Real Chromium + app Markdown/IndexedDB/Settings; no inference or renderer service.
 * LLAMPART_PLAYWRIGHT_MODULE=/tmp/opencode/llampart-browser-tools/node_modules/playwright-core/index.mjs node tests/browser/diagrams.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTransparentExport } from './export-transparency.mjs';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-diagrams';
await mkdir(artifacts, { recursive: true });
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({
	viewport: { width: 1600, height: 1000 },
	acceptDownloads: true
});
const page = await context.newPage();
await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
	await welcome.locator('#about-llampart-do-not-show-again').check();
	await welcome.getByRole('button', { name: 'OK', exact: true }).click();
});
const errors = [],
	transparency = [],
	warnings = [],
	external = [],
	requests = [];
page.on('pageerror', (error) => {
	errors.push(error.stack || error.message);
	console.error(error.stack || error.message);
});
page.on('console', (event) => {
	if (event.type() === 'warning' && event.text().startsWith('Mermaid:'))
		warnings.push(event.text());
});
page.on('request', (request) => {
	if (!request.url().startsWith(base) && !/^(data|blob):/.test(request.url()))
		external.push(request.url());
	requests.push(request.url());
});
const fence = (source) => '```mermaid\n' + source + '\n```';
const samples = [
	[
		'flowchart',
		'flowchart LR\n subgraph local[Przeglądarka]\n A[Użytkownik] --> B[llampart]\n B --> C{Model lokalny}\n C --> D[Odpowiedź]\n end\n D --> E[Markdown]\n E --> F[Diagram]'
	],
	[
		'state',
		'stateDiagram-v2\n [*] --> Gotowy\n Gotowy --> Generowanie: Wyślij\n Generowanie --> Renderowanie: Zamknięty blok\n Renderowanie --> Gotowy: Odpowiedź\n Renderowanie --> Błąd: Niepoprawna składnia\n Błąd --> Gotowy: Pokaż kod'
	],
	[
		'gantt',
		'gantt\n title Plan wdrożenia\n dateFormat YYYY-MM-DD\n axisFormat %d.%m\n section Przygotowanie\n Analiza :done, a, 2026-10-01, 3d\n Projekt :a2, after a, 4d\n section Implementacja\n Markdown :active, b, after a2, 5d\n Eksport :c, after b, 3d\n Testy :crit, d, after c, 4d'
	],
	[
		'mindmap',
		'mindmap\n root((llampart))\n  Rozmowa\n   Markdown\n   Streaming\n  Wizualizacje\n   Wykresy\n   Diagramy\n  Prywatność\n   Lokalne fonty\n   Brak usług zewnętrznych\n  Ustawienia\n   Typografia\n   Preferencje\n  Modele\n   Lokalne\n   Zdalne'
	]
];
const titles = [
	'Przepływ żądania LLM',
	'Stany generowania odpowiedzi',
	'Plan wdrożenia',
	'Obszary llampart'
];
samples.forEach((sample, i) => {
	sample[1] = sample[1].replace('\n', `\n %% title: ${titles[i]}\n`);
});
const complexSamples = [
	[
		'flowchart',
		`flowchart TB
%% title: Obsługa żądania — wiele etapów
subgraph client[Klient]
U[Żądanie użytkownika] --> V{Poprawne dane?}
V -->|Nie| N[Wyjaśnienie problemu]
end
subgraph compute[Przetwarzanie]
V -->|Tak| R{Wybór środowiska}
R -->|Lokalnie| L[Model lokalny]
R -->|Klaster GPU| G[Kolejka zadań]
G --> M[Wnioskowanie GPU]
L --> O[Wynik modelu]
M --> O
end
subgraph output[Prezentacja]
O --> P[Walidacja Markdown]
P --> F[Wykresy i diagramy]
P --> T[Tekst odpowiedzi]
F --> S[Zapis rozmowy]
T --> S
end`
	],
	[
		'state',
		`stateDiagram-v2
%% title: Cykl obsługi zamówienia
[*] --> Gotowy
state Obsługa {
[*] --> Walidacja
Walidacja --> Realizacja: Dane poprawne
Walidacja --> Korekta: Brak danych
Korekta --> Walidacja: Uzupełnienie
Realizacja --> Kontrola: Wynik
Kontrola --> Realizacja: Ponów
Kontrola --> [*]: Zaakceptowano
}
Gotowy --> Obsługa: Zlecenie
Obsługa --> Gotowy: Zakończenie
Obsługa --> Wstrzymany: Przerwanie
Wstrzymany --> Obsługa: Wznowienie
Wstrzymany --> Gotowy: Anulowanie
Gotowy --> [*]: Zamknięcie`
	],
	[
		'mindmap',
		`mindmap
%% title: Strategia produktu
root((llampart))
 Rozmowa
  Historia
   Wyszukiwanie
   Eksport
  Streaming
   Tokeny
   Zatrzymanie
 Wizualizacje
  Wykresy
   Line i Area
   Bar i Donut
  Diagramy
   Procesy
   Harmonogramy
 Prywatność
  Lokalne dane
   IndexedDB
  Fonty WOFF2
 Ustawienia
  Wygląd
   Frosted Glass
   Typografia
  Preferencje odpowiedzi
 Modele
  Lokalne
   CPU
   GPU
  Dostawcy zewnętrzni`
	],
	[
		'gantt',
		`gantt
%% title: Harmonogram biznesowy — długie nazwy
dateFormat YYYY-MM-DD
axisFormat %Y-%m-%d
tickInterval 1day
section Przygotowanie
Warsztaty z interesariuszami :a,2026-01-01,8d
Pełna analiza wymagań i uzgodnienie zakresu :b,after a,1d
Projekt doświadczenia użytkownika :c,after b,28d
section Implementacja
Implementacja podstawowych funkcji :d,after c,40d
Krótka weryfikacja zgodności specyfikacji :e,after d,1d
Integracja danych i dostawców :f,after e,25d
section Weryfikacja
Testy bezpieczeństwa i lokalnych fontów :g,after f,12d
Odbiór rozwiązania przez interesariuszy :h,after g,1d
Pilotaż :i,after h,30d
section Wdrożenie
Publikacja :milestone,j,after i,0d
Wsparcie po wdrożeniu :k,after j,45d`
	]
];
const chart =
	'```llampart-chart\n' +
	JSON.stringify({
		type: 'line',
		title: 'Wykres llampart — porównanie stylu',
		xKey: 'x',
		series: [{ key: 'y', label: 'Postęp' }],
		data: [
			{ x: 'A', y: 3 },
			{ x: 'B', y: 7 },
			{ x: 'C', y: 5 }
		]
	}) +
	'\n```';
const table = '| Etap | Stan |\n|---|---|\n| Diagram | Gotowy |';
const markdown =
	samples.map(([name, source]) => `**${name}**\n\n${fence(source)}`).join('\n\n') +
	'\n\n' +
	chart +
	'\n\n' +
	table +
	'\n\n$$\nx^2+y^2=z^2\n$$\n\nKoniec odpowiedzi.';
await page.addInitScript(() => {
	if (!localStorage.getItem('LlamaCppWebui.config'))
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'llama-server',
				serverBaseUrl: 'http://diagrams.test',
				llamaServerBaseUrl: 'http://diagrams.test',
				interfaceLanguage: 'pl',
				theme: 'frosted-glass',
				frostedGlassWallpaper: 'frosted-glass-02',
				fontFamily: 'fira-sans',
				fontVariant: '400',
				fontSize: 'default',
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false,
				renderUserContentAsMarkdown: true,
				renderReasoningContentAsMarkdown: true,
				minimalAgenticIndicators: false
			})
		);
});
await page.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	if (path.endsWith('/chat/completions'))
		return route.fulfill({
			contentType: 'text/event-stream',
			body: `data: ${JSON.stringify({ choices: [{ delta: { content: markdown, reasoning_content: fence(samples[0][1]) } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
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
const assistant = page.locator('.llampart-assistant-markdown').first();
const frames = assistant.locator('.llampart-diagram-frame');
const preview = page.locator('.diagram-preview-dialog-content');
async function ready(count = 4) {
	await page.waitForFunction(
		(count) => {
			const a = document.querySelector('.llampart-assistant-markdown');
			return (
				a?.querySelectorAll('.llampart-diagram-frame').length === count &&
				!a?.querySelector('.llampart-inline-processing-status')
			);
		},
		count,
		{ timeout: 90000 }
	);
}
async function setContent(content) {
	await page.evaluate(async (content) => {
		const { conversations, db } = window.diagramTest;
		const message = conversations.activeMessages.find((m) => m.role === 'assistant');
		await db.updateMessage(message.id, { content });
		conversations.updateMessageAtIndex(conversations.findMessageIndex(message.id), { content });
	}, content);
}
async function settings(patch) {
	await page.evaluate((patch) => {
		for (const [key, value] of Object.entries(patch))
			window.diagramTest.settings.updateConfig(key, value);
	}, patch);
	await ready();
}
async function screenshot(name, target = frames.first()) {
	await target.scrollIntoViewIfNeeded();
	await target.evaluate((element) =>
		element.scrollIntoView({ block: 'center', behavior: 'instant' })
	);
	await target.evaluate(async (element) => {
		await Promise.allSettled(
			element
				.closest('.markdown-block')
				?.getAnimations()
				.map((a) => a.finished) || []
		);
	});
	await page.screenshot({ path: `${artifacts}/${name}.png` });
}
async function assertLabelSpacing() {
	for (const frame of await frames.all()) {
		const collisions = await frame.locator('.diagram-surface').evaluate((host) => {
			const labels = [...host.shadowRoot.querySelectorAll('text')]
				.map((text) => ({ value: text.textContent.trim(), box: text.getBoundingClientRect() }))
				.filter(({ value, box }) => value && box.width && box.height);
			return labels.flatMap((a, i) =>
				labels
					.slice(i + 1)
					.filter(
						(b) =>
							Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 &&
							Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1
					)
					.map((b) => [a.value, b.value])
			);
		});
		assert.deepEqual(
			collisions,
			[],
			`Overlapping labels in ${await frame.getAttribute('aria-label')}`
		);
		const schedule = await frame.locator('.diagram-surface').evaluate((host) => {
			const svg = host.shadowRoot.querySelector('svg');
			const stateCentered = [...svg.querySelectorAll('g.node.statediagram-state')].every((node) => {
				const shape = node.querySelector(':scope > rect.basic'),
					text = node.querySelector(':scope > .label text');
				if (!shape || !text) return true;
				const a = shape.getBoundingClientRect(),
					b = text.getBoundingClientRect();
				return (
					Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 0.8 &&
					Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 0.8
				);
			});
			const outsideClear = [
				...svg.querySelectorAll('text.taskTextOutsideLeft,text.taskTextOutsideRight')
			].every((text) => {
				const bar = svg.getElementById(text.id.replace(/-text$/, ''));
				const a = bar.getBoundingClientRect(),
					b = text.getBoundingClientRect();
				return text.classList.contains('taskTextOutsideRight')
					? b.left - a.right > 1
					: a.left - b.right > 1;
			});
			const root = svg.querySelector('.section-root');
			const mindmapRoot =
				!root ||
				(root.querySelector(':scope > rect.basic') && !root.querySelector(':scope > circle'));
			const mindmapCurves = [...svg.querySelectorAll('path.edge[class*="edge-depth-"]')].every(
				(path) => {
					return (
						/^M[^C]+C[^LCQ]+$/.test(path.getAttribute('d')) &&
						parseFloat(getComputedStyle(path).strokeWidth) === 3
					);
				}
			);
			const mindmapCleanNodes =
				svg.querySelectorAll('.mindmap-node > line.node-line-').length === 0;
			const ticks = [...svg.querySelectorAll('.grid .tick text')].map((el) =>
				el.getBoundingClientRect()
			);
			const centered = [...svg.querySelectorAll('text.taskText')].every((text) => {
				const bar = svg.querySelector(`[id="${CSS.escape(text.id.replace(/-text$/, ''))}"]`);
				if (!bar) return false;
				const a = text.getBoundingClientRect(),
					b = bar.getBoundingClientRect();
				return (
					Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) < 1 &&
					Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) <
						parseFloat(getComputedStyle(text).fontSize) * 0.3
				);
			});
			return {
				stateCentered,
				outsideClear,
				mindmapRoot: Boolean(mindmapRoot),
				mindmapCurves,
				mindmapCleanNodes,
				centered,
				separated: ticks.every((tick, i) => i === 0 || tick.left - ticks[i - 1].right >= 3),
				unresolved: Number(svg.dataset.unresolvedLabels || 0)
			};
		});
		assert(schedule.centered, 'Gantt in-bar labels must be centered');
		assert(schedule.stateCentered, 'State text must be centered in both axes');
		assert(schedule.outsideClear, 'Gantt outside text must clear bars and rotated milestones');
		assert(schedule.mindmapRoot, 'Mindmap root must be a native rounded rectangle');
		assert(schedule.mindmapCurves, 'Mindmap branches must be continuous 3px cubic curves');
		assert(schedule.mindmapCleanNodes, 'Mindmap rectangles must not have decorative underlines');
		assert(schedule.separated, 'Gantt dates must have breathing room');
		assert.equal(
			schedule.unresolved,
			0,
			`Unresolved edge-label placement in ${await frame.getAttribute('aria-label')}`
		);
	}
}

try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	assert(
		!requests.some((url) => /mermaid-runtime|mermaid\.core|mermaid_core/.test(url)),
		'Engine must not load without a diagram'
	);
	await page.locator('textarea').first().fill(fence(samples[0][1]));
	await page.locator('textarea').first().press('Enter');
	const started = Date.now();
	try {
		await ready();
	} catch (error) {
		await page.screenshot({ path: `${artifacts}/failure.png` });
		console.log(await assistant.innerText());
		throw error;
	}
	assert.equal(await frames.count(), 4);
	await assertLabelSpacing();
	for (const frame of await frames.all()) {
		for (const rect of await frame.locator('.edgeLabel .background').all())
			assert.equal(await rect.evaluate((el) => getComputedStyle(el).opacity), '0');
	}
	assert.equal(await frames.nth(2).locator('.today').count(), 0);
	for (let i = 0; i < samples.length; i++)
		assert.equal(await frames.nth(i).locator('.diagram-title').innerText(), titles[i]);
	const initialRenderMs = Date.now() - started;
	assert.equal(await page.locator('.markdown-user-content .llampart-diagram-frame').count(), 0);
	assert.equal(
		await page.locator('.llampart-reasoning-content .llampart-diagram-frame').count(),
		0
	);
	assert.equal(await assistant.locator('.llampart-chart-frame').count(), 1);
	assert.equal(await assistant.locator('.katex-display').count(), 1);
	await page.evaluate(async () => {
		window.diagramTest = await import('/tests/browser/charts-harness.ts');
	});
	for (const wallpaper of ['frosted-glass-02', 'frosted-glass-04']) {
		await settings({ frostedGlassWallpaper: wallpaper });
		for (let i = 0; i < samples.length; i++)
			await screenshot(`${wallpaper}-${samples[i][0]}`, frames.nth(i));
	}
	await screenshot('diagram-next-to-chart', frames.last());
	// Frames share structural CSS and the exact Frosted Glass material tokens.
	const surfaces = await page.locator('.llampart-visualization-frame').evaluateAll((elements) =>
		elements.map((el) => {
			const css = getComputedStyle(el);
			return [css.backgroundColor, css.backdropFilter, css.border, css.boxShadow, css.borderRadius];
		})
	);
	for (const surface of surfaces) assert.deepEqual(surface, surfaces[0]);
	for (const frame of await page.locator('.llampart-visualization-frame').all()) {
		const actions = frame.locator('.visualization-actions button');
		assert.equal(
			await actions
				.last()
				.getAttribute('class')
				.then((value) => value.includes('visualization-preview-action')),
			true
		);
		const positions = await actions.evaluateAll((buttons) =>
			buttons.map((b) => b.getBoundingClientRect().x)
		);
		assert.deepEqual(
			positions,
			[...positions].sort((a, b) => a - b)
		);
	}
	const chartFrame = assistant.locator('.llampart-chart-frame');
	assert.equal(
		await chartFrame
			.locator('.chart-actions button')
			.allTextContents()
			.then((labels) => labels.map((label) => label.trim()).join(',')),
		'PNG,SVG,CSV,'
	);
	const chartEye = chartFrame.getByRole('button', { name: 'Podgląd wykresu', exact: true });
	await chartEye.click();
	const chartPreview = page.locator('.chart-preview-dialog-content');
	await chartPreview.locator('svg[role="img"]').waitFor();
	const chartBounds = await chartPreview.boundingBox();
	assert(chartBounds.width <= 1281 && chartBounds.height <= 801);
	assert((await chartPreview.innerText()).includes('Wykres llampart'));
	assert.equal(await chartPreview.getByRole('button', { name: /PNG|SVG|CSV/ }).count(), 0);
	await page.screenshot({ path: `${artifacts}/chart-eye-preview.png` });
	await page.keyboard.press('Escape');
	assert(await chartEye.evaluate((el) => el === document.activeElement));
	await chartEye.click();
	await chartPreview.locator('.chart-live-preview svg[role="img"]').waitFor();
	await chartPreview.locator('.chart-plot').hover({ position: { x: 120, y: 100 } });
	await page
		.locator('.chart-preview-tooltip-root .llampart-chart-tooltip')
		.waitFor({ state: 'visible' });
	await page.screenshot({ path: `${artifacts}/chart-active-tooltip.png` });
	await settings({
		fontFamily: 'crimson-text',
		fontSize: '20',
		frostedGlassWallpaper: 'frosted-glass-02'
	});
	await page.waitForFunction(() => {
		const inline = document.querySelector('.llampart-chart-frame');
		const popup = document.querySelector('.chart-live-preview');
		return (
			popup &&
			getComputedStyle(popup).fontFamily === getComputedStyle(inline).fontFamily &&
			getComputedStyle(popup).fontSize === getComputedStyle(inline).fontSize
		);
	});
	await page.keyboard.press('Escape');
	await settings({ fontFamily: 'fira-sans', fontSize: 'default' });
	for (const [family, size, variant] of [
		['crimson-text', '16', '600'],
		['libre-caslon-condensed', '20', '400'],
		['fira-sans', 'default', '400']
	]) {
		await settings({ fontFamily: family, fontSize: size, fontVariant: variant });
		const text = frames.first().locator('.diagram-surface .node text').first();
		assert(
			(await text.evaluate((el) => getComputedStyle(el).fontFamily))
				.toLowerCase()
				.includes(family.split('-')[0])
		);
		if (size !== 'default')
			assert.equal(await text.evaluate((el) => getComputedStyle(el).fontSize), `${size}px`);
		assert.equal(await text.evaluate((el) => getComputedStyle(el).fontWeight), variant);
		assert(
			(
				await frames
					.first()
					.locator('.cluster-label text')
					.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontWeight))
			).every((weight) => weight === '700')
		);
		await assertLabelSpacing();
		await screenshot(`font-${family}-${size}`);
		for (const format of ['SVG', 'PNG']) {
			const downloaded = page.waitForEvent('download');
			await frames
				.first()
				.getByRole('button', { name: `Eksportuj diagram jako ${format}`, exact: true })
				.click();
			const download = await downloaded;
			const file = `${artifacts}/${family}-${size}.${format.toLowerCase()}`;
			await download.saveAs(file);
			const bytes = await readFile(file);
			transparency.push({
				type: 'flowchart',
				family,
				size,
				...(await assertTransparentExport(page, bytes, format))
			});
			if (format === 'SVG') {
				const svg = bytes.toString();
				assert(svg.includes('data:font/woff2;base64,'));
				assert(!/foreignObject|<script|<button|https?:\/\/(?!www\.w3\.org)/i.test(svg));
				assert(svg.includes('Użytkownik'));
				const reopened = await context.newPage();
				try {
					await reopened.goto(`data:image/svg+xml;base64,${bytes.toString('base64')}`);
					await reopened.evaluate(() => document.fonts.ready);
					assert.equal(await reopened.locator('parsererror').count(), 0);
					assert(
						await reopened.evaluate(() =>
							[...document.styleSheets]
								.flatMap((sheet) => [...sheet.cssRules])
								.filter((rule) => rule instanceof CSSFontFaceRule)
								.some((rule) => {
									const range = rule.style.fontWeight.split(/\s+/).map(Number);
									return (
										range[0] <= 700 &&
										(range[1] ?? range[0]) >= 700 &&
										rule.style.src.includes('data:font/woff2;base64,')
									);
								})
						),
						'Exported SVG must embed the bold section face (700)'
					);
					const headings = reopened.locator('.cluster-label text');
					assert((await headings.count()) > 0, 'Exported SVG must retain section headings');
					assert(
						(
							await headings.evaluateAll((nodes) =>
								nodes.map((node) => getComputedStyle(node).fontWeight)
							)
						).every((weight) => weight === '700'),
						'Exported SVG section headings must use bold (700)'
					);
					console.log(`PASS standalone SVG: embedded bold 700 and section headings (${family})`);
				} finally {
					await reopened.close();
				}
			} else assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
		}
	}
	for (let i = 0; i < samples.length; i++) {
		await frames.nth(i).getByRole('button', { name: 'Podgląd diagramu', exact: true }).click();
		await preview.waitFor();
		const bounds = await preview.boundingBox();
		assert(bounds.width <= 1600 * 0.8 + 1 && bounds.height <= 1000 * 0.8 + 1);
		assert.equal(await preview.locator('svg[role="img"]').count(), 1);
		assert.equal(await preview.getByRole('button', { name: /PNG|SVG|Mermaid/ }).count(), 0);
		await page.screenshot({ path: `${artifacts}/preview-${samples[i][0]}.png` });
		await page.keyboard.press('Escape');
		await preview.waitFor({ state: 'hidden' });
		assert(
			await frames
				.nth(i)
				.getByRole('button', { name: 'Podgląd diagramu', exact: true })
				.evaluate((el) => el === document.activeElement)
		);
	}
	// Export every family, then reopen standalone SVG and PNG while offline.
	const offline = await context.newPage();
	for (let i = 0; i < samples.length; i++) {
		for (const format of ['SVG', 'PNG']) {
			const downloaded = page.waitForEvent('download');
			await frames
				.nth(i)
				.getByRole('button', { name: `Eksportuj diagram jako ${format}`, exact: true })
				.click();
			const download = await downloaded;
			const file = `${artifacts}/${samples[i][0]}.${format.toLowerCase()}`;
			await download.saveAs(file);
			const bytes = await readFile(file);
			transparency.push({
				type: samples[i][0],
				...(await assertTransparentExport(page, bytes, format))
			});
			await context.setOffline(true);
			await offline.setContent(
				'<style>body{margin:0;background:#f5f6f5}img{max-width:100%;height:auto}</style><img alt="Standalone diagram">'
			);
			const dimensions = await offline.locator('img').evaluate(
				async (img, data) => {
					img.src = data;
					await img.decode();
					return { width: img.naturalWidth, height: img.naturalHeight };
				},
				`data:${format === 'SVG' ? 'image/svg+xml' : 'image/png'};base64,${bytes.toString('base64')}`
			);
			assert(dimensions.width > 100 && dimensions.height > 50);
			await offline.screenshot({ path: `${artifacts}/offline-${samples[i][0]}-${format}.png` });
			await context.setOffline(false);
		}
	}
	await offline.close();
	await writeFile(`${artifacts}/transparency.json`, JSON.stringify(transparency, null, 2));
	console.log(
		'PASS Flowchart/State/Mindmap/Gantt PNG RGBA alpha=0 and SVG without document backdrop'
	);
	await assistant.locator('.table-preview-button').click();
	assert.equal(await page.locator('.table-preview-dialog-content').locator('table').count(), 1);
	assert.equal(
		(await page.locator('.table-preview-dialog-content').boundingBox()).width,
		1600 * 0.8
	);
	await page.keyboard.press('Escape');
	assert.equal(
		await assistant.locator('.table-preview-button svg path').first().getAttribute('d'),
		await frames
			.first()
			.getByRole('button', { name: 'Podgląd diagramu', exact: true })
			.locator('svg path')
			.getAttribute('d')
	);
	console.log(
		'PASS four types, two wallpapers, three fonts/sizes/weights, PNG/SVG, eye preview/Escape/focus, tables and live charts'
	);
	const geometry = [];
	for (const [wallpaper, family, size] of [
		['frosted-glass-02', 'fira-sans', '16'],
		['frosted-glass-04', 'crimson-text', '20']
	]) {
		await setContent(complexSamples.map(([, source]) => fence(source)).join('\n\n'));
		await settings({ frostedGlassWallpaper: wallpaper, fontFamily: family, fontSize: size });
		await assertLabelSpacing();
		for (let i = 0; i < complexSamples.length; i++) {
			const frame = frames.nth(i),
				name = complexSamples[i][0];
			await screenshot(`complex-${wallpaper}-${family}-${name}`, frame);
			const stats = await frame.locator('.diagram-surface').evaluate((host) => {
				const svg = host.shadowRoot.querySelector('svg');
				return {
					unresolved: Number(svg.dataset.unresolvedLabels || 0),
					unresolvedLabels: [...svg.querySelectorAll('[data-layout-collision]')].map((label) =>
						label.textContent.trim()
					),
					width: svg.viewBox.baseVal.width,
					height: svg.viewBox.baseVal.height,
					today: svg.querySelectorAll('.today').length
				};
			});
			geometry.push({ wallpaper, family, size, name, ...stats });
			assert.equal(stats.unresolved, 0);
			assert.equal(stats.today, 0);
			await frame.getByRole('button', { name: 'Podgląd diagramu', exact: true }).click();
			assert.equal(await preview.locator('svg[role="img"]').count(), 1);
			assert.equal(await preview.locator('img,canvas').count(), 0);
			await page.screenshot({ path: `${artifacts}/complex-preview-${wallpaper}-${name}.png` });
			await page.keyboard.press('Escape');
			for (const format of ['SVG', 'PNG']) {
				const download = page.waitForEvent('download');
				await frame
					.getByRole('button', { name: `Eksportuj diagram jako ${format}`, exact: true })
					.click();
				await (
					await download
				).saveAs(`${artifacts}/complex-${wallpaper}-${name}.${format.toLowerCase()}`);
			}
		}
	}
	await writeFile(`${artifacts}/geometry.json`, JSON.stringify(geometry, null, 2));
	const contextSources = [
		'### Przepływ **biznesowy**\n\n' +
			fence(
				'flowchart LR\nA[Wniosek] --> B{Zgoda?}\nB -->|Tak| C[Realizacja]\nB -->|Nie| D[Korekta]'
			),
		'## Stany zamówienia\n\n' +
			fence(
				'stateDiagram-v2\n[*] --> Gotowy\nGotowy --> Praca: Dane poprawne\nGotowy --> Anulowanie: Anuluj\nPraca --> [*]: Zakończ\nAnulowanie --> [*]: Zamknij'
			),
		'**Strategia produktu**\n\n' + fence('mindmap\nroot((Firma))\n  Produkt\n  Rynek'),
		'### Nagłówek kontekstu\n\n' +
			fence(
				'gantt\ntitle Plan roczny\ndateFormat YYYY-MM-DD\nsection Plan\nWarsztaty :a,2026-01-28,1d\nOdbiór :milestone,m,after a,0d\nWdrożenie :after m,8d'
			)
	];
	await setContent(contextSources.join('\n\n'));
	await assertLabelSpacing();
	for (const [i, title] of [
		'Przepływ biznesowy',
		'Stany zamówienia',
		'Strategia produktu',
		'Plan roczny'
	].entries()) {
		assert.equal(await frames.nth(i).locator('.diagram-title').innerText(), title);
		await frames.nth(i).getByRole('button', { name: 'Podgląd diagramu', exact: true }).click();
		assert.equal(await preview.locator('.table-preview-title').innerText(), title);
		if (i === 3) assert.equal(await preview.locator('text').filter({ hasText: title }).count(), 0);
		await page.screenshot({ path: `${artifacts}/title-${i}.png` });
		await page.keyboard.press('Escape');
	}
	assert.equal(
		await frames
			.nth(0)
			.locator('.node polygon')
			.first()
			.evaluate((node) => getComputedStyle(node).fill),
		'rgb(0, 163, 163)'
	);
	const terminalPaths = await frames
		.nth(1)
		.locator('.diagram-surface')
		.evaluate((host) => {
			const svg = host.shadowRoot.querySelector('svg');
			const paths = [...svg.querySelectorAll('.edgePaths path')];
			return {
				count: paths.length,
				ends: paths.slice(-2).map((p) => {
					const end = p.getPointAtLength(p.getTotalLength());
					return [end.x, end.y];
				})
			};
		});
	assert.equal(
		terminalPaths.count,
		5,
		'Native shared terminal ports must preserve every relationship'
	);
	assert.deepEqual(terminalPaths.ends[0], terminalPaths.ends[1], 'Terminal entry must be aligned');
	console.log(
		'PASS contextual/native frame titles, no duplicate Gantt title, centered State, shared terminal entry, rounded Mindmap root and 3px cubic branches'
	);
	await setContent(markdown);
	await settings({ fontFamily: 'fira-sans', fontSize: 'default' });
	console.log(
		'PASS complex four-family examples at two wallpapers/fonts/sizes, full SVG preview and PNG/SVG export'
	);

	// Actual transactional preview: re-layout, Cancel, Save and Reset-to-defaults.
	await page.evaluate(() => {
		const { settings } = window.diagramTest;
		window.diagramPreview = settings.beginPreview();
		settings.updatePreview(window.diagramPreview, {
			fontFamily: 'crimson-text',
			fontSize: '20',
			fontVariant: '600'
		});
	});
	await ready();
	assert.equal(
		await frames
			.first()
			.locator('text')
			.first()
			.evaluate((el) => getComputedStyle(el).fontSize),
		'20px'
	);
	await page.evaluate(() => window.diagramTest.settings.cancelPreview(window.diagramPreview));
	await ready();
	assert(
		(
			await frames
				.first()
				.locator('text')
				.first()
				.evaluate((el) => getComputedStyle(el).fontFamily)
		).includes('Fira Sans')
	);
	await page.evaluate(() => {
		const { settings } = window.diagramTest;
		window.diagramPreview = settings.beginPreview();
		settings.updatePreview(window.diagramPreview, {
			fontFamily: 'libre-caslon-condensed',
			fontSize: '16'
		});
		settings.commitPreview(window.diagramPreview, {
			fontFamily: 'libre-caslon-condensed',
			fontSize: '16'
		});
	});
	await ready();
	assert(
		(
			await frames
				.first()
				.locator('text')
				.first()
				.evaluate((el) => getComputedStyle(el).fontFamily)
		).includes('Libre Caslon')
	);
	await page.evaluate(async () => {
		const { SETTING_CONFIG_DEFAULT } = await import('/src/lib/constants/settings-config.ts');
		const { settings } = window.diagramTest;
		window.diagramPreview = settings.beginPreview();
		settings.updatePreview(window.diagramPreview, SETTING_CONFIG_DEFAULT);
	});
	await ready();
	await page.evaluate(() => window.diagramTest.settings.cancelPreview(window.diagramPreview));
	await ready();
	await settings({ fontFamily: 'fira-sans', fontSize: '16' });
	await settings({ interfaceLanguage: 'en' });
	assert.equal(
		await frames.first().getByRole('button', { name: 'Preview diagram', exact: true }).count(),
		1
	);
	await settings({ interfaceLanguage: 'pl' });

	// Stable completed diagrams must retain their SVG identity while tokens append.
	const first = fence(samples[0][1]);
	await setContent('Początek\n\n```mermaid\nflowchart LR\n A[');
	await frames.first().waitFor({ state: 'hidden' });
	assert.equal(await assistant.locator('.llampart-diagram-fallback').count(), 1);
	await setContent(first);
	await ready(1);
	await page.evaluate(() => {
		window.stableDiagram = document.querySelector('.diagram-surface').shadowRoot.firstElementChild;
	});
	for (const suffix of [
		'\n\nDalszy',
		'\n\nDalszy tekst',
		'\n\nDalszy tekst\n\n' + fence(samples[1][1])
	]) {
		await setContent(first + suffix);
		await ready(suffix.includes('stateDiagram-v2') ? 2 : 1);
		assert(
			await page.evaluate(
				() =>
					document.querySelector('.diagram-surface').shadowRoot.firstElementChild ===
					window.stableDiagram
			)
		);
	}
	for (const invalid of [
		'sequenceDiagram\nA->>B: Unsupported',
		'erDiagram\nA ||--o{ B : Unsupported',
		'pie\n A: 1',
		'flowchart LR\nA[broken',
		'%%{init:{"securityLevel":"loose"}}%%\nflowchart LR\nA --> B',
		'flowchart LR\nA[<img src="https://evil.test/x" onerror="alert(1)">]',
		'flowchart LR\n' + Array.from({ length: 601 }, (_, i) => `N${i} --> N${i + 1}`).join('\n')
	]) {
		await setContent('Przed\n\n' + fence(invalid) + '\n\nPo błędzie.');
		await assistant.locator('.llampart-diagram-fallback').waitFor();
		assert(!(await assistant.innerText()).includes(invalid));
		await assistant
			.locator('.llampart-diagram-fallback')
			.getByRole('button', { name: 'Pokaż kod', exact: true })
			.click();
		assert.equal(await page.locator('.visualization-source').textContent(), invalid);
		await page.keyboard.press('Escape');
		assert((await assistant.innerText()).includes('Po błędzie.'));
	}
	await setContent(Array.from({ length: 10 }, () => first).join('\n\n'));
	await ready(8);
	assert.equal(await assistant.locator('.llampart-diagram-fallback').count(), 2);
	console.log(
		'PASS Settings preview/Cancel/Save/Reset/language, stable SVGs, invalid parser/config/HTML fallbacks, eight-diagram cap'
	);

	// A malicious SVG must be rejected independently of the source preflight.
	const security = await page.evaluate(async () => {
		const { verifiedDiagramSvg } = await import('/src/lib/diagrams/mermaid-policy.ts');
		const wraps = (body) =>
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${body}</svg>`;
		return [
			'<script>alert(1)</script>',
			'<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTML</div></foreignObject>',
			'<a href="https://evil.test"><text>link</text></a>',
			'<image href="https://evil.test/x"/>',
			'<rect onload="alert(1)"/>',
			'<style>@import "https://evil.test/x";</style>',
			'<style>rect{fill:url(https://evil.test/x)}</style>',
			'<style>rect{fill:u\\72l(https://evil.test/x)}</style>',
			'<use href="//evil.test/x"/>',
			'<g xml:base="/external.svg"><use href="#remote"/></g>',
			'<style>@font-face{src:url(/external.woff2)}</style>'
		].map((body) => {
			try {
				verifiedDiagramSvg(wraps(body));
				return false;
			} catch {
				return true;
			}
		});
	});
	assert(security.every(Boolean));

	const big =
		'flowchart TB\n' +
		Array.from(
			{ length: 45 },
			(_, i) => `N${i}[Etap ${i}] --> N${i + 1}\nN${i} --> B${i}[Gałąź ${i}]`
		).join('\n');
	const wide =
		'flowchart LR\n' +
		Array.from({ length: 14 }, (_, i) => `A${i}[Etap ${i}] --> A${i + 1}`).join('\n');
	const long =
		'gantt\n title Długi harmonogram\n dateFormat YYYY-MM-DD\n' +
		Array.from(
			{ length: 30 },
			(_, i) =>
				`${i % 5 === 0 ? 'section Etap ' + i + '\n' : ''}Zadanie ${i} :t${i}, ${i ? 'after t' + (i - 1) : '2026-01-01'}, 10d`
		).join('\n');
	await setContent([big, wide, long].map(fence).join('\n\n'));
	await ready(3);
	for (let i = 0; i < 3; i++) {
		await frames.nth(i).getByRole('button', { name: 'Podgląd diagramu', exact: true }).click();
		const scroll = preview.locator('.diagram-preview-scroll');
		const size = await scroll.evaluate((el) => ({
			width: el.clientWidth,
			height: el.clientHeight,
			sw: el.scrollWidth,
			sh: el.scrollHeight
		}));
		assert(size.sw > size.width || size.sh > size.height);
		await page.screenshot({
			path: `${artifacts}/large-${['flowchart', 'wide-flowchart', 'gantt'][i]}-preview.png`
		});
		await scroll.evaluate((el) => el.scrollTo(el.scrollWidth, el.scrollHeight));
		await page.screenshot({ path: `${artifacts}/large-${i}-end.png` });
		await page.keyboard.press('Escape');
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await ready(3);
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await screenshot('mobile-large');
	await page.setViewportSize({ width: 1600, height: 1000 });

	// Supersede expensive work and rapidly switch typography; only the newest wins.
	await setContent(fence(big));
	await page.evaluate(async (latest) => {
		const { conversations, settings } = window.diagramTest;
		for (const family of ['crimson-text', 'libre-caslon-condensed', 'fira-sans'])
			settings.updateConfig('fontFamily', family);
		const message = conversations.activeMessages.find((m) => m.role === 'assistant');
		conversations.updateMessageAtIndex(conversations.findMessageIndex(message.id), {
			content: latest
		});
	}, fence('flowchart LR\nLATEST[Ostatni wynik] --> OK'));
	await ready(1);
	assert(
		(await frames.first().locator('text').allTextContents()).join(' ').includes('Ostatni wynik')
	);
	assert(
		(
			await frames
				.first()
				.locator('text')
				.first()
				.evaluate((el) => getComputedStyle(el).fontFamily)
		).includes('Fira Sans')
	);
	await setContent(markdown);
	await ready();
	await page.reload();
	await ready();
	assert.equal(await assistant.locator('.llampart-chart-frame').count(), 1);
	console.log(
		'PASS SVG security boundary, large/wide flowchart/long Gantt scroll, mobile overflow, rapid replacement, conversation reload'
	);
	// Drive the real ChatService with a controllable Response, not private store state.
	const incompleteSource = 'flowchart LR\nB[';
	const expectedPartial =
		'Początek\n\n' +
		fence('flowchart LR\nA[Użytkownik] --> B[llampart]') +
		'\n\n' +
		fence(samples[1][1]) +
		'\n\n```mermaid\n' +
		incompleteSource;
	const streamState = () =>
		page.evaluate(async () => {
			const { db, conversations } = await import('/tests/browser/charts-harness.ts');
			const { chatStore } = await import('/src/lib/stores/chat.svelte.ts');
			const { scanMermaidFences } = await import('/src/lib/markdown/mermaid-blocks.ts');
			const conversation = conversations.activeConversation;
			const messages = await db.getConversationMessages(conversation.id);
			const assistant = conversations.activeMessages.findLast((m) => m.role === 'assistant');
			const saved = messages.find((m) => m.id === assistant.id);
			const scan = scanMermaidFences(assistant.content);
			return {
				conversationId: conversation.id,
				currNode: conversation.currNode,
				savedCurrNode: (await db.getConversation(conversation.id)).currNode,
				messageIds: messages.map((m) => m.id),
				assistantId: assistant.id,
				content: assistant.content,
				savedContent: saved.content,
				closedFences: scan.ranges.length,
				pendingSource: scan.pending?.code,
				loading: chatStore.isLoading,
				streaming: chatStore.isStreaming()
			};
		});
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.evaluate(async () => {
		const { ChatService } = await import('/src/lib/services/chat.service.ts');
		const send = ChatService.sendMessage;
		window.diagramTerminalCallbacks = { complete: 0, error: 0 };
		ChatService.sendMessage = function (messages, options, ...rest) {
			return send.call(
				this,
				messages,
				{
					...options,
					onComplete: (...args) => {
						window.diagramTerminalCallbacks.complete++;
						return options.onComplete?.(...args);
					},
					onError: (...args) => {
						window.diagramTerminalCallbacks.error++;
						return options.onError?.(...args);
					}
				},
				...rest
			);
		};
		const original = window.fetch;
		window.fetch = (input, init) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (!url.includes('/chat/completions')) return original(input, init);
			const stream = new ReadableStream({
				start(controller) {
					window.enqueueDiagramToken = (content) =>
						controller.enqueue(
							new TextEncoder().encode(
								'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'
							)
						);
					init?.signal?.addEventListener(
						'abort',
						() => {
							window.diagramStreamAborted = true;
							controller.error(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true }
					);
				}
			});
			return Promise.resolve(
				new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
			);
		};
	});
	await page.locator('textarea').first().fill('Wyjaśnij proces diagramem.');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(() => typeof window.enqueueDiagramToken === 'function');
	await page.evaluate(() => window.enqueueDiagramToken('Początek\n\n```mermaid\n'));
	await page.getByText('Przygotowywanie diagramu…', { exact: true }).waitFor();
	for (const token of ['flowchart LR\n', 'A[', 'Użytkownik] --> B[llampart]'])
		await page.evaluate((token) => window.enqueueDiagramToken(token), token);
	assert.equal(await page.locator('.llampart-diagram-frame').count(), 0);
	assert.equal(await page.locator('.llampart-diagram-fallback').count(), 0);
	await page.evaluate(() => window.enqueueDiagramToken('\n```'));
	await page.locator('.llampart-diagram-frame').waitFor();
	await page.evaluate(() => {
		window.liveDiagram = document.querySelector('.diagram-surface').shadowRoot.firstElementChild;
	});
	await page.evaluate((token) => window.enqueueDiagramToken('\n\n' + token), fence(samples[1][1]));
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-diagram-frame').length === 2
	);
	assert(
		await page.evaluate(
			() =>
				document.querySelector('.diagram-surface').shadowRoot.firstElementChild ===
				window.liveDiagram
		)
	);
	await page.evaluate(
		(source) => window.enqueueDiagramToken('\n\n```mermaid\n' + source),
		incompleteSource
	);
	await page.getByText('Przygotowywanie diagramu…', { exact: true }).waitFor();
	const beforeStop = await streamState();
	assert.equal(beforeStop.content, expectedPartial);
	await page.locator('.llampart-composer-stop-action').click();
	await page.waitForFunction(() => window.diagramStreamAborted === true);
	await page.locator('.llampart-diagram-fallback').waitFor();
	// Changing isStreaming rebuilds Markdown blocks. Check the final render/data,
	// not the identity of an SVG from the previous streaming render policy.
	await ready(2);
	await page.waitForFunction(async () => {
		const { chatStore } = await import('/src/lib/stores/chat.svelte.ts');
		return !chatStore.isLoading && !chatStore.isStreaming();
	});
	const stopped = await streamState();
	assert.equal(stopped.content, expectedPartial);
	assert.equal(stopped.savedContent, expectedPartial);
	assert.equal(stopped.closedFences, 2);
	assert.equal(stopped.pendingSource, incompleteSource);
	for (const key of ['conversationId', 'currNode', 'savedCurrNode', 'messageIds', 'assistantId'])
		assert.deepEqual(stopped[key], beforeStop[key], `Stop must preserve ${key}`);
	assert.deepEqual(
		await page.evaluate(() => window.diagramTerminalCallbacks),
		{ complete: 0, error: 0 },
		'User Stop is neither successful stream completion nor an incomplete-stream error'
	);
	for (const [i, label] of ['Użytkownik', 'Gotowy'].entries()) {
		const svg = page.locator('.llampart-diagram-frame').nth(i).locator('.diagram-surface svg');
		await svg.waitFor({ state: 'visible' });
		assert((await svg.textContent()).includes(label));
		const bounds = await svg.boundingBox();
		assert(bounds.width > 0 && bounds.height > 0);
	}
	const fallback = page.locator('.llampart-diagram-fallback');
	assert.equal(await fallback.count(), 1);
	await fallback.getByRole('button', { name: 'Pokaż kod', exact: true }).click();
	await page.getByRole('dialog').waitFor({ state: 'visible' });
	assert.equal(await page.locator('.visualization-source').textContent(), incompleteSource);
	await page.keyboard.press('Escape');
	await page.getByRole('dialog').waitFor({ state: 'hidden' });
	await page.reload();
	await ready(2);
	// loadConversation restores the persisted leaf, not the pre-reload UI snapshot.
	assert.deepEqual(
		await streamState(),
		{ ...stopped, currNode: stopped.savedCurrNode },
		'Reload restores the persisted leaf and exact stopped partial answer'
	);
	await writeFile(`${artifacts}/stopped-stream.json`, JSON.stringify(stopped, null, 2));
	console.log(
		'PASS real ChatService token streaming: stable append, Stop abort, two rendered closed fences, exact partial answer/graph/IndexedDB/reload, incomplete-tail source fallback, no false completion'
	);
	assert.deepEqual(external, []);
	assert.deepEqual(errors, []);
	await writeFile(
		`${artifacts}/results.json`,
		JSON.stringify(
			{ initialRenderMs, errors, warnings, external, requests: requests.length },
			null,
			2
		)
	);
} finally {
	await browser.close();
}
