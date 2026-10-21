/** AUD-001: real file import in a disposable Chromium context. Provider traffic
 * is mocked; no existing profiles, installations or user data are accessed.
 * Set LLAMPART_PLAYWRIGHT_MODULE and LLAMPART_TEST_URL (a development server).
 * Optional LLAMPART_CHROMIUM and LLAMPART_TEST_ARTIFACTS, outside the repo. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40135';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const errors = [];
const results = [];
page.on('pageerror', (error) => errors.push(error.message));
await context.route('**/*', (route) => {
	const url = new URL(route.request().url());
	if (url.origin !== new URL(base).origin) return route.abort();
	if (
		url.pathname.includes('/__llampart/api/') ||
		/^\/(props|models|tools|v1\/)/.test(url.pathname)
	)
		return route.fulfill({
			json: url.pathname.endsWith('/models')
				? { object: 'list', data: [{ id: 'synthetic/model' }] }
				: {}
		});
	return route.continue();
});
await context.addInitScript(() => {
	if (localStorage.getItem('aud-001-seeded')) return;
	localStorage.setItem('aud-001-seeded', '1');
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
	localStorage.setItem('llama-webui-migration-v2-done', '1');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'vllm',
			vllmBaseUrl: 'http://synthetic.invalid',
			vllmApiKey: 'synthetic-secret',
			alwaysShowSidebarOnDesktop: true,
			fontSize: '13',
			temperature: 0.5,
			agenticMaxTurns: 19,
			mcpServers: '[{"id":"kept","url":"http://mcp.invalid/mcp","enabled":false}]'
		})
	);
	localStorage.setItem(
		'LlamaCppWebui.userOverrides',
		'["temperature","mcpServers","agenticMaxTurns"]'
	);
	localStorage.setItem('LlamaCppWebui.alwaysAllowedTools', '["synthetic/tool"]');
});
const settingsDialog = page.locator('.llampart-chat-settings-dialog-content');
const reloadDialog = page.getByRole('alertdialog').filter({ hasText: 'Reload the app now' });
const success = page
	.locator('[data-sonner-toast][data-type="success"]')
	.filter({ hasText: 'Settings imported' });
