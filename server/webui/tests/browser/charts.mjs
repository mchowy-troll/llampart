/** Real app/IndexedDB/Markdown/Settings in isolated Chromium; HTTP fixtures, no inference.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/charts.mjs
 * LLAMPART_TEST_PRODUCTION=1 skips dev-only store editing/streaming probes.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTransparentExport } from './export-transparency.mjs';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-chart-browser';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({
	viewport: { width: 1920, height: 1080 },
	acceptDownloads: true
});
const page = await context.newPage();
await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
	await welcome.locator('#about-llampart-do-not-show-again').check();
	await welcome.getByRole('button', { name: 'OK', exact: true }).click();
});
const errors = [];
const transparency = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (event) => {
	if (event.type() === 'error') console.error(event.text());
});
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const fence = (spec) => '```llampart-chart\n' + JSON.stringify(spec) + '\n```';
const cart = {
	xKey: 'month',
	xLabel: 'Miesiąc',
	yLabel: 'Kwota',
	series: [
		{ key: 'revenue', label: 'Przychód' },
		{ key: 'cost', label: 'Koszty' }
	],
	data: [
		{ month: 'Styczeń', revenue: 12.123456, cost: 8 },
		{ month: 'Luty', revenue: 18, cost: 11 },
		{ month: 'Marzec', revenue: 24, cost: 15 }
	]
};
const circular = {
	labelKey: 'Nazwa',
	valueKey: 'Udział',
	data: [
		{ Nazwa: 'Łódź', Udział: 3 },
		{ Nazwa: '東京', Udział: 7 },
		{ Nazwa: 'Kraków', Udział: 2 }
	]
};
const specs = [
	{ ...cart, type: 'line', title: 'Przychody miesięczne' },
	{ ...cart, type: 'bar', title: 'Słupki grupowane' },
	{ ...cart, type: 'bar', title: 'Słupki poziome', orientation: 'horizontal' },
	{ ...cart, type: 'area', title: 'Obszary' },
	{ ...circular, type: 'donut', title: 'Udziały' },
	{ ...circular, type: 'donut', title: 'Pierścień' }
];
const table = '| Nazwa | Wartość |\n|---|---|\n| A | 12 |';
const markdown =
	'Przed wykresem.\n\n' +
	fence(specs[0]) +
	'\n\n' +
	table +
	'\n\n' +
	specs.slice(1).map(fence).join('\n\n') +
	'\n\n$$\nx^2 + y^2 = z^2\n$$\n\n```js\nconst safe = true;\n```\n\n' +
	fence({ type: 'radar', title: '<img src=x onerror=alert(1)>' }) +
	'\n\nPo wykresach.';
let captured;
await page.addInitScript(() => {
	if (!localStorage.getItem('LlamaCppWebui.config'))
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'llama-server',
				serverBaseUrl: 'http://charts.test',
				llamaServerBaseUrl: 'http://charts.test',
				interfaceLanguage: 'pl',
				theme: 'frosted-glass',
				frostedGlassWallpaper: 'frosted-glass-02',
				fontFamily: 'merriweather',
				fontVariant: '400',
				uiScale: '100',
				renderUserContentAsMarkdown: true,
				renderReasoningContentAsMarkdown: true,
				minimalAgenticIndicators: false,
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false,
				alwaysShowSidebarOnDesktop: true
			})
		);
});
await page.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	if (path.endsWith('/chat/completions')) {
		captured = route.request().postDataJSON();
		return route.fulfill({
			contentType: 'text/event-stream',
			body: `data: ${JSON.stringify({ choices: [{ delta: { content: markdown, reasoning_content: fence(specs[0]) } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
		});
	}
	return route.fulfill({
		json: path.endsWith('/props')
			? {
					build_info: 'charts-test',
					model_path: 'charts.gguf',
					default_generation_settings: { params: {} }
				}
			: path.endsWith('/models')
				? { object: 'list', data: [{ id: 'charts.gguf' }] }
				: []
	});
});
const assistant = page.locator('.llampart-assistant-markdown').first();
const frames = assistant.locator('.llampart-chart-frame');
const dialog = page.locator('.llampart-chat-settings-dialog-content');
async function select(id, name) {
	await page.locator(`#${id}`).click();
	await page.getByRole('option', { name, exact: true }).click();
}
async function openSettings() {
	await page.locator('button[aria-label="Ustawienia"]').click();
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
}
async function closeSettings() {
	await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function state() {
	return frames.first().evaluate((el) => ({
		color: getComputedStyle(el.querySelector('.chart-swatch')).backgroundColor,
		material: getComputedStyle(el).backgroundColor,
		font: getComputedStyle(el.querySelector('text')).fontFamily,
		size: getComputedStyle(el.querySelector('text')).fontSize,
		width: el.clientWidth,
		scroll: el.scrollWidth
	}));
}
async function shot(name) {
	await frames.first().scrollIntoViewIfNeeded();
	await frames.first().evaluate(async (element) => {
		await Promise.all(
			element
				.closest('.markdown-block')
				.getAnimations()
				.map((animation) => animation.finished)
		);
	});
	await page.screenshot({ path: `${artifacts}/${name}.png` });
}

try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	assert.equal(await page.locator('.llampart-chart-frame').count(), 0);
	assert(!page.url().includes('ChartFrame'));
	await page.locator('textarea').first().fill(fence(specs[0]));
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(() => {
		const frames = [
			...document.querySelectorAll('.llampart-assistant-markdown .llampart-chart-frame')
		];
		return frames.length === 6 && frames.every((frame) => frame.querySelector('.lc-layout-svg'));
	});
	assert.equal(await frames.count(), 6);
	assert.equal(await page.locator('.markdown-user-content .llampart-chart-frame').count(), 0);
	assert.equal(await page.locator('.llampart-reasoning-content .llampart-chart-frame').count(), 0);
	assert.equal(await assistant.locator('.llampart-chart-fallback').count(), 1);
	assert.equal(await assistant.locator('img').count(), 0);
	assert.equal(await assistant.locator('table').count(), 1);
	assert.equal(await assistant.locator('.katex-display').count(), 1);
	assert((await assistant.locator('code.language-js').textContent()).includes('const safe'));
	assert(
		captured.messages.some(
			(message) => message.role === 'system' && message.content.includes('llampart-chart')
		)
	);
	for (const frame of await frames.all()) {
		assert((await frame.locator('path[d]').count()) > 0);
		const geometry = await frame.evaluate((el) => ({
			width: el.clientWidth,
			scroll: el.scrollWidth
		}));
		assert(geometry.width > 300 && geometry.scroll <= geometry.width + 1);
	}
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await shot('wallpaper-02-merriweather');
	const before = await state();
	await page.evaluate(() => {
		window.settingsChartIdentity = document.querySelector('.llampart-chart-frame');
	});
	assert.deepEqual(
		await page.evaluate(() =>
			Array.from({ length: 5 }, (_, i) =>
				getComputedStyle(document.documentElement)
					.getPropertyValue(`--llampart-chart-${i + 1}`)
					.trim()
			)
		),
		['#00BEFF', '#00A3A3', '#00C853', '#AEEA00', '#FF6D00']
	);
	await frames.first().locator('.chart-legend button').last().click();
	assert.equal(
		await frames.first().locator('.chart-legend button[aria-pressed="false"]').count(),
		1
	);
	await frames.first().getByRole('button', { name: 'Podgląd wykresu', exact: true }).click();
	const selectedPreview = page.locator('.chart-preview-dialog-content');
	await selectedPreview.locator('svg[role="img"]').waitFor();
	assert.equal(
		await selectedPreview.locator('.chart-legend button[aria-pressed="false"]').count(),
		1
	);
	await selectedPreview.locator('.chart-legend button').last().click();
	assert.equal(
		await selectedPreview.locator('.chart-legend button[aria-pressed="false"]').count(),
		0
	);
	await page.keyboard.press('Escape');
	assert.equal(
		await frames.first().locator('.chart-legend button[aria-pressed="false"]').count(),
		1
	);
	await frames.first().locator('.chart-legend button').last().click();
	// Each native chart family uses the table Dialog, with the eye after exports.
	for (let i = 0; i < specs.length; i++) {
		const frame = frames.nth(i);
		const eye = frame.getByRole('button', { name: 'Podgląd wykresu', exact: true });
		assert(
			await frame
				.locator('.chart-actions button')
				.last()
				.evaluate((el) => el.classList.contains('visualization-preview-action'))
		);
		await eye.click();
		const preview = page.locator('.chart-preview-dialog-content');
		await preview.locator('svg[role="img"]').waitFor();
		assert.equal(await preview.locator('.chart-live-preview').count(), 1);
		assert.equal(await preview.locator('img,canvas').count(), 0);
		const plot = preview.locator('.chart-plot');
		if (specs[i].type === 'donut') {
			const slice = preview.locator('.chart-slice').first();
			const original = await slice.getAttribute('d');
			await slice.hover({ force: true });
			await page.waitForFunction(
				(d) => document.querySelector('.chart-live-preview .chart-slice')?.getAttribute('d') !== d,
				original
			);
		} else if (specs[i].type === 'bar') {
			await preview.locator('.lc-bars-bar').first().hover({ force: true });
		} else {
			await plot.hover({ position: { x: 120, y: 100 } });
		}
		const tooltip = page.locator('.chart-preview-tooltip-root .llampart-chart-tooltip');
		await tooltip.waitFor({ state: 'visible' });
		await page.waitForFunction(() => {
			let el = document.querySelector('.chart-preview-tooltip-root .llampart-chart-tooltip');
			if (!el) return false;
			while (el && el !== document.body) {
				if (Number(getComputedStyle(el).opacity) < 0.99) return false;
				el = el.parentElement;
			}
			return true;
		});
		if (specs[i].type === 'line' || specs[i].type === 'area')
			assert((await preview.locator('.lc-highlight-point').count()) > 0);
		assert((await tooltip.innerText()).length > 0);
		assert.equal(
			await page.evaluate(() => {
				const ids = [...document.querySelectorAll('.llampart-chart-renderer [id]')].map(
					(el) => el.id
				);
				return new Set(ids).size === ids.length;
			}),
			true
		);
		const box = await preview.boundingBox();
		assert(box.width <= 1920 * 0.8 + 1 && box.height <= 1080 * 0.8 + 1);
		await page.screenshot({ path: `${artifacts}/preview-${i}-${specs[i].type}.png` });
		await page.keyboard.press('Escape');
		assert(await eye.evaluate((el) => el === document.activeElement));
		await page.waitForFunction(() => !document.querySelector('.chart-preview-tooltip-root'));
	}
	await frames
		.first()
		.locator('.chart-plot')
		.hover({ position: { x: 120, y: 100 } });
	await page.locator('.llampart-chart-tooltip').waitFor({ state: 'visible' });
	assert.equal(
		await page
			.locator('.llampart-chart-tooltip')
			.evaluate((el) => Boolean(el.closest('.llampart-chart-frame'))),
		false
	);
	await page.mouse.move(10, 10);
	console.log(
		'PASS actual app: six chart variants, mixed Markdown/math/table/code, inert fallback, context gating, legend and portal tooltip, no overflow'
	);

	const saved = await page.evaluate(() => localStorage.getItem('LlamaCppWebui.config'));
	await openSettings();
	await select('fontFamily', 'Barlow');
	await page.locator('#uiScale').fill('110');
	await page.getByRole('button', { name: 'Frosted Glass 05', exact: true }).click();
	await page.locator('#frostedGlassMilkiness').fill('17');
	await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '110');
	await page.waitForFunction(
		(material) =>
			getComputedStyle(document.querySelector('.llampart-chart-frame')).backgroundColor !==
			material,
		before.material
	);
	const preview = await state();
	assert.equal(preview.color, before.color);
	assert.notEqual(preview.font, before.font);
	assert.notEqual(preview.size, before.size);
	assert.equal(await page.evaluate(() => localStorage.getItem('LlamaCppWebui.config')), saved);
	// Screenshot outside the dialog while retaining the unsaved preview.
	await page.screenshot({ path: `${artifacts}/settings-preview.png` });
	await closeSettings();
	await page.waitForFunction(
		(font) => getComputedStyle(document.querySelector('.chart-plot text')).fontFamily === font,
		before.font
	);
	assert.equal((await state()).color, before.color);
	assert.equal((await state()).material, before.material);
	assert.equal((await state()).size, before.size);
	assert(
		await page.evaluate(
			() => document.querySelector('.llampart-chart-frame') === window.settingsChartIdentity
		)
	);
	console.log(
		'PASS live wallpaper/font/scale/opacity preview and cancel: chart palette/typography restored; localStorage untouched'
	);

	for (const format of ['png', 'svg', 'csv']) {
		const pending = page.waitForEvent('download');
		await frames
			.first()
			.getByRole('button', { name: new RegExp(` ${format.toUpperCase()}$`) })
			.click();
		const download = await pending;
		assert(download.suggestedFilename().endsWith(`.${format}`));
		const path = `${artifacts}/chart.${format}`;
		await download.saveAs(path);
		const bytes = await readFile(path);
		assert(bytes.length > 50);
		if (format === 'csv') {
			assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
			assert.equal(
				bytes.toString('utf8'),
				'\uFEFFMiesiąc,Przychód,Koszty\r\nStyczeń,12.123456,8\r\nLuty,18,11\r\nMarzec,24,15\r\n'
			);
		} else {
			transparency.push({
				type: specs[0].type,
				...(await assertTransparentExport(page, bytes, format))
			});
			if (format === 'png') {
				assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
				assert(bytes.readUInt32BE(16) > 1000);
			} else {
				assert(!bytes.toString().includes('var('));
				assert(bytes.toString().includes('data:font/woff2;base64,'));
				assert(bytes.toString().includes('Przychody miesięczne'));
			}
			const reopened = await context.newPage();
			await reopened.route(`**/chart-export.${format}`, (route) =>
				route.fulfill({
					contentType: format === 'svg' ? 'image/svg+xml' : 'image/png',
					body: bytes
				})
			);
			await reopened.goto(`${base}/chart-export.${format}`);
			if (format === 'svg') {
				assert.equal(await reopened.locator('parsererror').count(), 0);
				await reopened.evaluate(() => document.fonts.ready);
				assert(
					await reopened.evaluate(() =>
						[...document.fonts].some((font) => font.status === 'loaded')
					)
				);
				assert.equal(
					await reopened
						.locator('svg > text')
						.first()
						.evaluate((el) => getComputedStyle(el).fontWeight),
					await frames
						.first()
						.locator('.chart-title')
						.evaluate((el) => getComputedStyle(el).fontWeight)
				);
			} else
				assert(
					await reopened.locator('img').evaluate((el) => el.complete && el.naturalHeight > 500)
				);
			await reopened.screenshot({ path: `${artifacts}/reopened-${format}.png` });
			await reopened.close();
		}
		console.log(
			`PASS real ${format.toUpperCase()} download${format !== 'csv' ? ' and independent reopen' : ' with BOM, original numbers and column/row order'}`
		);
	}
	for (let index = 1; index < specs.length; index++) {
		for (const format of ['png', 'svg', 'csv']) {
			const pending = page.waitForEvent('download');
			await frames
				.nth(index)
				.getByRole('button', { name: new RegExp(` ${format.toUpperCase()}$`) })
				.click();
			const download = await pending;
			const path = `${artifacts}/chart-${index}.${format}`;
			await download.saveAs(path);
			const bytes = await readFile(path);
			if (format !== 'csv')
				transparency.push({
					type: specs[index].type,
					variant: index,
					...(await assertTransparentExport(page, bytes, format))
				});
			if (format === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
			if (format === 'svg') {
				assert(bytes.toString().includes(specs[index].title));
				assert(!bytes.toString().includes('var('));
				assert(!/="[^"]*NaN/.test(bytes.toString().replace(/data:font[^"\s)]+/g, '')));
			}
			if (format === 'csv') {
				const spec = specs[index];
				const columns = spec.series
					? [spec.xKey, ...spec.series.map((item) => item.key)]
					: [spec.labelKey, spec.valueKey];
				const headers = spec.series
					? [spec.xLabel, ...spec.series.map((item) => item.label)]
					: [spec.labelKey, spec.valueKey];
				assert.equal(
					bytes.toString(),
					'\uFEFF' +
						[headers, ...spec.data.map((row) => columns.map((key) => row[key]))]
							.map((row) => row.join(','))
							.join('\r\n') +
						'\r\n'
				);
			}
		}
	}
	console.log('PASS PNG/SVG/CSV files for grouped/ horizontal bar, area and donut as well as line');
	await writeFile(`${artifacts}/transparency.json`, JSON.stringify(transparency, null, 2));
	console.log(
		'PASS every chart PNG has RGBA transparent pixels; every SVG has transparent corners and no document background'
	);

	if (!process.env.LLAMPART_TEST_PRODUCTION) {
		await page.evaluate(async () => {
			const { db, conversations, settings } = await import('/tests/browser/charts-harness.ts');
			const assistant = conversations.activeMessages.find(
				(message) => message.role === 'assistant'
			);
			window.chartTest = {
				db,
				conversations,
				settings,
				message: assistant,
				original: assistant.content
			};
			window.setChartContent = async (content) => {
				await db.updateMessage(assistant.id, { content });
				conversations.updateMessageAtIndex(conversations.findMessageIndex(assistant.id), {
					content
				});
			};
		});
		// Unknown future family must work through CSS inheritance without production registry edits.
		await page.evaluate(() => {
			const font = new FontFace('Future Chart Test', 'local("DejaVu Serif")');
			document.fonts.add(font);
			return font.load();
		});
		await page.evaluate(() =>
			document.documentElement.style.setProperty('--llampart-font-family', '"Future Chart Test"')
		);
		assert((await state()).font.includes('Future Chart Test'));
		await page.evaluate(() =>
			document.documentElement.style.removeProperty('--llampart-font-family')
		);
		await page.evaluate(() => window.setChartContent('Start\n\n```llampart-chart\n'));
		await frames.first().waitFor({ state: 'hidden' });
		for (let i = 0; i < JSON.stringify(specs[0]).length; i += 20) {
			await page.evaluate(
				(text) => window.setChartContent('Start\n\n```llampart-chart\n' + text),
				JSON.stringify(specs[0]).slice(0, i)
			);
		}
		assert.equal(await frames.count(), 0);
		const first = 'Start\n\n' + fence(specs[0]);
		await page.evaluate((text) => window.setChartContent(text), first);
		await page.waitForFunction(() =>
			document.querySelector('.llampart-chart-frame .lc-layout-svg')
		);
		await page.evaluate(() => {
			window.chartIdentity = document.querySelector('.llampart-chart-frame');
		});
		await frames.first().locator('.chart-legend button').last().click();
		for (const suffix of [
			'\n\nFurther',
			'\n\nFurther text\n\n' + fence(specs[5]),
			'\n\nFurther text\n\n' + fence(specs[5]) + '\n\nFinal paragraph'
		]) {
			await page.evaluate((text) => window.setChartContent(text), first + suffix);
			await page.waitForFunction(
				() => document.querySelector('.llampart-chart-frame') === window.chartIdentity
			);
		}
		await page.waitForFunction(
			() => document.querySelectorAll('.llampart-chart-frame').length === 2
		);
		assert.equal(
			await frames.first().locator('.chart-legend button[aria-pressed="false"]').count(),
			1
		);
		await page.evaluate(() => window.setChartContent('Edited: no chart.'));
		await frames.first().waitFor({ state: 'hidden' });
		assert.equal(await page.locator('.llampart-chart-tooltip').count(), 0);
		await page.evaluate(() => window.setChartContent(''));
		await page.waitForFunction(
			() => !document.querySelector('.llampart-assistant-markdown')?.textContent.trim()
		);
		await page.evaluate(
			(text) => window.setChartContent(text),
			Array.from({ length: 9 }, () => fence(specs[0])).join('\n\n')
		);
		await page.waitForFunction(
			() => document.querySelectorAll('.llampart-chart-frame').length === 8
		);
		assert.equal(await assistant.locator('.llampart-chart-fallback').count(), 1);
		const maximal = {
			type: 'line',
			title: '500 punktów / 5 serii',
			xKey: 'x',
			series: Array.from({ length: 5 }, (_, i) => ({ key: `s${i}`, label: `Seria ${i}` })),
			data: Array.from({ length: 500 }, (_, x) => ({
				x,
				...Object.fromEntries(
					Array.from({ length: 5 }, (_, i) => [`s${i}`, Math.sin(x / 20 + i) * 10])
				)
			}))
		};
		await page.evaluate((text) => window.setChartContent(text), fence(maximal));
		await page.waitForFunction(
			() => document.querySelectorAll('.llampart-chart-frame .chart-series-line').length === 5
		);
		assert.equal(await frames.first().locator('.chart-legend button').count(), 5);
		await shot('maximal-dataset');
		const csvSecurity = {
			type: 'bar',
			title: '<img src=x onerror=alert(1)> $5',
			xKey: 'x',
			xLabel: ' \t=header',
			series: [{ key: 'y', label: '@Suma' }],
			data: [
				{ x: '=1', y: -1.25 },
				{ x: '\t@evil', y: 0 },
				{ x: 'Łódź,\n"東京"', y: 1.2345678 }
			]
		};
		await page.evaluate(
			(text) => window.setChartContent(text),
			fence(csvSecurity).replaceAll('```', '~~~~')
		);
		await page.waitForFunction(() =>
			document.querySelector('.chart-title')?.textContent.includes('$5')
		);
		assert.equal(await assistant.locator('img').count(), 0);
		const securityDownload = page.waitForEvent('download');
		await frames.first().getByRole('button', { name: / CSV$/ }).click();
		const downloaded = await securityDownload;
		const securePath = `${artifacts}/formula-safe.csv`;
		await downloaded.saveAs(securePath);
		assert.equal(
			await readFile(securePath, 'utf8'),
			'\uFEFF\' \t=header,\'@Suma\r\n\'=1,-1.25\r\n\'\t@evil,0\r\n"Łódź,\n""東京""",1.2345678\r\n'
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await frames.first().scrollIntoViewIfNeeded();
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		assert(await frames.first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
		await page.screenshot({ path: `${artifacts}/mobile-negative-bar.png` });
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.evaluate(() => window.setChartContent(window.chartTest.original));
		await page.waitForFunction(
			() => document.querySelectorAll('.llampart-chart-frame').length === 6
		);
		const stored = await page.evaluate(
			async () =>
				(await window.chartTest.db.getConversationMessages(window.chartTest.message.convId)).find(
					(m) => m.id === window.chartTest.message.id
				).content
		);
		assert.equal(stored, markdown);
		console.log(
			'PASS incremental JSON, closed-block stabilization, two charts, same native component identity/legend state across append, editing/removal and original IndexedDB Markdown'
		);
	}
	await page.reload();
	await page.waitForFunction(() => {
		const frames = [...document.querySelectorAll('.llampart-chart-frame')];
		return frames.length === 6 && frames.every((frame) => frame.querySelector('.lc-layout-svg'));
	});
	await openSettings();
	await select('fontFamily', 'Barlow');
	await page.getByRole('button', { name: 'Frosted Glass 05', exact: true }).click();
	await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
	await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
	await shot('wallpaper-05-display-opaque');
	assert(
		await page.locator('html').evaluate((el) => el.classList.contains('has-frosted-glass-opaque'))
	);
	// Exercise real ChatService stream consumption using a controllable browser Response.
	// No component/store internals are involved in these token and abort probes.
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.evaluate(() => {
		const original = window.fetch;
		window.fetch = (input, init) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (!url.includes('/chat/completions')) return original(input, init);
			const stream = new ReadableStream({
				start(controller) {
					window.enqueueChartToken = (content) =>
						controller.enqueue(
							new TextEncoder().encode(
								'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n'
							)
						);
					init?.signal?.addEventListener(
						'abort',
						() => {
							window.chartStreamAborted = true;
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
	await page.locator('textarea').first().fill('Stream several charts without inventing data');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(() => typeof window.enqueueChartToken === 'function');
	await page.evaluate(() => window.enqueueChartToken('Streaming\n\n```llampart-chart\n'));
	await page.getByText('Przygotowywanie wykresu…', { exact: true }).waitFor();
	for (let offset = 0; offset < JSON.stringify(specs[0]).length; offset += 30) {
		await page.evaluate(
			(token) => window.enqueueChartToken(token),
			JSON.stringify(specs[0]).slice(offset, offset + 30)
		);
	}
	assert.equal(await page.locator('.llampart-chart-frame').count(), 0);
	await page.evaluate(() => window.enqueueChartToken('\n```'));
	await page.waitForFunction(() => document.querySelector('.llampart-chart-frame .lc-layout-svg'));
	await page.evaluate(() => {
		window.liveChartIdentity = document.querySelector('.llampart-chart-frame');
	});
	await page.evaluate(
		(token) => window.enqueueChartToken('\n\nSecond\n\n' + token),
		fence(specs[5])
	);
	await page.waitForFunction(() => document.querySelectorAll('.llampart-chart-frame').length === 2);
	assert(
		await page.evaluate(
			() => document.querySelector('.llampart-chart-frame') === window.liveChartIdentity
		)
	);
	await page.evaluate(() =>
		window.enqueueChartToken('\n\nAfter charts\n\n```llampart-chart\n{"type":"area"')
	);
	await page.getByText('Przygotowywanie wykresu…', { exact: true }).waitFor();
	await page.locator('.llampart-composer-stop-action').click();
	await page.waitForFunction(() => window.chartStreamAborted === true);
	await page.getByText('Przygotowywanie wykresu…', { exact: true }).waitFor({ state: 'hidden' });
	await page.locator('.llampart-chart-fallback').waitFor();
	assert.equal(await page.locator('.llampart-chart-frame').count(), 2);
	assert(
		await page.evaluate(
			() => document.querySelector('.llampart-chart-frame') === window.liveChartIdentity
		)
	);
	console.log(
		'PASS real ChatService incremental stream: no partial JSON chart, two closed charts retain identity, Stop preserves charts and exposes copyable unfinished source'
	);
	assert.deepEqual(errors, []);
	console.log(
		'PASS historical reopen, second wallpaper/font and opaque Frosted Glass; no runtime errors'
	);
} catch (error) {
	console.error('Original chart test failure:', error);
	console.error(
		'Chart diagnostics',
		JSON.stringify(
			await page.evaluate(() => ({
				frames: [...document.querySelectorAll('.llampart-chart-frame')].map((el) => ({
					title: el.querySelector('.chart-title')?.textContent,
					svg: el.querySelectorAll('.lc-layout-svg').length,
					error: el.querySelector('[role="alert"]')?.textContent,
					buttons: [...el.querySelectorAll('.chart-actions button')].map((b) => ({
						text: b.textContent,
						disabled: b.disabled
					}))
				})),
				tooltips: [...document.querySelectorAll('.llampart-chart-tooltip')].map(
					(el) => el.textContent
				)
			})),
			null,
			2
		)
	);
	await page.screenshot({ path: `${artifacts}/failure.png` });
	throw error;
} finally {
	await browser.close();
}
