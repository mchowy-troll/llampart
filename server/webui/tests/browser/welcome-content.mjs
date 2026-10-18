/**
 * Real Welcome modal, six languages, constrained viewports and maximum UI scale.
 * Run after check/tests on a stable Vite server; do not rebuild while it runs.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40140 node tests/browser/welcome-content.mjs
 * The 1.9.0 → 2.0.0 probe overrides only the browser's Vite package.json module,
 * never the package file or release configuration. Omit it for production preview
 * with LLAMPART_TEST_PRODUCTION=1.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40140';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/welcome-update-chromium';
const packageUrl = new URL('../../package.json', import.meta.url);
const originalPackage = await readFile(packageUrl, 'utf8');
const { version: appVersion } = JSON.parse(originalPackage);
const approved = JSON.parse(
	await readFile(new URL('../fixtures/welcome-approved-copy.json', import.meta.url), 'utf8')
);
const dismissalKey = 'Llampart.aboutDismissedVersion';
const authorsUrl = 'https://github.com/mchowy-troll/llampart/blob/main/AUTHORS.md';
const reports = [];
const errors = [];
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});

async function setup(context, language, scale, savedVersion = null) {
	await context.addInitScript(
		({ language, scale, key, savedVersion }) => {
			if (sessionStorage.getItem('welcome-content-initialized')) return;
			sessionStorage.setItem('welcome-content-initialized', 'true');
			localStorage.setItem('welcome-unrelated-preference', 'keep-me');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					interfaceLanguage: language,
					uiScale: scale,
					fontFamily: 'merriweather',
					fontVariant: '400',
					theme: 'frosted-glass',
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://mock.invalid:8000',
					llamaServerBaseUrl: 'http://mock.invalid:8000'
				})
			);
			if (savedVersion !== null) localStorage.setItem(key, savedVersion);
		},
		{ language, scale, key: dismissalKey, savedVersion }
	);
	await context.route('**/__llampart/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		return route.fulfill({
			json: path.endsWith('/props')
				? {
						build_info: 'welcome-content-test',
						model_path: 'test.gguf',
						default_generation_settings: { params: {} }
					}
				: path.endsWith('/models')
					? { object: 'list', data: [{ id: 'test.gguf' }] }
					: {}
		});
	});
}

async function checkGeometry(welcome) {
	const geometry = await welcome.evaluate((dialog) => {
		const grid = dialog.children[0];
		const [identity, info] = grid.children;
		const scroller = info.firstElementChild;
		const footer = dialog.children[1];
		const rect = (element) => element.getBoundingClientRect().toJSON();
		const noHorizontalOverflow = (element) => element.scrollWidth <= element.clientWidth + 1;
		return {
			dialog: rect(dialog),
			footer: rect(footer),
			grid: rect(grid),
			identity: rect(identity),
			info: rect(info),
			viewport: [innerWidth, innerHeight],
			noHorizontalOverflow: [
				dialog,
				grid,
				identity,
				info,
				scroller,
				...dialog.querySelectorAll('section')
			].every(noHorizontalOverflow),
			fontSize: getComputedStyle(dialog.querySelector('section p')).fontSize,
			rootScrollTop: dialog.scrollTop,
			scrollHeight: scroller.scrollHeight,
			clientHeight: scroller.clientHeight
		};
	});
	assert(geometry.noHorizontalOverflow, JSON.stringify(geometry));
	assert(geometry.dialog.top >= -1 && geometry.dialog.bottom <= geometry.viewport[1] + 1);
	assert(geometry.footer.top >= geometry.grid.bottom - 1);
	assert(geometry.footer.bottom <= geometry.dialog.bottom + 1);
	assert(geometry.identity.right <= geometry.info.left + 1, 'Keep the two-column composition');
	assert(geometry.info.bottom <= geometry.footer.top + 1);
	assert.equal(geometry.rootScrollTop, 0, 'Only the existing content panels should scroll');
	return geometry;
}

