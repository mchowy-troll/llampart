/** Desktop Settings regression; mocked HTTP, isolated storage, no real conversations.
 * Supply LLAMPART_PLAYWRIGHT_MODULE and optionally LLAMPART_TEST_URL / LLAMPART_TEST_ARTIFACTS.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const key = 'LlamaCppWebui.config';
await page.addInitScript(() => {
	if (!localStorage.getItem('LlamaCppWebui.config'))
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				theme: 'frosted-glass',
				interfaceLanguage: 'en',
				apiProvider: 'vllm',
				vllmBaseUrl: 'http://mock.invalid:8000',
				alwaysShowSidebarOnDesktop: true,
				fontFamily: 'merriweather',
				fontVariant: '600',
				fontSize: '16',
				frostedGlassWallpaper: 'frosted-glass-02'
			})
		);
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
});
await page.route('**/__llampart/api/**', (route) =>
	route.fulfill({
		json: route.request().url().endsWith('/models')
			? { object: 'list', data: [{ id: 'synthetic/model' }] }
			: {}
	})
);
const dialog = page.locator('.llampart-chat-settings-dialog-content');
const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
async function open() {
	await page.locator('button[aria-label="Settings"]').click();
	await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
}
async function close(save = false) {
	await dialog.getByRole('button', { name: save ? 'Save settings' : 'Close', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function order(wallpaper = true) {
	const headings = await dialog.locator('section h4, section h3').allTextContents();
	assert.deepEqual(
		headings.slice(0, wallpaper ? 4 : 3).map((text) => text.trim()),
		wallpaper
			? ['Interface', 'Wallpaper', 'Typography', 'Sidebar']
			: ['Interface', 'Typography', 'Sidebar']
	);
	assert.equal(headings.filter((text) => text.trim() === 'Wallpaper').length, Number(wallpaper));
}
try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40135');
	await page.locator('textarea').first().waitFor();
	await open();
	await order();
	const before = await stored();
	await page.getByRole('button', { name: 'Frosted Glass 05', exact: true }).click();
	await close();
	assert.deepEqual(await stored(), before, 'Cancel must not write settings');
	await open();
	await order();
	await page.getByRole('button', { name: 'Frosted Glass 05', exact: true }).click();
	await close(true);
	const saved = await stored();
	assert.equal(saved.frostedGlassWallpaper, 'frosted-glass-05');
	for (const field of ['fontFamily', 'fontVariant', 'fontSize'])
		assert.equal(saved[field], before[field]);
	await open();
	await order();
	await page.locator('#theme').click();
	assert.deepEqual(
		(await page.getByRole('option').allTextContents()).map((s) => s.trim()),
		['Frosted Glass']
	);
	await page.keyboard.press('Escape');
	console.log('Only Frosted Glass is registered; no second theme available for a switch test.');
	await order();
	if (process.env.LLAMPART_TEST_ARTIFACTS) {
		await mkdir(process.env.LLAMPART_TEST_ARTIFACTS, { recursive: true });
		await page.screenshot({
			path: `${process.env.LLAMPART_TEST_ARTIFACTS}/UX-02-appearance.png`,
			animations: 'disabled'
		});
	}
	await close();
	assert.deepEqual(await stored(), saved);
	await page.reload();
	await open();
	await order();
	assert.deepEqual(await stored(), saved);
	assert.deepEqual(errors, []);
	console.log(
		'PASS Interface → Wallpaper → Typography → Sidebar; themes, Save/Cancel, reopen, typography storage'
	);
} finally {
	await browser.close();
}