const storageError = page.locator('[data-sonner-toast][data-type="error"]');
async function openSettings() {
	const button = page.locator('button[aria-label="Settings"]');
	await button.click();
	await settingsDialog.waitFor();
}
async function selectData() {
	await settingsDialog.getByRole('button', { name: 'Data', exact: true }).click();
}
async function importFile(text) {
	const chooser = page.waitForEvent('filechooser');
	await settingsDialog.getByRole('button', { name: 'Import settings', exact: true }).click();
	await (
		await chooser
	).setFiles({
		name: 'synthetic-settings.json',
		mimeType: 'application/json',
		buffer: Buffer.from(text)
	});
}
function file(fontSize = '18', temperature = 0.9) {
	return JSON.stringify({
		type: 'llampart-settings-export',
		formatVersion: 1,
		app: 'llampart',
		settings: { fontSize, temperature, mcpServers: '[]', vllmApiKey: 'ignored' },
		userOverrides: ['temperature', 'theme']
	});
}
async function snapshot() {
	return page.evaluate(async () => {
		const { settingsStore: settings } = await import('/src/lib/stores/settings.svelte.ts');
		return {
			config: { ...settings.config },
			overrides: [...settings.userOverrides].sort(),
			rawConfig: localStorage.getItem('LlamaCppWebui.config'),
			rawOverrides: localStorage.getItem('LlamaCppWebui.userOverrides'),
			tools: localStorage.getItem('LlamaCppWebui.alwaysAllowedTools')
		};
	});
}
async function fault(mode) {
	await page.evaluate((mode) => {
		const original = Storage.prototype.setItem;
		const configKey = 'LlamaCppWebui.config';
		const overridesKey = 'LlamaCppWebui.userOverrides';
		const old = localStorage.getItem(configKey);
		globalThis.restoreImportStorage = () => {
			Storage.prototype.setItem = original;
		};
		Storage.prototype.setItem = function (key, value) {
			if (
				(mode === 'first' && key === configKey) ||
				(key === overridesKey && mode !== 'first') ||
				(mode === 'rollback' && key === configKey && value === old)
			)
				throw new DOMException('AUD-001 synthetic quota', 'QuotaExceededError');
			return original.call(this, key, value);
		};
	}, mode);
}
async function restoreStorage() {
	await page.evaluate(() => globalThis.restoreImportStorage());
}
async function cancelReload() {
	await reloadDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await reloadDialog.waitFor({ state: 'hidden' });
	await success.waitFor({ state: 'hidden' });
}
try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	await openSettings();
	await settingsDialog.getByRole('button', { name: 'Appearance', exact: true }).click();
	await page.locator('#fontSize').click();
	await page.getByRole('option', { name: '20 px', exact: true }).click();
	// An immediate MCP change after opening Settings must not be restored by Save.
	await page.evaluate(async () => {
		const { mcpStore } = await import('/src/lib/stores/mcp.svelte.ts');
		mcpStore.updateServer('kept', { url: 'http://edited.invalid/mcp' });
	});
	await selectData();
	for (const text of ['{broken', file('99')]) {
		const before = await snapshot();
		const alert = page.waitForEvent('dialog');
		await importFile(text);
		const warning = await alert;
		assert.match(warning.message(), /check the file format/);
		await warning.dismiss();
		assert.deepEqual(await snapshot(), before);
		assert.equal(await success.count(), 0);
		assert.equal(await reloadDialog.count(), 0);
	}
	results.push('PASS: malformed JSON and invalid known value, no writes/success/reload');
	for (const [index, mode] of ['first', 'second', 'rollback'].entries()) {
		const before = await snapshot();
		const text = file(index % 2 ? '16' : '18', index % 2 ? 0.7 : 0.9);
		await fault(mode);
		await importFile(text);
		const warning = storageError.filter({
			hasText:
				mode === 'rollback'
					? 'previous stored settings could not be fully restored'
					: 'Settings could not be saved to browser storage'
		});
		await warning.waitFor();
		const after = await snapshot();
		assert.deepEqual(after.config, before.config);
		assert.deepEqual(after.overrides, before.overrides);
		assert.equal(after.rawOverrides, before.rawOverrides);
		if (mode === 'rollback') assert.notEqual(after.rawConfig, before.rawConfig);
		else assert.equal(after.rawConfig, before.rawConfig);
		assert.equal(await success.count(), 0);
		assert.equal(await reloadDialog.count(), 0);
		await restoreStorage();
		await warning.waitFor({ state: 'hidden' });
		await importFile(text);
		await success.waitFor();
		await reloadDialog.waitFor();
		assert.match(await reloadDialog.innerText(), /older set of settings/i);
		const imported = await snapshot();
		assert.equal(imported.config.fontSize, index % 2 ? '16' : '18');
		assert.equal(imported.config.mcpServers, before.config.mcpServers);
		assert.equal(imported.config.vllmApiKey, 'synthetic-secret');
		assert.equal(imported.tools, before.tools);
		assert.deepEqual(imported.overrides, ['agenticMaxTurns', 'mcpServers', 'temperature', 'theme']);
		await cancelReload();
		assert.deepEqual(await snapshot(), imported);
		results.push(
			`PASS: ${mode} write failure, explicit error, no false success/reload, retry and cancel reload`
		);
	}
	const imported = await snapshot();
	await settingsDialog.getByRole('button', { name: 'Save settings', exact: true }).click();
	const conflict = page.getByRole('alertdialog').filter({ hasText: 'changed outside this form' });
	await conflict.waitFor();
	assert.deepEqual(await snapshot(), imported);
	await conflict.getByRole('button', { name: 'Close', exact: true }).click();
	await page.keyboard.press('Escape');
	await settingsDialog.waitFor({ state: 'hidden' });
	assert.deepEqual(await snapshot(), imported);
	// An untouched snapshot plus an independent draft edit can still be saved.
	await openSettings();
	await settingsDialog.getByRole('button', { name: 'Appearance', exact: true }).click();
	await page.locator('#uiScale').focus();
	await page.locator('#uiScale').press('ArrowRight');
	await selectData();
	await importFile(file('16', 0.6));
	await success.waitFor();
	await cancelReload();
	await settingsDialog.getByRole('button', { name: 'Save settings', exact: true }).click();
	await settingsDialog.waitFor({ state: 'hidden' });
	const saved = await snapshot();
	assert.equal(saved.config.fontSize, '16');
	assert.equal(saved.config.uiScale, '105');
	assert.equal(saved.config.mcpServers, imported.config.mcpServers);
	await page.reload();
	await page.waitForSelector('textarea');
	assert.deepEqual(await snapshot(), saved);
	await openSettings();
	await selectData();
	await importFile(file('18', 0.9));
	await success.waitFor();
	await reloadDialog.waitFor();
	const beforeReload = await snapshot();
	await reloadDialog.getByRole('button', { name: 'Reload now', exact: true }).click();
	await settingsDialog.waitFor({ state: 'hidden' });
	await page.waitForSelector('textarea');
	assert.deepEqual(await snapshot(), beforeReload);
	assert.deepEqual(errors, []);
	results.push(
		'PASS: conflicting Save blocked; Cancel, independent Save, reinitialize and confirmed reload preserve import and MCP; no pageerror'
	);
	console.log(results.join('\n'));
	if (artifacts)
		await writeFile(
			`${artifacts}/browser-results.json`,
			JSON.stringify({ results, errors }, null, 2)
		);
} catch (error) {
	if (artifacts) await page.screenshot({ path: `${artifacts}/failure.png` });
	throw error;
} finally {
	await context.close();
	await browser.close();
}
