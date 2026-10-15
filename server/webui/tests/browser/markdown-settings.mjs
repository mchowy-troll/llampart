/**
 * Real chat-component Markdown + settings transaction regression in Chromium.
 * Uses an isolated browser profile, real renderer/IndexedDB and mocked provider HTTP.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/markdown-settings.mjs
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
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => {
	if (message.type() === 'error' && message.text().includes('Failed to process markdown'))
		failures.push(message.text());
});
page.on('response', (response) => {
	if (response.status() >= 400 && response.url().includes('/node_modules/.vite/'))
		failures.push(`${response.status()} ${response.url()}`);
});
const markdown =
	'# Czym jest zdrowa dieta\n\n**Pogrubienie** i *kursywa*.\n\n- Regularność\n- Różnorodność\n\n> Cytat testowy\n\n```js\nconst zdrowie = true;\n```\n\n| Grupa | Przykłady |\n|---|---|\n| Warzywa | marchew |\n\n[Przykładowy link](https://example.org/)';
const key = 'LlamaCppWebui.config';
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
				renderUserContentAsMarkdown: true,
				renderReasoningContentAsMarkdown: true,
				minimalAgenticIndicators: false,
				alwaysShowSidebarOnDesktop: true,
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false
			})
		);
		localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
	}
});
await page.route('**/__llampart/api/**', (route) => {
	const url = new URL(route.request().url());
	if (url.pathname.endsWith('/chat/completions')) {
		const chunk = (delta, finish_reason = null) =>
			`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
		return route.fulfill({
			contentType: 'text/event-stream',
			body:
				chunk({ reasoning_content: markdown }) +
				chunk({ content: markdown }) +
				chunk({}, 'stop') +
				'data: [DONE]\n\n'
		});
	}
	return route.fulfill({
		json: url.pathname.endsWith('/props')
			? {
					build_info: 'markdown-test',
					default_generation_settings: { params: { temperature: 0.8, top_p: 0.95 } },
					model_path: 'test.gguf',
					modalities: { vision: false, audio: false }
				}
			: url.pathname.endsWith('/models')
				? { object: 'list', data: [{ id: 'test.gguf' }] }
				: []
	});
});
const assistant = page.locator('.llampart-assistant-markdown').first();
const user = page.locator('.markdown-user-content').first();
const reasoning = page.locator('.llampart-reasoning-content').first();
const dialog = page.locator('.llampart-chat-settings-dialog-content');
const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
async function ensureReasoningOpen() {
	const trigger = page.locator('.llampart-agentic-panel [data-slot="collapsible-trigger"]').first();
	if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
	await reasoning.waitFor({ state: 'visible' });
}
async function assertMarkdown(root) {
	await root.locator('h1').waitFor();
	for (const selector of [
		'h1',
		'strong',
		'em',
		'ul > li',
		'blockquote',
		'pre code',
		'table th',
		'table td',
		'a[href="https://example.org/"]'
	]) {
		assert(
			(await root.locator(selector).count()) > 0,
			`Missing generated Markdown HTML: ${selector}`
		);
	}
	assert.equal(await root.locator('.markdown-block--fallback').count(), 0);
	assert.equal(
		await root
			.locator('strong')
			.first()
			.evaluate((el) => getComputedStyle(el).display),
		'inline'
	);
	assert.equal(
		await root
			.locator('table')
			.first()
			.evaluate((el) => getComputedStyle(el).display),
		'table'
	);
}
async function checkPreferences(userEnabled, reasoningEnabled) {
	await assertMarkdown(assistant);
	if (userEnabled) await assertMarkdown(user);
	else {
		assert.equal(await page.locator('.markdown-user-content').count(), 0);
		assert(
			(await page.locator('.llampart-user-message').first().textContent()).includes(
				'**Pogrubienie**'
			)
		);
	}
	await ensureReasoningOpen();
	if (reasoningEnabled) await assertMarkdown(reasoning);
	else {
		assert.equal(await reasoning.locator('.llampart-markdown-content').count(), 0);
		assert((await reasoning.textContent()).includes('**Pogrubienie**'));
	}
	const saved = await stored();
	assert.equal(saved.renderUserContentAsMarkdown, userEnabled);
	assert.equal(saved.renderReasoningContentAsMarkdown, reasoningEnabled);
	assert.deepEqual(failures, []);
}
async function openSettings() {
	await page.locator('button[aria-label="Ustawienia"]').click();
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
}
async function setOption(id, checked) {
	const checkbox = page.locator(`#${id}`);
	if (((await checkbox.getAttribute('aria-checked')) === 'true') !== checked)
		await checkbox.click();
}
async function closeSettings(save = false) {
	await dialog
		.getByRole('button', { name: save ? 'Zapisz ustawienia' : 'Zamknij', exact: true })
		.click();
	await dialog.waitFor({ state: 'hidden' });
}
async function screenshot(name, root) {
	if (!process.env.LLAMPART_TEST_ARTIFACTS) return;
	await mkdir(process.env.LLAMPART_TEST_ARTIFACTS, { recursive: true });
	await root.scrollIntoViewIfNeeded();
	await page.screenshot({ path: `${process.env.LLAMPART_TEST_ARTIFACTS}/${name}.png` });
}

try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://localhost:5173');
	await page.locator('textarea').first().fill(markdown);
	await page.locator('textarea').first().press('Enter');
	await checkPreferences(true, true);
	await screenshot('assistant-markdown', assistant);
	await screenshot('reasoning-markdown', reasoning);
	await screenshot('user-markdown', user);
	console.log(
		'PASS actual chat: assistant/user/reasoning headings, bold, italic, lists, quotes, code, tables and links'
	);

	const before = await stored();
	await openSettings();
	await closeSettings();
	await checkPreferences(true, true);
	await openSettings();
	await page.locator('#uiScale').fill('110');
	await setOption('renderUserContentAsMarkdown', false);
	await setOption('renderReasoningContentAsMarkdown', false);
	await closeSettings();
	assert.deepEqual(await stored(), before);
	await checkPreferences(true, true);
	console.log(
		'PASS Settings open/close and appearance rollback preserve Markdown and stored preferences'
	);

	for (const [userEnabled, reasoningEnabled] of [
		[false, true],
		[true, false],
		[false, false],
		[true, true]
	]) {
		await openSettings();
		await page.locator('#uiScale').fill(userEnabled ? '100' : '95');
		await setOption('renderUserContentAsMarkdown', userEnabled);
		await setOption('renderReasoningContentAsMarkdown', reasoningEnabled);
		await closeSettings(true);
		await checkPreferences(userEnabled, reasoningEnabled);
		await page.reload();
		await page.waitForSelector('textarea');
		await checkPreferences(userEnabled, reasoningEnabled);
		assert.equal(await page.locator('.llampart-about-dialog-content').count(), 0);
		assert.equal(
			await page.evaluate(() => localStorage.getItem('Llampart.aboutDismissedVersion')),
			'1.9.0'
		);
		console.log(
			`PASS saved appearance + Markdown preferences: user=${userEnabled}, reasoning=${reasoningEnabled}, reload`
		);
	}
	assert.deepEqual(failures, []);
} finally {
	await browser.close();
}
