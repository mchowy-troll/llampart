/** Local font glyphs, pixel text sizing, real Settings and chart exports in Chromium. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts =
	process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-typography/browser';
await mkdir(artifacts, { recursive: true });
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({
	viewport: { width: 1920, height: 1080 },
	acceptDownloads: true
});
const page = await context.newPage(),
	errors = [],
	fonts = [],
	external = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => {
	if (message.type() === 'error') console.error('Browser:', message.text());
});
page.on('request', (r) => {
	const url = new URL(r.url());
	if (url.pathname.startsWith('/fonts/')) fonts.push(r.url());
	if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) external.push(r.url());
});
const sample = 'ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ äöüÄÖÜß éèêëàâæçîïôœùûÿÉÈÊËÀÂÆÇÎÏÔŒÙÛŸ ìòáíñúü¡¿';
const specs = ['line', 'area', 'bar', 'donut'].map((type) =>
	type === 'donut'
		? {
				type,
				title: 'Zażółć gęślą jaźń',
				labelKey: 'name',
				valueKey: 'value',
				data: [
					{ name: 'Łódź', value: 35 },
					{ name: 'Żółć', value: 15 },
					{ name: 'Gęś', value: 25 }
				]
			}
		: {
				type,
				title: 'Zażółć gęślą jaźń',
				xKey: 'month',
				series: [
					{ key: 'a', label: 'Łódź' },
					{ key: 'b', label: 'Żółć' }
				],
				data: [
					{ month: 'Styczeń', a: 12, b: 9 },
					{ month: 'Luty', a: 19, b: 13 },
					{ month: 'Marzec', a: 25, b: 18 }
				]
			}
);
const markdown =
	'# Typografia\n\n' +
	sample +
	'\n\n**Pogrubienie** i *kursywa*. `const ł = 1;`\n\n- Lista\n\n| Miasto | Wartość |\n| --- | --- |\n| Łódź | 25 |\n\n$$x^2 + y^2 = z^2$$\n\n' +
	specs.map((s) => '```llampart-chart\n' + JSON.stringify(s) + '\n```').join('\n\n');
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
	if (!localStorage.getItem('LlamaCppWebui.config'))
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'llama-server',
				serverBaseUrl: 'http://charts.test',
				llamaServerBaseUrl: 'http://charts.test',
				theme: 'frosted-glass',
				interfaceLanguage: 'pl',
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false,
				alwaysShowSidebarOnDesktop: true,
				fontFamily: 'default',
				fontSize: 'default',
				uiScale: '100'
			})
		);
});
await page.route('**/*', (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.includes('/__llampart/api/'))
		return route.fulfill(
			url.pathname.endsWith('/chat/completions')
				? {
						contentType: 'text/event-stream',
						body: `data: ${JSON.stringify({ choices: [{ delta: { content: markdown } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
					}
				: {
						json: url.pathname.endsWith('/props')
							? {
									build_info: 'test',
									model_path: 'charts.gguf',
									default_generation_settings: { params: {} }
								}
							: url.pathname.endsWith('/models')
								? { object: 'list', data: [{ id: 'charts.gguf' }] }
								: []
					}
		);
	return url.origin === new URL(base).origin ? route.continue() : route.abort();
});
const dialog = page.locator('.llampart-chat-settings-dialog-content'),
	frames = page.locator('.llampart-assistant-markdown .llampart-chart-frame');
async function open() {
	await page.locator('button[aria-label="Ustawienia"]').click();
	await dialog.waitFor();
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
}
async function select(id, label) {
	await page.locator('#' + id).click();
	await page.getByRole('option', { name: label, exact: true }).click();
	await page.evaluate(() => document.fonts.ready);
}
async function cancel() {
	await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
const sizes = () =>
	page.evaluate(() => ({
		root: parseFloat(getComputedStyle(document.documentElement).fontSize),
		body: parseFloat(getComputedStyle(document.body).fontSize),
		plot: document.querySelector('.chart-plot').getBoundingClientRect().height,
		axis: parseFloat(getComputedStyle(document.querySelector('.chart-plot text')).fontSize),
		legend: parseFloat(getComputedStyle(document.querySelector('.chart-legend button')).fontSize),
		paragraph: parseFloat(
			getComputedStyle(document.querySelector('.llampart-assistant-markdown p')).fontSize
		),
		heading: parseFloat(
			getComputedStyle(document.querySelector('.llampart-assistant-markdown h1')).fontSize
		),
		table: parseFloat(
			getComputedStyle(document.querySelector('.llampart-assistant-markdown td')).fontSize
		),
		code: getComputedStyle(document.querySelector('.llampart-assistant-markdown code')).fontFamily,
		math: getComputedStyle(document.querySelector('.katex')).fontFamily
	}));
async function glyphs(session, selector) {
	const { root } = await session.send('DOM.getDocument');
	const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
	const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
	assert(fonts.length > 0);
	assert(
		fonts.every((f) => f.isCustomFont),
		JSON.stringify(fonts)
	);
	return fonts;
}
async function exports(index, id) {
	const frame = frames.nth(index);
	const expectedLabelSize = (await sizes()).legend;
	for (const format of ['svg', 'png']) {
		await frame.evaluate((el) => el.scrollIntoView({ block: 'center' }));
		await page.mouse.move(5, 5);
		const [item] = await Promise.all([
			page.waitForEvent('download'),
			frame.getByRole('button', { name: new RegExp(`${format.toUpperCase()}$`) }).click()
		]);
		const path = `${artifacts}/${id}-${index}.${format}`;
		await item.saveAs(path);
		const bytes = await readFile(path);
		const reopened = await context.newPage();
		await reopened.route(`**/export.${format}`, (r) =>
			r.fulfill({ contentType: format === 'svg' ? 'image/svg+xml' : 'image/png', body: bytes })
		);
		await reopened.goto(`${base}/export.${format}`);
		if (format === 'svg') {
			assert.equal(await reopened.locator('parsererror').count(), 0);
			assert(bytes.toString().includes('data:font/woff2;base64,'));
			assert((bytes.toString().match(/@font-face/g) || []).length <= 12);
			assert(!bytes.toString().includes('fonts.gstatic.com'));
			await reopened.evaluate(() => document.fonts.ready);
			const cdp = await context.newCDPSession(reopened);
			await cdp.send('DOM.enable');
			await cdp.send('CSS.enable');
			await glyphs(cdp, 'svg text');
			await cdp.detach();
			const axis = await reopened.locator('.lc-axis text').count();
			if (axis)
				assert.equal(
					await reopened
						.locator('.lc-axis text')
						.first()
						.evaluate((n) => parseFloat(getComputedStyle(n).fontSize)),
					expectedLabelSize // Export preserves the same visualization label token as the live legend.
				);
		} else
			assert(
				await reopened.locator('img').evaluate((img) => img.complete && img.naturalWidth > 500)
			);
		await reopened.screenshot({ path: `${artifacts}/reopened-${id}-${index}-${format}.png` });
		await reopened.close();
	}
}
try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.locator('textarea').first().fill('Sprawdź typografię');
	await page.locator('textarea').first().press('Enter');
	await frames.nth(3).waitFor();
	const initial = await sizes();
	assert.equal(initial.root, 12);
	assert.equal(initial.body, 12);
	const cdp = await context.newCDPSession(page);
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	const evidence = [];
	for (const [id, label, weights, italic] of [
		['crimson-text', 'Crimson Text', [400, 600, 700], true],
		['libre-caslon-condensed', 'Libre Caslon Condensed', [400, 500, 600, 700], true],
		['fira-sans', 'Fira Sans', [400, 500, 600, 700], true]
	]) {
		await open();
		await select('fontFamily', label);
		await select('fontSize', '18 px');
		await page.locator('#fontVariant').click();
		assert.deepEqual(
			(await page.getByRole('option').allTextContents()).map((s) => s.trim()),
			weights.map(
				(w) => ({ 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' })[w] + ` — ${w}`
			)
		);
		await page.keyboard.press('Escape');
		const selected = await sizes();
		assert.equal(selected.body, 18);
		assert.equal(
			await page
				.locator('html')
				.evaluate((n) => n.style.getPropertyValue('--llampart-fixed-text-scale')),
			'1.5'
		);
		assert.equal(selected.root, 12);
		assert.equal(selected.plot, initial.plot);
		// Axes share the donut legend's label token, not the historical 0.75 scale.
		assert.equal(selected.legend, selected.body * 0.8);
		assert.equal(selected.axis, selected.legend);
		assert.equal(selected.code, initial.code);
		assert.equal(selected.math, initial.math);
		for (const key of ['paragraph', 'heading', 'table'])
			assert(Math.abs(selected[key] / initial[key] - 1.5) < 0.001, key);
		for (const weight of weights) {
			await select(
				'fontVariant',
				{ 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold' }[weight] + ` — ${weight}`
			);
			assert.equal(
				await page
					.locator('html')
					.evaluate((n) => n.style.getPropertyValue('--llampart-font-weight')),
				String(weight)
			);
		}
		await select('fontVariant', 'Regular — 400');
		for (const weight of weights)
			for (const style of italic ? ['normal', 'italic'] : ['normal']) {
				await page.evaluate(
					({ sample, weight, style }) => {
						document.querySelector('#glyph-probe')?.remove();
						const span = document.createElement('span');
						span.id = 'glyph-probe';
						span.textContent = sample;
						span.style.cssText = `font-family:var(--llampart-font-family);font-size:24px;font-weight:${weight};font-style:${style};position:fixed;top:0;left:0;z-index:99999;background:white`;
						document.body.append(span);
					},
					{ sample, weight, style }
				);
				await page.evaluate(() => document.fonts.ready);
				evidence.push({ id, weight, style, fonts: await glyphs(cdp, '#glyph-probe') });
			}
		await page.screenshot({ path: `${artifacts}/${id}-glyphs.png` });
		await page.locator('#glyph-probe').evaluate((n) => n.remove());
		const controls = await Promise.all(
			['fontFamily', 'fontVariant', 'fontSize'].map((id) => page.locator('#' + id).boundingBox())
		);
		assert(
			controls.every(
				(b) =>
					Math.abs(b.width - controls[0].width) < 1 &&
					Math.abs(b.height - controls[0].height) < 1 &&
					Math.abs(b.y - controls[0].y) < 1
			)
		);
		await page.screenshot({ path: `${artifacts}/${id}-desktop.png` });
		await cancel();
		assert.deepEqual(await sizes(), initial);
		await open();
		await select('fontFamily', label);
		await select('fontSize', '18 px');
		await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		await frames.first().evaluate((n) => n.scrollIntoView({ block: 'center' }));
		const point = await frames.first().locator('.lc-point').first().boundingBox();
		await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
		await page.locator('.chart-tooltip-content').waitFor({ state: 'visible' });
		const tooltip = await page.locator('.chart-tooltip-content').evaluate((n) => ({
			family: getComputedStyle(n).fontFamily,
			size: getComputedStyle(n).fontSize
		}));
		assert(tooltip.family.includes(label));
		assert.equal(tooltip.size, '14.4px');
		await page.screenshot({ path: `${artifacts}/${id}-tooltip.png` });
		await page.mouse.move(5, 5);
		for (let i = 0; i < 4; i++) await exports(i, id);
		// Restore the actual initial baseline through the same form before the next family.
		await open();
		await select('fontFamily', 'Domyślna');
		await select('fontSize', 'Domyślna');
		await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		console.log(
			`PASS ${label}: real glyphs all weights/styles, 18 px, cancel/save and four chart PNG/SVG reopens`
		);
	}
	for (const width of [800, 390]) {
		await page.setViewportSize({ width: 1920, height: 1080 });
		await page.reload();
		await page.waitForSelector('textarea');
		await open();
		await page.setViewportSize({ width, height: 1000 });
		await select('fontFamily', 'Libre Caslon Condensed');
		await select('fontSize', '20 px');
		for (const id of ['fontFamily', 'fontVariant', 'fontSize']) {
			const control = page.locator('#' + id);
			assert(await control.isVisible());
			assert(await control.evaluate((n) => n.scrollWidth <= n.clientWidth));
			await control.screenshot({ path: `${artifacts}/responsive-${width}-${id}.png` });
		}
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await page.screenshot({ path: `${artifacts}/responsive-${width}.png` });
		await cancel();
	}
	assert.equal((await sizes()).body, 16);
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.reload();
	await page.waitForSelector('textarea');
	await open();
	for (const n of [12, 13, 14, 15, 16, 17, 18, 19, 20]) {
		await select('fontSize', `${n} px`);
		assert.equal((await sizes()).body, n);
		assert.equal((await sizes()).root, 12);
	}
	await page.locator('#uiScale').fill('110');
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '110');
	assert.equal((await sizes()).body, 20);
	assert.equal((await sizes()).root, 13.2);
	await page.waitForFunction(
		() =>
			Math.abs(
				parseFloat(document.documentElement.style.getPropertyValue('--llampart-fixed-text-scale')) -
					20 / 13.2
			) < 0.001
	);
	await cancel();
	assert.equal((await sizes()).body, 12);
	assert.deepEqual(errors, []);
	assert.deepEqual(external, []);
	assert(fonts.length > 0 && fonts.every((url) => new URL(url).pathname.endsWith('.woff2')));
	await writeFile(
		`${artifacts}/evidence.json`,
		JSON.stringify(
			{ initial, glyphs: evidence, fontRequests: [...new Set(fonts)], external },
			null,
			2
		)
	);
	console.log(
		'PASS responsive default 12/16 px, 12–20 px, independent UI Scale, unchanged code/KaTeX families, local-only WOFF2 Network'
	);
} catch (e) {
	console.error(
		await frames.first().evaluate((n) => ({
			classes: n.className,
			text: n.textContent,
			fonts: document.fonts.status,
			buttons: [...n.querySelectorAll('button')].map((b) => ({
				text: b.textContent,
				disabled: b.disabled
			}))
		}))
	);
	await page.screenshot({ path: `${artifacts}/failure.png` });
	throw e;
} finally {
	await browser.close();
}
