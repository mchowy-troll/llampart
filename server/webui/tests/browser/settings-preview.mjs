/**
 * Real Chromium regression against the application (development or production preview).
 * No project dependency required: supply an installed Playwright/Core module explicitly.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40133 node tests/browser/settings-preview.mjs
 * Optional: LLAMPART_CHROMIUM, LLAMPART_TEST_ARTIFACTS (outside the repository).
 * Provider HTTP responses are mocked except --offline-only: serve a real static
 * build with its API gateway pointing to an unavailable backend. That focused
 * branch uses no dev-only imports. LLAMPART_BROWSER=firefox selects Firefox;
 * LLAMPART_FIREFOX may point to an installed Playwright-compatible executable.
 * --layout-only: production-compatible sidebar geometry and keyboard regression.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

assert(process.env.LLAMPART_PLAYWRIGHT_MODULE, 'Set LLAMPART_PLAYWRIGHT_MODULE');
// Focused post-release regression: Reset + reasoning + eye, no preview suite.
const resetOnly = process.argv.includes('--reset-only');
const offlineOnly = process.argv.includes('--offline-only');
const layoutOnly = process.argv.includes('--layout-only');
const engines = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const firefox = process.env.LLAMPART_BROWSER === 'firefox';
const browser = await engines[firefox ? 'firefox' : 'chromium'].launch({
	executablePath: firefox
		? process.env.LLAMPART_FIREFOX
		: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: firefox ? [] : ['--no-sandbox']
});
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const page = await browser.newPage({
	viewport: {
		width: Number(process.env.LLAMPART_TEST_WIDTH || 1920),
		height: Number(process.env.LLAMPART_TEST_HEIGHT || 1080)
	},
	deviceScaleFactor: Number(process.env.LLAMPART_TEST_DPR || 1),
	...(layoutOnly ? { screen: { width: 1920, height: 1080 } } : {})
});
await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
	await welcome.locator('#about-llampart-do-not-show-again').check();
	await welcome.getByRole('button', { name: 'OK', exact: true }).click();
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const storageKey = 'LlamaCppWebui.config';
const wallpaperKey = 'llampart:frosted-glass:user-wallpaper';
const initial = {
	apiProvider: resetOnly ? 'llama-server' : 'vllm',
	vllmBaseUrl: offlineOnly ? 'http://127.0.0.1:9' : 'http://mock.invalid:8000',
	serverBaseUrl: offlineOnly ? 'http://127.0.0.1:9' : 'http://mock.invalid:8000',
	theme: 'frosted-glass',
	interfaceLanguage: 'pl',
	alwaysShowSidebarOnDesktop: true,
	uiScale: '100',
	fontFamily: 'default',
	fontVariant: '400',
	fontSize: 'default',
	frostedGlassWallpaper: 'frosted-glass-02',
	frostedGlassMilkiness: 50,
	frostedGlassOpaque: false,
	...(resetOnly
		? {
				temperature: 0.2,
				titleGenerationUseLLM: false,
				backend_sampling: false,
				responsePrefCharts: true,
				uiScale: '105',
				fontFamily: 'merriweather',
				fontSize: '18',
				apiKey: 'mock-key',
				openAiCompatibleBaseUrl: 'https://saved.invalid/v1',
				openAiCompatibleApiKey: 'saved-key'
			}
		: {})
};
let validationMode = 'success';
let nativeLevels = ['minimal', 'high', 'xhigh', 'max'];
let smokeEnglish = false;
const oldPng =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==';
const models = { object: 'list', data: [{ id: 'mock/model' }] };
await page.route('**/*', async (route) => {
	const url = new URL(route.request().url());
	if (offlineOnly) return route.continue();
	if (layoutOnly && url.pathname.includes('/__llampart/api/')) {
		if (url.pathname.endsWith('/chat/completions'))
			return route.fulfill({
				contentType: 'text/event-stream',
				body: 'data: {"choices":[{"delta":{"content":"MOCK sidebar conversation"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
			});
		return route.fulfill({
			json: url.pathname.endsWith('/models')
				? models
				: url.pathname.endsWith('/props')
					? { build_info: 'MOCK', default_generation_settings: { params: {} } }
					: []
		});
	}
	if (resetOnly && url.hostname === 'mcp-smoke.invalid')
		return route.fulfill({ status: 503, body: 'Isolated MCP smoke: no external backend' });
	if (resetOnly && url.pathname.includes('/__llampart/api/')) {
		if (url.pathname.endsWith('/chat/completions'))
			return route.fulfill({
				contentType: 'text/event-stream',
				body: 'data: {"choices":[{"delta":{"content":"Synthetic reasoning answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
			});
		if (url.pathname.endsWith('/props'))
			return route.fulfill({
				json: {
					role: 'model',
					build_info: 'reset-smoke',
					model_path: 'mock/model',
					chat_template: '{{ message.content }}',
					chat_template_caps: {
						supports_reasoning_effort: true,
						...(nativeLevels ? { reasoning_effort_values: nativeLevels } : {})
					},
					default_generation_settings: {
						n_ctx: 8192,
						params: {
							temperature: 0.8,
							backend_sampling: route.request().headers()['x-llampart-host'] === 'mock.invalid'
						}
					}
				}
			});
		if (url.pathname.endsWith('/models')) return route.fulfill({ json: models });
		if (url.pathname.endsWith('/tools')) return route.fulfill({ json: [] });
		return route.fulfill({ json: { status: 'ok' } });
	}
	if (url.pathname.includes('/__llampart/api/') && url.pathname.endsWith('/models')) {
		return validationMode === 'failure'
			? route.fulfill({ status: 503, json: { error: 'Test connection failure' } })
			: route.fulfill({ json: models });
	}
	return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
});
await page.addInitScript(
	({ key, config, layoutOnly }) => {
		// The layout fixture does not test onboarding. Dismiss it before app startup,
		// rather than racing its async locator handler against repeated reloads.
		if (layoutOnly) localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
		if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(config));
	},
	{ key: storageKey, config: initial, layoutOnly }
);
if (offlineOnly) {
	await page.addInitScript(() => {
		localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
		Object.defineProperty(globalThis, 'caches', { value: undefined });
	});
}

