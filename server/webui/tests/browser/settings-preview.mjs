/**
 * Real Chromium regression against the application (development or production preview).
 * No project dependency required: supply an installed Playwright/Core module explicitly.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40133 node tests/browser/settings-preview.mjs
 * Optional: LLAMPART_CHROMIUM, LLAMPART_TEST_ARTIFACTS (outside the repository).
 * Provider HTTP responses are mocked; this does not test a real inference backend.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

assert(process.env.LLAMPART_PLAYWRIGHT_MODULE, 'Set LLAMPART_PLAYWRIGHT_MODULE');
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const storageKey = 'LlamaCppWebui.config';
const wallpaperKey = 'llampart:frosted-glass:user-wallpaper';
const initial = {
	apiProvider: 'vllm',
	vllmBaseUrl: 'http://mock.invalid:8000',
	serverBaseUrl: 'http://mock.invalid:8000',
	theme: 'frosted-glass',
	interfaceLanguage: 'pl',
	alwaysShowSidebarOnDesktop: true,
	uiScale: '100',
	fontFamily: 'default',
	fontVariant: '400',
	frostedGlassWallpaper: 'frosted-glass-02',
	frostedGlassMilkiness: 50,
	frostedGlassOpaque: false
};
let validationMode = 'success';
let heldRoutes = [];
const models = { object: 'list', data: [{ id: 'mock/model' }] };
await page.route('**/*', async (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.includes('/__llampart/api/') && url.pathname.endsWith('/models')) {
		if (validationMode === 'hold') {
			heldRoutes.push(route);
			return;
		}
		return validationMode === 'failure'
			? route.fulfill({ status: 503, json: { error: 'Test connection failure' } })
			: route.fulfill({ json: models });
	}
	return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
});
await page.addInitScript(
	({ key, config }) => {
		if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(config));
		localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
	},
	{ key: storageKey, config: initial }
);

const dialog = page.locator('.llampart-chat-settings-dialog-content');
const persisted = () => page.evaluate((key) => localStorage.getItem(key), storageKey);
const scale = () => page.locator('html').getAttribute('data-llampart-ui-scale');
async function open() {
	if (!(await page.locator('button[aria-label="Ustawienia"]').isVisible())) {
		await page.getByRole('button', { name: 'Przełącz pasek boczny', exact: true }).click();
	}
	await page.locator('button[aria-label="Ustawienia"]').click();
	await dialog.waitFor({ state: 'visible' });
}
async function appearance() {
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
}
async function close(method = 'button') {
	if (method === 'escape') await page.keyboard.press('Escape');
	else if (method === 'outside') await page.mouse.click(15, 15);
	else await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function select(id, name) {
	await page.locator(`#${id}`).click();
	await page.getByRole('option', { name, exact: true }).click();
}
async function preview() {
	await page.locator('#uiScale').fill('110');
	await select('fontFamily', 'Merriweather');
	await select('fontVariant', 'Bold — 700');
	await page.getByRole('button', { name: 'Frosted Glass 05', exact: true }).click();
	await page.locator('#frostedGlassMilkiness').fill('17');
	await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '110');
	assert.equal(await page.locator('html').getAttribute('data-llampart-font'), 'merriweather');
	assert.equal(
		await page
			.locator('html')
			.evaluate((el) => el.style.getPropertyValue('--llampart-font-weight')),
		'700'
	);
	assert.equal(
		await page
			.locator('html')
			.evaluate((el) => el.style.getPropertyValue('--llampart-theme-wallpaper').includes('05.jpg')),
		true
	);
	assert.equal(
		await page.locator('html').evaluate((el) => el.classList.contains('has-frosted-glass-opaque')),
		true
	);
}
async function save() {
	await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
}
async function screenshot(name) {
	if (artifacts) await page.screenshot({ path: `${artifacts}/${name}.png` });
}

