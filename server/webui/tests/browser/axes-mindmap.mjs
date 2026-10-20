/** Real desktop Markdown/render/export regression for axes and Mindmap only. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTransparentExport } from './export-transparency.mjs';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const baseline = process.env.LLAMPART_AXES_MINDMAP_BASELINE === '1';
const reference = process.env.LLAMPART_AXES_MINDMAP_REFERENCE
	? JSON.parse(await readFile(process.env.LLAMPART_AXES_MINDMAP_REFERENCE, 'utf8'))
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
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => {
	if (message.type() === 'error') errors.push(message.text());
});
const fence = (lang, code) => '```' + lang + '\n' + code + '\n```';
const balanced =
	'mindmap\n root((Centrum))\n' +
	['Plan', 'Dane', 'Produkt', 'Zespół', 'Jakość', 'Klienci', 'Wyniki', 'Rozwój']
		.map((label) => `  ${label}\n   ${label} A\n   ${label} B`)
		.join('\n');
const maps = [
	balanced,
	'mindmap\n root(Strategia)\n  Rozbudowany obszar produktu\n   Projektowanie\n    Makiety\n     Weryfikacja\n   Implementacja\n    Narzędzia\n  Sprzedaż\n  Obsługa\n   Klienci\n  Pomiary\n   Wyniki',
	'mindmap\n root((Mindmap))\n  Dane\n   Wyniki\n  Rozmowa',
	'mindmap\n root(Start)\n  A[Prostokąt]\n   B(Zaokrąglony)\n    C{{Sześciokąt}}\n  D((Koło))\n  E[Koniec]',
	'mindmap\n root(Samodzielny korzeń)'
];
const controls = [
	'flowchart TB\nsubgraph init[Inicjalizacja]\nA[Start] -->|Tak| B{Poprawne?}\nend\nsubgraph fin[Finalizacja]\nC[Wynik]\nend\nB -->|Nie| C',
	'gantt\ntitle Harmonogram\ndateFormat YYYY-MM-DD\nsection Plan\nAnaliza :a,2026-07-25,7d\nDługa nazwa :b,2026-07-31,1d\nKoniec :milestone,c,2026-08-01,0d',
	'stateDiagram-v2\n[*] --> Gotowy\nGotowy --> Koniec: Dane poprawne\nKoniec --> [*]'
];
const categories = [
	'Sklep stacjonarny w regionie mazowieckim',
	'Sprzedaż internetowa dla klientów zagranicznych',
	'Centrum dystrybucji i obsługi zamówień hurtowych'
];
const spec = (type, labels) => ({
	type,
	title: type,
	xKey: 'x',
	series: [{ key: 'y', label: 'Seria' }],
	data: labels.map((x, i) => ({ x, y: (i + 1) * 123456.78 })),
	xLabel: 'Kategorie',
	yLabel: 'Przychody'
});
const specs = [
	spec('line', ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze']),
	spec('area', ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec']),
	spec('bar', categories),
	{ ...spec('bar', categories), orientation: 'horizontal' },
	spec('line', ['Pierwsza', 'Druga', 'Ostatnia']),
	{
		type: 'donut',
		title: 'Kontrola donut',
		labelKey: 'x',
		valueKey: 'y',
		data: [
			{ x: 'A', y: 3 },
			{ x: 'B', y: 7 }
		]
	}
];
specs[4].data = [
	{ x: 'Pierwsza', y: -999999.99 },
	{ x: 'Druga', y: 999999.99 },
	{ x: 'Ostatnia', y: 1234567890 }
];
const content = [...maps, ...controls]
	.map((s) => fence('mermaid', s))
	.concat(specs.map((s) => fence('llampart-chart', JSON.stringify(s))))
	.join('\n\n');
let responseContent = content;
let diagramCount = 8,
	chartCount = 6;
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://axes.test',
			llamaServerBaseUrl: 'http://axes.test',
			interfaceLanguage: 'pl',
			theme: 'frosted-glass',
			fontFamily: 'fira-sans',
			fontVariant: '400',
			fontSize: 'default',
			titleGenerationUseLLM: false,
			askForTitleConfirmation: false,
			alwaysShowSidebarOnDesktop: false
		})
	);
});
await context.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	return path.endsWith('/chat/completions')
		? route.fulfill({
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ choices: [{ delta: { content: responseContent } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
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
const assistant = page.locator('.llampart-assistant-markdown').last();
async function settle() {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	});
	await page.waitForFunction(
		({ diagramCount, chartCount }) => {
			const a = [...document.querySelectorAll('.llampart-assistant-markdown')].at(-1);
			if (!a) return false;
			const diagrams = [...a.querySelectorAll('.diagram-surface')];
			if (
				diagrams.length !== diagramCount ||
				!diagrams.every((h) => h.shadowRoot?.querySelector('svg')) ||
				a.querySelectorAll('.llampart-chart-frame').length !== chartCount ||
				a.querySelector('.llampart-inline-processing-status')
			)
				return false;
			const key = [
				a.getBoundingClientRect().width,
				...diagrams.map((h) => h.shadowRoot.querySelector('svg').outerHTML),
				...[...a.querySelectorAll('.chart-plot svg')].map((s) => s.outerHTML)
			].join('|');
			if (window.axesStable?.key !== key) {
				window.axesStable = { key, time: performance.now() };
				return false;
			}
			return performance.now() - window.axesStable.time > 300;
		},
		{ diagramCount, chartCount },
		{ timeout: 120000 }
	);
}
async function snapshot() {
	return assistant.evaluate((a) => {
		const style = (n) => {
			const s = getComputedStyle(n);
			return Object.fromEntries(
				[
					'fontFamily',
					'fontSize',
					'fontWeight',
					'fontStyle',
					'fill',
					'stroke',
					'strokeWidth',
					'opacity'
				].map((k) => [k, s[k]])
			);
		};
		const box = (n) => n.getBoundingClientRect();
		const overlap = (a, b) =>
			Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
			Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5;
		const collide = (nodes) =>
			nodes.flatMap((n, i) =>
				nodes
					.slice(i + 1)
					.filter((m) => overlap(box(n), box(m)))
					.map((m) => [n.textContent, m.textContent])
			);
		const diagrams = [...a.querySelectorAll('.diagram-surface')].map((h, index) => {
			const svg = h.shadowRoot.querySelector('svg');
			const bounds = box(svg),
				vb = svg.viewBox.baseVal;
			const nodes = [...svg.querySelectorAll('.mindmap-node')];
			const texts = [...svg.querySelectorAll('text')].filter((n) => n.textContent.trim());
			const root = nodes.find((n) => n.classList.contains('section-root'));
			const paths = [...svg.querySelectorAll('path.edge[class*="edge-depth-"]')];
			return {
				index,
				viewBox: [vb.x, vb.y, vb.width, vb.height],
				root: root ? box(root).toJSON() : null,
				nodes: nodes.map((n) => ({
					id: n.id,
					text: n.textContent.trim(),
					box: box(n).toJSON(),
					shape: [
						...n.querySelectorAll(
							':scope > rect,:scope > circle,:scope > path,:scope > polygon,:scope > ellipse'
						)
					].map((s) => ({
						kind: s.tagName,
						attrs: ['x', 'y', 'width', 'height', 'rx', 'ry', 'd', 'points', 'r', 'cx', 'cy'].map(
							(k) => s.getAttribute(k)
						),
						style: style(s)
					})),
					texts: [...n.querySelectorAll('text')].map((t) => ({
						text: t.textContent,
						style: style(t)
					}))
				})),
				above: root ? nodes.filter((n) => n !== root && box(n).bottom <= box(root).top).length : 0,
				below: root ? nodes.filter((n) => n !== root && box(n).top >= box(root).bottom).length : 0,
				nodeCollisions: collide(nodes),
				textCollisions: collide(texts),
				contained: [...texts, ...nodes, ...paths].every(
					(t) =>
						box(t).left >= bounds.left - 1 &&
						box(t).right <= bounds.right + 1 &&
						box(t).top >= bounds.top - 1 &&
						box(t).bottom <= bounds.bottom + 1
				),
				paths: paths.map((p) => ({
					d: p.getAttribute('d'),
					style: style(p),
					linecap: getComputedStyle(p).strokeLinecap,
					linejoin: getComputedStyle(p).strokeLinejoin,
					endpoints: [0, p.getTotalLength()].map((distance) => {
						const point = p.getPointAtLength(distance).matrixTransform(p.getScreenCTM());
						const candidates = nodes.map((n) => {
							const b = box(n);
							const outsideX = Math.max(b.left - point.x, 0, point.x - b.right);
							const outsideY = Math.max(b.top - point.y, 0, point.y - b.bottom);
							return {
								text: n.textContent.trim(),
								error:
									Math.hypot(outsideX, outsideY) +
									(outsideX || outsideY
										? 0
										: Math.min(
												point.x - b.left,
												b.right - point.x,
												point.y - b.top,
												b.bottom - point.y
											))
							};
						});
						return candidates.sort((a, b) => a.error - b.error)[0];
					}),
					throughNodes: nodes
						.filter((n) => {
							const b = box(n),
								matrix = p.getScreenCTM(),
								length = p.getTotalLength();
							for (let i = 3; i < length - 3; i += 2) {
								const q = p.getPointAtLength(i).matrixTransform(matrix);
								if (q.x > b.left + 1 && q.x < b.right - 1 && q.y > b.top + 1 && q.y < b.bottom - 1)
									return true;
							}
							return false;
						})
						.map((n) => n.textContent.trim())
				})),
				control:
					index >= 5
						? {
								texts: texts.map((t) => [t.textContent, style(t)]),
								shapes: [
									...svg.querySelectorAll(
										'g.node,g.cluster > rect,.cluster-label,.edgePaths path,rect.task'
									)
								].map((n) => [
									n.tagName,
									['x', 'y', 'width', 'height', 'transform', 'd', 'rx', 'ry'].map((k) =>
										n.getAttribute(k)
									)
								])
							}
						: null
			};
		});
		const charts = [...a.querySelectorAll('.llampart-chart-frame')].map((f) => {
			const labels = [...f.querySelectorAll('.lc-axis text')],
				bounds = box(f.querySelector('svg.lc-root') || f.querySelector('svg[role="img"]') || f);
			return {
				width: bounds.width,
				texts: labels.map((n) => n.textContent),
				labels: labels.map((n) => ({
					text:
						[...n.querySelectorAll('tspan')].map((s) => s.textContent).join(' ') || n.textContent,
					box: box(n).toJSON(),
					rows: n.querySelectorAll('tspan').length,
					value: n.classList.contains('chart-value-tick')
				})),
				styles: labels.map((n) => style(n)),
				collisions: collide(labels),
				contained: labels.every(
					(n) =>
						box(n).left >= bounds.left - 1 &&
						box(n).right <= bounds.right + 1 &&
						box(n).top >= bounds.top - 1 &&
						box(n).bottom <= bounds.bottom + 1
				),
				legend: [...f.querySelectorAll('.chart-legend button')].map((n) => [
					n.textContent,
					style(n)
				]),
				toolbar: [...f.querySelectorAll('.visualization-header button')].map((n) =>
					n.getAttribute('aria-label')
				),
				marks: [...f.querySelectorAll('.lc-bars-bar,.lc-arc-line')].map((n) => style(n).fill)
			};
		});
		return { diagrams, charts };
	});
}
function verify(s, old) {
	for (const d of s.diagrams) {
		assert(d.contained, `clipped diagram ${d.index}`);
		assert.deepEqual(d.textCollisions, []);
		assert.deepEqual(d.nodeCollisions, []);
	}
	for (const d of s.diagrams.slice(0, 5)) {
		// With only one branch on each side a horizontal map is intentional.
		if (d.index < 2) {
			assert(d.above > 0, `Mindmap ${d.index} must use space above root`);
			assert(d.below > 0, `Mindmap ${d.index} must use space below root`);
		}
		for (const path of d.paths) {
			assert(path.d.includes('C'));
			assert.equal(path.style.strokeWidth, '3px');
			assert.equal(path.linecap, 'round');
			assert.equal(path.linejoin, 'round');
			for (const endpoint of path.endpoints)
				assert(endpoint.error < 1, `endpoint not on node boundary: ${JSON.stringify(endpoint)}`);
			assert.deepEqual(path.throughNodes, [], `branch through a node: ${JSON.stringify(path)}`);
		}
	}
	for (const c of s.charts) {
		assert(c.contained);
		assert.deepEqual(c.collisions, []);
		for (const label of c.labels) {
			assert(label.rows <= 2);
			if (label.value) assert(!label.text.includes('…'));
		}
	}
	for (const value of ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze'])
		assert(s.charts[0].texts.includes(value), value);
	if (old) {
		for (let i = 0; i < 5; i++) {
			const previous = old.diagrams[i];
			assert.equal(s.diagrams[i].nodes.length, previous.nodes.length);
			for (const n of s.diagrams[i].nodes) {
				const p = previous.nodes.find((p) => p.text === n.text);
				assert(p, n.text);
				assert.deepEqual(n.shape, p.shape);
				assert.deepEqual(n.texts, p.texts);
			}
		}
		for (let i = 5; i < 8; i++)
			assert.deepEqual(s.diagrams[i].control, old.diagrams[i].control, `control diagram ${i}`);
		for (let i = 0; i < 6; i++) {
			assert.deepEqual(s.charts[i].legend, old.charts[i].legend);
			assert.deepEqual(s.charts[i].toolbar, old.charts[i].toolbar);
			assert.deepEqual(s.charts[i].marks, old.charts[i].marks);
		}
		for (const i of [2, 3])
			assert(
				s.charts[i].texts.join('').length > old.charts[i].texts.join('').length,
				'long category must show more characters'
			);
	}
}
try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
	await page.locator('textarea').first().fill('Osie i Mindmap');
	await page.locator('textarea').first().press('Enter');
	await settle();
	await page.evaluate(async () => {
		window.axes = await import('/tests/browser/charts-harness.ts');
	});
	const matrix = [];
	for (const colorScheme of ['light', 'dark'])
		for (const [width, height] of [
			[1920, 1080],
			[1600, 1200],
			[1100, 900]
		]) {
			await page.emulateMedia({ colorScheme });
			await page.setViewportSize({ width, height });
			await assistant.evaluate((n, width) => {
				n.style.maxWidth = width === 1100 ? '600px' : '';
			}, width);
			await settle();
			const s = { width, height, colorScheme, ...(await snapshot()) };
			matrix.push(s);
			await writeFile(`${artifacts}/styles.json`, JSON.stringify(matrix, null, 2));
			if (!baseline)
				verify(
					s,
					reference?.find((r) => r.width === width && r.colorScheme === colorScheme)
				);
			const frames = assistant.locator('.llampart-visualization-frame');
			for (const i of [0, 1, 2, 3, 4, 8, 9, 10, 11, 12]) {
				await frames.nth(i).scrollIntoViewIfNeeded();
				await frames.nth(i).evaluate((n) => n.scrollIntoView({ block: 'start' }));
				await frames.nth(i).screenshot({ path: `${artifacts}/${colorScheme}-${width}-${i}.png` });
			}
		}
	if (!baseline) {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await assistant.evaluate((n) => {
			n.style.maxWidth = '';
		});
		await settle();
		const exports = [];
		for (const i of [0, 1, 2, 3, 4, 8, 9, 10, 11, 12])
			for (const format of i < 8 ? ['SVG', 'PNG'] : ['SVG', 'PNG', 'CSV']) {
				const frame = assistant.locator('.llampart-visualization-frame').nth(i);
				await frame.scrollIntoViewIfNeeded();
				const pending = page.waitForEvent('download');
				await frame.getByRole('button', { name: new RegExp(`(^| )${format}$`) }).click();
				const download = await pending,
					path = `${artifacts}/export-${i}.${format.toLowerCase()}`;
				await download.saveAs(path);
				exports.push(path);
				if (format === 'CSV') {
					const expected = await page.evaluate(
						async (s) => (await import('/src/lib/charts/chart-csv.ts')).chartCsv(s),
						specs[i - 8]
					);
					assert.equal(await readFile(path, 'utf8'), expected);
				}
			}
		const raster = await context.newPage(),
			preview = await context.newPage(),
			alpha = [],
			exportedGeometry = [];
		for (const path of exports.filter((p) => !p.endsWith('.csv'))) {
			const bytes = await readFile(path);
			alpha.push(
				await assertTransparentExport(raster, bytes, path.endsWith('.svg') ? 'svg' : 'png')
			);
			await preview.goto(
				`data:image/${path.endsWith('.svg') ? 'svg+xml' : 'png'};base64,${bytes.toString('base64')}`
			);
			if (path.endsWith('.png'))
				assert(await preview.locator('img').evaluate((n) => n.complete && n.naturalWidth > 100));
			else {
				assert(await preview.locator('svg').count());
				const geometry = await preview.evaluate(async () => {
					await document.fonts.ready;
					const svg = document.querySelector('svg'),
						bounds = svg.getBoundingClientRect();
					const nodes = [...svg.querySelectorAll('.mindmap-node,.lc-axis text,path.edge')];
					return {
						elements: nodes.length,
						nodeCount: svg.querySelectorAll('.mindmap-node').length,
						clipped: nodes
							.filter((n) => {
								const b = n.getBoundingClientRect();
								return (
									b.left < bounds.left - 1 ||
									b.right > bounds.right + 1 ||
									b.top < bounds.top - 1 ||
									b.bottom > bounds.bottom + 1
								);
							})
							.map((n) => n.textContent || n.id)
					};
				});
				assert(geometry.elements > 0);
				assert.deepEqual(geometry.clipped, []);
				const index = Number(path.match(/export-(\d+)/)[1]);
				if (index < 5) assert.equal(geometry.nodeCount, matrix[0].diagrams[index].nodes.length);
				exportedGeometry.push({ path, ...geometry });
			}
		}
		await writeFile(`${artifacts}/export-geometry.json`, JSON.stringify(exportedGeometry, null, 2));
		await raster.close();
		await preview.close();
		// The unchanged legend still toggles its series and the tooltip still uses source data.
		const chart = assistant.locator('.llampart-chart-frame').last();
		const legendEntry = chart.locator('.chart-legend button').first();
		await legendEntry.click();
		assert.equal(await legendEntry.getAttribute('aria-pressed'), 'false');
		await legendEntry.click();
		assert.equal(await legendEntry.getAttribute('aria-pressed'), 'true');
		await page.evaluate(() => {
			window.axes.settings.updateConfig('fontFamily', 'merriweather');
			window.axes.settings.updateConfig('fontSize', '20');
		});
		await settle();
		const custom = await snapshot();
		verify(custom, null);
		assert(
			custom.diagrams[0].nodes.every((n) =>
				n.texts.every((t) => t.style.fontFamily.includes('Merriweather'))
			)
		);
		await writeFile(`${artifacts}/custom-font.json`, JSON.stringify(custom, null, 2));
		// Additional structures and dense/decimal axes under the user's larger font.
		const extraMaps = [
			'mindmap\n root(Szerokie drzewo)\n' +
				Array.from({ length: 18 }, (_, i) => `  Gałąź ${i}\n   Szczegóły ${i}`).join('\n'),
			'mindmap\n root(Jedna gałąź)\n  Potomek',
			'mindmap\n root(Głębokie drzewo)\n' +
				Array.from({ length: 9 }, (_, i) => ' '.repeat(i + 2) + `Poziom ${i}`).join('\n')
		];
		const dense = Array.from({ length: 18 }, (_, i) => `Regionalne centrum obsługi klientów ${i}`);
		const extraSpecs = [
			...['line', 'area', 'bar'].map((type) => spec(type, dense)),
			{ ...spec('bar', dense), orientation: 'horizontal' },
			{
				...spec('line', ['Ujemna', 'Zero', 'Dodatnia']),
				data: [
					{ x: 'Ujemna', y: -0.123 },
					{ x: 'Zero', y: 0.001 },
					{ x: 'Dodatnia', y: 0.456 }
				]
			},
			{
				...spec('line', []),
				data: [
					{ x: 10, y: 1 },
					{ x: 3, y: 2 },
					{ x: 8, y: 3 }
				]
			},
			spec('bar', ['i'.repeat(38), 'l'.repeat(38)])
		];
		responseContent = [
			...extraMaps.map((s) => fence('mermaid', s)),
			...extraSpecs.map((s) => fence('llampart-chart', JSON.stringify(s)))
		].join('\n\n');
		diagramCount = extraMaps.length;
		chartCount = extraSpecs.length;
		await page.locator('textarea').first().fill('Dodatkowe struktury i etykiety');
		await page.locator('textarea').first().press('Enter');
		await settle();
		const extraSnapshots = [];
		for (const width of [1920, 1600, 1100]) {
			await page.setViewportSize({ width, height: width === 1600 ? 1200 : 1080 });
			await assistant.evaluate((n, w) => {
				n.style.maxWidth = w === 1100 ? '600px' : '';
			}, width);
			await settle();
			const extra = await snapshot();
			extraSnapshots.push({ width, ...extra });
			await writeFile(
				`${artifacts}/extra-structures.json`,
				JSON.stringify(extraSnapshots, null, 2)
			);
			for (const d of extra.diagrams) {
				assert(d.contained);
				assert.deepEqual(d.nodeCollisions, []);
				assert.deepEqual(d.textCollisions, []);
				for (const path of d.paths) {
					assert.deepEqual(path.throughNodes, []);
					for (const endpoint of path.endpoints) assert(endpoint.error < 1);
				}
			}
			assert(extra.diagrams[0].above > 0 && extra.diagrams[0].below > 0);
			for (const c of extra.charts) {
				assert(c.contained);
				assert.deepEqual(c.collisions, []);
				for (const label of c.labels) {
					assert(label.rows <= 2);
					if (label.value) assert(!label.text.includes('…'));
				}
			}
			for (const c of extra.charts.slice(0, 4))
				assert(
					c.labels.filter((n) => n.rows > 0 && !n.value).length < dense.length,
					'dense axes must thin ticks rather than data'
				);
			assert.equal(
				extra.charts[2].marks.length,
				dense.length,
				'thinning ticks must preserve all bars'
			);
			const numericLabels = extra.charts[4].labels.filter((n) => n.value).map((n) => n.text);
			assert(
				numericLabels.some((s) => s.startsWith('-') && s.includes(',')),
				'negative decimal values must render in full'
			);
			if (width === 1920)
				for (const name of extraSpecs[6].data.map((r) => r.x))
					assert(
						extra.charts[6].labels.some((n) => n.text === name),
						'a long unbroken label that fits must remain full'
					);
		}
		await writeFile(`${artifacts}/extra-structures.json`, JSON.stringify(extraSnapshots, null, 2));
		await page.setViewportSize({ width: 1920, height: 1080 });
		await assistant.evaluate((n) => {
			n.style.maxWidth = '';
		});
		await settle();
		const hiddenCategoryBar = assistant
			.locator('.llampart-chart-frame')
			.nth(2)
			.locator('.lc-bars-bar')
			.nth(1);
		await hiddenCategoryBar.scrollIntoViewIfNeeded();
		// The native tooltip hit layer intentionally sits above the visible mark.
		const point = await hiddenCategoryBar.boundingBox();
		assert(point);
		await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
		await page
			.locator('.llampart-chart-tooltip')
			.filter({ hasText: dense[1] })
			.waitFor({ state: 'visible' });
		assert.deepEqual(errors, []);
		await writeFile(
			`${artifacts}/result.json`,
			JSON.stringify({ matrix: matrix.length, exports, alpha, errors }, null, 2)
		);
	}
	console.log(
		baseline
			? 'PASS baseline axes/Mindmap captured'
			: 'PASS desktop axes/Mindmap, unchanged box shapes/fonts/palette/control diagrams, longer labels, exports and legend'
	);
} catch (error) {
	await page.screenshot({ path: `${artifacts}/failure.png` }).catch(() => {});
	throw error;
} finally {
	await browser.close();
}
