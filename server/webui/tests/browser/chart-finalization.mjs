/** Fixed palette, ascending Donut presentation and source-order exports in the real app. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts =
	process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-chart-finalization/browser';
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
const page = await context.newPage(),
	errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const colors = [
	'#00BEFF',
	'#00A3A3',
	'#00C853',
	'#AEEA00',
	'#FF6D00',
	'#FF1744',
	'#D500F9',
	'#651FFF',
	'#263238'
];
const cart = {
	xKey: 'month',
	series: ['a', 'b', 'c', 'd'].map((key, i) => ({ key, label: `Produkt ${'ABCD'[i]}` })),
	data: [
		{ month: 'Styczeń', a: 12, b: 9, c: 7, d: 3 },
		{ month: 'Luty', a: 19, b: 13, c: 11, d: 7 },
		{ month: 'Marzec', a: 25, b: 18, c: 13, d: 10 }
	]
};
const donut = (title, data) => ({
	type: 'donut',
	title,
	labelKey: 'category',
	valueKey: 'value',
	data: data.map(([category, value]) => ({ category, value }))
});
const specs = [
	...['line', 'area', 'bar'].map((type) => ({ ...cart, type, title: `Produkty · ${type}` })),
	donut('Donut · 5 kategorii', [
		['A', 35],
		['B', 15],
		['C', 25],
		['D', 10],
		['E', 20]
	]),
	donut('Donut · 9 kategorii', [
		['Sprzedaż', 43],
		['Usługi', 27],
		['Licencje', 18],
		['Pozostałe', 12],
		['Konsultacje', 8],
		['Partnerzy', 16],
		['Zwroty', 2],
		['Inne', 5],
		['Eksport', 21]
	]),
	donut(
		'Donut · 20 kategorii',
		Array.from({ length: 20 }, (_, i) => [`Kategoria ${i + 1}`, ((i * 7) % 20) + 1])
	),
	donut('Donut · remisy i zera', [
		['A', 4],
		['B', 0],
		['C', 2],
		['D', 2],
		['E', 0],
		['F', 1]
	])
];
const fence = (spec) => '```llampart-chart\n' + JSON.stringify(spec) + '\n```';
const markdown = specs.map(fence).join('\n\n');
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://charts.test',
			llamaServerBaseUrl: 'http://charts.test',
			theme: 'frosted-glass',
			frostedGlassWallpaper: 'frosted-glass-02',
			fontFamily: 'merriweather',
			fontVariant: '400',
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
			body: `data: ${JSON.stringify({ choices: [{ delta: { content: markdown } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
		});
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
const frames = page.locator('.llampart-assistant-markdown .llampart-chart-frame');
const ordered = (spec) =>
	spec.data
		.map((row, index) => ({ row, index }))
		.sort((a, b) => a.row.value - b.row.value || a.index - b.index)
		.map((item) => item.row);
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
async function staticPoints(scope, spec) {
	const points = await scope.locator('.lc-point').evaluateAll((nodes) =>
		nodes.map((n) => ({
			r: Number(n.getAttribute('r')),
			fill: getComputedStyle(n).fill,
			stroke: getComputedStyle(n).stroke,
			width: getComputedStyle(n).strokeWidth,
			filter: getComputedStyle(n).filter,
			shadow: getComputedStyle(n).boxShadow,
			opacity: getComputedStyle(n).opacity
		}))
	);
	assert.equal(points.length, spec.data.length * spec.series.length);
	assert.deepEqual(
		points.map((p) => p.fill),
		colors.slice(0, spec.series.length).flatMap((color) => spec.data.map(() => rgb(color)))
	);
	for (const p of points) {
		assert.equal(p.r, 3.25);
		assert(p.r > 2.5 && p.r < 4.5);
		assert.equal(p.stroke, 'none');
		assert.equal(p.width, '0px');
		assert.equal(p.filter, 'none');
		assert.equal(p.shadow, 'none');
		assert.equal(p.opacity, '1');
	}
	return points;
}
async function hoverPoints(index, spec, wall) {
	const frame = frames.nth(index);
	await frame.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	const before = await staticPoints(frame, spec),
		box = await frame.locator('.lc-point').first().boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForFunction((count) => {
		const nodes = [...document.querySelectorAll('.lc-highlight-point')];
		return (
			nodes.length === count &&
			nodes.every((n) => Math.abs(Number(n.getAttribute('r')) - 4.5) < 0.001)
		);
	}, spec.series.length);
	assert.deepEqual(await staticPoints(frame, spec), before);
	await page.waitForFunction(() =>
		[...document.querySelectorAll('.llampart-chart-tooltip-root')].every(
			(el) => getComputedStyle(el).opacity === '1'
		)
	);
	assert((await page.locator('.chart-tooltip-content').textContent()).includes(spec.data[0].month));
	assert.deepEqual(
		await frame.locator('.lc-highlight-point').evaluateAll((nodes) =>
			nodes.map((n) => ({
				r: Number(n.getAttribute('r')),
				stroke: getComputedStyle(n).stroke,
				width: getComputedStyle(n).strokeWidth
			}))
		),
		spec.series.map(() => ({ r: 4.5, stroke: 'rgb(255, 255, 255)', width: '2px' }))
	);
	await page.screenshot({ path: `${artifacts}/${wall}-${spec.type}-points-hover.png` });
	await leave();
}
async function point(index, slice) {
	await frames.nth(index).evaluate((el) => el.scrollIntoView({ block: 'center' }));
	return frames
		.nth(index)
		.locator('.chart-slice')
		.nth(slice)
		.evaluate((node) => {
			const b = node.getBBox(),
				points = [];
			for (let i = 1; i < 30; i++)
				for (let j = 1; j < 30; j++) {
					const p = new DOMPoint(b.x + (b.width * i) / 30, b.y + (b.height * j) / 30);
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
async function hover(index, slice, row, total) {
	const p = await point(index, slice);
	await page.mouse.move(p.x, p.y);
	await page.waitForFunction(
		(category) => document.querySelector('.chart-tooltip-content')?.textContent.includes(category),
		row.category
	);
	const text = (await page.locator('.chart-tooltip-content').textContent())
		.replace(/\s+/g, ' ')
		.trim();
	const share = new Intl.NumberFormat('pl', { style: 'percent', maximumFractionDigits: 1 }).format(
		row.value / total
	);
	assert(text.includes(`Wartość: ${row.value} · Udział: ${share}`));
	assert.equal(
		await frames
			.nth(index)
			.locator('.chart-plot circle,.lc-highlight-point,.chart-plot text')
			.count(),
		0
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
}
async function leave() {
	await page.mouse.move(5, 5);
	await page.waitForFunction(() => !document.querySelector('.chart-tooltip-content'));
}
const records = [];
async function validate(index, spec) {
	const frame = frames.nth(index),
		isDonut = spec.type === 'donut',
		rows = isDonut ? ordered(spec) : null;
	const legend = await frame.locator('.chart-legend button').allTextContents();
	assert.deepEqual(
		legend.map((s) => s.trim()),
		isDonut ? rows.map((r) => r.category) : spec.series.map((s) => s.label)
	);
	const expected = await page.evaluate(
		(count) =>
			Array.from({ length: count }, (_, i) =>
				getComputedStyle(document.documentElement)
					.getPropertyValue(`--llampart-chart-${i + 1}`)
					.trim()
			),
		isDonut ? rows.length : spec.series.length
	);
	assert.deepEqual(expected.slice(0, 9), colors.slice(0, expected.length));
	assert.equal(new Set(expected).size, expected.length);
	const selector = isDonut
		? '.chart-slice'
		: spec.type === 'bar'
			? '.lc-bars-bar'
			: '.chart-series-line';
	const applied = await frame.locator(selector).evaluateAll((nodes) =>
		nodes.map((n) => ({
			color: getComputedStyle(n)[n.classList.contains('chart-series-line') ? 'stroke' : 'fill'],
			d: n.getAttribute('d')
		}))
	);
	const expectedMarks =
		spec.type === 'bar'
			? expected.flatMap((color) => spec.data.map(() => rgb(color)))
			: expected.map(rgb);
	assert.deepEqual(
		applied.map((m) => m.color),
		expectedMarks
	);
	if (spec.type === 'line' || spec.type === 'area') await staticPoints(frame, spec);
	if (isDonut) {
		let cumulative = 0;
		const total = rows.reduce((sum, r) => sum + r.value, 0);
		for (let i = 0; i < rows.length; i++) {
			const start = applied[i].d.match(/^M([\d.e+-]+),([\d.e+-]+)/);
			assert(start, applied[i].d);
			const angle = (Math.atan2(Number(start[1]), -Number(start[2])) + Math.PI * 2) % (Math.PI * 2);
			assert(
				Math.abs(angle - (cumulative / total) * Math.PI * 2) < 0.002,
				`wrong visual angle for ${rows[i].category}`
			);
			cumulative += rows[i].value;
		}
	}
	records.push({ title: spec.title, legend, applied, expected });
}
async function exports(index, spec, wall) {
	for (const format of ['png', 'svg', 'csv']) {
		const pending = page.waitForEvent('download');
		await frames
			.nth(index)
			.getByRole('button', { name: new RegExp(` ${format.toUpperCase()}$`) })
			.click();
		const file = `${artifacts}/${wall}-${index}.${format}`;
		await (await pending).saveAs(file);
		const bytes = await readFile(file);
		if (format === 'csv') {
			assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
			if (spec.type === 'donut')
				assert.equal(
					bytes.toString(),
					'\uFEFFcategory,value\r\n' + spec.data.map((r) => `${r.category},${r.value}\r\n`).join('')
				);
			continue;
		}
		const reopened = await context.newPage();
		await reopened.route(`**/export.${format}`, (r) =>
			r.fulfill({ contentType: format === 'svg' ? 'image/svg+xml' : 'image/png', body: bytes })
		);
		await reopened.goto(`${base}/export.${format}`);
		if (format === 'svg') {
			assert.equal(
				await reopened.locator('parsererror,.lc-highlight-point,.chart-tooltip-content').count(),
				0
			);
			if (spec.type === 'donut') {
				assert.equal(await reopened.locator('circle,.chart-slice-percentage').count(), 0);
				assert.deepEqual(
					await reopened
						.locator('.chart-slice')
						.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fill)),
					records.find((r) => r.title === spec.title).applied.map((m) => m.color)
				);
				assert.deepEqual(
					await reopened
						.locator('.chart-slice')
						.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('d'))),
					records.find((r) => r.title === spec.title).applied.map((m) => m.d)
				);
			}
			if (spec.type === 'line' || spec.type === 'area') await staticPoints(reopened, spec);
		} else
			assert(
				await reopened.locator('img').evaluate((img) => img.complete && img.naturalWidth > 1000)
			);
		await reopened.screenshot({ path: `${artifacts}/reopened-${wall}-${index}-${format}.png` });
		await reopened.close();
	}
}
try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.locator('textarea').first().fill('Pokaż aktualne wykresy');
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(
		() => document.querySelectorAll('.llampart-chart-frame svg[role="img"]').length === 7
	);
	for (const [wall, id] of [
		['turquoise', '02'],
		['pink', '01']
	]) {
		if (id === '01') {
			await page.locator('button[aria-label="Ustawienia"]').click();
			const dialog = page.locator('.llampart-chat-settings-dialog-content');
			await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
			await page.getByRole('button', { name: 'Frosted Glass 01', exact: true }).click();
			await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
			await dialog.waitFor({ state: 'hidden' });
		}
		await page.evaluate(() => document.fonts.ready);
		for (let i = 0; i < specs.length; i++) {
			await validate(i, specs[i]);
			if (specs[i].type === 'line' || specs[i].type === 'area')
				await hoverPoints(i, specs[i], wall);
			if (specs[i].type === 'donut') {
				const rows = ordered(specs[i]),
					total = rows.reduce((sum, r) => sum + r.value, 0);
				for (let j = 0; j < rows.length; j++)
					if (rows[j].value > 0) await hover(i, j, rows[j], total);
				await frames.nth(i).screenshot({ path: `${artifacts}/${wall}-${i}-hover.png` });
				await leave();
				const selected = rows.findIndex((r) => r.value > 0);
				await frames.nth(i).locator('.chart-legend button').nth(selected).click();
				assert.equal(await frames.nth(i).locator('.chart-slice').count(), rows.length - 1);
				assert.deepEqual(
					await frames
						.nth(i)
						.locator('.chart-slice')
						.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fill)),
					records
						.at(-1)
						.applied.filter((_, j) => j !== selected)
						.map((m) => m.color)
				);
				await frames.nth(i).locator('.chart-legend button').nth(selected).click();
			}
			await frames.nth(i).scrollIntoViewIfNeeded();
			await frames.nth(i).screenshot({ path: `${artifacts}/${wall}-chart-${i}.png` });
			await exports(i, specs[i], wall);
		}
		console.log(
			`PASS ${wall}: actual SVG HEX colors, ascending angles and stable ties, 5/9/20 categories, all nonzero slices, legend mapping and PNG/SVG/CSV reopens`
		);
	}
	if (!process.env.LLAMPART_TEST_PRODUCTION) {
		const changed = {
			...specs[3],
			data: specs[3].data.map((row) => ({ ...row, value: 50 - row.value }))
		};
		await hover(3, 0, ordered(specs[3])[0], 105);
		await page.evaluate(async (content) => {
			const { db, conversations } = await import('/tests/browser/charts-harness.ts');
			const message = conversations.activeMessages.find((m) => m.role === 'assistant');
			await db.updateMessage(message.id, { content });
			conversations.updateMessageAtIndex(conversations.findMessageIndex(message.id), { content });
		}, fence(changed));
		await page.waitForFunction(
			() =>
				document.querySelectorAll('.llampart-chart-frame').length === 1 &&
				document.querySelector('.chart-legend button').textContent.trim() === 'A'
		);
		await leave();
		await validate(0, changed);
		await hover(0, 0, ordered(changed)[0], 145);
		await leave();
		console.log(
			'PASS changed source while a slice was active: fresh ascending order, first color, tooltip category/value and no stale active mapping'
		);
	}
	await writeFile(`${artifacts}/svg-evidence.json`, JSON.stringify(records, null, 2));
	assert.deepEqual(errors, []);
} catch (error) {
	console.error(error);
	await page.screenshot({ path: `${artifacts}/failure.png` });
	throw error;
} finally {
	await browser.close();
}
