/**
 * Chromium regression: real composer/stores/provider with controlled HTTP, no inference.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/reasoning-control.mjs
 * Optional LLAMPART_TEST_ARTIFACTS must point outside the repository.
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
const url = process.env.LLAMPART_TEST_URL || 'http://localhost:5173';
const templates = {
	effort: `{% set reasoning_effort = reasoning_effort | default('medium') %}{{ 'Reasoning: ' + reasoning_effort + '\\n\\n' }}`,
	toggle: '{% if enable_thinking is defined and enable_thinking %}<think>{% endif %}',
	none: '{% for message in messages %}{{ message.content }}{% endfor %}'
};
const errors = [];
const payloads = [];
async function setup(mode, { router = false, custom = '', delayedEffort = false } = {}) {
	const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
	const page = await context.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(
		({ custom }) => {
			if (localStorage.getItem('LlamaCppWebui.config')) return;
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					interfaceLanguage: 'en',
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://source-a.test',
					llamaServerBaseUrl: 'http://source-a.test',
					alwaysShowSidebarOnDesktop: true,
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false,
					custom
				})
			);
			localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
			localStorage.setItem('LlamaCppWebui.thinkingEnabledDefault', 'false');
			localStorage.setItem('LlamaCppWebui.reasoningEffortDefault', 'max');
		},
		{ custom }
	);
	let release;
	const gate = new Promise((done) => {
		release = done;
	});
	const requests = [];
	const modelIds = router ? ['none', 'effort', 'toggle'] : [mode];
	await page.route('**/__llampart/api/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url());
		const sourceB = request.headers()['x-llampart-host'] === 'source-b.test';
		if (path.pathname.endsWith('/chat/completions')) {
			const body = request.postDataJSON();
			requests.push(body);
			payloads.push(body);
			return route.fulfill({
				contentType: 'text/event-stream',
				body:
					'data: {"choices":[{"delta":{"reasoning_content":"thinking","content":"answer"}}]}\n\n' +
					'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
			});
		}
		if (path.pathname.endsWith('/props')) {
			const model = path.searchParams.get('model');
			if (delayedEffort && model === 'effort' && !sourceB) await gate;
			return route.fulfill({
				json: {
					build_info: 'reasoning-control-test',
					role: router && !model ? 'router' : 'model',
					default_generation_settings: { n_ctx: 8192, params: { temperature: 0.8 } },
					model_path: `${model || mode}.gguf`,
					// The router default deliberately disagrees with per-model props.
					chat_template: sourceB ? templates.none : templates[model || (router ? 'effort' : mode)]
				}
			});
		}
		if (path.pathname.endsWith('/models'))
			return route.fulfill({
				json: {
					object: 'list',
					data: modelIds.map((id) => ({ id, status: { value: 'loaded' } }))
				}
			});
		return route.fulfill({ json: [] });
	});
	await page.goto(url);
	await page.waitForSelector('textarea');
	await page.locator('.llampart-model-selector-trigger').first().waitFor();
	return { context, page, requests, release };
}
const trigger = (page) => page.locator('.llampart-reasoning-trigger');
const menu = (page) => page.locator('.llampart-reasoning-effort-menu');
async function checkMenu(page, labels, selected) {
	await trigger(page).focus();
	await page.keyboard.press('Enter');
	assert.deepEqual(
		await menu(page)
			.getByRole('menuitemradio')
			.allTextContents()
			.then((items) => items.map((text) => text.trim())),
		labels
	);
	assert.equal((await menu(page).locator('[aria-checked="true"]').textContent()).trim(), selected);
	assert(!/tokens|unlimited/i.test(await menu(page).textContent()));
}
async function send(page, requests) {
	const count = requests.length;
	const response = page.waitForResponse((response) => response.url().endsWith('/chat/completions'));
	await page.locator('textarea').first().fill('Test reasoning controls');
	await page.locator('textarea').first().press('Enter');
	await response;
	await page.waitForFunction(() =>
		document.querySelector('.llampart-assistant-markdown')?.textContent?.includes('answer')
	);
	await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
	assert.equal(requests.length, count + 1);
	const body = requests.at(-1);
	assert(!Object.hasOwn(body, 'thinking_budget_tokens'));
	assert(!Object.hasOwn(body, 'reasoning_effort'));
	assert.equal(body.reasoning_control, true);
	return body;
}
async function selectModel(page, model) {
	await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').click();
	await page
		.locator('.llampart-model-selector-menu')
		.getByRole('option')
		.filter({ hasText: new RegExp(`^${model}`) })
		.first()
		.click();
}

