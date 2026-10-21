/** Real composer/stores/serializers with controlled HTTP, no inference.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/reasoning-control.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

assert(process.env.LLAMPART_PLAYWRIGHT_MODULE, 'Set LLAMPART_PLAYWRIGHT_MODULE');
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const base = process.env.LLAMPART_TEST_URL || 'http://localhost:5173';
const errors = [],
	payloads = [];
const templates = {
	effort: `{% set effort = reasoning_effort | default('xhigh') %}{% if effort not in ('low', 'medium', 'xhigh') %}{{ raise_exception('unsupported') }}{% endif %}{{ effort }}`,
	toggle: '{% if enable_thinking is defined and enable_thinking %}<think>{% endif %}',
	unknown: '{% for message in messages %}{{ message.content }}{% endfor %}'
};
try {
	for (const mode of Object.keys(templates)) {
		const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
		const page = await context.newPage();
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript(() => {
			if (localStorage.getItem('LlamaCppWebui.config')) return;
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					interfaceLanguage: 'en',
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://source-a.test',
					llamaServerBaseUrl: 'http://source-a.test',
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false
				})
			);
			localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
			// Unavailable historical choices must remain visible, never become another level.
			localStorage.setItem('LlamaCppWebui.thinkingEnabledDefault', 'true');
			localStorage.setItem('LlamaCppWebui.reasoningEffortDefault', 'max');
		});
		const requests = [];
		await page.route('**/__llampart/api/**', async (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/chat/completions')) {
				requests.push(route.request().postDataJSON());
				payloads.push(requests.at(-1));
				return route.fulfill({
					contentType: 'text/event-stream',
					body: 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
				});
			}
			if (path.endsWith('/props'))
				return route.fulfill({
					json: {
						build_info: 'reasoning-contract-test',
						role: 'model',
						default_generation_settings: { n_ctx: 8192, params: {} },
						chat_template: templates[mode]
					}
				});
			if (path.endsWith('/models'))
				return route.fulfill({
					json: { data: [{ id: 'test-model', status: { value: 'loaded' } }] }
				});
			return route.fulfill({ json: [] });
		});
		try {
			await page.goto(base);
			await page.waitForSelector('textarea');
			const trigger = page.locator('.llampart-reasoning-trigger');
			await trigger.click();
			await page.getByRole('alert').filter({ hasText: 'Saved reasoning selection' }).waitFor();
			assert.equal(await page.getByRole('menuitemradio', { name: 'High', exact: true }).count(), 0);
			const labels = await page.getByRole('menuitemradio').allTextContents();
			assert.deepEqual(
				labels.map((label) => label.trim()),
				mode === 'effort'
					? ['Default / Auto', 'Low', 'Medium', 'Very high']
					: mode === 'toggle'
						? ['Default / Auto', 'Off', 'Enabled']
						: ['Default / Auto']
			);
			const chosen = mode === 'effort' ? 'Very high' : mode === 'toggle' ? 'Off' : 'Default / Auto';
			await page.getByRole('menuitemradio', { name: chosen, exact: true }).click();
			await page.locator('textarea').first().fill('Synthetic reasoning contract check');
			await page.locator('textarea').first().press('Enter');
			await page.waitForFunction(() =>
				document.querySelector('.llampart-assistant-markdown')?.textContent?.includes('answer')
			);
			await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
			assert.equal(requests.length, 1);
			const body = requests[0];
			if (mode === 'effort')
				assert.deepEqual(body.chat_template_kwargs, { reasoning_effort: 'xhigh' });
			else if (mode === 'toggle')
				assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
			else assert(!Object.hasOwn(body, 'chat_template_kwargs'));
			for (const key of ['reasoning_effort', 'thinking_budget_tokens', 'reasoning_control'])
				assert(!Object.hasOwn(body, key));
			await page.reload();
			await trigger.click();
			assert.equal(
				await page
					.getByRole('menuitemradio', { name: chosen, exact: true })
					.getAttribute('aria-checked'),
				'true'
			);
			if (process.env.LLAMPART_TEST_ARTIFACTS) {
				await mkdir(process.env.LLAMPART_TEST_ARTIFACTS, { recursive: true });
				await page.screenshot({ path: `${process.env.LLAMPART_TEST_ARTIFACTS}/${mode}.png` });
			}
			console.log(
				`PASS Chromium ${mode}: historical unavailable warning, exact choice, serialized request and reload`
			);
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(errors, []);
	if (process.env.LLAMPART_TEST_ARTIFACTS)
		await writeFile(
			`${process.env.LLAMPART_TEST_ARTIFACTS}/requests.json`,
			JSON.stringify(payloads, null, 2)
		);
} finally {
	await browser.close();
}
