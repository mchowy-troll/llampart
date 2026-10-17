/** Chromium UI + captured HTTP requests + IndexedDB; fixtures, not real inference.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/response-preferences.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({
	viewport: { width: 1920, height: 1080 },
	permissions: ['clipboard-read', 'clipboard-write']
});
const page = await context.newPage();
const artifacts =
	process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-response-preferences/browser';
await mkdir(artifacts, { recursive: true });
const errors = [];
const requests = [];
const externalFonts = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
	if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) externalFonts.push(request.url());
});
const keys = [
	'NoHeadings',
	'Tables',
	'Charts',
	'Diagrams',
	'NoDecorations',
	'Concise',
	'Examples',
	'Steps',
	'UserLanguage'
].map((name) => `responsePref${name}`);
const storageKey = 'LlamaCppWebui.config';
const manual =
	'Manual system: preserve my exact words. Answer in Polish unless requested otherwise.';
await page.addInitScript(
	({ storageKey, manual }) => {
		if (!localStorage.getItem(storageKey))
			localStorage.setItem(
				storageKey,
				JSON.stringify({
					apiProvider: 'vllm',
					serverBaseUrl: 'http://mock.invalid:8000',
					vllmBaseUrl: 'http://mock.invalid:8000',
					interfaceLanguage: 'pl',
					theme: 'frosted-glass',
					fontFamily: 'fira-sans',
					fontSize: '20',
					systemMessage: manual,
					showSystemMessage: true,
					titleGenerationUseLLM: false,
					titleGenerationUseFirstLine: true,
					alwaysShowSidebarOnDesktop: true
				})
			);
		localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
	},
	{ storageKey, manual }
);
await page.route('**/__llampart/api/**', (route) => {
	const path = new URL(route.request().url()).pathname;
	if (path.endsWith('/chat/completions')) {
		requests.push(route.request().postDataJSON());
		return route.fulfill({
			contentType: 'text/event-stream',
			body: 'data: {"choices":[{"delta":{"content":"Odpowiedź testowa."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
		});
	}
	return route.fulfill({
		json: path.endsWith('/models') ? { object: 'list', data: [{ id: 'mock/model' }] } : {}
	});
});
const dialog = page.locator('.llampart-chat-settings-dialog-content');
const frame = page.locator('[data-settings-group="response-preferences"]');
const persisted = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), storageKey);
const locale = async () => (await persisted()).interfaceLanguage;
async function open() {
	const name = (await locale()) === 'pl' ? 'Ustawienia' : 'Settings';
	await page.locator(`button[aria-label="${name}"]`).click();
	await dialog.waitFor({ state: 'visible' });
	await dialog
		.getByRole('button', { name: (await locale()) === 'pl' ? 'Ogólne' : 'General', exact: true })
		.click();
	await frame.waitFor();
}
async function close(method = 'button') {
	if (method === 'escape') await page.keyboard.press('Escape');
	else if (method === 'outside') await page.mouse.click(15, 15);
	else
		await dialog
			.getByRole('button', { name: (await locale()) === 'pl' ? 'Zamknij' : 'Close', exact: true })
			.click();
	await dialog.waitFor({ state: 'hidden' });
}
async function save() {
	await dialog
		.getByRole('button', {
			name: (await locale()) === 'pl' ? 'Zapisz ustawienia' : 'Save settings',
			exact: true
		})
		.click();
	await dialog.waitFor({ state: 'hidden' });
}
async function send(text) {
	const count = requests.length;
	const assistantCount = await page.locator('.llampart-assistant-markdown').count();
	await page.locator('textarea').first().fill(text);
	await page.locator('textarea').first().press('Enter');
	await page.waitForFunction(
		(count) => document.querySelectorAll('.llampart-assistant-markdown').length > count,
		assistantCount
	);
	await page
		.getByRole('button', { name: /^(Stop generating|Zatrzymaj generowanie)$/ })
		.first()
		.waitFor({ state: 'hidden' });
	assert.equal(requests.length, count + 1);
	return requests.at(-1).messages.find((message) => message.role === 'system').content;
}
async function screenshot(name) {
	await frame.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${artifacts}/${name}.png` });
}

try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
	await page.waitForSelector('textarea');
	await page.keyboard.press('Escape');
	const baseline = await send('Pierwsza wiadomość bez aktywnych preferencji.');
	assert(baseline.endsWith(manual));
	assert(!baseline.includes('<llampart-response-preferences>'));
	await open();
	assert.deepEqual(
		await dialog
			.locator('[data-settings-group]')
			.evaluateAll((els) => els.map((el) => el.dataset.settingsGroup)),
		['connection', 'system-message', 'response-preferences']
	);
	const system = page.locator('[data-settings-group="system-message"]');
	assert.equal((await frame.boundingBox()).width, (await system.boundingBox()).width);
	assert.equal(await frame.locator('[role="checkbox"]').count(), 9);
	assert.equal(await frame.locator('details').getAttribute('open'), null);
	assert.equal(await page.locator('#systemMessage').inputValue(), manual);
	await frame.locator('summary').click();
	assert(await frame.getByText('Brak aktywnych preferencji', { exact: false }).isVisible());
	for (const key of keys) {
		await page.locator(`#${key}`).check();
		assert((await frame.locator('[data-response-instructions]').textContent()).length > 0);
		await page.locator(`#${key}`).uncheck();
	}
	// Keyboard activation and accessible label association.
	await page.locator(`#${keys[0]}`).focus();
	await page.keyboard.press('Space');
	assert.equal(await page.locator(`#${keys[0]}`).getAttribute('aria-checked'), 'true');
	for (const key of keys) await page.locator(`#${key}`).check();
	const preview = await frame.locator('[data-response-instructions]').textContent();
	assert(!preview.includes(manual));
	assert(!preview.includes('Cartesian example'));
	await frame.getByRole('button', { name: 'Kopiuj do schowka', exact: true }).click();
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), preview);
	const headings = frame.locator('legend');
	const desktop = await headings.evaluateAll((els) =>
		els.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }))
	);
	assert(desktop[1].x > desktop[0].x && Math.abs(desktop[1].y - desktop[0].y) < 2);
	assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontSize), '20px');
	await screenshot('desktop-20px');
	for (const width of [800, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await frame.scrollIntoViewIfNeeded();
		const positions = await headings.evaluateAll((els) =>
			els.map((el) => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }))
		);
		assert(Math.abs(positions[0].x - positions[1].x) < 2 && positions[1].y > positions[0].y);
		assert(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
		await screenshot(`narrow-${width}-20px`);
	}
	await page.setViewportSize({ width: 1920, height: 1080 });
	await close();
	let cancelled = await persisted();
	assert(keys.every((key) => cancelled[key] !== true));
	for (const method of ['escape', 'outside']) {
		await open();
		for (const key of keys) {
			assert.equal(await page.locator(`#${key}`).getAttribute('aria-checked'), 'false');
			await page.locator(`#${key}`).check();
		}
		await close(method);
		cancelled = await persisted();
		assert(keys.every((key) => cancelled[key] !== true));
	}
	assert(
		!(await send('Po anulowaniu nadal bez dodatkowych reguł.')).includes(
			'<llampart-response-preferences>'
		)
	);
	await open();
	for (const key of keys) await page.locator(`#${key}`).check();
	await save();
	assert(keys.every((key) => requests[0][key] === undefined));
	const stored = await persisted();
	assert(keys.every((key) => stored[key] === true));
	const enabled = await send('Porównaj wartości 12, 18 i 24.');
	assert(enabled.includes(preview));
	assert(enabled.endsWith(manual));
	assert.equal(enabled.split('Cartesian example:').length, 2);
	await page.reload();
	await page.waitForSelector('textarea');
	await open();
	for (const key of keys)
		assert.equal(await page.locator(`#${key}`).getAttribute('aria-checked'), 'true');
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
	await page.locator('#fontSize').click();
	await page.getByRole('option', { name: '18 px', exact: true }).click();
	await dialog.getByRole('button', { name: 'Ogólne', exact: true }).click();
	assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontSize), '18px');
	await screenshot('desktop-18px');
	await close();
	await open();
	// Switch interface language through existing settings, not through prompt text.
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
	await page.locator('#interfaceLanguage').click();
	await page.getByRole('option', { name: 'English', exact: true }).click();
	await save();
	await open();
	assert(
		await frame.getByRole('heading', { name: 'Response preferences', exact: true }).isVisible()
	);
	await frame.locator('summary').click();
	assert.equal(await frame.locator('[data-response-instructions]').textContent(), preview);
	await screenshot('english-20px');
	await close();
	assert((await send('Nadal odpowiedz po polsku.')).includes(preview));
	// Raw IndexedDB confirms request-only injection, not a hidden history message.
	const history = await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const request = indexedDB.open('LlamacppWebui');
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const read = db.transaction('messages').objectStore('messages').getAll();
					read.onsuccess = () => {
						resolve(read.result);
						db.close();
					};
					read.onerror = () => {
						reject(read.error);
						db.close();
					};
				};
			})
	);
	assert(!JSON.stringify(history).includes('<llampart-response-preferences>'));
	assert(!JSON.stringify(history).includes('Cartesian example:'));
	assert(history.some((message) => message.role === 'system' && message.content === manual));
	await open();
	for (const key of keys) await page.locator(`#${key}`).uncheck();
	await save();
	const disabled = await send('Preferencje wyłączone. Porównaj 5 i 10.');
	assert(!disabled.includes('<llampart-response-preferences>'));
	assert(disabled.includes('Supported types: line, area, bar, donut.'));
	assert(disabled.endsWith(manual));
	await open();
	for (const key of keys) await page.locator(`#${key}`).check();
	await save();
	await open();
	await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
	await page.getByRole('button', { name: 'Reset to Default', exact: true }).click();
	for (const key of keys)
		assert.equal(await page.locator(`#${key}`).getAttribute('aria-checked'), 'false');
	await close();
	const reset = await persisted();
	assert(keys.every((key) => reset[key] === false));
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
	await page.waitForSelector('textarea');
	const noManual = await send('Nowa rozmowa bez ręcznego System Message.');
	assert(!noManual.includes(manual));
	assert(!noManual.includes('<llampart-response-preferences>'));
	assert.deepEqual(errors, []);
	assert.deepEqual(externalFonts, []);
	await writeFile(
		`${artifacts}/evidence.json`,
		JSON.stringify({ requests, errors, externalFonts, preview, history }, null, 2)
	);
	console.log(
		'PASS separate frame/order, desktop two columns, narrow one column, Frosted Glass and 20px text, accessible keyboard checkbox, read-only live preview/copy'
	);
	console.log(
		'PASS all nine independently, Save/reload, Cancel button/Escape/outside, Reset, Polish/English interface with identical English instructions'
	);
	console.log(
		'PASS real captured chat requests before/after Save in existing conversation, manual prompt unchanged, chart schema once, no generated instructions in IndexedDB or external font requests'
	);
} finally {
	await browser.close();
}
