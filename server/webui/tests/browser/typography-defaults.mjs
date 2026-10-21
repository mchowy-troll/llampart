/** One isolated 1920x1080 session for final review A/B/C. HTTP/SSE are mocked.
 * Start a fresh isolated Vite after check: direct harness imports must share the
 * app's store instances, not stale timestamped modules from earlier Vite HMR.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/browser/typography-defaults.mjs
 * Optional LLAMPART_TEST_URL, LLAMPART_TEST_ARTIFACTS (outside the repository). */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40134';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let uiSettings = {};
let pendingCompletion;
const props = () => ({
	role: 'model',
	build_info: 'isolated-abc',
	model_path: 'synthetic/model',
	chat_template: '{{ messages }}',
	default_generation_settings: {
		n_ctx: 8192,
		params: { temperature: 0.8, backend_sampling: true }
	},
	ui_settings: uiSettings
});
await context.route('**/*', (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.endsWith('/props')) return route.fulfill({ json: props() });
	if (url.pathname.endsWith('/models'))
		return route.fulfill({ json: { object: 'list', data: [{ id: 'synthetic/model' }] } });
	if (url.pathname.endsWith('/tools')) return route.fulfill({ json: [] });
	if (url.pathname.endsWith('/chat/completions')) {
		pendingCompletion = route;
		return;
	}
	if (url.pathname.includes('/__llampart/api/')) return route.fulfill({ json: { status: 'ok' } });
	return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
});
await context.addInitScript(() => {
	// Suppress only the existing About modal in this disposable browser context.
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
});
const dialog = page.locator('.llampart-chat-settings-dialog-content');
const fontLabels = ['Merriweather (Default)', 'Regular — 400 (Default)', '13 px (Default)'];
async function screenshot(name) {
	if (artifacts)
		await page.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled' });
}
async function select(id, label) {
	await page.locator(`#${id}`).click();
	await page.getByRole('option', { name: label, exact: true }).click();
	await page.getByRole('listbox').waitFor({ state: 'hidden' });
}
async function closeOptions() {
	await page.keyboard.press('Escape');
	await page.getByRole('listbox').waitFor({ state: 'hidden' });
}
async function open() {
	const button = page.locator('button[aria-label="Settings"]');
	if (!(await button.isVisible())) await page.locator('.llampart-sidebar-v-trigger').click();
	await button.click();
	await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
}
async function expectLabels(labels = fontLabels) {
	for (const [i, id] of ['fontFamily', 'fontVariant', 'fontSize'].entries())
		assert.equal((await page.locator(`#${id}`).innerText()).trim(), labels[i]);
}
async function runtime(weight = '400', size = '13', family = 'merriweather') {
	await page.waitForFunction(
		({ weight, size, family }) =>
			document.documentElement.dataset.llampartFont === family &&
			getComputedStyle(document.body).fontWeight === weight &&
			getComputedStyle(document.body).fontSize === `${size}px`,
		{ weight, size, family }
	);
}
async function save() {
	await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
async function reset() {
	await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
	await page
		.getByRole('alertdialog')
		.getByRole('button', { name: 'Reset to Default', exact: true })
		.click();
	await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
	await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
	await expectLabels();
	await runtime();
}
const snapshot = () =>
	page.evaluate(async () => {
		const { settings } = await import('/tests/browser/charts-harness.ts');
		return {
			config: { ...settings.config },
			overrides: [...settings.userOverrides],
			raw: localStorage.getItem('LlamaCppWebui.config'),
			rawOverrides: localStorage.getItem('LlamaCppWebui.userOverrides')
		};
	});
async function assertNoTileSpinner() {
	assert.equal(
		await page.locator('.conversation-item :is(.loading-icon, .animate-spin)').count(),
		0
	);
	const spinning = await page.locator('.conversation-item').evaluateAll((tiles) =>
		tiles
			.flatMap((tile) => [...tile.querySelectorAll('*')])
			.some((el) =>
				getComputedStyle(el)
					.animationName.split(',')
					.some((name) => /spin/i.test(name))
			)
	);
	assert.equal(spinning, false);
}
try {
	await page.goto(base);
	await runtime();
	await open();
	await expectLabels();
	// Exactly the existing choices, never a separate sentinel option.
	for (const [id, count] of [
		['fontFamily', 5],
		['fontSize', 9]
	]) {
		await page.locator(`#${id}`).click();
		assert.equal(await page.getByRole('option').count(), count);
		assert.equal(await page.getByRole('option', { name: /^Default \(/ }).count(), 0);
		await closeOptions();
	}
	for (const [language, suffixes] of [
		['pl', ['domyślna', 'domyślna', 'domyślny']],
		['de', ['Standard', 'Standard', 'Standard']],
		['es', ['predeterminada', 'predeterminada', 'predeterminado']],
		['fr', ['par défaut', 'par défaut', 'par défaut']],
		['it', ['predefinita', 'predefinita', 'predefinita']],
		['en', ['Default', 'Default', 'Default']]
	]) {
		await page.evaluate(
			async (language) =>
				(await import('/tests/browser/charts-harness.ts')).settings.updateConfig(
					'interfaceLanguage',
					language
				),
			language
		);
		const labels = [
			`Merriweather (${suffixes[0]})`,
			`Regular — 400 (${suffixes[1]})`,
			`13 px (${suffixes[2]})`
		];
		await expectLabels(labels);
		await screenshot(`labels-${language}`);
		for (const [i, id] of ['fontFamily', 'fontVariant', 'fontSize'].entries()) {
			await page.locator(`#${id}`).click();
			await page.getByRole('option', { name: labels[i], exact: true }).waitFor();
			await closeOptions();
		}
	}
	await page.locator('#fontVariant').click();
	await screenshot('merriweather-variants');
	assert.deepEqual(
		(await page.getByRole('option').allTextContents()).map((label) => label.trim()),
		['Regular — 400 (Default)', 'Medium — 500', 'SemiBold — 600', 'Bold — 700']
	);
	await closeOptions();
	for (const [label, weight] of [
		['Medium — 500', '500'],
		['SemiBold — 600', '600'],
		['Bold — 700', '700']
	]) {
		await select('fontVariant', label);
		await runtime(weight);
	}
	await select('fontFamily', 'Fira Sans');
	await page.locator('#fontVariant').click();
	assert.equal(await page.getByRole('option', { name: 'Regular — 400', exact: true }).count(), 1);
	assert.equal(await page.getByRole('option', { name: /\(Default\)/ }).count(), 0);
	await closeOptions();
	await select('fontFamily', 'Merriweather (Default)');
	await page.locator('#fontVariant').click();
	assert.equal(await page.getByRole('option').count(), 4);
	await closeOptions();
	await select('fontVariant', 'SemiBold — 600');
	await runtime('600');
	await save();
	await page.reload();
	await runtime('600');
	await open();
	await expectLabels(['Merriweather (Default)', 'SemiBold — 600', '13 px (Default)']);
	await screenshot('merriweather-600-reload');
	await reset();
	await screenshot('factory-defaults');
	await page.keyboard.press('Escape');
	await page.reload();
	await runtime();
	// Import old sentinels through the real importer, without changing its format.
	await page.evaluate(async () => {
		const { importApplicationSettings } = await import('/src/lib/utils/settings-import-export.ts');
		importApplicationSettings(
			JSON.stringify({
				type: 'llampart-settings-export',
				formatVersion: 1,
				settings: { fontFamily: 'default', fontVariant: 'default', fontSize: 'default' }
			})
		);
	});
	await runtime();
	await open();
	await expectLabels();
	const legacy = await snapshot();
	await page.keyboard.press('Escape');
	assert.deepEqual(
		await snapshot(),
		legacy,
		'opening/closing legacy settings must not migrate storage'
	);
	await open();
	await select('fontVariant', 'Medium — 500');
	await runtime('500');
	await save();
	await page.reload();
	await runtime('500');
	assert.equal((await snapshot()).config.fontFamily, 'merriweather');
	assert.equal(JSON.parse((await snapshot()).raw).fontVariant, '500');
	await page.evaluate(async () => {
		const { importApplicationSettings } = await import('/src/lib/utils/settings-import-export.ts');
		importApplicationSettings(
			JSON.stringify({
				type: 'llampart-settings-export',
				formatVersion: 1,
				settings: { fontFamily: 'fira-sans', fontVariant: '600', fontSize: '18' }
			})
		);
	});
	await page.reload();
	await runtime('600', '18', 'fira-sans');
	await open();
	await expectLabels(['Fira Sans', 'SemiBold — 600', '18 px']);
	await reset();
	await page.keyboard.press('Escape');
	console.log(
		'PASS A: first-run/reset labels, six live languages, four Merriweather variants, actual CSS 500/600/700, 600 Save/reload, historical and explicit imports'
	);

	// B: actual /props fetch -> real layout effect -> failed second storage key.
	await page.evaluate(async () => {
		const { settings } = await import('/tests/browser/charts-harness.ts');
		settings.updateMultipleConfig({
			alwaysShowSidebarOnDesktop: true,
			titleGenerationUseLLM: false,
			temperature: 0.5
		});
	});
	const beforeFailure = await snapshot();
	uiSettings = { showMessageStats: !beforeFailure.config.showMessageStats };
	await page.evaluate(() => {
		const original = Storage.prototype.setItem;
		globalThis.restoreAbcStorage = () => {
			Storage.prototype.setItem = original;
		};
		globalThis.abcFailedWrites = 0;
		Storage.prototype.setItem = function (key, value) {
			if (key === 'LlamaCppWebui.userOverrides' && globalThis.abcFailArmed) {
				globalThis.abcFailArmed = false;
				globalThis.abcFailedWrites++;
				throw new DOMException('isolated quota', 'QuotaExceededError');
			}
			return original.call(this, key, value);
		};
	});
	const fetchProps = () =>
		page.evaluate(async () => {
			globalThis.abcFailArmed = true;
			await (await import('/src/lib/stores/server.svelte.ts')).serverStore.fetch();
		});
	await fetchProps();
	await page
		.getByText(
			'Server defaults could not be saved. Previous settings remain active. Synchronization can be retried on the next update.',
			{ exact: true }
		)
		.waitFor();
	assert.deepEqual(await snapshot(), beforeFailure);
	await fetchProps();
	await fetchProps();
	assert.equal(await page.evaluate(() => globalThis.abcFailedWrites >= 3), true);
	assert.equal(
		await page
			.locator('[data-sonner-toast]')
			.filter({ hasText: 'Server defaults could not be saved' })
			.count(),
		1
	);
	assert.deepEqual(await snapshot(), beforeFailure);
	await open();
	await expectLabels();
	await page.keyboard.press('Escape');
	await screenshot('props-persistence-error');
	await page.evaluate(() => globalThis.restoreAbcStorage());
	await fetchProps();
	await page.waitForFunction(
		async (value) =>
			(await import('/tests/browser/charts-harness.ts')).settings.config.showMessageStats === value,
		uiSettings.showMessageStats
	);
	const recovered = await snapshot();
	assert.equal(JSON.parse(recovered.raw).showMessageStats, uiSettings.showMessageStats);
	assert.equal(recovered.config.temperature, 0.5);
	assert.deepEqual(recovered.overrides, beforeFailure.overrides);
	assert.deepEqual(JSON.parse(recovered.rawOverrides), beforeFailure.overrides);
	console.log(
		'PASS B: new /props, controlled storage failure, unchanged memory/storage/overrides, one toast, responsive UI and successful next sync; no unhandled reactive error'
	);

	// C: two synthetic conversations; real send, background navigation and stop.
	const ids = await page.evaluate(async () => {
		const { db, conversations } = await import('/tests/browser/charts-harness.ts');
		const ids = [];
		for (const name of ['ABC generating', 'ABC other']) {
			const conv = await db.createConversation(name);
			await db.createRootMessage(conv.id);
			ids.push(conv.id);
		}
		await conversations.loadConversations();
		return ids;
	});
	await page.goto(`${base}/#/chat/${ids[0]}`);
	const tile = (id) => page.locator(`[data-conversation-selection-id="${id}"]`);
	await tile(ids[0]).waitFor();
	await assertNoTileSpinner();
	await tile(ids[0]).locator('[aria-label="Pin conversation"]').click();
	await tile(ids[0]).locator('[aria-label="Unpin conversation"]').waitFor();
	const pinGeometry = () =>
		tile(ids[0]).evaluate((el) => {
			const tile = el.getBoundingClientRect(),
				pin = el.querySelector('.conversation-pin-button').getBoundingClientRect();
			return { width: tile.width, height: tile.height, x: pin.x - tile.x, y: pin.y - tile.y };
		});
	const geometry = await pinGeometry();
	const requested = page.waitForRequest((req) => req.url().endsWith('/chat/completions'));
	await page.locator('textarea').first().fill('Synthetic background generation');
	await page.locator('textarea').first().press('Enter');
	await requested;
	await page.locator('.llampart-composer-stop-action').waitFor();
	await assertNoTileSpinner();
	assert.deepEqual(await pinGeometry(), geometry);
	await screenshot('sidebar-generating-pinned');
	await tile(ids[1]).click();
	await page.waitForFunction(
		(id) =>
			document.querySelector(`[data-conversation-selection-id="${id}"]`)?.dataset.active === 'true',
		ids[1]
	);
	await assertNoTileSpinner();
	assert.equal(
		await page.evaluate(
			async (id) =>
				(await import('/src/lib/stores/chat.svelte.ts')).getAllLoadingChats().includes(id),
			ids[0]
		),
		true
	);
	await tile(ids[0]).click();
	await page.locator('.llampart-composer-stop-action').waitFor();
	await assertNoTileSpinner();
	await tile(ids[0]).locator('[aria-label="Stop generation"]').click();
	await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
	await assertNoTileSpinner();
	await pendingCompletion?.abort().catch(() => {});
	pendingCompletion = undefined;
	await tile(ids[0]).locator('[aria-label="Unpin conversation"]').click();
	await tile(ids[0]).locator('[aria-label="Pin conversation"]').waitFor();
	const nextRequest = page.waitForRequest((req) => req.url().endsWith('/chat/completions'));
	await page.locator('textarea').first().fill('Synthetic completed generation');
	await page.locator('textarea').first().press('Enter');
	await nextRequest;
	await page.locator('.llampart-composer-stop-action').waitFor();
	await assertNoTileSpinner();
	await pendingCompletion.fulfill({
		contentType: 'text/event-stream',
		body: 'data: {"choices":[{"delta":{"content":"Synthetic final answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
	});
	await page.getByText('Synthetic final answer', { exact: true }).waitFor();
	await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
	await assertNoTileSpinner();
	await screenshot('sidebar-after-generation');
	assert.deepEqual(errors, []);
	console.log(
		'PASS C: no tile spinner before/during/after generation, pin/unpin, unchanged pin geometry, switch away/back while loading, sidebar Stop and unchanged composer indicator, completed SSE answer; no pageerror'
	);
} catch (error) {
	await screenshot('failure');
	console.error(
		'Browser diagnostics:',
		JSON.stringify(
			await page.evaluate(async () => {
				const { settings } = await import('/tests/browser/charts-harness.ts');
				const { serverStore } = await import('/src/lib/stores/server.svelte.ts');
				return {
					failedWrites: globalThis.abcFailedWrites,
					props: serverStore.props,
					config: { ...settings.config },
					overrides: [...settings.userOverrides],
					toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((el) => el.textContent)
				};
			})
		),
		'pageerrors:',
		errors
	);
	throw error;
} finally {
	await browser.close();
}
