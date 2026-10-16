/** Isolated real-app regression for the unified chart family; provider HTTP is a fixture.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/chart-family.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-chart-family';
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
const cartesian = {
	xKey: 'month',
	series: [
		{ key: 'a', label: 'Produkt A' },
		{ key: 'b', label: 'Produkt B' },
		{ key: 'c', label: 'Produkt C' },
		{ key: 'd', label: 'Produkt D' }
	],
	data: [
		{ month: 'Styczeń', a: 12, b: 9, c: 7, d: 3 },
		{ month: 'Luty', a: 19, b: 13, c: 11, d: 7 },
		{ month: 'Marzec', a: 25, b: 18, c: 13, d: 10 }
	]
};
const circular = {
	labelKey: 'category',
	valueKey: 'value',
	data: [
		{ category: 'Sprzedaż', value: 43 },
		{ category: 'Usługi', value: 27 },
		{ category: 'Licencje', value: 18 },
		{ category: 'Pozostałe', value: 12 }
	]
};
const sortedCircular = [...circular.data].sort((a, b) => a.value - b.value);
const specs = [
	{ ...cartesian, type: 'bar', title: 'Sprzedaż produktów' },
	{ ...circular, type: 'donut', title: 'Struktura przychodów' },
	{ ...circular, type: 'donut', title: 'Udziały przychodów' },
	{ ...cartesian, type: 'line', title: 'Sprzedaż produktów · Line' },
	{ ...cartesian, type: 'area', title: 'Sprzedaż produktów · Area' }
];
const markdown = specs
	.map((spec) => '```llampart-chart\n' + JSON.stringify(spec) + '\n```')
	.join('\n\n');
let responseMarkdown = markdown;
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://pastels.test',
			llamaServerBaseUrl: 'http://pastels.test',
			theme: 'frosted-glass',
			frostedGlassWallpaper: 'frosted-glass-02',
			fontFamily: 'merriweather',
			fontVariant: '400',
			uiScale: '100',
			interfaceLanguage: 'pl',
			titleGenerationUseLLM: false,
			askForTitleConfirmation: false,
			alwaysShowSidebarOnDesktop: true
		})
	);
});
await page.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	if (path.endsWith('/chat/completions'))
		return route.fulfill({
			contentType: 'text/event-stream',
			body: `data: ${JSON.stringify({ choices: [{ delta: { content: responseMarkdown } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
		});
	return route.fulfill({
		json: path.endsWith('/props')
			? {
					build_info: 'test',
					model_path: 'pastels.gguf',
					default_generation_settings: { params: {} }
				}
			: path.endsWith('/models')
				? { object: 'list', data: [{ id: 'pastels.gguf' }] }
				: []
	});
});
const frames = page.locator('.llampart-assistant-markdown .llampart-chart-frame');
const dialog = page.locator('.llampart-chat-settings-dialog-content');
const share = (value, total) =>
	new Intl.NumberFormat('pl', { style: 'percent', maximumFractionDigits: 1 }).format(value / total);
async function slicePoint(index, slice) {
	await frames.nth(index).scrollIntoViewIfNeeded();
	return frames
		.nth(index)
		.locator('.chart-slice')
		.nth(slice)
		.evaluate((node) => {
			const b = node.getBBox(),
				points = [];
			for (let i = 1; i < 20; i++)
				for (let j = 1; j < 20; j++) {
					const p = new DOMPoint(b.x + (b.width * i) / 20, b.y + (b.height * j) / 20);
					if (node.isPointInFill(p)) points.push(p);
				}
			points.sort(
				(a, c) =>
					Math.hypot(a.x - b.x - b.width / 2, a.y - b.y - b.height / 2) -
					Math.hypot(c.x - b.x - b.width / 2, c.y - b.y - b.height / 2)
			);
			const p = points[0].matrixTransform(node.getScreenCTM());
			return { x: p.x, y: p.y };
		});
}
async function hoverSlice(index, slice, category) {
	const point = await slicePoint(index, slice);
	await page.mouse.move(point.x, point.y);
	await page.waitForFunction(
		(category) =>
			document.querySelectorAll('.chart-tooltip-content').length === 1 &&
			document.querySelector('.chart-tooltip-content').textContent.includes(category),
		category
	);
	assert.equal(
		await frames
			.nth(index)
			.locator('.chart-plot circle,.lc-highlight-point,.chart-slice-percentage')
			.count(),
		0
	);
	await page.waitForFunction(() =>
		[...document.querySelectorAll('.llampart-chart-tooltip-root')].every(
			(el) => getComputedStyle(el).opacity === '1'
		)
	);
	return (await page.locator('.chart-tooltip-content').textContent()).replace(/\s+/g, ' ').trim();
}
async function hoverAllSlices(name) {
	for (const index of [1, 2])
		for (let slice = 0; slice < 4; slice++) {
			assert.equal(
				await hoverSlice(index, slice, sortedCircular[slice].category),
				`${sortedCircular[slice].category} — ${share(sortedCircular[slice].value, 100)}`
			);
			assert.equal(
				await page
					.locator('.chart-tooltip-content .chart-swatch')
					.evaluate((el) => getComputedStyle(el).backgroundColor),
				await frames
					.nth(index)
					.locator('.chart-legend .chart-swatch')
					.nth(slice)
					.evaluate((el) => getComputedStyle(el).backgroundColor)
			);
			await page.screenshot({ path: `${artifacts}/${name}-hover-${index}-${slice}.png` });
		}
	await page.mouse.move(5, 5);
	await page.waitForFunction(
		() => document.querySelectorAll('.chart-tooltip-content').length === 0
	);
}
async function open() {
	await page.locator('button[aria-label="Ustawienia"]').click();
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
}
async function close() {
	await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function save() {
	await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function palette() {
	return page.evaluate(() =>
		Array.from({ length: 5 }, (_, i) =>
			getComputedStyle(document.documentElement).getPropertyValue(`--llampart-chart-fill-${i + 1}`)
		).join('|')
	);
}
async function capture(name) {
	await documentReady();
	for (let index = 0; index < 5; index++) {
		await frames.nth(index).evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await frames.nth(index).evaluate(async (el) => {
			await Promise.all(
				el
					.closest('.markdown-block')
					.getAnimations()
					.map((animation) => animation.finished.catch(() => {}))
			);
		});
		await frames.nth(index).screenshot({
			path: `${artifacts}/${name}-${['bar', 'donut-distribution', 'donut', 'line', 'area'][index]}.png`
		});
	}
}
async function documentReady() {
	await page.evaluate(() => document.fonts.ready);
}
async function validate() {
	for (let index = 0; index < 3; index++) {
		const result = await frames.nth(index).evaluate((el, index) => {
			const normalize = (color) => {
				const ctx = document.createElement('canvas').getContext('2d');
				ctx.fillStyle = color;
				ctx.fillRect(0, 0, 1, 1);
				return [...ctx.getImageData(0, 0, 1, 1).data].join(',');
			};
			const swatches = [...el.querySelectorAll('.chart-legend .chart-swatch')].map((node) =>
				normalize(getComputedStyle(node).backgroundColor)
			);
			const marks = [...el.querySelectorAll(index === 0 ? '.lc-bars-bar' : '.lc-arc-line')];
			const fills = marks.map((node) => normalize(getComputedStyle(node).fill));
			const labels = [...el.querySelectorAll('.chart-slice-percentage[visibility="visible"]')];
			const rectangles = labels.map((node) => node.getBoundingClientRect());
			const overlaps = rectangles.some((a, i) =>
				rectangles.some(
					(b, j) =>
						i !== j && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
				)
			);
			return {
				swatches,
				fills,
				overlaps,
				strokes: marks.map((node) => getComputedStyle(node).stroke),
				widths: marks.map((node) => getComputedStyle(node).strokeWidth),
				opacity: getComputedStyle(el).opacity,
				overflow: el.scrollWidth > el.clientWidth + 1
			};
		}, index);
		assert(result.fills.length >= 4);
		assert(result.fills.every((fill) => result.swatches.includes(fill)));
		assert.equal(result.opacity, '1');
		assert(!result.overlaps && !result.overflow);
		if (index === 0)
			assert(result.strokes.every((stroke, i) => stroke === 'none' || result.widths[i] === '0px'));
		else assert(result.strokes.every((stroke) => stroke !== 'rgb(0, 0, 0)' && stroke !== 'none'));
	}
	assert.deepEqual(
		(await frames.nth(1).locator('.chart-legend button').allTextContents()).map((value) =>
			value.trim()
		),
		sortedCircular.map((row) => row.category)
	);
}
async function exportFiles(name) {
	for (let index = 0; index < 5; index++)
		for (const format of ['png', 'svg', 'csv']) {
			const selector =
				index === 0 ? '.lc-bars-bar' : index < 3 ? '.lc-arc-line' : '.chart-series-line';
			const fills = await frames
				.nth(index)
				.locator(selector)
				.evaluateAll((nodes) =>
					nodes.map(
						(node) =>
							getComputedStyle(node)[
								node.classList.contains('chart-series-line') ? 'stroke' : 'fill'
							]
					)
				);
			const pending = page.waitForEvent('download');
			await frames
				.nth(index)
				.getByRole('button', { name: new RegExp(` ${format.toUpperCase()}$`) })
				.click();
			const download = await pending,
				path = `${artifacts}/${name}-${index}.${format}`;
			await download.saveAs(path);
			const bytes = await readFile(path);
			if (format === 'csv') {
				assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
				if (index > 0 && index < 3) assert(bytes.toString().includes('Sprzedaż,43\r\n'));
				continue;
			}
			const reopened = await context.newPage();
			await reopened.route(`**/export.${format}`, (route) =>
				route.fulfill({
					contentType: format === 'png' ? 'image/png' : 'image/svg+xml',
					body: bytes
				})
			);
			await reopened.goto(`${base}/export.${format}`);
			if (format === 'svg') {
				assert(!bytes.toString().includes('var('));
				assert.equal(await reopened.locator('parsererror').count(), 0);
				await reopened.evaluate(() => document.fonts.ready);
				assert.deepEqual(
					await reopened
						.locator(selector)
						.evaluateAll((nodes) =>
							nodes.map(
								(node) =>
									getComputedStyle(node)[
										node.classList.contains('chart-series-line') ? 'stroke' : 'fill'
									]
							)
						),
					fills
				);
				if (index === 4) {
					assert.equal(await reopened.locator('linearGradient').count(), 4);
					assert.equal(await reopened.locator('.lc-area-path').count(), 4);
					assert(
						await reopened.locator('.lc-area-path').evaluateAll((nodes) =>
							nodes.every((node) => {
								const fill = getComputedStyle(node).fill;
								const id = fill.match(/#([^"')]+)/)?.[1];
								return id && document.getElementById(id)?.querySelectorAll('stop').length === 2;
							})
						)
					);
					assert.deepEqual(
						await reopened
							.locator('linearGradient')
							.first()
							.locator('stop')
							.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).stopOpacity)),
						['0.38', '0.025']
					);
				}
				if (index < 3)
					assert.equal(
						await reopened.locator('circle,.lc-highlight-point,.chart-slice-percentage').count(),
						0
					);
				if (index > 0 && index < 3) assert.equal(await reopened.locator('.chart-slice').count(), 4);
			} else
				assert(
					await reopened.locator('img').evaluate((img) => img.complete && img.naturalWidth > 1000)
				);
			await reopened.screenshot({ path: `${artifacts}/reopened-${name}-${index}-${format}.png` });
			await reopened.close();
		}
}
try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.locator('textarea').first().fill('Przedstaw dane na wykresach');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-chart-frame svg[role="img"]').length === 5
	);
	await validate();
	for (let i = 0; i < 5; i++)
		assert(
			(await frames.nth(i).locator('.chart-legend button').allTextContents()).every(
				(text) => !/^\d+\./.test(text.trim())
			)
		);
	for (const index of [1, 2])
		assert.equal(await frames.nth(index).locator('.chart-plot text').count(), 0);
	await page.evaluate(() => {
		window.pastelFrames = [...document.querySelectorAll('.llampart-chart-frame')];
	});
	const baseline = await palette(),
		storage = await page.evaluate(() => localStorage.getItem('LlamaCppWebui.config'));
	for (const index of [3, 4]) {
		await frames.nth(index).scrollIntoViewIfNeeded();
		const point = await frames.nth(index).locator('.lc-point').first().boundingBox();
		await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
		await page.waitForFunction(
			(index) =>
				[...document.querySelectorAll('.llampart-chart-frame')][index].querySelectorAll(
					'.lc-highlight-point'
				).length === 4,
			index
		);
		assert.deepEqual(
			await frames
				.nth(index)
				.locator('.lc-highlight-point')
				.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill)),
			await frames
				.nth(index)
				.locator('.chart-legend .chart-swatch')
				.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor))
		);
		await page.waitForFunction(
			() => document.querySelectorAll('.chart-tooltip-content').length === 1
		);
		assert((await page.locator('.chart-tooltip-content').textContent()).includes('12'));
		await page.waitForFunction(() =>
			[...document.querySelectorAll('.llampart-chart-tooltip-root')].every(
				(el) => getComputedStyle(el).opacity === '1'
			)
		);
		assert(
			await frames
				.nth(index)
				.locator('.chart-series-line')
				.evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '1'))
		);
		await page.screenshot({ path: `${artifacts}/tooltip-${index === 3 ? 'line' : 'area'}.png` });
		await page.mouse.move(5, 5);
		await page.waitForFunction(
			() => document.querySelectorAll('.chart-tooltip-content').length === 0
		);
	}
	await hoverAllSlices('turquoise');
	await capture('turquoise');
	await exportFiles('turquoise');
	// Hover changes only the donut's outer radius, and export restores the stable base path.
	await frames.nth(2).scrollIntoViewIfNeeded();
	const basePath = await frames.nth(2).locator('.chart-slice').first().getAttribute('d');
	const activeTarget = await slicePoint(2, 0);
	await page.mouse.move(activeTarget.x, activeTarget.y);
	await page.waitForFunction(
		(basePath) =>
			[...document.querySelectorAll('.llampart-chart-frame')][2]
				.querySelector('.chart-slice')
				.getAttribute('d') !== basePath,
		basePath
	);
	await frames.nth(2).screenshot({ path: `${artifacts}/active-donut.png` });
	const activeDownload = page.waitForEvent('download');
	await frames
		.nth(2)
		.getByRole('button', { name: / SVG$/ })
		.evaluate((button) => button.click());
	const activeFile = `${artifacts}/active-export.svg`;
	await (await activeDownload).saveAs(activeFile);
	const stableSvg = await readFile(activeFile, 'utf8');
	const stablePath = await page.evaluate(
		(svg) =>
			new DOMParser()
				.parseFromString(svg, 'image/svg+xml')
				.querySelector('.chart-slice')
				.getAttribute('d'),
		stableSvg
	);
	assert.equal(stablePath, basePath);
	await page.mouse.move(5, 5);
	await page.waitForFunction(
		() => document.querySelectorAll('.chart-tooltip-content').length === 0
	);
	// Every type now shares the same ordered base palette.
	assert(
		await frames
			.nth(3)
			.evaluate(
				(el) =>
					getComputedStyle(el.querySelector('.chart-legend .chart-swatch')).backgroundColor ===
					getComputedStyle(document.querySelector('.chart-legend .chart-swatch')).backgroundColor
			)
	);
	// Scroll the distribution donut back into view before interacting with its centroid.
	await frames.nth(1).scrollIntoViewIfNeeded();
	const target = await slicePoint(1, 3);
	await page.mouse.move(target.x, target.y);
	await page.waitForFunction(
		() => document.querySelectorAll('.chart-tooltip-content').length === 1
	);
	await page.locator('.chart-tooltip-content').waitFor({ state: 'visible' });
	assert((await page.locator('.chart-tooltip-content').textContent()).includes('43%'));
	assert.equal(
		await page
			.locator('.chart-tooltip-content .chart-swatch')
			.evaluate((el) => getComputedStyle(el).backgroundColor),
		await frames
			.nth(1)
			.locator('.chart-legend .chart-swatch')
			.last()
			.evaluate((el) => getComputedStyle(el).backgroundColor)
	);
	await page.mouse.move(5, 5);
	await frames.first().scrollIntoViewIfNeeded();
	const barTarget = await frames.first().locator('.lc-bars-bar').first().boundingBox();
	await page.mouse.move(barTarget.x + barTarget.width / 2, barTarget.y + barTarget.height / 2);
	await page.waitForFunction(
		() =>
			document.querySelectorAll('.chart-tooltip-content').length === 1 &&
			document.querySelector('.chart-tooltip-content').textContent.includes('Produkt')
	);
	await page.locator('.chart-tooltip-content').waitFor({ state: 'visible' });
	assert.deepEqual(
		await page
			.locator('.chart-tooltip-content .chart-swatch')
			.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor)),
		await frames
			.first()
			.locator('.chart-legend .chart-swatch')
			.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor))
	);
	assert.equal(await frames.first().locator('.chart-plot circle,.lc-highlight-point').count(), 0);
	assert.equal(await frames.first().locator('.lc-highlight-area').count(), 1);
	await page.mouse.move(5, 5);
	await frames.nth(1).locator('.chart-legend button').last().click();
	await page.waitForFunction(
		() =>
			[...document.querySelectorAll('.llampart-chart-frame')][1].querySelectorAll('.chart-slice')
				.length === 3
	);
	assert((await hoverSlice(1, 2, 'Usługi')).includes('Wartość: 27 · Udział: 47,4%'));
	await page.mouse.move(5, 5);
	await frames.nth(1).locator('.chart-legend button').last().click();
	await open();
	await page.getByRole('button', { name: 'Frosted Glass 01', exact: true }).click();
	await page.waitForFunction(() =>
		document.documentElement.style
			.getPropertyValue('--llampart-theme-wallpaper')
			.includes('frosted-glass-01')
	);
	assert.equal(await page.evaluate(() => localStorage.getItem('LlamaCppWebui.config')), storage);
	assert.equal(await palette(), baseline);
	await close();
	assert.equal(await palette(), baseline);
	await open();
	await page.getByRole('button', { name: 'Frosted Glass 01', exact: true }).click();
	await save();
	await page.waitForFunction(() =>
		document.documentElement.style
			.getPropertyValue('--llampart-theme-wallpaper')
			.includes('frosted-glass-01')
	);
	await validate();
	assert.equal(await palette(), baseline);
	await hoverAllSlices('pink');
	await capture('pink');
	await exportFiles('pink');
	console.log(
		'PASS turquoise/pink: fixed colors, no black bar borders, slice separators, matching legend/tooltip colors, sorted shares and all PNG/SVG/CSV reopens'
	);
	const pinkPalette = await palette();
	await open();
	await page.getByRole('button', { name: 'Frosted Glass 02', exact: true }).click();
	await page.waitForFunction(() =>
		document.documentElement.style
			.getPropertyValue('--llampart-theme-wallpaper')
			.includes('frosted-glass-02')
	);
	await close();
	assert.equal(await palette(), pinkPalette);
	for (const [id, name] of [
		['01', 'pink'],
		['02', 'turquoise']
	]) {
		await open();
		await page.getByRole('button', { name: `Frosted Glass ${id}`, exact: true }).click();
		await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
		await save();
		await validate();
		await capture(`${name}-opaque`);
	}
	await open();
	await page.getByRole('button', { name: 'Frosted Glass 01', exact: true }).click();
	await page.getByLabel('Wyłącz przezroczystość', { exact: true }).uncheck();
	await save();
	for (const [name, color] of [
		['very-light', '#fafafa'],
		['very-dark', '#080a0b'],
		['monochrome', '#8d9394']
	]) {
		await open();
		const image = await page.evaluate((color) => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 64;
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = color;
			ctx.fillRect(0, 0, 64, 64);
			return canvas.toDataURL();
		}, color);
		await dialog.locator('input[type=file]').setInputFiles({
			name: `${name}.png`,
			mimeType: 'image/png',
			buffer: Buffer.from(image.split(',')[1], 'base64')
		});
		await page.waitForFunction(
			(color) =>
				document.documentElement.style.getPropertyValue('--llampart-frosted-glass-accent') ===
				color,
			color
		);
		await save();
		await validate();
		await capture(name);
	}
	await open();
	await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
	await save();
	await validate();
	await capture('opaque');
	assert(
		await page.evaluate(() =>
			[...document.querySelectorAll('.llampart-chart-frame')].every(
				(el, i) => el === window.pastelFrames[i]
			)
		)
	);
	console.log(
		'PASS custom very-light/dark/monochrome wallpapers, opaque glass, Settings rollback and stable component identity'
	);
	await open();
	await page.locator('#fontFamily').click();
	await page.getByRole('option', { name: 'Crimson Text', exact: true }).click();
	await page.locator('#uiScale').fill('110');
	await save();
	await page.setViewportSize({ width: 390, height: 844 });
	await documentReady();
	await validate();
	await capture('mobile-large-font');
	responseMarkdown =
		'```llampart-chart\n' +
		JSON.stringify({
			type: 'donut',
			title: 'Małe wycinki',
			labelKey: 'category',
			valueKey: 'value',
			data: [
				{ category: 'Duży', value: 99 },
				{ category: 'Mały', value: 1 }
			]
		}) +
		'\n```';
	await page.locator('textarea').first().fill('Pokaż mały wycinek');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(() => document.querySelectorAll('.llampart-chart-frame').length === 6);
	const tiny = frames.last();
	await tiny.scrollIntoViewIfNeeded();
	await tiny.locator('.chart-slice').first().waitFor();
	assert.equal(await tiny.locator('.chart-plot text').count(), 0);
	assert.equal(await hoverSlice(5, 0, 'Mały'), 'Mały — 1%');
	await page.mouse.move(5, 5);
	await tiny.screenshot({ path: `${artifacts}/tiny-slice-mobile.png` });
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const one = {
		...cartesian,
		series: cartesian.series.slice(0, 1),
		data: cartesian.data.map(({ month, a }) => ({ month, a }))
	};
	const negative = {
		...one,
		data: [
			{ month: 'Dodatnia', a: 18 },
			{ month: 'Ujemna', a: -12 }
		]
	};
	const large = {
		xKey: 'x',
		series: Array.from({ length: 5 }, (_, i) => ({ key: `y${i}`, label: `Seria ${i}` })),
		data: Array.from({ length: 500 }, (_, i) => ({
			x: i,
			y0: Math.sin(i / 13) * 10,
			y1: Math.cos(i / 17) * 7,
			y2: i / 50,
			y3: 8 - i / 80,
			y4: Math.sin(i / 29) * 5 + 10
		}))
	};
	const extra = [
		{ ...one, type: 'line', title: 'Jedna seria Line' },
		{ ...one, type: 'area', title: 'Jedna seria Area' },
		{ ...negative, type: 'bar', title: 'Ujemne pionowe' },
		{ ...negative, type: 'bar', orientation: 'horizontal', title: 'Ujemne poziome' },
		{ ...large, type: 'line', title: '500 × 5 Line' },
		{ ...large, type: 'area', title: '500 × 5 Area' },
		{
			...one,
			type: 'bar',
			title: 'Długie etykiety',
			series: [{ key: 'a', label: 'Bardzo długa nazwa serii '.repeat(5).slice(0, 120) }],
			data: [
				{ month: 'Długa kategoria '.repeat(7), a: 18 },
				{ month: 'Inna kategoria '.repeat(7), a: 9 }
			]
		},
		{
			...one,
			type: 'area',
			title: 'Kolejność liczbowa',
			data: [
				{ month: 3, a: 12 },
				{ month: 1, a: 6 },
				{ month: 2, a: 9 }
			]
		}
	];
	responseMarkdown = extra
		.map((spec) => '```llampart-chart\n' + JSON.stringify(spec) + '\n```')
		.join('\n\n');
	const started = Date.now();
	await page.locator('textarea').first().fill('Przypadki brzegowe');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-chart-frame').length === 14
	);
	console.log(
		`Rendered eight edge-case charts (including two 500×5) in ${Date.now() - started} ms`
	);
	assert.equal(await frames.nth(10).locator('.lc-points').count(), 0);
	assert.equal(await frames.nth(11).locator('.lc-points').count(), 0);
	for (const [index, expected] of [
		[8, ['4,4,0,0', '0,0,4,4']],
		[9, ['0,4,4,0', '4,0,0,4']]
	])
		assert.deepEqual(
			await frames
				.nth(index)
				.locator('.lc-bars-bar')
				.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('corners'))),
			expected
		);
	const gradientIds = await page
		.locator('linearGradient')
		.evaluateAll((nodes) => nodes.map((node) => node.id));
	assert.equal(new Set(gradientIds).size, gradientIds.length);
	assert(
		!(await frames.nth(13).locator('.chart-series-line').first().getAttribute('d')).includes('C')
	);
	for (const index of [6, 7, 8, 9, 10, 11, 12, 13]) {
		await frames.nth(index).scrollIntoViewIfNeeded();
		assert(await frames.nth(index).evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
		await frames.nth(index).screenshot({ path: `${artifacts}/edge-${index}.png` });
	}
	await frames.nth(2).scrollIntoViewIfNeeded();
	const reduced = await slicePoint(2, 0);
	await page.mouse.move(reduced.x, reduced.y);
	assert.equal(
		await frames
			.nth(2)
			.locator('.chart-slice')
			.first()
			.evaluate((node) => getComputedStyle(node).transitionDuration),
		'0s'
	);
	assert(
		!(await frames
			.nth(2)
			.locator('.chart-plot')
			.evaluate((el) => el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')))
	);
	console.log(
		'PASS single/multi Line/Area, negative vertical/horizontal bars and corners, 500×5, long labels, independent gradients, nonmonotonic numeric order, active donut/export and reduced motion'
	);
	const semantic = [
		{
			type: 'donut',
			labelKey: 'category',
			valueKey: 'value',
			data: [
				{ category: 'Liczba', value: 250 },
				{ category: 'Reszta', value: 750 }
			]
		},
		{
			type: 'donut',
			format: 'percent',
			labelKey: 'category',
			valueKey: 'value',
			data: [
				{ category: 'Ułamek', value: 0.25 },
				{ category: 'Reszta', value: 0.75 }
			]
		},
		{
			type: 'donut',
			labelKey: 'category',
			valueKey: 'value',
			data: [
				{ category: 'Suma dwanaście', value: 3 },
				{ category: 'Reszta', value: 9 }
			]
		}
	];
	responseMarkdown = semantic
		.map((spec) => '```llampart-chart\n' + JSON.stringify(spec) + '\n```')
		.join('\n\n');
	await page.locator('textarea').first().fill('Semantyka tooltipów');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-chart-frame').length === 17
	);
	assert((await hoverSlice(14, 0, 'Liczba')).includes('Wartość: 250 · Udział: 25%'));
	await page.mouse.move(5, 5);
	await page.waitForFunction(
		() => document.querySelectorAll('.chart-tooltip-content').length === 0
	);
	assert.equal(await hoverSlice(15, 0, 'Ułamek'), 'Ułamek — 25%');
	await page.mouse.move(5, 5);
	await page.waitForFunction(
		() => document.querySelectorAll('.chart-tooltip-content').length === 0
	);
	assert((await hoverSlice(16, 0, 'Suma dwanaście')).includes('Wartość: 3 · Udział: 25%'));
	console.log(
		'PASS all donut slices on both wallpapers: no Cartesian markers or slice labels; counts, non-100 totals, percent fractions and legend renormalization have unambiguous tooltip values'
	);
	assert.deepEqual(errors, []);
	console.log(
		'PASS inherited font/scale and mobile labels: no overlap, no overflow, no runtime errors'
	);
} catch (error) {
	console.error('Original browser assertion:', error);
	console.error(
		await page.evaluate(() => ({
			frames: document.querySelectorAll('.llampart-chart-frame').length,
			fallbacks: document.querySelectorAll('.llampart-chart-fallback').length,
			text: document.body.innerText.slice(-2000)
		})),
		errors
	);
	await page.screenshot({ path: `${artifacts}/failure.png` });
	throw error;
} finally {
	await browser.close();
}