try {
	for (const mode of ['effort', 'toggle', 'none']) {
		const { context, page, requests } = await setup(mode);
		try {
			if (mode === 'effort') {
				await checkMenu(page, ['Low', 'Medium', 'High'], 'High');
				await page.keyboard.press('Escape');
				assert.deepEqual((await send(page, requests)).chat_template_kwargs, {
					reasoning_effort: 'high'
				});
				// Existing max/false conversation values survive reload, but are interpreted consistently.
				await page.reload();
				await checkMenu(page, ['Low', 'Medium', 'High'], 'High');
				await page.keyboard.press('Home');
				assert.equal(
					await menu(page)
						.getByRole('menuitemradio', { name: 'Low', exact: true })
						.evaluate((el) => el === document.activeElement),
					true
				);
				await page.keyboard.press('Enter');
				assert.deepEqual((await send(page, requests)).chat_template_kwargs, {
					reasoning_effort: 'low'
				});
			} else if (mode === 'toggle') {
				await checkMenu(page, ['Off', 'Enabled'], 'Off');
				await page.keyboard.press('Escape');
				assert.deepEqual((await send(page, requests)).chat_template_kwargs, {
					enable_thinking: false
				});
				await checkMenu(page, ['Off', 'Enabled'], 'Off');
				await page.keyboard.press('End');
				assert.equal(
					await menu(page)
						.getByRole('menuitemradio', { name: 'Enabled', exact: true })
						.evaluate((el) => el === document.activeElement),
					true
				);
				await page.keyboard.press('Space');
				assert.deepEqual((await send(page, requests)).chat_template_kwargs, {
					enable_thinking: true
				});
			} else {
				assert.equal(await trigger(page).count(), 0);
				assert(!Object.hasOwn(await send(page, requests), 'chat_template_kwargs'));
				assert.equal(
					await trigger(page).count(),
					0,
					'Generated reasoning is not evidence of control'
				);
			}
			if (process.env.LLAMPART_TEST_ARTIFACTS) {
				await mkdir(process.env.LLAMPART_TEST_ARTIFACTS, { recursive: true });
				if (mode !== 'none') await trigger(page).click();
				await page.screenshot({ path: `${process.env.LLAMPART_TEST_ARTIFACTS}/${mode}.png` });
			}
			console.log(
				`PASS Chromium single-model ${mode}: menu, keyboard, captured JSON, historical state`
			);
		} finally {
			await context.close();
		}
	}

	const router = await setup('none', { router: true, delayedEffort: true });
	try {
		const { page, requests } = router;
		assert.equal(await trigger(page).count(), 0);
		await selectModel(page, 'effort');
		assert.equal(await trigger(page).count(), 0, 'Pending props cannot reuse router controls');
		await selectModel(page, 'toggle');
		await checkMenu(page, ['Off', 'Enabled'], 'Off');
		await page.keyboard.press('Escape');
		router.release();
		await checkMenu(page, ['Off', 'Enabled'], 'Off');
		await menu(page).getByRole('menuitemradio', { name: 'Enabled', exact: true }).click();
		assert.deepEqual((await send(page, requests)).chat_template_kwargs, { enable_thinking: true });
		assert.equal(requests.at(-1).model, 'toggle');
		await selectModel(page, 'effort');
		await checkMenu(page, ['Low', 'Medium', 'High'], 'High');
		await page.keyboard.press('Escape');
		assert.deepEqual((await send(page, requests)).chat_template_kwargs, {
			reasoning_effort: 'high'
		});
		assert.equal(requests.at(-1).model, 'effort');
		await selectModel(page, 'none');
		assert.equal(await trigger(page).count(), 0);
		assert(!Object.hasOwn(await send(page, requests), 'chat_template_kwargs'));
		assert.equal(requests.at(-1).model, 'none');
		console.log(
			'PASS Chromium router: model-specific props, deferred response, effort/toggle/none switches and JSON'
		);

		await page.locator('button[aria-label="Settings"]').click();
		const settings = page.locator('.llampart-chat-settings-dialog-content');
		await settings.getByRole('button', { name: 'General', exact: true }).click();
		await page.locator('#llamaServerBaseUrl').fill('http://source-b.test');
		await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
		await settings.waitFor({ state: 'hidden' });
		await selectModel(page, 'effort');
		assert.equal(await trigger(page).count(), 0);
		assert(!Object.hasOwn(await send(page, requests), 'chat_template_kwargs'));
		console.log('PASS Chromium server switch: same model ID does not reuse old controls');
	} finally {
		router.release();
		await router.context.close();
	}

	for (const conflict of [false, true]) {
		const custom = JSON.stringify({
			chat_template_kwargs: conflict ? { reasoning_effort: 'low' } : { date: 'today' }
		});
		const { context, page, requests } = await setup('effort', { custom });
		try {
			await trigger(page).waitFor();
			if (conflict) {
				await page.locator('textarea').first().fill('Conflicting request');
				await page.locator('textarea').first().press('Enter');
				await page.getByText(/Reasoning control conflict:/).waitFor();
				assert.equal(requests.length, 0);
			} else
				assert.deepEqual((await send(page, requests)).chat_template_kwargs, {
					date: 'today',
					reasoning_effort: 'high'
				});
			console.log(
				`PASS Chromium Custom JSON: ${conflict ? 'conflict visibly rejected before HTTP' : 'unrelated kwargs retained'}`
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
