/** Isolated 1920x1080 smoke for Settings persistence, typography and format buttons.
 * Supply LLAMPART_PLAYWRIGHT_MODULE, LLAMPART_TEST_URL and LLAMPART_TEST_ARTIFACTS.
 * Provider HTTP is mocked; no existing browser profile or user data is accessed. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
	await welcome.locator('#about-llampart-do-not-show-again').check();
	await welcome.getByRole('button', { name: 'OK', exact: true }).click();
});
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40134';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-three-smoke';
await mkdir(artifacts, { recursive: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await context.route('**/*', (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.endsWith('/models'))
		return route.fulfill({ json: { object: 'list', data: [{ id: 'synthetic/model' }] } });
	if (url.pathname.includes('/__llampart/api/'))
		return route.fulfill({
			json: url.pathname.endsWith('/models') ? { data: [{ id: 'synthetic/model' }] } : {}
		});
	return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
});
const key = 'LlamaCppWebui.config';
const dialog = page.locator('.llampart-chat-settings-dialog-content');
async function openSettings() {
	if (
		await page
			.locator('button[aria-label="Settings"]')
			.waitFor({ state: 'visible', timeout: 3000 })
			.then(
				() => true,
				() => false
			)
	)
		await page.locator('button[aria-label="Settings"]').click();
	else await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
	await dialog.waitFor();
}
async function screenshot(name) {
	await page.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled' });
}
async function failOverridesWrite() {
	await page.evaluate(() => {
		const original = Storage.prototype.setItem;
		globalThis.restoreSettingsStorage = () => {
			Storage.prototype.setItem = original;
		};
		Storage.prototype.setItem = function (key, value) {
			if (key === 'LlamaCppWebui.userOverrides')
				throw new DOMException('synthetic quota', 'QuotaExceededError');
			return original.call(this, key, value);
		};
	});
}
async function restoreStorage() {
	await page.evaluate(() => globalThis.restoreSettingsStorage());
}
try {
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.keyboard.press('Escape');
	await page.waitForFunction(
		() =>
			document.documentElement.dataset.llampartFont === 'merriweather' &&
			getComputedStyle(document.body).fontSize === '13px'
	);
	await openSettings();
	await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
	assert.match(await page.locator('#fontFamily').innerText(), /Merriweather/);
	assert.match(await page.locator('#fontVariant').innerText(), /Regular — 400/);
	assert.match(await page.locator('#fontSize').innerText(), /13 px/);
	await screenshot('defaults-1920');
	await page.keyboard.press('Escape');
	await dialog.waitFor({ state: 'hidden' });
	const id = await page.evaluate(async () => {
		const { db } = await import('/tests/browser/charts-harness.ts');
		const conv = await db.createConversation('Synthetic Settings fixture');
		const root = await db.createRootMessage(conv.id);
		const content = [
			'| A | B |',
			'|---|---|',
			'| 1 | 2 |',
			'',
			'```llampart-chart',
			JSON.stringify({
				type: 'bar',
				title: 'Export chart',
				xKey: 'x',
				series: [{ key: 'y', label: 'Value' }],
				data: [{ x: 'A', y: 12 }]
			}),
			'```',
			'',
			'```mermaid',
			'flowchart LR\nA[Input] --> B[Output]',
			'```',
			'',
			'```js',
			'const value = 42;',
			'```'
		].join('\n');
		await db.createMessageBranch(
			{
				convId: conv.id,
				type: 'text',
				role: 'assistant',
				timestamp: Date.now(),
				content,
				children: [],
				parent: root,
				model: 'synthetic/model'
			},
			root
		);
		return conv.id;
	});
	await page.goto(`${base}/#/chat/${id}`);
	await page.locator('.chart-plot svg').first().waitFor({ timeout: 60000 });
	await page.locator('.diagram-surface svg').first().waitFor({ timeout: 60000 });
	const selectors = [
		'.table-csv-button',
		'.chart-actions button:first-child',
		'.diagram-actions button:first-child',
		'.download-code-btn'
	];
	const metrics = {};
	for (const selector of selectors) {
		const button = page.locator(selector).first();
		await button.scrollIntoViewIfNeeded();
		const measure = () =>
			button.evaluate((el) => {
				const s = getComputedStyle(el);
				return Object.fromEntries(
					[
						'backgroundColor',
						'borderColor',
						'borderWidth',
						'color',
						'opacity',
						'width',
						'height',
						'padding',
						'borderRadius',
						'fontFamily',
						'fontSize'
					].map((k) => [k, s[k]])
				);
			});
		await page.mouse.move(0, 0);
		metrics[selector] = { normal: await measure() };
		await button.hover();
		await page.waitForTimeout(250);
		metrics[selector].hover = await measure();
	}
	const stage = process.argv.includes('--baseline') ? 'before' : 'after';
	await writeFile(`${artifacts}/${stage}-metrics.json`, JSON.stringify(metrics, null, 2));
	await page
		.locator('.llampart-assistant-markdown')
		.first()
		.screenshot({ path: `${artifacts}/${stage}-formats.png`, animations: 'disabled' });
	if (stage === 'after') {
		// Hover comparison at identical geometry. The reference uses the original
		// measured 10% fill, only in this disposable page (not in product CSS).
		const exportButton = page.locator('.chart-actions button:first-child');
		await exportButton.hover();
		await page.waitForTimeout(250);
		await page.locator('.chart-header').screenshot({ path: `${artifacts}/hover-after.png` });
		await exportButton.evaluate((el) => {
			el.style.backgroundColor = 'color-mix(in oklab, var(--muted-foreground) 10%, transparent)';
		});
		await page.waitForTimeout(250);
		await page
			.locator('.chart-header')
			.screenshot({ path: `${artifacts}/hover-reference-before.png` });
		await exportButton.evaluate((el) => el.style.removeProperty('background-color'));
		for (const value of Object.values(metrics)) {
			assert.match(value.hover.backgroundColor, /\/ 0\.03\)/);
			assert.equal(value.normal.borderWidth, '0px');
			assert.equal(value.normal.opacity, '1');
		}
		// Optional real before/after geometry/text comparison, not reconstructed CSS.
		const before = await readFile(`${artifacts}/before-metrics.json`, 'utf8')
			.then(JSON.parse)
			.catch(() => null);
		if (before)
			for (const selector of selectors)
				for (const state of ['normal', 'hover'])
					for (const property of [
						'width',
						'height',
						'padding',
						'borderRadius',
						'color',
						'opacity',
						'fontFamily',
						'fontSize'
					])
						assert.equal(
							metrics[selector][state][property],
							before[selector][state][property],
							`${selector} ${state} ${property}`
						);
		const eyeStyle = (selector) =>
			page
				.locator(selector)
				.first()
				.evaluate((el) => {
					const css = getComputedStyle(el),
						svg = getComputedStyle(el.querySelector('svg'));
					return [
						css.width,
						css.height,
						css.padding,
						css.borderWidth,
						css.backgroundColor,
						svg.width,
						svg.height
					];
				});
		const tableEye = await eyeStyle('.table-preview-button');
		for (const selector of [
			'.chart-actions .visualization-preview-action',
			'.diagram-actions .visualization-preview-action'
		]) {
			assert.deepEqual(await eyeStyle(selector), tableEye);
			await page.locator(selector).click();
			await page.getByRole('dialog').waitFor();
			await page.keyboard.press('Escape');
		}
		// Set up only this test context's synthetic connection; do not contact a model.
		await page.evaluate(async () =>
			(await import('/tests/browser/charts-harness.ts')).settings.updateMultipleConfig({
				apiProvider: 'vllm',
				vllmBaseUrl: 'http://mock.invalid',
				alwaysShowSidebarOnDesktop: true
			})
		);
		await openSettings();
		await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
		await page.locator('#fontFamily').click();
		await page.getByRole('option', { name: 'Fira Sans', exact: true }).click();
		await page.locator('#fontSize').click();
		await page.getByRole('option', { name: '18 px', exact: true }).click();
		const snapshot = () =>
			page.evaluate(async (key) => {
				const { settings } = await import('/tests/browser/charts-harness.ts');
				return {
					config: { ...settings.config },
					overrides: [...settings.userOverrides],
					raw: localStorage.getItem(key),
					rawOverrides: localStorage.getItem('LlamaCppWebui.userOverrides')
				};
			}, key);
		const unchanged = await snapshot();
		await failOverridesWrite();
		await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
		const warning = page.getByRole('alertdialog');
		await warning.getByText(/Settings could not be saved to browser storage/).waitFor();
		assert.deepEqual(await snapshot(), unchanged);
		assert(await dialog.isVisible());
		assert.match(await page.locator('#fontFamily').innerText(), /Fira Sans/);
		await screenshot('storage-error-1920');
		await warning.getByRole('button', { name: 'Close', exact: true }).click();
		await restoreStorage();
		await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		assert.equal((await snapshot()).config.fontFamily, 'fira-sans');
		assert.equal(JSON.parse((await snapshot()).raw).fontSize, '18');
		await page.reload();
		await page.waitForFunction(
			() =>
				document.documentElement.dataset.llampartFont === 'fira-sans' &&
				getComputedStyle(document.body).fontSize === '18px'
		);
		await openSettings();
		await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
		assert.match(await page.locator('#fontFamily').innerText(), /Fira Sans/);
		assert.match(await page.locator('#fontSize').innerText(), /18 px/);
		await screenshot('saved-preferences-1920');
		console.log(
			'PASS: storage second-write failure preserves memory, disk and draft; Save retry, reopen and reload preserve explicit Fira Sans 18px preferences'
		);
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		await dialog.getByRole('button', { name: 'Add New Server', exact: true }).click();
		await page.locator('#server-url-new-server').fill('http://mcp-smoke.invalid/mcp');
		const beforeAdd = await snapshot();
		await failOverridesWrite();
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		await dialog.getByRole('alert').filter({ hasText: 'Settings could not be saved' }).waitFor();
		assert.deepEqual(await snapshot(), beforeAdd);
		assert.equal(
			await page.locator('#server-url-new-server').inputValue(),
			'http://mcp-smoke.invalid/mcp'
		);
		await restoreStorage();
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		await dialog.getByRole('button', { name: 'Edit server', exact: true }).waitFor();
		const server = JSON.parse((await snapshot()).config.mcpServers)[0];
		await dialog.getByRole('button', { name: 'Edit server', exact: true }).click();
		const urlField = page.locator(`[id="server-url-${server.id}"]`);
		await urlField.fill('http://mcp-smoke.invalid/edited');
		const beforeEdit = await snapshot();
		await failOverridesWrite();
		await dialog.getByRole('button', { name: 'Update', exact: true }).click();
		await dialog.getByRole('alert').filter({ hasText: 'Settings could not be saved' }).waitFor();
		assert.deepEqual(await snapshot(), beforeEdit);
		assert.equal(await urlField.inputValue(), 'http://mcp-smoke.invalid/edited');
		await restoreStorage();
		await dialog.getByRole('button', { name: 'Update', exact: true }).click();
		await dialog.getByRole('button', { name: 'Delete server', exact: true }).click();
		const deletion = page.getByRole('alertdialog');
		const beforeDelete = await snapshot();
		await failOverridesWrite();
		await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
		await deletion.getByRole('alert').filter({ hasText: 'Settings could not be saved' }).waitFor();
		assert.deepEqual(await snapshot(), beforeDelete);
		assert(await deletion.isVisible());
		await screenshot('mcp-delete-storage-error-1920');
		await restoreStorage();
		await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
		await deletion.waitFor({ state: 'hidden' });
		assert.deepEqual(JSON.parse((await snapshot()).config.mcpServers), []);
		await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		await page.reload();
		await openSettings();
		assert.deepEqual(JSON.parse((await snapshot()).config.mcpServers), []);
		await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
		const reset = page.getByRole('alertdialog');
		const beforeReset = await snapshot();
		await failOverridesWrite();
		await reset.getByRole('button', { name: 'Reset to Default', exact: true }).click();
		await reset.getByRole('alert').filter({ hasText: 'Settings could not be saved' }).waitFor();
		assert.deepEqual(await snapshot(), beforeReset);
		assert(await reset.isVisible());
		await restoreStorage();
		await reset.getByRole('button', { name: 'Reset to Default', exact: true }).click();
		await reset.waitFor({ state: 'hidden' });
		await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
		assert.match(await page.locator('#fontFamily').innerText(), /Merriweather/);
		assert.match(await page.locator('#fontVariant').innerText(), /Regular — 400/);
		assert.match(await page.locator('#fontSize').innerText(), /13 px/);
		await page.keyboard.press('Escape');
		await page.reload();
		await page.waitForFunction(
			() =>
				document.documentElement.dataset.llampartFont === 'merriweather' &&
				getComputedStyle(document.body).fontSize === '13px'
		);
		console.log(
			'PASS: MCP Add/Edit/Delete and full Reset failures keep forms and stored/in-memory state intact; retries succeed; bottom Save and reload preserve MCP results and factory typography'
		);
	}
	assert.deepEqual(errors, []);
	console.log(`${stage}: fresh defaults, all four content families, no unhandled pageerror: PASS`);
} catch (error) {
	await screenshot('failure');
	throw error;
} finally {
	await browser.close();
}
