/** Desktop-only continuation of the UI polish package; real Markdown/render/export. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTransparentExport } from './export-transparency.mjs';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const before = process.env.LLAMPART_DESKTOP_BASELINE === '1';
const reference = process.env.LLAMPART_DESKTOP_REFERENCE
	? JSON.parse(await readFile(process.env.LLAMPART_DESKTOP_REFERENCE, 'utf8'))
	: null;
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	args: ['--no-sandbox']
});
const context = await browser.newContext({
	viewport: { width: 1920, height: 1080 },
	acceptDownloads: true
});
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const fence = (type, code) => '```' + type + '\n' + code + '\n```';
const gantts = [
	'gantt\ntitle Granica miesiąca\ndateFormat YYYY-MM-DD\nsection Przygotowanie\nAnaliza :a,2026-07-25,7d\nBardzo długa nazwa krótkiego zadania przy prawej krawędzi :b,2026-07-31,1d\nTest :c,2026-08-01,7d\nKoniec :milestone,d,2026-08-08,0d',
	'gantt\ntitle Granica roku\ndateFormat YYYY-MM-DD HH:mm\nsection Długi etap weryfikacji\nA :a,2026-12-31 22:00,1h\nDługa końcowa nazwa :b,2026-12-31 23:00,30m\nC :c,2027-01-01 00:00,1h',
	'gantt\ntitle Długi okres\ndateFormat YYYY-MM-DD\nsection Plan\nPrzygotowanie :a,2026-01-01,90d\nOstatnie krótkie zadanie :b,2027-06-28,1d'
];
const flows = [
	'flowchart TB\nsubgraph init[Inicjalizacja]\nA[Start] -->|Tak| B{Poprawne?}\nend\nsubgraph fin[Finalizacja]\nC[Wynik]\nend\nB -->|Nie| C',
	'flowchart LR\nsubgraph outer[Bardzo długi tytuł sekcji procesu]\nsubgraph inner[Etap wewnętrzny]\nA[Start] --> B[Analiza]\nend\nB --> C[Koniec]\nend',
	'flowchart TB\nsubgraph only[Etap decyzji]\nA{Poprawne?} -->|Tak| B((Gotowe))\nend'
];
const other = [
	'mindmap\n root((Mindmap))\n  Dane\n   Wyniki',
	'stateDiagram-v2\n[*] --> Gotowy\nGotowy --> Koniec: Dane poprawne\nKoniec --> [*]'
];
const rows = [
	{ x: 'Sklep stacjonarny', y: -1234567.89 },
	{ x: 'Sprzedaż internetowa', y: 9876543.21 },
	{ x: 'Bardzo długa nazwa kategorii regionalnej', y: 4500000 }
];
const specs = ['line', 'area', 'bar'].map((type) => ({
	type,
	title: type,
	xKey: 'x',
	series: [{ key: 'y', label: 'Seria' }],
	data: rows,
	xLabel: 'Kanał sprzedaży',
	yLabel: 'Przychody w złotych'
}));
specs.push({ ...specs[2], orientation: 'horizontal', title: 'horizontal' });
specs.push({
	...specs[0],
	title: 'Miesiące',
	data: [
		'Styczeń',
		'Luty',
		'Marzec',
		'Kwiecień',
		'Maj',
		'Czerwiec',
		'Lipiec',
		'Sierpień',
		'Wrzesień',
		'Październik',
		'Listopad',
		'Grudzień'
	].map((x, i) => ({ x, y: i * 1000000 }))
});
specs.push({
	type: 'donut',
	title: 'Donut',
	labelKey: 'x',
	valueKey: 'y',
	data: [
		{ x: 'A', y: 3 },
		{ x: 'B', y: 7 }
	]
});
let content =
	[...gantts, ...flows, ...other].map((s) => fence('mermaid', s)).join('\n\n') +
	'\n\n' +
	specs.map((s) => fence('llampart-chart', JSON.stringify(s))).join('\n\n');
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://desktop.test',
			llamaServerBaseUrl: 'http://desktop.test',
			interfaceLanguage: 'pl',
			theme: 'frosted-glass',
			fontFamily: 'fira-sans',
			fontVariant: '400',
			fontSize: 'default',
			titleGenerationUseLLM: false,
			askForTitleConfirmation: false
		})
	);
});
await context.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	return path.endsWith('/chat/completions')
		? route.fulfill({
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
			})
		: route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'test',
							model_path: 'test.gguf',
							default_generation_settings: { params: {} }
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'test.gguf' }] }
						: []
			});
});
const assistant = page.locator('.llampart-assistant-markdown').first();
async function settle() {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	});
	await page.waitForFunction(
		() =>
			document.querySelectorAll('.llampart-assistant-markdown .diagram-surface').length === 8 &&
			[...document.querySelectorAll('.diagram-surface')].every((h) =>
				h.shadowRoot?.querySelector('svg')
			) &&
			document.querySelectorAll('.llampart-assistant-markdown .llampart-chart-frame').length ===
				6 &&
			!document.querySelector('.llampart-assistant-markdown .llampart-inline-processing-status'),
		null,
		{ timeout: 90000 }
	);
	await page.waitForFunction(
		() => {
			const a = document.querySelector('.llampart-assistant-markdown');
			const key = [
				a.getBoundingClientRect().width,
				...[...a.querySelectorAll('.diagram-surface')].map(
					(h) => h.shadowRoot?.querySelector('svg')?.outerHTML
				)
			].join('|');
			if (window.desktopStable?.key !== key) {
				window.desktopStable = { key, time: performance.now() };
				return false;
			}
			return (
				!a.querySelector('.llampart-inline-processing-status') &&
				performance.now() - window.desktopStable.time > 300
			);
		},
		null,
		{ timeout: 90000 }
	);
}
async function snapshot() {
	return assistant.evaluate((a) => {
		const style = (n) => {
			const s = getComputedStyle(n);
			return Object.fromEntries(
				['fontFamily', 'fontSize', 'fontWeight', 'fill', 'color'].map((k) => [k, s[k]])
			);
		};
		const box = (n) => n.getBoundingClientRect().toJSON();
		const overlaps = (a, b) =>
			Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
			Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5;
		const collisions = (nodes) =>
			nodes.flatMap((n, i) =>
				nodes
					.slice(i + 1)
					.filter((m) => overlaps(box(n), box(m)))
					.map((m) => [n.textContent, m.textContent])
			);
		const diagrams = [...a.querySelectorAll('.diagram-surface')].map((host) => {
			const svg = host.shadowRoot.querySelector('svg');
			const bounds = box(svg);
			const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim());
			return {
				viewBox: svg.getAttribute('viewBox'),
				texts: texts.map((t) => ({
					text: t.textContent,
					style: style(t),
					contained:
						box(t).left >= bounds.left - 1 &&
						box(t).right <= bounds.right + 1 &&
						box(t).top >= bounds.top - 1 &&
						box(t).bottom <= bounds.bottom + 1
				})),
				collisions: collisions(texts),
				clusters: [...svg.querySelectorAll('g.cluster')].map((g) => {
					const r = g.querySelector(':scope > rect');
					const l = g.querySelector(':scope > .cluster-label');
					const t = l.querySelector('text');
					const b = box(t),
						rb = box(r);
					return {
						title: t.textContent,
						style: style(t),
						rx: r.getAttribute('rx'),
						ry: r.getAttribute('ry'),
						rect: rb,
						titleBox: b,
						localRect: ['x', 'y', 'width', 'height'].map((k) => r.getAttribute(k)),
						transform: l.getAttribute('transform'),
						leftGap: b.left - rb.left,
						topGap: b.top - rb.top,
						titleInLeftHalf: b.left < rb.left + rb.width / 2,
						obstacles: [...svg.querySelectorAll('g.node')]
							.filter((n) => overlaps(b, box(n)))
							.map((n) => n.textContent)
					};
				}),
				nodeRadius: [...svg.querySelectorAll('g.node rect')].map((r) => getComputedStyle(r).rx),
				nodes: [...svg.querySelectorAll('g.node')].map((n) => [
					n.textContent,
					n.getAttribute('transform')
				]),
				paths: [...svg.querySelectorAll('.edgePaths path')].map((p) => p.getAttribute('d')),
				bars: [...svg.querySelectorAll('rect.task')].map((r) => ({
					id: r.id,
					x: Number(r.getAttribute('x')),
					width: Number(r.getAttribute('width'))
				})),
				taskOutside: [...svg.querySelectorAll('text[id$="-text"]')].every((t) => {
					const r = svg.getElementById(t.id.replace(/-text$/, ''));
					return !r || !overlaps(box(t), box(r));
				})
			};
		});
		const charts = [...a.querySelectorAll('.llampart-chart-frame')].map((f) => {
			const labels = [...f.querySelectorAll('.lc-axis text')];
			const b = box(f);
			return {
				width: b.width,
				texts: labels.map((t) => t.textContent),
				collisions: collisions(labels),
				contained: labels.every((t) => box(t).left >= b.left - 1 && box(t).right <= b.right + 1),
				legend: [...f.querySelectorAll('.chart-legend button')].map((n) => ({
					text: n.textContent,
					style: style(n)
				})),
				title: style(f.querySelector('.visualization-title')),
				fills: [...f.querySelectorAll('.lc-bars-bar,.lc-arc-line')].map(
					(n) => getComputedStyle(n).fill
				)
			};
		});
		return { diagrams, charts };
	});
}
try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
	await page.locator('textarea').first().fill('Desktop refinement');
	await page.locator('textarea').first().press('Enter');
	await settle();
	await page.evaluate(async () => {
		window.desktop = await import('/tests/browser/charts-harness.ts');
	});
	const snapshots = [];
	for (const colorScheme of ['light', 'dark']) {
		await page.emulateMedia({ colorScheme });
		for (const [width, height] of [
			[1920, 1080],
			[1600, 1200],
			[1100, 900]
		]) {
			await page.setViewportSize({ width, height });
			// A narrow desktop message column, not a mobile viewport.
			await assistant.evaluate((n, width) => {
				n.style.maxWidth = width === 1100 ? '600px' : '';
			}, width);
			await settle();
			const s = { width, height, colorScheme, ...(await snapshot()) };
			snapshots.push(s);
			if (!before) {
				for (const d of s.diagrams) {
					assert(
						d.texts.every((t) => t.contained),
						`diagram clipping ${d.texts.filter((t) => !t.contained).map((t) => t.text)}`
					);
					assert.deepEqual(d.collisions, []);
					assert(d.taskOutside);
				}
				for (const d of s.diagrams.slice(3, 6))
					for (const g of d.clusters) {
						assert.equal(g.rx, '8');
						assert.equal(g.ry, '8');
						assert.equal(g.style.fontWeight, '700');
						assert(g.titleInLeftHalf);
						assert(g.leftGap > 2 && g.topGap > 2);
						assert.deepEqual(g.obstacles, []);
						assert(d.nodeRadius.every((r) => r === '8px'));
					}
				for (const c of s.charts) {
					assert(c.contained);
					assert.deepEqual(c.collisions, []);
				}
				if (reference) {
					const old = reference.find((r) => r.width === width && r.colorScheme === colorScheme);
					for (let i = 0; i < 3; i++) {
						for (const t of s.diagrams[i].texts) {
							const prev = old.diagrams[i].texts.find((p) => p.text === t.text);
							if (!prev) continue;
							assert(
								Math.abs(parseFloat(t.style.fontSize) - parseFloat(prev.style.fontSize) - 1) < 0.01
							);
							assert.equal(t.style.fontFamily, prev.style.fontFamily);
							assert.equal(t.style.fill, prev.style.fill);
						}
						const a = s.diagrams[i].bars,
							b = old.diagrams[i].bars;
						assert.deepEqual(
							a.map((v) => v.width),
							b.map((v) => v.width)
						);
						assert.deepEqual(
							a.map((v) => v.x - a[0].x),
							b.map((v) => v.x - b[0].x)
						);
					}
					for (let i = 6; i < 8; i++) assert.deepEqual(s.diagrams[i].texts, old.diagrams[i].texts);
					for (let i = 3; i < 6; i++) {
						assert.deepEqual(s.diagrams[i].nodes, old.diagrams[i].nodes);
						assert.deepEqual(s.diagrams[i].paths, old.diagrams[i].paths);
						assert.deepEqual(
							s.diagrams[i].clusters.map((g) => g.localRect),
							old.diagrams[i].clusters.map((g) => g.localRect)
						);
						for (const g of s.diagrams[i].clusters)
							assert.equal(
								g.style.fontFamily,
								old.diagrams[i].clusters.find((p) => p.title === g.title).style.fontFamily
							);
					}
					for (let i = 0; i < 6; i++) {
						assert.deepEqual(s.charts[i].legend, old.charts[i].legend);
						assert.deepEqual(s.charts[i].title, old.charts[i].title);
						assert.deepEqual(s.charts[i].fills, old.charts[i].fills);
					}
					for (let i = 0; i < 5; i++)
						assert(
							s.charts[i].texts.join('').length >= old.charts[i].texts.join('').length,
							'must show at least as many characters'
						);
				}
			}
			const frames = assistant.locator('.llampart-visualization-frame');
			for (let i = 0; i < 14; i++) {
				await frames.nth(i).scrollIntoViewIfNeeded();
				await frames.nth(i).evaluate((n) => n.scrollIntoView({ block: 'start' }));
				await frames.nth(i).screenshot({ path: `${artifacts}/${colorScheme}-${width}-${i}.png` });
			}
		}
	}
	await writeFile(`${artifacts}/styles.json`, JSON.stringify(snapshots, null, 2));
	if (!before) {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await assistant.evaluate((n) => {
			n.style.maxWidth = '';
		});
		await settle();
		const exports = [];
		for (let i = 0; i < 14; i++)
			for (const format of i < 8 ? ['SVG', 'PNG'] : ['SVG', 'PNG', 'CSV']) {
				const frame = assistant.locator('.llampart-visualization-frame').nth(i);
				await frame.scrollIntoViewIfNeeded();
				const pending = page.waitForEvent('download');
				console.log('Export', i, format);
				await frame.getByRole('button', { name: new RegExp(`(^| )${format}$`) }).click();
				const download = await pending;
				const path = `${artifacts}/export-${i}.${format.toLowerCase()}`;
				await download.saveAs(path);
				exports.push(path);
				if (format === 'CSV') {
					const expected = await page.evaluate(
						async (spec) => (await import('/src/lib/charts/chart-csv.ts')).chartCsv(spec),
						specs[i - 8]
					);
					assert.equal(await readFile(path, 'utf8'), expected);
				}
			}
		const preview = await context.newPage();
		const raster = await context.newPage();
		const transparency = [];
		for (const path of exports.filter((p) => !p.endsWith('.csv'))) {
			transparency.push(
				await assertTransparentExport(
					raster,
					await readFile(path),
					path.endsWith('.svg') ? 'svg' : 'png'
				)
			);
			await preview.goto(
				'data:' +
					(path.endsWith('.svg') ? 'image/svg+xml' : 'image/png') +
					';base64,' +
					(await readFile(path)).toString('base64')
			);
			if (path.endsWith('.png'))
				assert(await preview.locator('img').evaluate((n) => n.complete && n.naturalWidth > 100));
			else {
				assert(await preview.locator('svg').count());
				if (/export-[345]\.svg$/.test(path)) {
					const weights = await preview.evaluate(() =>
						[...document.styleSheets]
							.flatMap((s) => [...s.cssRules])
							.filter((r) => r instanceof CSSFontFaceRule)
							.map((r) => r.style.fontWeight)
					);
					assert(
						weights.some((w) => {
							const range = w.split(/\s+/).map(Number);
							return range[0] <= 700 && (range[1] ?? range[0]) >= 700;
						}),
						'export must embed the bold section face'
					);
					assert(
						(
							await preview
								.locator('.cluster-label text')
								.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontWeight))
						).every((w) => w === '700')
					);
				}
			}
		}
		await writeFile(`${artifacts}/transparency.json`, JSON.stringify(transparency, null, 2));
		await preview.close();
		await raster.close();
		await page.evaluate(() => {
			window.desktop.settings.updateConfig('fontFamily', 'merriweather');
			window.desktop.settings.updateConfig('fontSize', '20');
		});
		await page.waitForFunction(() =>
			getComputedStyle(document.querySelector('.visualization-title')).fontFamily.includes(
				'Merriweather'
			)
		);
		await settle();
		const customFont = await snapshot();
		for (const d of customFont.diagrams)
			assert(d.texts.every((t) => t.style.fontFamily.includes('Merriweather')));
		for (const d of customFont.diagrams.slice(0, 3))
			assert(d.texts.every((t) => t.style.fontSize === '17px' && t.contained));
		for (const d of customFont.diagrams.slice(3, 6))
			for (const g of d.clusters) {
				assert.equal(g.style.fontWeight, '700');
				assert.deepEqual(g.obstacles, []);
			}
		for (const c of customFont.charts) {
			assert(c.contained);
			assert.deepEqual(c.collisions, []);
		}
		await writeFile(`${artifacts}/custom-font.json`, JSON.stringify(customFont, null, 2));
		await assistant
			.locator('.llampart-diagram-frame')
			.nth(3)
			.screenshot({ path: `${artifacts}/custom-font-flowchart.png` });
		await page.evaluate(() => {
			window.desktop.settings.updateConfig('fontFamily', 'fira-sans');
			window.desktop.settings.updateConfig('fontSize', 'default');
		});
		await settle();
		await page.evaluate(
			async (content) => {
				const { conversations, db } = window.desktop;
				const m = conversations.activeMessages.find((m) => m.role === 'assistant');
				await db.updateMessage(m.id, { content });
				conversations.updateMessageAtIndex(conversations.findMessageIndex(m.id), { content });
			},
			fence('mermaid', 'flowchart LR\nA[') + '\n\n' + fence('llampart-chart', '{')
		);
		await page.evaluate(() =>
			window.desktop.settings.updateConfig('alwaysShowSidebarOnDesktop', false)
		);
		const fallbacks = [];
		for (const language of ['pl', 'en', 'de', 'fr', 'it', 'es']) {
			await page.evaluate(
				(l) => window.desktop.settings.updateConfig('interfaceLanguage', l),
				language
			);
			const expected = await page.evaluate(async (l) => {
				const { t } = await import('/src/lib/i18n/index.ts');
				return [[t('diagrams.invalid', l)], [t('charts.invalid', l)]];
			}, language);
			await page.waitForFunction((e) => {
				const m = [...document.querySelectorAll('.llampart-assistant-markdown .fallback-message')];
				return (
					m.length === 2 &&
					m.every(
						(n, i) =>
							[...n.querySelectorAll('p')].map((p) => p.textContent).join('\n') === e[i].join('\n')
					)
				);
			}, expected);
			for (const width of [1920, 1600, 1100]) {
				await page.setViewportSize({ width, height: 1000 });
				if (await page.locator('[data-slot="sidebar"][data-state="expanded"]').count()) {
					await page.locator('[data-slot="sidebar-trigger"]').first().click();
					await page.waitForFunction(
						() => !document.querySelector('[data-slot="sidebar"][data-state="expanded"]')
					);
				}
				for (const i of [0, 1]) {
					const f = assistant.locator('.llampart-visualization-fallback').nth(i);
					assert.deepEqual(await f.locator('[role=status] p').allTextContents(), expected[i]);
					assert.equal(await f.locator('button').count(), 2);
					const gap = await f.evaluate((n) => {
						const s = n.querySelector('[role=status]'),
							p = s.lastElementChild;
						return s.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom;
					});
					assert.equal(gap, 0);
					await f.locator('button').nth(1).click();
					assert.equal(
						await page.evaluate(() => navigator.clipboard.readText()),
						i === 0 ? 'flowchart LR\nA[' : '{'
					);
					await f.locator('button').nth(0).click();
					await page.getByRole('dialog').waitFor();
					assert.equal(
						await page.locator('.visualization-source').textContent(),
						i === 0 ? 'flowchart LR\nA[' : '{'
					);
					await page.keyboard.press('Escape');
					await page.getByRole('dialog').waitFor({ state: 'hidden' });
					fallbacks.push({
						language,
						width,
						kind: i === 0 ? 'diagram' : 'chart',
						text: expected[i],
						gap
					});
				}
				await page.screenshot({ path: `${artifacts}/fallback-${language}-${width}.png` });
			}
		}
		assert.equal(fallbacks.length, 36);
		assert.deepEqual(errors, []);
		await writeFile(
			`${artifacts}/result.json`,
			JSON.stringify({ matrix: snapshots.length, exports, fallbacks, errors }, null, 2)
		);
	}
	console.log(
		before
			? 'Desktop baseline captured'
			: 'PASS desktop matrix, Gantt +1px/bar invariants, group headers, longer axes, exports, six-language fallbacks/actions'
	);
} catch (error) {
	await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
	throw error;
} finally {
	await browser.close();
}