const dialog = page.locator('.llampart-chat-settings-dialog-content');
const persisted = () => page.evaluate((key) => localStorage.getItem(key), storageKey);
const scale = () => page.locator('html').getAttribute('data-llampart-ui-scale');
async function open() {
	const label = smokeEnglish ? 'Settings' : 'Ustawienia';
	const settingsButton = page.locator(`button[aria-label="${label}"]`);
	if (
		!(await settingsButton.waitFor({ state: 'visible', timeout: 2000 }).then(
			() => true,
			() => false
		))
	) {
		await page
			.getByRole('button', {
				name: smokeEnglish ? 'Toggle sidebar' : 'Przełącz pasek boczny',
				exact: true
			})
			.click();
	}
	await settingsButton.click();
	await dialog.waitFor({ state: 'visible' });
}
async function appearance() {
	await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
}
async function close(method = 'button') {
	if (method === 'escape') await page.keyboard.press('Escape');
	else if (method === 'outside') await page.mouse.click(15, 15);
	else
		await dialog
			.getByRole('button', { name: smokeEnglish ? 'Close' : 'Zamknij', exact: true })
			.click();
	await dialog.waitFor({ state: 'hidden' });
}
async function select(id, name) {
	await page.locator(`#${id}`).click();
	const option = page.getByRole('option', { name, exact: true });
	if (await option.count()) await option.click();
	else await page.getByRole('option', { name: `${name} (domyślna)`, exact: true }).click();
}
async function preview() {
	await page.locator('#uiScale').fill('110');
	await select('fontFamily', 'Merriweather');
	await select('fontVariant', 'Bold — 700');
	await select('fontSize', '18 px');
	await page.waitForFunction(() => getComputedStyle(document.body).fontSize === '18px');
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
	if (artifacts)
		await page.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled' });
}

// Neutral sidebar geometry: real app/Chromium and hit tests, MOCK provider only.
async function sidebarRegression() {
	await page.locator('textarea').first().fill('MOCK selection fixture');
	await page.waitForFunction(
		() => document.querySelector('.llampart-composer-send-button')?.disabled === false
	);
	await page.locator('textarea').first().press('Enter');
	await page.locator('.llampart-assistant-markdown').first().waitFor();
	const samples = [];
	const configs = [];
	for (const fontFamily of ['merriweather', 'google-sans', 'literata']) {
		for (const interfaceLanguage of ['pl', 'en', 'el', 'bg'])
			configs.push({
				fontFamily,
				interfaceLanguage,
				uiScale: '100',
				fontSize: '13',
				compactSidebar: false
			});
		for (const compactSidebar of [false, true])
			for (const uiScale of ['90', '100', '110'])
				for (const fontSize of ['13', '20'])
					configs.push({ fontFamily, interfaceLanguage: 'el', uiScale, fontSize, compactSidebar });
	}
	const unique = [...new Map(configs.map((config) => [JSON.stringify(config), config])).values()];
	const cdp = firefox ? null : await page.context().newCDPSession(page);
	for (const config of unique) {
		await page.evaluate(
			(config) =>
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({ ...JSON.parse(localStorage.getItem('LlamaCppWebui.config')), ...config })
				),
			config
		);
		await page.reload();
		await page.locator('.llampart-sidebar-search-action').waitFor();
		await page.evaluate(() => document.fonts.ready);
		for (const width of [800, 1023, 1024, 1280]) {
			// Keep the physical screen independent of the CSS viewport at the 2/3 grid boundary.
			await page.setViewportSize({ width: width + 1, height: 1080 });
			if (cdp)
				await cdp.send('Emulation.setDeviceMetricsOverride', {
					width,
					height: 1080,
					deviceScaleFactor: 1,
					mobile: false,
					screenWidth: 1920,
					screenHeight: 1080
				});
			else await page.setViewportSize({ width, height: 1080 });
			await page.waitForTimeout(100);
			const geometry = await page
				.locator('.llampart-sidebar-conversations-frame')
				.evaluate((frame) => {
					const bounds = frame.getBoundingClientRect();
					const actions = [...frame.querySelectorAll('.llampart-sidebar-primary-action')].map(
						(action) => {
							const rect = action.getBoundingClientRect();
							const label = action.querySelector('span');
							const range = document.createRange();
							range.selectNodeContents(label);
							const icon = action.querySelector('svg').getBoundingClientRect();
							const hits = [
								[0.05, 0.5],
								[0.5, 0.5],
								[0.95, 0.5],
								[0.5, 0.1],
								[0.5, 0.9]
							].map(([x, y]) =>
								action.contains(
									document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y)
								)
							);
							return {
								box: rect.toJSON(),
								label: [...range.getClientRects()].map((rect) => rect.toJSON()),
								icon: icon.toJSON(),
								hits,
								minHeight: getComputedStyle(action).minHeight
							};
						}
					);
					return {
						viewport: innerWidth,
						screen: screen.width,
						frame: bounds.toJSON(),
						actions,
						grid: getComputedStyle(frame.querySelector('.llampart-conversation-grid-menu'))
							.gridTemplateColumns,
						overflow: getComputedStyle(frame).overflow
					};
				});
			assert.equal(geometry.actions.length, 2);
			assert.notEqual(geometry.overflow, 'hidden');
			for (const action of geometry.actions) {
				for (const rect of [action.box, action.icon, ...action.label]) {
					assert(
						rect.left >= geometry.frame.left + 2 && rect.right <= geometry.frame.right - 2,
						JSON.stringify({ config, geometry })
					);
					assert(rect.top >= geometry.frame.top && rect.bottom <= geometry.frame.bottom);
				}
				assert(action.hits.every(Boolean), JSON.stringify({ config, geometry }));
				assert(action.box.height >= parseFloat(action.minHeight) - 0.1);
			}
			const [a, b] = geometry.actions.map((action) => action.box);
			assert(a.right <= b.left || a.bottom <= b.top, 'Action hitboxes must not overlap');
			assert(geometry.actions[0].icon.right <= geometry.actions[0].label[0].left + 1);
			assert(
				geometry.actions[1].icon.left >=
					Math.max(...geometry.actions[1].label.map((rect) => rect.right)) - 1
			);
			samples.push({ config, ...geometry });
		}
	}
	const interactions = [];
	for (const controlConfig of [
		{ compactSidebar: false, uiScale: '100', fontSize: '13', fontFamily: 'merriweather' },
		{ compactSidebar: true, uiScale: '110', fontSize: '20', fontFamily: 'literata' }
	]) {
		await page.evaluate(
			(config) =>
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({ ...JSON.parse(localStorage.getItem('LlamaCppWebui.config')), ...config })
				),
			controlConfig
		);
		await page.reload();
		await page.locator('.llampart-sidebar-search-action').waitFor();
		for (const width of [800, 1024]) {
			await page.setViewportSize({ width, height: 1080 });
			if (cdp)
				await cdp.send('Emulation.setDeviceMetricsOverride', {
					width,
					height: 1080,
					deviceScaleFactor: 1,
					mobile: false,
					screenWidth: 1920,
					screenHeight: 1080
				});
			await page.waitForTimeout(200);
			const fresh = page.locator('.llampart-sidebar-new-chat-action');
			const search = page.locator('.llampart-sidebar-search-action');
			await fresh.focus();
			await page.keyboard.press('Tab');
			assert(
				await search.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))
			);
			const focus = await search.evaluate((el) => ({
				shadow: getComputedStyle(el).boxShadow,
				outline: getComputedStyle(el).outline,
				box: el.getBoundingClientRect().toJSON(),
				frame: el.closest('.llampart-sidebar-conversations-frame').getBoundingClientRect().toJSON()
			}));
			assert(focus.outline.includes('solid 2px'), 'Visible keyboard focus must remain');
			assert(
				focus.box.left - 4 >= focus.frame.left && focus.box.right + 4 <= focus.frame.right,
				'Focus ring stays in frame'
			);
			await search.press('Enter');
			const input = page.locator('.llampart-sidebar-action-search-input');
			assert(await input.evaluate((el) => document.activeElement === el));
			await input.fill('MOCK');
			await input.press('Escape');
			await search.click();
			await page.keyboard.press('Tab');
			const close = page.locator('.llampart-sidebar-search-close');
			assert(
				await close.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))
			);
			const target = await close.evaluate((el) => {
				const rect = el.getBoundingClientRect();
				return {
					box: rect.toJSON(),
					hit: el.contains(
						document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
					),
					outline: getComputedStyle(el).outline
				};
			});
			assert(target.box.width >= 24 && target.box.height >= 24 && target.hit);
			assert(!target.outline.includes('none'));
			await close.press('Enter');
			await search.waitFor();
			await page.locator('.llampart-sidebar-delete-button').click();
			assert.equal(await page.locator('.llampart-sidebar-bulk-action').count(), 6);
			await page.locator('.llampart-sidebar-bulk-action').first().click();
			await page.locator('.llampart-sidebar-delete-button').click();
			await fresh.focus();
			await fresh.press('Enter');
			await page.waitForFunction(() => !location.hash.includes('/chat/'));
			await page.locator('[data-sidebar="trigger"]').first().click();
			await page.waitForTimeout(500);
			assert.equal(await search.isVisible(), false);
			for (let i = 0; i < 20; i++) {
				await page.keyboard.press('Tab');
				assert(
					await page.evaluate(
						() => !document.activeElement?.closest('.llampart-sidebar-primary-action')
					)
				);
			}
			await page.locator('[data-sidebar="trigger"]').first().click();
			await search.waitFor();
			interactions.push({ controlConfig, width, focus, target });
		}
	}
	assert.deepEqual(errors, []);
	if (artifacts)
		await writeFile(
			`${artifacts}/sidebar.json`,
			JSON.stringify({ samples, interactions }, null, 2)
		);
	console.log(
		`REAL PASS: ${samples.length} sidebar geometry/label/icon/hit-test cases, keyboard/search/selection/collapse, close target >=24px; MOCK HTTP/SSE`
	);
}