try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40133');
	await page.waitForSelector('textarea');
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '100');
	const before = await persisted();

	// A/B: actual field handlers + layout runtime, all supported dialog cancellation paths.
	for (const method of ['button', 'escape', 'outside']) {
		await open();
		await appearance();
		await preview();
		assert.equal(await persisted(), before);
		await screenshot(`preview-${method}`);
		await close(method);
		await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '100');
		assert.equal(await page.locator('html').getAttribute('data-llampart-font'), null);
		assert.equal(
			await page
				.locator('html')
				.evaluate((el) => el.classList.contains('has-frosted-glass-opaque')),
			false
		);
		assert.equal(
			await page
				.locator('html')
				.evaluate((el) =>
					el.style.getPropertyValue('--llampart-theme-wallpaper').includes('02.jpg')
				),
			true
		);
		assert.equal(await persisted(), before);
		await open();
		await appearance();
		assert.equal(await page.locator('#uiScale').inputValue(), '100');
		assert.equal(
			await page
				.locator('#fontFamily')
				.textContent()
				.then((v) => v.trim()),
			'Domyślna'
		);
		await close();
	}
	console.log('PASS A/B: preview + close button/Escape/outside + reopen, storage unchanged');

	// D: failure keeps the form and preview; closing rolls it back without partial persistence.
	await open();
	await appearance();
	await preview();
	await dialog.getByRole('button', { name: 'Ogólne', exact: true }).click();
	await page.locator('#vllmBaseUrl').fill('http://invalid.example:9999');
	validationMode = 'failure';
	await save();
	await page.getByRole('alertdialog').waitFor();
	assert.equal(await persisted(), before);
	assert.equal(await scale(), '110');
	await page.getByRole('alertdialog').getByRole('button', { name: 'Zamknij', exact: true }).click();
	assert.equal(await page.locator('#vllmBaseUrl').inputValue(), 'http://invalid.example:9999');
	await close();
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '100');
	console.log('PASS D: failed connection validation, editable draft, rollback on close');

	// F: validation resolves only after the old dialog has closed and another session opened.
	validationMode = 'hold';
	await open();
	await appearance();
	await preview();
	const validationRequest = page.waitForRequest(
		(request) => request.url().includes('/__llampart/api/') && request.url().endsWith('/models')
	);
	await save();
	await validationRequest;
	assert(heldRoutes.length > 0, 'connection validation must be in flight');
	await close('escape');
	await open();
	await appearance();
	validationMode = 'success';
	for (const route of heldRoutes) await route.fulfill({ json: models });
	heldRoutes = [];
	// Allow the fulfilled request and async continuation to run before asserting no commit.
	await page.waitForTimeout(200);
	assert.equal(await persisted(), before);
	assert.equal(await scale(), '100');
	assert(await dialog.isVisible());
	await close();
	console.log('PASS F: late validation cannot commit or close a newer settings session');

	// Editing the form or confirming Reset while validation is pending also invalidates it.
	for (const action of ['edit', 'reset']) {
		validationMode = 'hold';
		await open();
		await appearance();
		await preview();
		const request = page.waitForRequest(
			(r) => r.url().includes('/__llampart/api/') && r.url().endsWith('/models')
		);
		await save();
		await request;
		if (action === 'edit') await page.locator('#uiScale').fill('105');
		else {
			await dialog.getByRole('button', { name: 'Resetuj', exact: true }).click();
			await page.getByRole('button', { name: 'Przywróć domyślne', exact: true }).click();
		}
		const savedBeforeResult = await persisted();
		validationMode = 'success';
		for (const route of heldRoutes) await route.fulfill({ json: models });
		heldRoutes = [];
		await page.waitForTimeout(200);
		assert.equal(await persisted(), savedBeforeResult);
		assert.equal(await scale(), action === 'edit' ? '105' : '100');
		assert(await dialog.isVisible());
		await close();
	}
	console.log('PASS additional races: edit/reset during pending connection validation');

	// E: the real confirmation footer resets committed settings and discards the old overlay.
	await open();
	await appearance();
	await preview();
	await dialog.getByRole('button', { name: 'Resetuj', exact: true }).click();
	await page.getByRole('button', { name: 'Przywróć domyślne', exact: true }).click();
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '100');
	assert.equal(await page.locator('#uiScale').inputValue(), '100');
	await close();
	assert.equal(await scale(), '100');
	console.log('PASS E: confirmed reset clears the previous preview');

	// C: real Save validates and commits the complete form; values survive a fresh app load.
	await open();
	await appearance();
	await preview();
	await save();
	await dialog.waitFor({ state: 'hidden' });
	const committed = JSON.parse(await persisted());
	assert.equal(committed.uiScale, '110');
	assert.equal(committed.fontFamily, 'merriweather');
	assert.equal(committed.fontVariant, '700');
	assert.equal(committed.frostedGlassMilkiness, 17);
	assert.equal(committed.frostedGlassOpaque, true);
	await page.reload();
	await page.waitForSelector('textarea');
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '110');
	assert.equal(await page.locator('html').getAttribute('data-llampart-font'), 'merriweather');
	await open();
	await appearance();
	assert.equal(await page.locator('#uiScale').inputValue(), '110');
	await select('fontFamily', 'DM Serif Display');
	assert.match(await page.locator('#fontVariant').textContent(), /400/);
	await save();
	await dialog.waitFor({ state: 'hidden' });
	assert.equal(JSON.parse(await persisted()).fontVariant, '400');
	assert.equal(
		await page
			.locator('html')
			.evaluate((el) => el.style.getPropertyValue('--llampart-font-weight')),
		'400'
	);
	await screenshot('committed');
	console.log('PASS C: whole-form commit, reload and family-only font normalization');

	// Custom image bytes are part of the same preview transaction, not written on upload.
	await open();
	await appearance();
	const image = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
		'base64'
	);
	await dialog
		.locator('input[type=file]')
		.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: image });
	await page.waitForFunction(() =>
		document.documentElement.style
			.getPropertyValue('--llampart-theme-wallpaper')
			.includes('data:image/png')
	);
	assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), null);
	await close();
	assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), null);
	await open();
	await appearance();
	await dialog
		.locator('input[type=file]')
		.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: image });
	await page.waitForFunction(() =>
		document.documentElement.style
			.getPropertyValue('--llampart-theme-wallpaper')
			.includes('data:image/png')
	);
	await save();
	await dialog.waitFor({ state: 'hidden' });
	assert.match(
		await page.evaluate((key) => localStorage.getItem(key), wallpaperKey),
		/^data:image\/png;base64,/
	);
	assert.deepEqual(errors, []);
	console.log('PASS custom wallpaper: upload preview, cancellation and commit; no page errors');
} finally {
	await browser.close();
}
