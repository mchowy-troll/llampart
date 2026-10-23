/** Compare HEAD and final in identical isolated Chromium contexts. No live inference. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const config = {
	apiProvider: 'vllm',
	serverBaseUrl: 'http://layout.synthetic',
	vllmBaseUrl: 'http://layout.synthetic',
	interfaceLanguage: 'en',
	theme: 'frosted-glass',
	frostedGlassWallpaper: 'frosted-glass-02',
	frostedGlassMilkiness: 50,
	frostedGlassOpaque: false,
	uiScale: '100',
	fontFamily: 'merriweather',
	fontVariant: '400',
	fontSize: '16',
	minimalAgenticIndicators: false,
	showThoughtInProgress: true,
	renderReasoningContentAsMarkdown: true,
	alwaysShowSidebarOnDesktop: true,
	titleGenerationUseLLM: false,
	askForTitleConfirmation: false,
	preEncodeConversation: false
};
const results = [];
try {
	for (const width of [1440, 390]) {
		const versions = {};
		for (const [version, base] of [
			['head', process.env.LLAMPART_BASELINE_URL],
			['final', process.env.LLAMPART_TEST_URL]
		]) {
			const context = await browser.newContext({
				viewport: { width, height: 1000 },
				deviceScaleFactor: 1,
				colorScheme: 'light',
				reducedMotion: 'reduce',
				locale: 'en-US',
				timezoneId: 'UTC'
			});
			try {
				const page = await context.newPage(),
					errors = [],
					failed = [],
					faviconCancellations = [];
				page.on('pageerror', (e) => errors.push(e.message));
				page.on('requestfailed', (r) => {
					const failure = { url: r.url(), error: r.failure() };
					// Chromium may cancel/reissue the document icon during hydration.
					// Record it separately; never exempt CSS/JS/fonts or other assets.
					if (
						new URL(r.url()).pathname === '/favicon.svg' &&
						r.failure()?.errorText === 'net::ERR_ABORTED'
					)
						faviconCancellations.push(failure);
					else failed.push(failure);
				});
				page.on('response', (r) => {
					if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() });
				});
				await context.addInitScript((config) => {
					localStorage.setItem('llama-webui-migration-v2-done', '1');
					localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
					localStorage.setItem('LlamaCppWebui.config', JSON.stringify(config));
				}, config);
				await page.route('**/__llampart/api/**', (route) =>
					route.fulfill({
						json: new URL(route.request().url()).pathname.endsWith('/models')
							? {
									object: 'list',
									data: [{ id: 'layout-model', capabilities: { vision: true, tools: true } }]
								}
							: []
					})
				);
				await page.goto(base);
				await page.locator('textarea').first().waitFor();
				await page.waitForLoadState('networkidle');
				const id = await page.evaluate(async () => {
					const { db } = await import('/tests/browser/charts-harness.ts');
					const conversation = await db.createConversation('Synthetic layout review');
					const root = await db.createRootMessage(conversation.id);
					const user = await db.createMessageBranch(
						{
							convId: conversation.id,
							role: 'user',
							content: 'Synthetic layout question',
							type: 'text',
							timestamp: 1800000000000,
							children: [],
							toolCalls: ''
						},
						root
					);
					await db.createMessageBranch(
						{
							convId: conversation.id,
							role: 'assistant',
							content: 'Synthetic final answer with **Markdown**.',
							reasoningContent:
								'**Synthetic reasoning**\n\nIdentical preserved reasoning with `inline code`.',
							model: 'layout-model',
							type: 'text',
							timestamp: 1800000000001,
							children: [],
							toolCalls: ''
						},
						user.id
					);
					return conversation.id;
				});
				await page.evaluate((id) => {
					location.hash = `/chat/${id}`;
				}, id);
				const panel = page.locator('.llampart-agentic-panel').first();
				await panel.waitFor();
				const toggle = panel.locator('button[aria-expanded]');
				if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
				await panel.getByText('Synthetic reasoning', { exact: true }).waitFor();
				await page.waitForLoadState('networkidle');
				await page.evaluate(async () => {
					await document.fonts.ready;
					await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
					await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
				});
				await page.mouse.move(1, 1);
				const inspect = () =>
					page.evaluate(() => {
						const names = [
							'background-color',
							'opacity',
							'backdrop-filter',
							'filter',
							'color',
							'border',
							'box-shadow',
							'font-family',
							'font-size',
							'border-radius'
						];
						function style(el) {
							const s = getComputedStyle(el),
								custom = {};
							for (const name of s)
								if (name.startsWith('--')) custom[name] = s.getPropertyValue(name).trim();
							return {
								properties: Object.fromEntries(
									names.map((name) => [name, s.getPropertyValue(name)])
								),
								custom
							};
						}
						function tree(el) {
							return {
								tag: el.tagName,
								classes: [...el.classList].sort(),
								slot: el.getAttribute('data-slot'),
								role: el.getAttribute('role'),
								state: el.getAttribute('data-state'),
								text: el.children.length ? undefined : el.textContent,
								children: [...el.children].map(tree)
							};
						}
						const panel = document.querySelector('.llampart-agentic-panel');
						const content = panel.querySelector('.overflow-y-auto');
						const root = getComputedStyle(document.documentElement);
						const body = getComputedStyle(document.body);
						return {
							panel: style(panel),
							content: style(content),
							trigger: style(panel.querySelector('button[aria-expanded]')),
							tree: tree(panel),
							assistant: style(document.querySelector('.llampart-assistant-message')),
							root: {
								theme: document.documentElement.dataset.theme,
								classes: [...document.documentElement.classList].sort(),
								scale: document.documentElement.dataset.llampartUiScale,
								background: body.backgroundImage,
								font: body.fontFamily,
								fontSize: body.fontSize,
								color: body.color,
								filter: root.filter
							},
							buttons: [
								...document.querySelector('.llampart-chat-form-root').querySelectorAll('button')
							].map((el) => ({ label: el.getAttribute('aria-label'), classes: el.className })),
							sidebar: !!document.querySelector('[data-slot="sidebar"]'),
							stylesheets: [...document.styleSheets].map((s) => {
								try {
									return { rules: s.cssRules.length };
								} catch {
									return { inaccessible: true };
								}
							}),
							assets: performance
								.getEntriesByType('resource')
								.filter((e) => /\.(css|woff2|jpg|png)(\?|$)/.test(e.name))
								.map((e) => ({ path: new URL(e.name).pathname, size: e.decodedBodySize }))
						};
					});
				const captured = await inspect();
				await page.screenshot({
					path: `${out}/${version}-${width}-expanded.png`,
					animations: 'disabled'
				});
				const panelPng = await panel.screenshot({
					path: `${out}/${version}-${width}-panel.png`,
					animations: 'disabled'
				});
				captured.panelPngSha256 = createHash('sha256').update(panelPng).digest('hex');
				await toggle.click();
				assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
				await toggle.press('Enter');
				assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
				assert.deepEqual((await inspect()).panel, captured.panel);
				assert.equal(await page.locator('.llampart-chat-form-root textarea').count(), 1);
				assert.equal(
					await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').count(),
					1
				);
				if (version === 'final') {
					assert.equal(await page.locator('.llampart-reasoning-trigger').count(), 0);
					const composer = page.locator('.llampart-chat-form-root');
					assert((await composer.getByRole('button').count()) >= 3);
					const order = await composer.evaluate((el) => {
						const model = el.querySelector('.llampart-model-selector-trigger');
						const buttons = [...el.querySelectorAll('button')];
						const index = buttons.indexOf(model);
						return {
							index,
							count: buttons.length,
							next: buttons[index + 1]?.getAttribute('aria-label')
						};
					});
					assert(order.index > 0);
					assert.equal(order.index, order.count - 2);
					captured.composerOrder = order;
				}
				await writeFile(
					`${out}/${version}-${width}.json`,
					JSON.stringify({ ...captured, errors, failed, faviconCancellations }, null, 2)
				);
				assert.deepEqual(errors, []);
				assert.deepEqual(failed, []);
				versions[version] = { ...captured, errors, failed, faviconCancellations };
			} finally {
				await context.close();
			}
		}
		for (const name of ['panel', 'content', 'trigger', 'tree', 'assistant', 'root'])
			assert.deepEqual(versions.final[name], versions.head[name], `${width}: ${name} differs`);
		assert.equal(
			versions.final.panelPngSha256,
			versions.head.panelPngSha256,
			`${width}: rendered reasoning pixels differ`
		);
		assert.deepEqual(
			versions.final.buttons,
			versions.head.buttons.filter(
				(button) => !button.classes.includes('llampart-reasoning-trigger')
			),
			`${width}: composer changed beyond the retired Reasoning Effort button`
		);
		assert.equal(versions.final.sidebar, true);
		results.push({ width, deviceScaleFactor: 1, result: 'PASS', config, versions });
		console.log(
			`PASS HEAD vs final: ${width}px, identical computed properties/custom properties/DOM and classes`
		);
	}
} finally {
	await writeFile(`${out}/comparison.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