async function run() {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40133');
	await page.waitForSelector('textarea');
	await page.keyboard.press('Escape');
	await page.waitForFunction(
		(scale) => document.documentElement.dataset.llampartUiScale === scale,
		initial.uiScale
	);
	if (layoutOnly) {
		await sidebarRegression();
		return;
	}
	if (offlineOnly) {
		const requests = [];
		page.on('request', (request) => requests.push(new URL(request.url()).pathname));
		await page.locator('.llampart-provider-connection-notice').waitFor();
		await open();
		await appearance();
		const images = dialog.locator('[data-llampart-wallpaper-grid] img');
		assert.equal(await images.count(), 5);
		const decoded = await images.evaluateAll(async (images) =>
			Promise.all(
				images.map(async (image) => {
					await image.decode();
					return {
						src: image.getAttribute('src'),
						width: image.naturalWidth,
						height: image.naturalHeight
					};
				})
			)
		);
		assert.deepEqual(
			decoded.map((image) => image.width),
			[768, 768, 768, 768, 768]
		);
		assert.deepEqual(
			decoded.map((image) => image.height),
			[430, 432, 512, 519, 512]
		);
		for (const [index, image] of decoded.entries())
			assert.equal(
				image.src,
				`/wallpapers/frosted-glass/thumbnails/frosted-glass-0${index + 1}.webp`
			);
		assert.equal(await page.evaluate(() => globalThis.caches), undefined);
		assert(!requests.some((path) => /frosted-glass-0[1345]\.jpg$/.test(path)));
		const tileSizes = await images.evaluateAll((images) =>
			images.map((image) => ({
				pixels: image.getBoundingClientRect().width * devicePixelRatio,
				available: image.naturalWidth
			}))
		);
		for (const tile of tileSizes) assert(tile.available >= tile.pixels, JSON.stringify(tile));
		if (artifacts)
			await dialog
				.locator('[data-llampart-wallpaper-grid]')
				.screenshot({ path: `${artifacts}/decoded-gallery.png` });
		await page.locator('#uiScale').fill('105');
		await page.locator('#frostedGlassMilkiness').fill('17');
		await page.getByRole('button', { name: 'Frosted Glass 05', exact: true }).click();
		const background = await page.locator('html').evaluate(async (root) => {
			const url = root.style
				.getPropertyValue('--llampart-theme-wallpaper')
				.match(/url\("(.*)"\)/)[1];
			const image = new Image();
			image.src = url;
			await image.decode();
			return { url, width: image.naturalWidth };
		});
		assert(background.url.includes('/frosted-glass-05.jpg'));
		assert(!background.url.includes('/thumbnails/'));
		assert.equal(background.width, 5120);
		console.log(
			JSON.stringify({
				viewport: page.viewportSize(),
				dpr: await page.evaluate(() => devicePixelRatio),
				decoded,
				tileSizes,
				background
			})
		);
		await dialog.getByRole('button', { name: 'Ogólne', exact: true }).click();
		await appearance();
		assert.equal(
			await page
				.getByRole('button', { name: 'Frosted Glass 05', exact: true })
				.getAttribute('aria-pressed'),
			'true'
		);
		await save();
		await dialog.waitFor({ state: 'hidden' });
		assert.equal(JSON.parse(await persisted()).frostedGlassWallpaper, 'frosted-glass-05');
		await page.reload();
		await page.waitForSelector('textarea');
		await page.locator('.llampart-provider-connection-notice').waitFor();
		assert.equal(JSON.parse(await persisted()).uiScale, '105');
		await open();
		await dialog.locator('#vllmBaseUrl').fill('http://127.0.0.1:9/v1');
		await save();
		await dialog.waitFor({ state: 'hidden' });
		assert.equal(JSON.parse(await persisted()).vllmBaseUrl, 'http://127.0.0.1:9/v1');
		await open();
		const beforeInvalid = await persisted();
		await dialog.locator('#vllmBaseUrl').fill('http://user:private-secret@host');
		await save();
		const warning = page.getByRole('alertdialog');
		await warning.waitFor();
		assert(!(await warning.innerText()).includes('private-secret'));
		assert.equal(await persisted(), beforeInvalid);
		await warning.getByRole('button', { name: 'Zamknij', exact: true }).click();
		await close();
		for (const [label, key, address] of [
			['OpenAI-compatible', 'openAiCompatibleBaseUrl', 'http://127.0.0.1:9'],
			['vLLM', 'vllmBaseUrl', 'http://127.0.0.1:9/v1'],
			['llama-server', 'llamaServerBaseUrl', '']
		]) {
			await open();
			await select('apiProvider', label);
			await dialog.locator(`#${key}`).fill(address);
			await save();
			await dialog.waitFor({ state: 'hidden' });
			assert.equal(JSON.parse(await persisted())[key], address);
			await page.locator('.llampart-provider-connection-notice').waitFor();
		}
		// A single failed thumbnail remains a named, selectable tile; no JPG fallback.
		await page.route('**/thumbnails/frosted-glass-01.webp', (route) =>
			route.fulfill({ contentType: 'image/webp', body: 'invalid WebP' })
		);
		await open();
		await appearance();
		const failed = page.getByRole('button', { name: 'Frosted Glass 01', exact: true });
		await page.waitForFunction(() => {
			const image = document.querySelector('img[src$="thumbnails/frosted-glass-01.webp"]');
			return image && getComputedStyle(image).visibility === 'hidden';
		});
		assert(await failed.isVisible());
		await images.nth(1).evaluate((image) => image.decode());
		const beforeFallback = requests.length;
		await failed.click();
		assert.equal(await failed.getAttribute('aria-pressed'), 'true');
		await close('escape');
		assert.equal(JSON.parse(await persisted()).frostedGlassWallpaper, 'frosted-glass-05');
		assert(!requests.slice(beforeFallback).some((path) => /frosted-glass-0[2-4]\.jpg$/.test(path)));
		await open();
		await appearance();
		await dialog.locator('input[type=file]').setInputFiles({
			name: 'test.png',
			mimeType: 'image/png',
			buffer: Buffer.from(oldPng.split(',')[1], 'base64')
		});
		assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), null);
		await save();
		await dialog.waitFor({ state: 'hidden' });
		await page.reload();
		await page.waitForSelector('textarea');
		assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), oldPng);
		assert.equal(JSON.parse(await persisted()).frostedGlassWallpaper, 'frosted-glass-user');
		await open();
		await appearance();
		assert.equal(
			await dialog.locator('[data-llampart-user-wallpaper-preview]').getAttribute('aria-pressed'),
			'true'
		);
		await close();
		// Controlled reconnect metadata, not a claim of a real healthy LLM backend.
		await page.route('**/__llampart/api/**', (route) => {
			const path = new URL(route.request().url()).pathname;
			return route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'offline-reconnect-fixture',
							model_path: 'fixture.gguf',
							default_generation_settings: { params: { temperature: 0.8 } },
							ui_settings: {
								uiScale: '100',
								fontSize: '13',
								frostedGlassWallpaper: 'frosted-glass-03',
								frostedGlassMilkiness: 75,
								showMessageStats: false
							}
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'fixture.gguf' }] }
						: []
			});
		});
		await page.reload();
		await page.waitForSelector('textarea');
		await page.locator('.llampart-provider-connection-notice').waitFor({ state: 'hidden' });
		await page.waitForFunction(
			() => JSON.parse(localStorage.getItem('LlamaCppWebui.config')).showMessageStats === false
		);
		assert.equal(JSON.parse(await persisted()).uiScale, '105');
		assert.equal(JSON.parse(await persisted()).frostedGlassMilkiness, 17);
		assert.equal(JSON.parse(await persisted()).frostedGlassWallpaper, 'frosted-glass-user');
		assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), oldPng);
		assert.deepEqual(errors, []);
		console.log(
			'REAL PASS: production-compatible UI; real unavailable API; offline appearance/profile Save, reload, preview/Cancel, custom wallpaper, five decoded WebP without Cache Storage'
		);
		console.log(
			'MOCK PASS: corrupt single-thumbnail fallback; reconnect /props cannot overwrite saved appearance or user wallpaper'
		);
		return;
	}
	if (resetOnly) {
		const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40133';
		const conversationId = await page.evaluate(async () => {
			const { db } = await import('/tests/browser/charts-harness.ts');
			const conversation = await db.createConversation('Isolated ISSUE smoke');
			const root = await db.createRootMessage(conversation.id);
			const content = [
				'| A | B |',
				'|---|---|',
				'| 1 | 2 |',
				'',
				'```llampart-chart',
				JSON.stringify({
					type: 'bar',
					title: 'Smoke chart',
					xKey: 'x',
					series: [{ key: 'y', label: 'Value' }],
					data: [{ x: 'A', y: 12 }]
				}),
				'```',
				'',
				'```mermaid',
				'flowchart LR\nA[Browser] --> B[Preview]',
				'```'
			].join('\n');
			await db.createMessageBranch(
				{
					convId: conversation.id,
					type: 'text',
					role: 'assistant',
					timestamp: Date.now(),
					content,
					children: [],
					parent: root,
					model: 'mock/model'
				},
				root
			);
			return conversation.id;
		});
		await page.goto(`${base}/#/chat/${conversationId}`);
		await page.locator('.llampart-assistant-markdown').first().waitFor();
		await page.evaluate(({ key, image }) => localStorage.setItem(key, image), {
			key: wallpaperKey,
			image: oldPng
		});
		assert.equal(await page.locator('.llampart-reasoning-trigger').count(), 0);
		const request = page.waitForRequest((request) => request.url().endsWith('/chat/completions'));
		await page.locator('textarea').first().fill('Synthetic effort smoke');
		await page.locator('textarea').first().press('Enter');
		assert.equal((await request).postDataJSON().chat_template_kwargs, undefined);
		await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
		const assistant = page.locator('.llampart-assistant-markdown').first();
		await assistant
			.locator('.llampart-chart-frame .chart-plot svg')
			.first()
			.waitFor({ timeout: 60000 });
		await assistant.locator('.diagram-surface svg').first().waitFor({ timeout: 60000 });
		const dimensions = (locator) =>
			locator.evaluate((el) => {
				const s = getComputedStyle(el),
					svg = el.querySelector('svg');
				return {
					width: s.width,
					height: s.height,
					padding: s.padding,
					border: s.borderWidth,
					background: s.backgroundColor,
					svgWidth: getComputedStyle(svg).width,
					svgHeight: getComputedStyle(svg).height
				};
			});
		const tableStyle = await dimensions(assistant.locator('.table-preview-button').first());
		for (const frame of ['.llampart-chart-frame', '.llampart-diagram-frame']) {
			const eye = assistant.locator(`${frame} .visualization-preview-action`);
			await eye.scrollIntoViewIfNeeded();
			assert.deepEqual(await dimensions(eye), tableStyle);
			await eye.click();
			await page.getByRole('dialog').waitFor();
			await page.keyboard.press('Escape');
		}
		await screenshot('issues-1920');
		nativeLevels = undefined;
		await page.reload();
		await page.waitForFunction(
			async (id) =>
				(await import('/tests/browser/charts-harness.ts')).conversations.activeConversation?.id ===
				id,
			conversationId
		);
		assert.equal(await page.locator('.llampart-reasoning-trigger').count(), 0);
		await open();
		await appearance();
		await page.locator('#uiScale').fill('110');
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		await dialog.getByRole('button', { name: 'Dodaj nowy serwer', exact: true }).click();
		await page.locator('#server-url-new-server').fill('http://mcp-smoke.invalid/mcp');
		await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
		const mcpBeforeSave = JSON.parse(JSON.parse(await persisted()).mcpServers);
		assert.equal(mcpBeforeSave.length, 1);
		assert.equal(mcpBeforeSave[0].url, 'http://mcp-smoke.invalid/mcp');
		await save();
		await dialog.waitFor({ state: 'hidden' });
		await open();
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		await dialog
			.getByText(/mcp-smoke\.invalid/)
			.first()
			.waitFor();
		assert.deepEqual(JSON.parse(JSON.parse(await persisted()).mcpServers), mcpBeforeSave);
		await close('button');
		await page.reload();
		await open();
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		await dialog
			.getByText(/mcp-smoke\.invalid/)
			.first()
			.waitFor();
		assert.deepEqual(JSON.parse(JSON.parse(await persisted()).mcpServers), mcpBeforeSave);
		assert.equal(JSON.parse(await persisted()).uiScale, '110');
		await screenshot('mcp-after-save-reopen-reload-1920');
		console.log(
			'PASS ISSUE-04: UI Add MCP → bottom Save → reopen → reload; UI + localStorage preserve exact ID/URL and independent UI Scale edit'
		);
		await dialog.getByRole('button', { name: 'Edytuj serwer', exact: true }).click();
		await page
			.locator(`[id="server-url-${mcpBeforeSave[0].id}"]`)
			.fill('http://mcp-smoke.invalid/edited');
		await dialog.getByRole('button', { name: 'Zaktualizuj', exact: true }).click();
		await save();
		await dialog.waitFor({ state: 'hidden' });
		await page.reload();
		assert.equal(
			JSON.parse(JSON.parse(await persisted()).mcpServers)[0].url,
			'http://mcp-smoke.invalid/edited'
		);
		await open();
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		await dialog.getByRole('button', { name: 'Usuń serwer', exact: true }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń', exact: true }).click();
		await save();
		await dialog.waitFor({ state: 'hidden' });
		await page.reload();
		assert.deepEqual(JSON.parse(JSON.parse(await persisted()).mcpServers), []);
		await open();
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		assert.equal(await dialog.getByText(/mcp-smoke\.invalid/).count(), 0);
		// Leave a configured endpoint for the subsequent full Reset to remove.
		await dialog.getByRole('button', { name: 'Dodaj nowy serwer', exact: true }).click();
		await page.locator('#server-url-new-server').fill('http://mcp-smoke.invalid/mcp');
		await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
		console.log(
			'PASS ISSUE-04 UI: MCP Edit and Delete → bottom Save → reload preserve their exact results'
		);
		await page.evaluate(async () => {
			const { toolsStore } = await import('/src/lib/stores/tools.svelte.ts');
			const { permissionsStore } = await import('/src/lib/stores/permissions.svelte.ts');
			toolsStore.toggleTool('builtin:reset-smoke');
			permissionsStore.allowTool('builtin:reset-smoke');
		});
		await dialog.getByRole('button', { name: 'Model', exact: true }).click();
		assert.equal(await page.locator('#temperature').inputValue(), '0.2');
		await dialog.getByRole('button', { name: 'Resetuj', exact: true }).click();
		const confirmation = page.getByRole('alertdialog');
		await confirmation.waitFor({ state: 'visible' });
		assert((await confirmation.textContent()).includes('kluczy API'));
		assert((await confirmation.textContent()).includes('MCP'));
		await confirmation.getByRole('button', { name: 'Przywróć domyślne', exact: true }).click();
		await confirmation.waitFor({ state: 'hidden' });
		smokeEnglish = true;
		assert(await dialog.isVisible(), 'the settings form must stay open');
		await dialog.getByRole('button', { name: 'General', exact: true }).waitFor();
		const checkFullDefaults = async () => {
			const result = await page.evaluate(async () => {
				const { SETTING_CONFIG_DEFAULT, GLOBAL_CONFIG_STORAGE_DEFAULT } =
					await import('/src/lib/constants/settings-config.ts');
				const { settings, db, conversations } = await import('/tests/browser/charts-harness.ts');
				const { toolsStore } = await import('/src/lib/stores/tools.svelte.ts');
				const { permissionsStore } = await import('/src/lib/stores/permissions.svelte.ts');
				const { mcpStore } = await import('/src/lib/stores/mcp.svelte.ts');
				return {
					current: { ...settings.config },
					defaults: SETTING_CONFIG_DEFAULT,
					overrides: [...settings.userOverrides],
					conversations: (await db.getAllConversations()).map((c) => c.id),
					stored: JSON.parse(localStorage.getItem('LlamaCppWebui.config')),
					auxiliaryDefaults: Object.entries(GLOBAL_CONFIG_STORAGE_DEFAULT).every(
						([key, value]) => localStorage.getItem(key) === value
					),
					toolsEnabled: toolsStore.isToolEnabled('builtin:reset-smoke'),
					permissions: [...permissionsStore.tools],
					pendingMcp: conversations.pendingMcpServerOverrides,
					connectedServers: mcpStore.connectedServerCount
				};
			});
			assert.deepEqual(result.current, result.defaults);
			delete result.stored.__llampartSettingsVersion;
			assert.deepEqual(result.stored, JSON.parse(JSON.stringify(result.defaults)));
			assert.deepEqual(result.overrides, []);
			assert.equal(result.auxiliaryDefaults, true);
			assert.equal(result.toolsEnabled, true);
			assert.deepEqual(result.permissions, []);
			assert.deepEqual(result.pendingMcp, []);
			assert.equal(result.connectedServers, 0);
			assert(result.conversations.includes(conversationId));
		};
		await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '100');
		await checkFullDefaults();
		await dialog.getByRole('button', { name: 'MCP', exact: true }).click();
		assert.equal(await dialog.getByText(/mcp-smoke\.invalid/).count(), 0);
		await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
		assert.equal(await page.locator('#uiScale').inputValue(), '100');
		assert.match(await page.locator('#fontFamily').textContent(), /Merriweather/);
		assert.match(await page.locator('#fontVariant').textContent(), /Regular — 400/);
		assert.match(await page.locator('#fontSize').textContent(), /13 px/);
		await screenshot('full-reset-english-defaults-1920');
		await close('button');
		await page.reload();
		await page.waitForSelector('textarea');
		await checkFullDefaults();
		assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), oldPng);
		await open();
		for (const section of ['General', 'Appearance', 'Chat', 'Model', 'MCP', 'Tools', 'Advanced'])
			await dialog.getByRole('button', { name: section, exact: true }).click();
		console.log(
			'PASS ISSUE-02: one FULL Reset restores every schema field, English, appearance, MCP=[], empty profiles/keys and overrides; survives reload; conversation history preserved'
		);
		assert.deepEqual(errors, []);
		console.log(
			'PASS 1920x1080: ISSUE-01–04 focused smoke, reasoning exact levels and unknown-level Auto, table-equivalent chart/diagram eye and preview clicks; no page errors'
		);
		return;
	}
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
				.evaluate((el) => el.style.getPropertyValue('--llampart-text-unit')),
			''
		);
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
			'Merriweather (domyślna)'
		);
		await close();
	}
	console.log('PASS A/B: preview + close button/Escape/outside + reopen, storage unchanged');

	// D: structural failure keeps the form/preview, without a network gate.
	await open();
	await appearance();
	await preview();
	await dialog.getByRole('button', { name: 'Ogólne', exact: true }).click();
	await page.locator('#vllmBaseUrl').fill('ftp://invalid.example:9999');
	validationMode = 'failure';
	await save();
	await page.getByRole('alertdialog').waitFor();
	assert.equal(await persisted(), before);
	assert.equal(await scale(), '110');
	await page.getByRole('alertdialog').getByRole('button', { name: 'Zamknij', exact: true }).click();
	assert.equal(await page.locator('#vllmBaseUrl').inputValue(), 'ftp://invalid.example:9999');
	await close();
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '100');
	console.log('PASS D: failed structural validation, editable draft, rollback on close');

	// C: Save commits despite failed provider HTTP; values survive a fresh app load.
	await open();
	await appearance();
	await preview();
	await save();
	await dialog.waitFor({ state: 'hidden' });
	const committed = JSON.parse(await persisted());
	assert.equal(committed.uiScale, '110');
	assert.equal(committed.fontFamily, 'merriweather');
	assert.equal(committed.fontVariant, '700');
	assert.equal(committed.fontSize, '18');
	assert.equal(committed.frostedGlassMilkiness, 17);
	assert.equal(committed.frostedGlassOpaque, true);
	await page.reload();
	await page.waitForSelector('textarea');
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '110');
	assert.equal(await page.locator('html').getAttribute('data-llampart-font'), 'merriweather');
	assert.equal(await page.locator('body').evaluate((el) => getComputedStyle(el).fontSize), '18px');
	await open();
	await appearance();
	assert.equal(await page.locator('#uiScale').inputValue(), '110');
	await select('fontVariant', 'Medium — 500');
	await select('fontFamily', 'Barlow');
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
	console.log('PASS C: changed-field commit, reload and family-only font normalization');

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
	console.log('PASS custom wallpaper: upload preview, cancellation and commit');

	// Real Storage methods fail only for the image key, never for unrelated config.
	for (const mode of ['quota', 'throw', 'verification']) {
		const committed = JSON.parse(await persisted());
		await open();
		await appearance();
		const nextScale = committed.uiScale === '110' ? '105' : '110';
		await page.locator('#uiScale').fill(nextScale);
		await dialog
			.locator('input[type=file]')
			.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: image });
		await page.waitForFunction(() =>
			document.documentElement.style
				.getPropertyValue('--llampart-theme-wallpaper')
				.includes('data:image/png')
		);
		assert.equal(
			await page.getByText('Tapeta użytkownika została zapisana.', { exact: true }).count(),
			0
		);
		await page.evaluate(
			({ key, mode }) => {
				const original = Storage.prototype.setItem;
				window.restoreWallpaperStorage = () => {
					Storage.prototype.setItem = original;
				};
				Storage.prototype.setItem = function (k, value) {
					if (k !== key) return original.call(this, k, value);
					if (this.getItem(key) !== null) throw new Error('Old image was not deleted before write');
					if (mode === 'quota') throw new DOMException('quota', 'QuotaExceededError');
					if (mode === 'throw') throw new Error('Storage test failure');
					return original.call(this, k, 'data:image/png;base64,d3Jvbmc=');
				};
			},
			{ key: wallpaperKey, mode }
		);
		await save();
		const warning = page.getByRole('alertdialog');
		await warning.waitFor();
		assert((await warning.textContent()).includes('Nie udało się zapisać tapety.'));
		assert.equal(await page.evaluate((key) => localStorage.getItem(key), wallpaperKey), null);
		assert.deepEqual(JSON.parse(await persisted()), {
			...committed,
			frostedGlassWallpaper: 'frosted-glass-03'
		});
		assert(await dialog.isVisible(), 'No false onSave/close after a failed commit');
		await warning.getByRole('button', { name: 'Zamknij', exact: true }).click();
		assert.equal(await page.locator('#uiScale').inputValue(), nextScale);
		assert(
			await page
				.locator('html')
				.evaluate((n) => n.style.getPropertyValue('--llampart-theme-wallpaper').includes('03.jpg'))
		);
		await screenshot(`wallpaper-${mode}-failure`);
		await page.evaluate(() => window.restoreWallpaperStorage());
		if (mode !== 'quota') {
			// Retry in the same session, including the still-unsaved unrelated field.
			await dialog
				.locator('input[type=file]')
				.setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: image });
			await page.waitForFunction(() =>
				document.documentElement.style
					.getPropertyValue('--llampart-theme-wallpaper')
					.includes('data:image/png')
			);
			await save();
			await dialog.waitFor({ state: 'hidden' });
			assert.equal(JSON.parse(await persisted()).uiScale, nextScale);
		} else await close('escape');
		await page.reload();
		await page.waitForSelector('textarea');
		assert.equal(
			JSON.parse(await persisted()).uiScale,
			mode === 'quota' ? committed.uiScale : nextScale
		);
		assert.equal(
			await page.evaluate((key) => localStorage.getItem(key) !== null, wallpaperKey),
			mode !== 'quota'
		);
		if (mode === 'quota') {
			assert(
				await page
					.locator('html')
					.evaluate((n) =>
						n.style.getPropertyValue('--llampart-theme-wallpaper').includes('03.jpg')
					)
			);
			await open();
			await appearance();
			await dialog
				.locator('input[type=file]')
				.setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: image });
			await page.waitForFunction(() =>
				document.documentElement.style
					.getPropertyValue('--llampart-theme-wallpaper')
					.includes('data:image/png')
			);
			await save();
			await dialog.waitFor({ state: 'hidden' });
		}
		console.log(
			`PASS wallpaper ${mode}: truthful warning, no false success/toast, fallback, unrelated draft, retry and reload`
		);
	}

	// A delayed FileReader from a closed session must not stage an image in its successor.
	const beforeLateUpload = await persisted();
	await open();
	await appearance();
	const beforeLateWallpaper = await page
		.locator('html')
		.evaluate((n) => n.style.getPropertyValue('--llampart-theme-wallpaper'));
	const lateImage = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 2;
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = 'red';
		ctx.fillRect(0, 0, 2, 2);
		const original = FileReader.prototype.readAsDataURL;
		FileReader.prototype.readAsDataURL = function (file) {
			window.releaseWallpaperRead = () => {
				FileReader.prototype.readAsDataURL = original;
				this.addEventListener('loadend', () => {
					window.wallpaperReadCompleted = true;
				});
				original.call(this, file);
			};
		};
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await dialog.locator('input[type=file]').setInputFiles({
		name: 'late.png',
		mimeType: 'image/png',
		buffer: Buffer.from(lateImage, 'base64')
	});
	await page.waitForFunction(() => typeof window.releaseWallpaperRead === 'function');
	await close('escape');
	await open();
	await appearance();
	await page.evaluate(() => window.releaseWallpaperRead());
	await page.waitForFunction(() => window.wallpaperReadCompleted === true);
	assert.equal(
		await page
			.locator('html')
			.evaluate((n) => n.style.getPropertyValue('--llampart-theme-wallpaper')),
		beforeLateWallpaper
	);
	assert.equal(await persisted(), beforeLateUpload);
	await close();
	console.log('PASS late wallpaper read cannot mutate a newer Settings preview session');

	// Exercise the existing file inputs, download links and reload popup in the real UI.
	async function upload(button, value) {
		const chooser = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: button, exact: true }).click();
		await (
			await chooser
		).setFiles({
			name: 'settings-regression.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(value))
		});
	}
	async function download(button, confirm) {
		const pending = page.waitForEvent('download');
		await dialog.getByRole('button', { name: button, exact: true }).click();
		if (confirm) {
			await page
				.getByRole('dialog', { name: 'Wybierz rozmowy do eksportu', exact: true })
				.getByRole('button', { name: /^Eksportuj \(\d+\)$/ })
				.click();
		}
		const file = await pending;
		return {
			name: file.suggestedFilename(),
			data: JSON.parse(await readFile(await file.path(), 'utf8'))
		};
	}
	async function history() {
		return page.evaluate(
			() =>
				new Promise((resolve, reject) => {
					const request = indexedDB.open('LlamacppWebui');
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						const db = request.result;
						const tx = db.transaction(['conversations', 'messages']);
						const convs = tx.objectStore('conversations').getAll();
						const messages = tx.objectStore('messages').getAll();
						tx.oncomplete = () => {
							resolve({ conversations: convs.result, messages: messages.result });
							db.close();
						};
						tx.onerror = () => {
							reject(tx.error);
							db.close();
						};
					};
				})
		);
	}
	await open();
	await dialog.getByRole('button', { name: 'Dane', exact: true }).click();
	const conversation = {
		conv: {
			id: 'settings-regression-conversation',
			name: 'Settings regression history',
			currNode: 'settings-message',
			lastModified: 1
		},
		messages: [
			{
				id: 'settings-root',
				convId: 'settings-regression-conversation',
				type: 'root',
				role: 'system',
				content: '',
				timestamp: 1,
				parent: null,
				children: ['settings-message'],
				toolCalls: ''
			},
			{
				id: 'settings-message',
				convId: 'settings-regression-conversation',
				type: 'text',
				role: 'user',
				content: 'Preserve this conversation.',
				timestamp: 1,
				parent: 'settings-root',
				children: [],
				toolCalls: ''
			}
		]
	};
	await upload('Importuj rozmowy', {
		type: 'llampart-conversations',
		formatVersion: 1,
		appVersion: '1.9.0',
		exportedAt: new Date().toISOString(),
		conversations: [conversation]
	});
	await page
		.getByRole('dialog', { name: 'Wybierz rozmowy do importu', exact: true })
		.getByRole('button', { name: /^Importuj \(\d+\)$/ })
		.click();
	await dialog.getByText('Zaimportowano 1 rozmowę', { exact: true }).waitFor();
	const historyBefore = await history();
	assert(
		historyBefore.messages.some((message) => message.content === 'Preserve this conversation.')
	);
	const conversationsBefore = await download('Eksportuj rozmowy', true);
	const current = await download('Eksportuj ustawienia');
	assert.match(current.name, /^llampart-settings-\d{4}-\d{2}-\d{2}\.json$/);
	assert.equal(current.data.formatVersion, 1);
	assert(!JSON.stringify(current.data).includes('data:image/'));
	const reloadDialog = page.getByRole('alertdialog', {
		name: 'Ustawienia zaimportowane',
		exact: true
	});
	const labels = [
		'preferencje odpowiedzi',
		'skala interfejsu',
		'typografia',
		'przezroczystość Frosted Glass'
	];
	const envelope = (settings) => ({ type: 'llampart-settings-export', formatVersion: 1, settings });
	await upload('Importuj ustawienia', envelope({ systemMessage: 'Imported older settings' }));
	await reloadDialog.waitFor();
	let text = await reloadDialog.textContent();
	for (const label of labels) assert(text.includes(label), label);
	assert(text.includes('Brakujące ustawienia nie zostały zmienione.'));
	assert(text.includes('Zalecamy wyeksportowanie nowego pliku ustawień'));
	assert(text.includes('Odświeżyć aplikację teraz, aby w pełni je zastosować?'));
	await screenshot('older-settings-popup');
	await reloadDialog.getByRole('button', { name: 'Anuluj', exact: true }).click();
	await reloadDialog.waitFor({ state: 'hidden' });
	assert(await dialog.isVisible());
	let saved = JSON.parse(await persisted());
	assert.equal(saved.systemMessage, 'Imported older settings');
	for (const key of [
		'uiScale',
		'fontFamily',
		'fontVariant',
		'fontSize',
		'frostedGlassMilkiness',
		'frostedGlassOpaque'
	])
		assert.equal(saved[key], current.data.settings[key]);
	const partial = { ...current.data.settings, uiScale: '95' };
	delete partial.fontSize;
	await upload('Importuj ustawienia', envelope(partial));
	await reloadDialog.waitFor();
	text = await reloadDialog.textContent();
	assert(text.includes('typografia'));
	for (const label of labels.filter((label) => label !== 'typografia'))
		assert(!text.includes(label), label);
	await reloadDialog.getByRole('button', { name: 'Anuluj', exact: true }).click();
	await reloadDialog.waitFor({ state: 'hidden' });
	saved = JSON.parse(await persisted());
	assert.equal(saved.uiScale, '95');
	assert.equal(saved.fontSize, current.data.settings.fontSize);
	const beforeInvalid = await persisted();
	const invalidAlert = page.waitForEvent('dialog').then(async (alert) => {
		assert.equal(alert.message(), 'Nie udało się zaimportować ustawień. Sprawdź format pliku.');
		await alert.accept();
	});
	await upload(
		'Importuj ustawienia',
		envelope({ systemMessage: 'Not saved', responsePrefTables: 'false' })
	);
	await invalidAlert;
	assert.equal(await persisted(), beforeInvalid);
	assert.equal(await reloadDialog.isVisible(), false);
	const complete = { ...current.data, settings: { ...current.data.settings, uiScale: '90' } };
	await upload('Importuj ustawienia', complete);
	await reloadDialog.waitFor();
	assert.equal(
		await reloadDialog.locator('[data-slot="alert-dialog-description"]').textContent(),
		'Ustawienia zostały zaimportowane. Odświeżyć aplikację teraz, aby w pełni je zastosować?'
	);
	await Promise.all([
		page.waitForEvent('load'),
		reloadDialog.getByRole('button', { name: 'Odśwież teraz', exact: true }).click()
	]);
	await page.waitForSelector('textarea');
	await page.waitForFunction(() => document.documentElement.dataset.llampartUiScale === '90');
	assert.equal(JSON.parse(await persisted()).uiScale, '90');
	assert.deepEqual(await history(), historyBefore);
	await open();
	await dialog.getByRole('button', { name: 'Dane', exact: true }).click();
	const conversationsAfter = await download('Eksportuj rozmowy', true);
	assert.deepEqual(conversationsAfter.data.conversations, conversationsBefore.data.conversations);
	assert.equal(conversationsAfter.data.type, conversationsBefore.data.type);
	assert.equal(conversationsAfter.data.formatVersion, conversationsBefore.data.formatVersion);
	await close();
	assert.deepEqual(errors, []);
	console.log(
		'PASS settings import/export: older + partial + complete popup, Cancel preserves imports, invalid import is atomic, Reload applies values'
	);
	console.log(
		'PASS independent conversation import/export and nonempty IndexedDB history unchanged; no page errors'
	);
}

try {
	await run();
} finally {
	await browser.close();
}
