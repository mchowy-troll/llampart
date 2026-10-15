/**
 * Regression: successful llama-server /props initialization must not create an
 * effect-update loop that leaves the welcome dialog visible but unresponsive.
 * Run against npm run dev or the production preview. HTTP backend is mocked.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/welcome-dialog.mjs
 * Optional: LLAMPART_CHROMIUM, LLAMPART_TEST_ARTIFACTS (outside the repository).
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
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dismissalKey = 'Llampart.aboutDismissedVersion';
let propsRequests = 0;
await page.addInitScript(() => {
	if (!localStorage.getItem('LlamaCppWebui.config')) {
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				interfaceLanguage: 'pl',
				apiProvider: 'llama-server',
				llamaServerBaseUrl: 'http://mock.invalid:8000',
				serverBaseUrl: 'http://mock.invalid:8000',
				fontFamily: 'merriweather',
				fontVariant: '400',
				uiScale: '100',
				alwaysShowSidebarOnDesktop: true
			})
		);
	}
});
const mockBackend = async (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.endsWith('/props')) {
		propsRequests++;
		return route.fulfill({
			json: {
				build_info: 'welcome-regression-test',
				default_generation_settings: { params: { temperature: 0.8, top_p: 0.95 } },
				model_path: 'test.gguf',
				modalities: { vision: false, audio: false }
			}
		});
	}
	return route.fulfill({
		json: url.pathname.endsWith('/models') ? { object: 'list', data: [{ id: 'test.gguf' }] } : {}
	});
};
await page.route('**/__llampart/api/**', mockBackend);

const welcome = page.locator('.llampart-about-dialog-content');
const checkbox = page.locator('#about-llampart-do-not-show-again');
const ok = welcome.getByRole('button', { name: 'OK', exact: true });
async function load(reload = false) {
	const propsLoaded = page.waitForResponse(
		(response) =>
			response.url().includes('/__llampart/api/') &&
			new URL(response.url()).pathname.endsWith('/props')
	);
	if (reload) await page.reload();
	else await page.goto(process.env.LLAMPART_TEST_URL || 'http://localhost:5173');
	await propsLoaded;
	await welcome.waitFor({ state: 'visible' });
	// Let /props update the real server store and run the layout synchronization effect.
	await page.waitForTimeout(200);
	assert.deepEqual(errors, [], 'Server-default synchronization must settle without runtime errors');
}

try {
	await load();
	const hit = await ok.evaluate((button) => {
		const rect = button.getBoundingClientRect();
		const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
		return button === target || button.contains(target);
	});
	assert.equal(hit, true, 'No layer may intercept OK');
	await checkbox.click();
	assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
	await checkbox.click();
	assert.equal(await checkbox.getAttribute('aria-checked'), 'false');
	await ok.click();
	await welcome.waitFor({ state: 'hidden' });
	assert.equal(await page.evaluate((key) => localStorage.getItem(key), dismissalKey), null);
	console.log('PASS: llama-server props initialization, checkbox and native pointer click on OK');

	const settings = page.locator('.llampart-chat-settings-dialog-content');
	for (const save of [false, true]) {
		await page.locator('button[aria-label="Ustawienia"]').click();
		await settings.getByRole('button', { name: 'Wygląd', exact: true }).click();
		await page.locator('#uiScale').fill('105');
		await settings
			.getByRole('button', { name: save ? 'Zapisz ustawienia' : 'Zamknij', exact: true })
			.click();
		await settings.waitFor({ state: 'hidden' });
		assert.equal(await page.evaluate((key) => localStorage.getItem(key), dismissalKey), null);
	}
	console.log('PASS: appearance rollback and commit do not set the Welcome dismissal flag');

	await load(true);
	await ok.focus();
	await page.keyboard.press('Enter');
	await welcome.waitFor({ state: 'hidden' });
	assert.equal(await page.evaluate((key) => localStorage.getItem(key), dismissalKey), null);
	console.log('PASS: keyboard activation; unchecked dismissal remains session-only');

	await load(true);
	await checkbox.focus();
	await page.keyboard.press('Space');
	assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
	await ok.click();
	await welcome.waitFor({ state: 'hidden' });
	assert.equal(await page.evaluate((key) => localStorage.getItem(key), dismissalKey), '1.9.0');
	await page.reload();
	await page.waitForSelector('textarea');
	assert.equal(await welcome.count(), 0);
	assert(propsRequests > 0);
	assert.deepEqual(errors, []);
	console.log('PASS: remembered dismissal survives reload; no effect-update errors');

	// Each initial persistence state must be checked in a separate browser context.
	for (const savedVersion of ['1.9.0', '1.8.0', 'historical-value']) {
		const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
		try {
			const isolatedPage = await context.newPage();
			isolatedPage.on('pageerror', (error) => errors.push(error.message));
			await isolatedPage.addInitScript(
				({ key, value }) => {
					if (!sessionStorage.getItem('welcome-test-initialized')) {
						localStorage.setItem(key, value);
						sessionStorage.setItem('welcome-test-initialized', 'true');
					}
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							interfaceLanguage: 'pl',
							apiProvider: 'llama-server',
							llamaServerBaseUrl: 'http://mock.invalid:8000',
							serverBaseUrl: 'http://mock.invalid:8000'
						})
					);
				},
				{ key: dismissalKey, value: savedVersion }
			);
			await isolatedPage.route('**/__llampart/api/**', mockBackend);
			await isolatedPage.goto(process.env.LLAMPART_TEST_URL || 'http://localhost:5173');
			await isolatedPage.waitForSelector('textarea');
			const isolatedWelcome = isolatedPage.locator('.llampart-about-dialog-content');
			if (savedVersion === '1.9.0') {
				await isolatedPage.waitForTimeout(200);
				assert.equal(await isolatedWelcome.count(), 0);
				await isolatedPage.reload();
				await isolatedPage.waitForSelector('textarea');
				assert.equal(await isolatedWelcome.count(), 0);
			} else {
				await isolatedWelcome.waitFor({ state: 'visible' });
				await isolatedWelcome.getByRole('button', { name: 'OK', exact: true }).click();
				await isolatedWelcome.waitFor({ state: 'hidden' });
				assert.equal(
					await isolatedPage.evaluate((key) => localStorage.getItem(key), dismissalKey),
					savedVersion
				);
				await isolatedPage.reload();
				await isolatedWelcome.waitFor({ state: 'visible' });
				await isolatedPage.locator('#about-llampart-do-not-show-again').click();
				await isolatedWelcome.getByRole('button', { name: 'OK', exact: true }).click();
				await isolatedWelcome.waitFor({ state: 'hidden' });
				assert.equal(
					await isolatedPage.evaluate((key) => localStorage.getItem(key), dismissalKey),
					'1.9.0'
				);
				await isolatedPage.reload();
				await isolatedPage.waitForSelector('textarea');
				assert.equal(await isolatedWelcome.count(), 0);
			}
			console.log(`PASS isolated Welcome state: ${savedVersion}, dismissal and reload`);
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(errors, []);
} catch (error) {
	if (process.env.LLAMPART_TEST_ARTIFACTS) {
		await mkdir(process.env.LLAMPART_TEST_ARTIFACTS, { recursive: true });
		await page.screenshot({ path: `${process.env.LLAMPART_TEST_ARTIFACTS}/welcome-failure.png` });
	}
	throw error;
} finally {
	await browser.close();
}