try {
	for (const language of ['en', 'pl', 'de', 'fr', 'it', 'es']) {
		for (const [width, height, scale] of [
			[1920, 1080, '100'],
			[1024, 768, '110'],
			[390, 844, '110'],
			[640, 360, '110']
		]) {
			const context = await browser.newContext({ viewport: { width, height } });
			try {
				await setup(context, language, scale);
				const page = await context.newPage();
				page.on('pageerror', (error) => errors.push(error.message));
				await page.goto(base);
				const welcome = page.locator('.llampart-about-dialog-content');
				await welcome.waitFor();
				await page.evaluate(() => document.fonts.ready);
				const section = welcome.locator('section').first();
				const paragraphs = section.locator('p');
				assert.equal(await paragraphs.count(), 4);
				const texts = await paragraphs.allTextContents();
				if (approved[language]) assert.deepEqual(texts, approved[language]);
				assert.equal(await section.locator('ul, ol, h1, h2, h3, p *').count(), 0);
				assert(!texts.some((text) => text.includes('dialogs.') || text.length < 250));
				const paragraphGeometry = await paragraphs.evaluateAll((elements) =>
					elements.map((el) => {
						const r = el.getBoundingClientRect();
						return { top: r.top, bottom: r.bottom, font: getComputedStyle(el).fontSize };
					})
				);
				for (let i = 1; i < paragraphGeometry.length; i++) {
					assert(
						paragraphGeometry[i].top > paragraphGeometry[i - 1].bottom,
						'Separate paragraphs naturally'
					);
					assert.equal(paragraphGeometry[i].font, paragraphGeometry[0].font);
				}
				const cards = welcome.locator('.llampart-about-info-card');
				assert.equal(await cards.count(), 3);
				assert((await cards.nth(0).textContent()).includes('Marcin Gluziński'));
				assert.equal(
					await cards.nth(0).locator('a').getAttribute('href'),
					'mailto:gluzinski.marcin@gmail.com'
				);
				assert((await cards.nth(1).textContent()).includes(appVersion));
				assert.equal(
					await cards.nth(2).locator('a').getAttribute('href'),
					'https://github.com/mchowy-troll/llampart'
				);
				assert.equal(
					await welcome.locator('img[alt="llampart"]').getAttribute('src'),
					'/llampart.svg'
				);
				for (const url of [
					authorsUrl,
					'https://github.com/ggml-org/llama.cpp',
					'https://unsplash.com/license'
				]) {
					assert.equal(await welcome.locator(`a[href="${url}"]`).getAttribute('target'), '_blank');
				}
				assert((await welcome.locator('section').last().textContent()).includes('MIT'));
				const geometry = await checkGeometry(welcome);
				await page.screenshot({ path: `${artifacts}/${language}-${width}-top.png` });
				// Every paragraph and the last license paragraph must be reachable;
				// scrolling either column may never displace the footer controls.
				for (const paragraph of await paragraphs.all()) {
					await paragraph.scrollIntoViewIfNeeded();
					assert(
						await paragraph.evaluate((el) => {
							const scroller = el.closest('section').parentElement;
							const r = el.getBoundingClientRect(),
								s = scroller.getBoundingClientRect();
							return r.bottom > s.top && r.top < s.bottom;
						})
					);
				}
				await welcome.locator('section').last().scrollIntoViewIfNeeded();
				await cards.nth(2).scrollIntoViewIfNeeded();
				await checkGeometry(welcome);
				await page.screenshot({ path: `${artifacts}/${language}-${width}-bottom.png` });
				const checkbox = page.locator('#about-llampart-do-not-show-again');
				const ok = welcome.getByRole('button', { name: 'OK', exact: true });
				for (const control of [ok, checkbox]) {
					assert(
						await control.evaluate((el) => {
							const r = el.getBoundingClientRect();
							return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
						})
					);
				}
				if (language === 'en' && width === 1920) {
					await context.route(authorsUrl, (route) =>
						route.fulfill({ contentType: 'text/plain', body: 'Authors document link regression' })
					);
					const popupPromise = page.waitForEvent('popup');
					await welcome.locator(`a[href="${authorsUrl}"]`).click();
					const popup = await popupPromise;
					await popup.waitForLoadState();
					assert.equal(popup.url(), authorsUrl);
					await popup.close();
				}
				await checkbox.focus();
				await page.keyboard.press('Space');
				assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
				await ok.focus();
				await page.keyboard.press('Enter');
				await welcome.waitFor({ state: 'hidden' });
				assert.equal(
					await page.evaluate((key) => localStorage.getItem(key), dismissalKey),
					appVersion
				);
				assert.equal(
					await page.evaluate(() => localStorage.getItem('welcome-unrelated-preference')),
					'keep-me'
				);
				reports.push({ language, width, height, scale, geometry });
				console.log(`PASS Welcome content: ${language}, ${width}×${height}, UI ${scale}%`);
			} finally {
				await context.close();
			}
		}
	}

	if (!process.env.LLAMPART_TEST_PRODUCTION) {
		const context = await browser.newContext();
		try {
			await setup(context, 'en', '110', '1.9.0');
			let overrides = 0;
			await context.route('**/package.json*', async (route) => {
				const response = await route.fetch();
				const source = await response.text();
				assert(
					source.includes(JSON.stringify(appVersion)),
					'Intercept the actual central version module'
				);
				overrides++;
				await route.fulfill({
					response,
					body: source.replaceAll(JSON.stringify(appVersion), '"2.0.0"')
				});
			});
			const page = await context.newPage();
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto(base);
			const welcome = page.locator('.llampart-about-dialog-content');
			await welcome.waitFor();
			assert(
				(await welcome.locator('.llampart-about-info-card').nth(1).textContent()).includes('2.0.0')
			);
			assert.equal(
				await page.locator('#about-llampart-do-not-show-again').getAttribute('aria-checked'),
				'false'
			);
			const conversation = await page.evaluate(async () => {
				const { db } = await import('/tests/browser/charts-harness.ts');
				return db.createConversation('Welcome persistence sentinel');
			});
			await page.keyboard.press('Escape');
			await welcome.waitFor({ state: 'hidden' });
			assert.equal(await page.evaluate((key) => localStorage.getItem(key), dismissalKey), '1.9.0');
			await page.reload();
			await welcome.waitFor();
			await page.locator('#about-llampart-do-not-show-again').click();
			await welcome.getByRole('button', { name: 'OK', exact: true }).click();
			await welcome.waitFor({ state: 'hidden' });
			assert.equal(await page.evaluate((key) => localStorage.getItem(key), dismissalKey), '2.0.0');
			await page.reload();
			await page.waitForSelector('textarea');
			assert.equal(await welcome.count(), 0);
			assert.equal(
				await page.evaluate(() => localStorage.getItem('welcome-unrelated-preference')),
				'keep-me'
			);
			assert.deepEqual(
				await page.evaluate(async (id) => {
					const { db } = await import('/tests/browser/charts-harness.ts');
					return db.getConversation(id);
				}, conversation.id),
				conversation,
				'Keep the saved IndexedDB conversation unchanged'
			);
			assert.deepEqual(
				await page.evaluate(() => {
					const { interfaceLanguage, uiScale, fontFamily, theme } = JSON.parse(
						localStorage.getItem('LlamaCppWebui.config')
					);
					return { interfaceLanguage, uiScale, fontFamily, theme };
				}),
				{
					interfaceLanguage: 'en',
					uiScale: '110',
					fontFamily: 'merriweather',
					theme: 'frosted-glass'
				}
			);
			assert(overrides > 0);
			assert.equal(await readFile(packageUrl, 'utf8'), originalPackage);
			console.log(
				'PASS test-only central version 1.9.0 → 2.0.0: redisplay, checkbox, Escape, persistence, reload'
			);
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(errors, []);
	await writeFile(`${artifacts}/results.json`, JSON.stringify(reports, null, 2));
} finally {
	await browser.close();
}
