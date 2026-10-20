/** Real message Markdown, SVG geometry and computed typography. Only HTTP is mocked.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/browser/ui-polish.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-ui-polish/browser';
const baseline = process.env.LLAMPART_UI_POLISH_BASELINE === '1';
const referencePath = process.env.LLAMPART_UI_POLISH_REFERENCE;
const references = referencePath ? JSON.parse(await readFile(referencePath, 'utf8')) : null;
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({
	viewport: { width: 1920, height: 1080 },
	acceptDownloads: true
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const fence = (language, code) => '```' + language + '\n' + code + '\n```';
const gantt = `gantt
title Gantt
dateFormat YYYY-MM-DD
section Plan
Analiza :a,2026-07-25,7d
Implementacja i bardzo długa nazwa zadania :b,2026-07-31,1d
Test :c,2026-08-01,7d
Koniec :milestone,d,2026-08-08,0d`;
const diagrams = [
	gantt,
	'mindmap\n root((Mindmap))\n  Dane\n   Wyniki\n  Rozmowa',
	'flowchart TB\n subgraph init[Inicjalizacja]\n A[Start] -->|Tak| B{Poprawne?}\n end\n subgraph fin[Finalizacja]\n C[Wynik]\n end\n B -->|Nie| C',
	'stateDiagram-v2\n [*] --> Gotowy\n Gotowy --> Koniec: Dane poprawne\n Koniec --> [*]'
];
const cartesian = {
	description: 'Opis danych',
	xKey: 'x',
	series: [{ key: 'y', label: 'Seria' }],
	data: [
		{ x: 'Długa kategoria pierwsza', y: -12345 },
		{ x: 'Druga', y: 12000 },
		{ x: 'Ostatnia', y: 4500 }
	],
	xLabel: 'Kategorie',
	yLabel: 'Wartość'
};
const specs = ['line', 'area', 'bar']
	.map((type) => ({ ...cartesian, type, title: type }))
	.concat([
		{ ...cartesian, type: 'bar', orientation: 'horizontal', title: 'horizontal' },
		{
			type: 'donut',
			title: 'Donut',
			labelKey: 'x',
			valueKey: 'y',
			data: [
				{ x: 'A', y: 3 },
				{ x: 'B', y: 7 }
			]
		}
	]);
const lists = `1. Pierwszy
2. Drugi

- Główny
  - Drugi
    - Trzeci
      - Czwarty

1. Numer
   - Punkt
     - Podpunkt

- Lista
  1. Numer wewnątrz

- [x] Gotowe
- [ ] Otwarte`;
const content =
	diagrams
		.map((code) => fence('mermaid', code))
		.concat(specs.map((spec) => fence('llampart-chart', JSON.stringify(spec))))
		.join('\n\n') +
	'\n\n' +
	lists;
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
	if (localStorage.getItem('LlamaCppWebui.config')) return;
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://polish.test',
			llamaServerBaseUrl: 'http://polish.test',
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
	if (path.endsWith('/chat/completions'))
		return route.fulfill({
			contentType: 'text/event-stream',
			body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
		});
	return route.fulfill({
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
async function settled(diagramCount, chartCount) {
	// ResizeObserver runs after layout: do not accept the previous width's SVG.
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await page.waitForFunction(
		([d, c]) => {
			const a = document.querySelector('.llampart-assistant-markdown');
			return (
				a &&
				a.querySelectorAll('.llampart-diagram-frame').length === d &&
				a.querySelectorAll('.llampart-chart-frame').length === c &&
				!a.querySelector('.llampart-inline-processing-status') &&
				[...a.querySelectorAll('.diagram-surface')].every((h) => h.shadowRoot?.querySelector('svg'))
			);
		},
		[diagramCount, chartCount],
		{ timeout: 90000 }
	);
}
async function update(patch) {
	await page.evaluate(async (patch) => {
		const { conversations, db } = window.polish;
		const message = conversations.activeMessages.find((m) => m.role === 'assistant');
		await db.updateMessage(message.id, patch);
		conversations.updateMessageAtIndex(conversations.findMessageIndex(message.id), patch);
	}, patch);
}
async function geometry() {
	return assistant.evaluate((a) => {
		const style = (el, pseudo) => {
			const s = getComputedStyle(el, pseudo);
			return Object.fromEntries(
				['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'fill', 'opacity'].map(
					(key) => [key, s[key]]
				)
			);
		};
		const overlap = (a, b) =>
			Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
			Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5;
		const collisions = (nodes) =>
			nodes.flatMap((a, i) =>
				nodes
					.slice(i + 1)
					.filter((b) => overlap(a.getBoundingClientRect(), b.getBoundingClientRect()))
					.map((b) => [a.textContent, b.textContent])
			);
		const diagrams = [...a.querySelectorAll('.diagram-surface')].map((h) => {
			const svg = h.shadowRoot.querySelector('svg'),
				boundary = svg.getBoundingClientRect();
			const tasks = [...svg.querySelectorAll('text[id$="-text"]')];
			const edges = [...svg.querySelectorAll('.edgeLabel text')];
			const obstacles = [...svg.querySelectorAll('g.node,.cluster-label')];
			const paths = [
				...svg.querySelectorAll('.edgePaths path,path.flowchart-link,path.transition')
			];
			const edgeGeometry = edges.map((text) => {
				const box = text.getBoundingClientRect();
				const inside = (point) =>
					point.x > box.left - 0.5 &&
					point.x < box.right + 0.5 &&
					point.y > box.top - 0.5 &&
					point.y < box.bottom + 0.5;
				return {
					text: text.textContent,
					contained:
						box.left >= boundary.left - 1 &&
						box.right <= boundary.right + 1 &&
						box.top >= boundary.top - 1 &&
						box.bottom <= boundary.bottom + 1,
					obstacles: obstacles
						.filter((node) => overlap(box, node.getBoundingClientRect()))
						.map((node) => node.textContent),
					crossed: paths.some((path) => {
						const length = path.getTotalLength(),
							matrix = path.getScreenCTM();
						const count = Math.ceil(length / 0.5);
						for (let i = 0; i <= count; i++)
							if (
								inside(
									path.getPointAtLength((length * i) / Math.max(1, count)).matrixTransform(matrix)
								)
							)
								return true;
						return false;
					}),
					arrowContact: paths.some((path) => {
						const matrix = path.getScreenCTM();
						return ['marker-start', 'marker-end'].some((attr) => {
							if (!path.getAttribute(attr) || path.getAttribute(attr) === 'none') return false;
							const point = path
								.getPointAtLength(attr === 'marker-start' ? 0 : path.getTotalLength())
								.matrixTransform(matrix);
							const gap = Math.hypot(
								Math.max(box.left - point.x, 0, point.x - box.right),
								Math.max(box.top - point.y, 0, point.y - box.bottom)
							);
							return gap < 2;
						});
					})
				};
			});
			return {
				title: style(h.closest('figure').querySelector('.visualization-title')),
				texts: [...svg.querySelectorAll('text')].map((t) => ({
					text: t.textContent,
					role: t.closest('.edgeLabel') ? 'edge' : t.closest('.cluster-label') ? 'cluster' : 'node',
					style: style(t)
				})),
				geometry: [
					...svg.querySelectorAll('g.node,g.cluster > rect,.cluster-label,.edgePaths path')
				].map((el) => ({
					kind: el.tagName,
					text: el.matches('path,rect') ? '' : el.textContent,
					attributes: ['x', 'y', 'width', 'height', 'transform', 'd'].map((key) =>
						el.getAttribute(key)
					)
				})),
				unresolved: svg.getAttribute('data-unresolved-labels'),
				edgeGeometry,
				collisions: collisions(
					[...svg.querySelectorAll('text')].filter((t) => t.textContent.trim())
				),
				tasks: tasks.map((t) => {
					const bar = svg.getElementById(t.id.replace(/-text$/, ''));
					const box = t.getBoundingClientRect();
					return {
						text: t.textContent,
						outside: !overlap(box, bar.getBoundingClientRect()),
						contained: box.left >= boundary.left - 1 && box.right <= boundary.right + 1,
						bar: ['x', 'y', 'width', 'height', 'transform'].map((key) => bar.getAttribute(key))
					};
				})
			};
		});
		const charts = [...a.querySelectorAll('.llampart-chart-frame')].map((frame) => {
			const boundary = frame.getBoundingClientRect();
			const labels = [...frame.querySelectorAll('.lc-axis text')];
			return {
				title: style(frame.querySelector('.visualization-title')),
				description: frame.querySelector('.chart-description')
					? style(frame.querySelector('.chart-description'))
					: null,
				axis: labels.map((el) => style(el)),
				legend: style(frame.querySelector('.chart-legend button')),
				collisions: collisions(labels),
				contained: labels.every((t) => {
					const box = t.getBoundingClientRect();
					return box.left >= boundary.left - 1 && box.right <= boundary.right + 1;
				})
			};
		});
		const lists = [...a.querySelectorAll('li:not(.task-list-item)')].map((li) => ({
			marker: style(li, '::marker'),
			text: style(li),
			list: getComputedStyle(li.parentElement).listStyleType,
			nestedUl: li.parentElement.matches('ul') && !!li.parentElement.parentElement.closest('ul,ol')
		}));
		const checks = [...a.querySelectorAll('.task-list-item input')].map((el) => ({
			checked: el.checked,
			disabled: el.disabled,
			background: getComputedStyle(el).backgroundColor,
			check: getComputedStyle(el, '::after').content,
			opacity: getComputedStyle(el).opacity
		}));
		return { diagrams, charts, lists, checks };
	});
}
try {
	await page.goto(base);
	await page.locator('textarea').first().fill('Test UI');
	await page.locator('textarea').first().press('Enter');
	await settled(4, 5);
	await page.evaluate(async () => {
		window.polish = await import('/tests/browser/charts-harness.ts');
	});
	await page.locator('button[aria-label="Ustawienia"]').click();
	const settingsDialog = page.locator('.llampart-chat-settings-dialog-content');
	await settingsDialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
	assert.equal(await settingsDialog.locator('#frostedGlassMilkiness').inputValue(), '75');
	assert.equal(
		await settingsDialog.locator('output[for="frostedGlassMilkiness"]').innerText(),
		'75%'
	);
	await settingsDialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
	await settingsDialog.waitFor({ state: 'hidden' });
	const snapshots = [];
	for (const colorScheme of ['light', 'dark']) {
		await page.emulateMedia({ colorScheme });
		for (const [width, height] of [
			[1920, 1080],
			[1600, 1200],
			[1100, 900]
		]) {
			await page.setViewportSize({ width, height });
			await settled(4, 5);
			const snapshot = await geometry();
			for (const d of snapshot.diagrams) {
				assert.deepEqual(d.collisions, []);
				assert(d.tasks.every((t) => t.outside && t.contained));
			}
			for (const c of snapshot.charts) {
				assert.deepEqual(c.collisions, []);
				assert(c.contained);
				assert.equal(c.legend.fontSize, snapshot.charts[4].legend.fontSize);
				if (c.description && !baseline)
					assert.equal(c.description.fontSize, snapshot.charts[4].legend.fontSize);
				assert(
					c.axis.every(
						(s) => s.fontSize === snapshot.charts[4].legend.fontSize && s.opacity === '1'
					) || baseline
				);
			}
			const labelSize = snapshot.charts[4].legend.fontSize;
			for (const [i, d] of snapshot.diagrams.entries()) {
				if (!baseline) {
					for (const text of d.texts)
						if (i === 0 || (i >= 2 && text.role === 'edge'))
							assert.equal(
								text.style.fontSize,
								i === 0 ? `${parseFloat(labelSize) + 1}px` : labelSize,
								`diagram ${i}: ${text.role} ${text.text}`
							);
					if (i >= 2) assert.equal(d.unresolved, '0');
					if (i >= 2)
						for (const edge of d.edgeGeometry) {
							assert(edge.contained && !edge.crossed && !edge.arrowContact, JSON.stringify(edge));
							assert.deepEqual(edge.obstacles, []);
						}
				}
			}
			if (references) {
				const before = references.find((r) => r.width === width && r.colorScheme === colorScheme);
				for (const [i, d] of snapshot.diagrams.entries()) {
					assert.deepEqual(d.title, before.diagrams[i].title);
					if (i > 0)
						assert.deepEqual(
							d.texts.filter((t) => i === 1 || (t.role !== 'edge' && t.role !== 'cluster')),
							before.diagrams[i].texts.filter(
								(t) => i === 1 || (t.role !== 'edge' && t.role !== 'cluster')
							)
						);
					if (i === 2)
						assert.deepEqual(
							d.geometry.filter((g) => g.kind !== 'g'),
							before.diagrams[i].geometry.filter((g) => g.kind !== 'g')
						);
				}
				for (const [i, c] of snapshot.charts.entries())
					assert.deepEqual(c.title, before.charts[i].title);
				assert.deepEqual(snapshot.charts[4].legend, before.charts[4].legend);
			}
			for (const li of snapshot.lists) {
				for (const key of ['color', 'fontFamily', 'fontSize', 'fontWeight'])
					assert.equal(li.marker[key], li.text[key]);
				if (li.nestedUl) assert.equal(li.list, baseline ? 'circle' : 'disc');
			}
			assert(snapshot.checks.every((c) => c.disabled && c.opacity === '1'));
			assert.notEqual(snapshot.checks[0].background, snapshot.checks[1].background);
			assert.equal(snapshot.checks[0].check, '""');
			snapshots.push({ colorScheme, width, height, ...snapshot });
			for (const [i, frame] of (
				await assistant.locator('.llampart-visualization-frame').all()
			).entries()) {
				await frame.scrollIntoViewIfNeeded();
				await frame.screenshot({ path: `${artifacts}/${colorScheme}-${width}-${i}.png` });
			}
			await assistant.locator('.task-list-item').first().scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${artifacts}/${colorScheme}-${width}-markdown.png` });
		}
	}
	await writeFile(`${artifacts}/styles.json`, JSON.stringify(snapshots, null, 2));
	const directions = [];
	const directionExports = [];
	const fontSettings = [];
	if (!baseline) {
		const sources = ['TB', 'LR', 'BT', 'RL']
			.map((direction) => diagrams[2].replace('flowchart TB', `flowchart ${direction}`))
			.concat(
				['TB', 'LR'].map(
					(direction) =>
						`stateDiagram-v2\n direction ${direction}\n [*] --> Gotowy\n Gotowy --> Koniec: Tak\n Koniec --> Gotowy: Nie\n Koniec --> [*]`
				)
			);
		await update({ content: sources.map((source) => fence('mermaid', source)).join('\n\n') });
		for (const colorScheme of ['light', 'dark']) {
			await page.emulateMedia({ colorScheme });
			for (const width of [1920, 1100]) {
				await page.setViewportSize({ width, height: 1080 });
				await settled(6, 0);
				const result = await geometry();
				for (const [i, d] of result.diagrams.entries()) {
					assert.equal(d.unresolved, '0');
					for (const text of d.texts.filter((t) => t.text.trim()))
						assert(
							Math.abs(
								parseFloat(text.style.fontSize) -
									parseFloat(d.title.fontSize) * (text.role === 'edge' ? 0.8 : 1)
							) < 0.001
						);
					for (const edge of d.edgeGeometry) {
						assert(edge.contained && !edge.crossed && !edge.arrowContact, JSON.stringify(edge));
						assert.deepEqual(edge.obstacles, []);
					}
					if (i < 4)
						for (const element of d.geometry.filter(
							(el) => el.text === 'Inicjalizacja' || el.text === 'Finalizacja'
						))
							assert(!element.attributes.some((value) => value?.includes('rotate')));
					await assistant
						.locator('.llampart-diagram-frame')
						.nth(i)
						.screenshot({ path: `${artifacts}/direction-${colorScheme}-${width}-${i}.png` });
				}
				directions.push({ colorScheme, width, ...result });
			}
		}
		await writeFile(`${artifacts}/directions.json`, JSON.stringify(directions, null, 2));
		const exportedSvgs = [];
		for (const [i, frame] of (await assistant.locator('.llampart-diagram-frame').all()).entries()) {
			for (const format of ['SVG', 'PNG']) {
				console.log('Direction export', i, format);
				const event = page.waitForEvent('download');
				await frame.getByRole('button', { name: new RegExp(` ${format}$`) }).click();
				const download = await event;
				const path = `${artifacts}/direction-export-${i}.${format.toLowerCase()}`;
				await download.saveAs(path);
				const bytes = await readFile(path);
				if (format === 'SVG') {
					assert(bytes.toString().includes('.edgeLabel text'));
					exportedSvgs.push(bytes.toString());
				} else assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
				directionExports.push(path);
			}
			await frame.screenshot({ path: `${artifacts}/direction-export-${i}-source.png` });
		}
		const exportPage = await context.newPage();
		for (const svg of exportedSvgs) {
			await exportPage.setContent(svg);
			await exportPage.evaluate(() => document.fonts.ready);
			const sizes = await exportPage
				.locator('.edgeLabel text')
				.evaluateAll((nodes) => nodes.map((el) => getComputedStyle(el).fontSize));
			assert(sizes.length > 0 && sizes.every((size) => size === '9.6px'));
		}
		await exportPage.close();
		await page.bringToFront();
		// Full-size preview uses the same SVG rather than reflowing nodes or groups.
		await assistant
			.locator('.llampart-diagram-frame')
			.first()
			.getByRole('button', { name: 'Podgląd diagramu', exact: true })
			.click();
		const preview = page.getByRole('dialog');
		const previewSvg = preview.locator('svg[role="img"]');
		await previewSvg.waitFor();
		assert(await previewSvg.locator('.edgeLabel text').count());
		for (const size of await previewSvg
			.locator('.edgeLabel text')
			.evaluateAll((nodes) => nodes.map((el) => getComputedStyle(el).fontSize)))
			assert.equal(size, '9.6px');
		await preview.screenshot({ path: `${artifacts}/native-diagram-preview.png` });
		await page.keyboard.press('Escape');
		await preview.waitFor({ state: 'hidden' });
		await update({ content });
		await settled(4, 5);
		for (const fontSize of ['12', '20']) {
			await page.evaluate(
				(size) => window.polish.settings.updateConfig('fontSize', size),
				fontSize
			);
			await page.waitForFunction(
				(size) =>
					getComputedStyle(document.querySelector('.visualization-title')).fontSize === `${size}px`,
				fontSize
			);
			await settled(4, 5);
			const result = await geometry();
			const expected = result.charts[4].legend.fontSize;
			assert(Math.abs(parseFloat(expected) - Number(fontSize) * 0.8) < 0.001);
			assert(result.charts.every((c) => c.axis.every((s) => s.fontSize === expected)));
			for (const [i, d] of result.diagrams.entries())
				for (const text of d.texts.filter((t) => t.text.trim()))
					assert.equal(
						text.style.fontSize,
						i === 0
							? `${parseFloat(expected) + 1}px`
							: i >= 2 && text.role === 'edge'
								? expected
								: `${fontSize}px`
					);
			fontSettings.push({ fontSize, ...result });
		}
		await writeFile(`${artifacts}/font-settings.json`, JSON.stringify(fontSettings, null, 2));
		await page.evaluate(() => window.polish.settings.updateConfig('fontSize', 'default'));
		await settled(4, 5);
	}
	// A dense month boundary and a year boundary, including a final long bar.
	for (const [start, end] of [
		['2026-07-31', '2026-08-01'],
		['2026-12-31', '2027-01-01']
	]) {
		await update({
			content: fence(
				'mermaid',
				`gantt\ndateFormat YYYY-MM-DD\nsection Etap\nDługi etap :a,${start},1d\nBardzo długa nazwa ostatniego zadania :b,${end},1d`
			)
		});
		for (const width of [1600, 1100, 1920]) {
			await page.setViewportSize({ width, height: 1080 });
			await settled(1, 0);
			const result = (await geometry()).diagrams[0];
			assert.deepEqual(result.collisions, []);
			assert(result.tasks.every((t) => t.outside && t.contained));
		}
	}
	await update({ content });
	await settled(4, 5);
	// Exercise the real download controls for every renderer, not a test-only SVG.
	const exports = [];
	for (const [i, frame] of (
		await assistant.locator('.llampart-visualization-frame').all()
	).entries()) {
		for (const format of ['SVG', 'PNG']) {
			const event = page.waitForEvent('download');
			await frame.getByRole('button', { name: new RegExp(` ${format}$`) }).click();
			const download = await event;
			const path = `${artifacts}/export-${i}.${format.toLowerCase()}`;
			await download.saveAs(path);
			const bytes = await readFile(path);
			assert(bytes.length > 100);
			if (format === 'SVG') assert(bytes.toString().includes('Llampart Fira Sans'));
			else assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
			exports.push(path);
		}
	}
	// Renderer exceptions, independent of parser validity. The production error
	// boundaries must retain the same opt-in source controls and safe status copy.
	const failurePage = await context.newPage();
	await failurePage.route('**/ChartFrame.svelte*', (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: 'throw new Error("renderer fixture"); export default function(){}'
		})
	);
	await failurePage.route('**/mermaid-runtime.ts*', (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: 'export async function renderDiagram(){throw new Error("renderer fixture")}'
		})
	);
	await failurePage.goto(page.url());
	await failurePage.waitForSelector('textarea');
	const conversationId = await page.evaluate(
		() => window.polish.conversations.activeConversation.id
	);
	await failurePage.evaluate(async (id) => {
		const { conversations } = await import('/tests/browser/charts-harness.ts');
		await conversations.loadConversation(id);
	}, conversationId);
	await failurePage.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	try {
		await failurePage.waitForFunction(
			() =>
				document.querySelectorAll('.llampart-assistant-markdown .llampart-visualization-fallback')
					.length === 9 &&
				[
					...document.querySelectorAll(
						'.llampart-assistant-markdown .llampart-visualization-fallback'
					)
				].every((node) => node.querySelectorAll('button').length === 2) &&
				!document.querySelector('.llampart-assistant-markdown .llampart-inline-processing-status')
		);
	} catch (error) {
		await failurePage.screenshot({ path: `${artifacts}/renderer-diagnostic.png`, fullPage: true });
		console.error(
			'Renderer fixture page',
			failurePage.url(),
			await failurePage.locator('body').innerText()
		);
		throw error;
	}
	assert.equal(
		await failurePage.getByRole('button', { name: 'Pokaż kod', exact: true }).count(),
		9
	);
	assert.equal(await failurePage.getByRole('dialog').count(), 0);
	assert(
		!(await failurePage.locator('.llampart-assistant-markdown').innerText()).includes(
			'renderer fixture'
		)
	);
	await failurePage.screenshot({ path: `${artifacts}/renderer-failures.png` });
	await failurePage.close();
	// Provider timings share this persisted presentation contract (llama uses the other branch).
	for (const apiProvider of ['vllm', 'openai-compatible']) {
		await page.evaluate(
			(value) => window.polish.settings.updateConfig('apiProvider', value),
			apiProvider
		);
		await update({
			model: 'test.gguf',
			timings: {
				provider: {
					usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
					metrics: [
						{
							name: 'tokensPerSecond',
							value: 42,
							unit: 'tokens/s',
							source: 'backend',
							available: true
						}
					]
				}
			}
		});
		const gauge = page.getByRole('button', { name: /^Szybkość generowania: / });
		await gauge.scrollIntoViewIfNeeded();
		assert((await gauge.innerText()).includes('42.00'));
		// Both providers reuse this button. Escape suppresses reopening until blur.
		await gauge.evaluate((node) => node.blur());
		await gauge.focus();
		const tooltip = page.locator('[data-slot="tooltip-content"][data-state$="open"]');
		await tooltip.waitFor({ state: 'visible' });
		assert.equal((await tooltip.innerText()).trim(), 'Szybkość generowania');
		await page.keyboard.press('Escape');
	}
	await page.evaluate(async () => {
		window.polish.settings.updateConfig('apiProvider', 'llama-server');
		await window.polish.connection.check(undefined, async () => new Response('', { status: 503 }));
	});
	const notice = page.locator('.llampart-provider-connection-notice');
	await notice.waitFor();
	assert.equal(
		(await notice.locator('.connection-message').innerText()).trim(),
		'Odśwież stronę po przywróceniu połączenia lub sprawdź ustawienia serwera.'
	);
	assert.equal(await notice.getByRole('button').count(), 2);
	await page.evaluate(() => window.polish.connection.check());
	await notice.waitFor({ state: 'hidden' });
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	// Both parser and limit paths retain bounded fallback with opt-in source access.
	await page.setViewportSize({ width: 1100, height: 900 });
	await page.evaluate(() =>
		window.polish.settings.updateConfig('alwaysShowSidebarOnDesktop', false)
	);
	if (await page.locator('[data-slot="sidebar"][data-state="expanded"]').count()) {
		await page.locator('[data-slot="sidebar-trigger"]').first().click();
		await page.waitForFunction(
			() => !document.querySelector('[data-slot="sidebar"][data-state="expanded"]')
		);
	}
	for (const [language, source] of [
		['llampart-chart', '{'],
		['llampart-chart', ''],
		['llampart-chart', JSON.stringify({ ...specs[0], data: [] })],
		[
			'llampart-chart',
			JSON.stringify({ ...specs[0], data: Array.from({ length: 501 }, (_, x) => ({ x, y: 1 })) })
		],
		['mermaid', 'flowchart LR\nA['],
		['mermaid', ''],
		['mermaid', 'mindmap\n' + ' A\n'.repeat(1201)]
	]) {
		await update({ content: fence(language, source) });
		const fallback = assistant.locator('.llampart-visualization-fallback');
		await fallback.waitFor();
		assert(await fallback.evaluate((node) => node.scrollWidth <= node.clientWidth));
		assert(
			(await fallback.innerText()).includes(language === 'mermaid' ? 'llampart-diagram' : language)
		);
		assert.equal(
			await fallback.getByRole('button', { name: 'Kopiuj kod', exact: true }).count(),
			1
		);
		assert.equal(await page.locator('[role="dialog"]').count(), 0);
		await fallback.getByRole('button', { name: 'Kopiuj kod', exact: true }).click();
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
		await fallback.getByRole('button', { name: 'Pokaż kod', exact: true }).click();
		await page.getByRole('dialog').waitFor();
		await page.keyboard.press('Escape');
		await page.getByRole('dialog').waitFor({ state: 'hidden' });
	}
	await assistant
		.locator('.llampart-visualization-fallback')
		.screenshot({ path: `${artifacts}/narrow-fallback.png` });
	const paragraphs = [];
	if (!baseline) {
		await update({
			content: fence('llampart-chart', '{') + '\n\n' + fence('mermaid', 'flowchart LR\nA[')
		});
		for (const language of ['pl', 'en', 'de', 'fr', 'it', 'es']) {
			await page.evaluate(
				(language) => window.polish.settings.updateConfig('interfaceLanguage', language),
				language
			);
			const expected = await page.evaluate(async (language) => {
				const { t } = await import('/src/lib/i18n/index.ts');
				return [
					[t('charts.invalid', language), t('charts.inspectDefinition', language)],
					[t('diagrams.invalid', language)]
				];
			}, language);
			await page.waitForFunction((expected) => {
				const messages = [
					...document.querySelectorAll('.llampart-assistant-markdown .fallback-message')
				];
				return (
					messages.length === 2 &&
					messages.every(
						(node, i) =>
							[...node.querySelectorAll('p')].map((p) => p.textContent).join('\n') ===
							expected[i].join('\n')
					)
				);
			}, expected);
			for (const colorScheme of ['light', 'dark']) {
				await page.emulateMedia({ colorScheme });
				for (const width of [1600, 1100]) {
					await page.setViewportSize({ width, height: 1000 });
					await page.waitForFunction(
						() =>
							document.querySelectorAll(
								'.llampart-assistant-markdown .llampart-visualization-fallback'
							).length === 2
					);
					for (const i of [0, 1]) {
						const fallback = assistant.locator('.llampart-visualization-fallback').nth(i);
						await fallback
							.locator('[role="status"] p')
							.nth(expected[i].length - 1)
							.waitFor({ state: 'visible' });
						assert.deepEqual(
							await fallback.locator('[role="status"] p').allTextContents(),
							expected[i]
						);
						const boxes = await fallback.locator('[role="status"] p').evaluateAll((nodes) =>
							nodes.map((node) => {
								const box = node.getBoundingClientRect();
								return {
									top: box.top,
									bottom: box.bottom,
									display: getComputedStyle(node).display
								};
							})
						);
						if (boxes.length > 1) assert(boxes[1].top > boxes[0].bottom);
						assert(boxes.every((box) => box.display === 'block'));
						assert(await fallback.evaluate((node) => node.scrollWidth <= node.clientWidth));
						paragraphs.push({
							language,
							colorScheme,
							width,
							kind: i === 0 ? 'chart' : 'diagram',
							expected: expected[i],
							boxes
						});
					}
					assert.equal(await page.getByRole('dialog').count(), 0);
					await page.screenshot({
						path: `${artifacts}/fallback-${language}-${colorScheme}-${width}.png`
					});
				}
			}
		}
		await writeFile(`${artifacts}/fallback-paragraphs.json`, JSON.stringify(paragraphs, null, 2));
		assert.equal(paragraphs.length, 48);
	}
	// Actual initialization/rehydration is covered by reload, reset by the real store.
	await page.evaluate(() => {
		window.polish.settings.updateConfig('frostedGlassMilkiness', 23);
	});
	await page.reload();
	assert.equal(
		await page.evaluate(
			async () =>
				(await import('/tests/browser/charts-harness.ts')).settings.config.frostedGlassMilkiness
		),
		23
	);
	await page.evaluate(async () =>
		(await import('/tests/browser/charts-harness.ts')).settings.resetConfig()
	);
	assert.equal(
		await page.evaluate(
			async () =>
				(await import('/tests/browser/charts-harness.ts')).settings.config.frostedGlassMilkiness
		),
		75
	);
	assert.deepEqual(errors, []);
	await writeFile(
		`${artifacts}/result.json`,
		JSON.stringify(
			{
				matrix: snapshots.length,
				directions: directions.length,
				paragraphs: paragraphs.length,
				exports: exports.concat(directionExports),
				errors
			},
			null,
			2
		)
	);
	console.log(
		'UI polish: matrix, geometry, Markdown, exports, provider tooltips, fallbacks and settings PASS'
	);
} catch (error) {
	await page.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
	throw error;
} finally {
	await browser.close();
}
