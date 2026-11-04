/** REAL UI/DOM Settings + IndexedDB; MOCK provider; isolated browser profiles.
 * All 25 locales: Save/Cancel/Reset. Six locales: responsive/scale matrix.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { INTERFACE_LANGUAGES } from '../../src/lib/i18n/types.ts';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40367';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/task6a-i18n';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const reports = [];
try {
	for (const language of INTERFACE_LANGUAGES) {
		const dictionary = (await import(`../../src/lib/i18n/locales/${language}.ts`))[language];
		const tr = (key) => key.split('.').reduce((node, part) => node[part], dictionary);
		const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		await context.addInitScript((language) => {
			if (!localStorage.getItem('LlamaCppWebui.config'))
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({
						interfaceLanguage: language,
						chartsEnabled: false,
						diagramsEnabled: false,
						responsePrefCharts: true,
						responsePrefDiagrams: true,
						apiProvider: 'llama-server',
						serverBaseUrl: 'http://i18n.test',
						llamaServerBaseUrl: 'http://i18n.test',
						titleGenerationUseLLM: false,
						askForTitleConfirmation: false
					})
				);
		}, language);
		await context.route('**/__llampart/api/**', (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/chat/completions'))
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `data: ${JSON.stringify({ choices: [{ delta: { content: '```llampart-chart\n{"raw":true}\n```\n\n```mermaid\nflowchart LR\nA-->B\n```' } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
				});
			return route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'capabilities-i18n-test',
							model_path: 'test.gguf',
							default_generation_settings: { params: {} }
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'test.gguf' }] }
						: []
			});
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addLocatorHandler(
			page.locator('.llampart-about-dialog-content'),
			async (welcome) => {
				await welcome.locator('#about-llampart-do-not-show-again').check();
				await welcome
					.getByRole('button', { name: tr('dialogs.aboutLlampartClose'), exact: true })
					.click();
			}
		);
		const dialog = page.locator('.llampart-chat-settings-dialog-content');
		const config = () =>
			page.evaluate(() => JSON.parse(localStorage.getItem('LlamaCppWebui.config')));
		async function open(section = 'sectionChat') {
			await page.locator(`button[aria-label="${tr('sidebar.settings')}"]`).click();
			await dialog.getByRole('button', { name: tr('settings.' + section), exact: true }).click();
		}
		await page.goto(base);
		await page.locator('textarea').first().fill('i18n');
		await page.locator('textarea').first().press('Enter');
		for (const kind of ['charts', 'diagrams'])
			await page.getByText(tr(kind + '.disabled'), { exact: true }).waitFor();
		await open();
		const group = page.locator('[data-settings-group="visualizations"]');
		assert.equal(
			await group.getByText(tr('settings.groupVisualizations'), { exact: true }).count(),
			1
		);
		for (const kind of ['Charts', 'Diagrams'])
			assert.equal(
				await group.getByText(tr('settings.field' + kind + 'Enabled'), { exact: true }).count(),
				1
			);
		if (['en', 'pl', 'bg', 'el', 'de', 'csb', 'es'].includes(language)) {
			for (const scale of ['90', '100', '110']) {
				await dialog
					.getByRole('button', { name: tr('settings.sectionAppearance'), exact: true })
					.click();
				await page.locator('#uiScale').fill(scale);
				await dialog.getByRole('button', { name: tr('settings.sectionChat'), exact: true }).click();
				for (const width of [390, 800, 1440]) {
					await page.setViewportSize({ width, height: 1000 });
					await group.scrollIntoViewIfNeeded();
					const overflow = await group.evaluate((el) => {
						const labels = [...el.querySelectorAll('label')];
						return {
							group: el.scrollWidth > el.clientWidth + 1,
							labels: labels.some((label) => label.scrollWidth > label.clientWidth + 1),
							page: document.documentElement.scrollWidth > innerWidth
						};
					});
					assert.deepEqual(
						overflow,
						{ group: false, labels: false, page: false },
						`${language}/${scale}/${width}`
					);
					await page.screenshot({ path: `${artifacts}/${language}-${scale}-${width}.png` });
					if (width < 768) {
						// Existing Settings intentionally uses a 48rem horizontal canvas.
						// Verify that the other end is reachable, not pretend the whole
						// form fits in a 390px viewport or truncate translated text.
						const shell = page.locator('.llampart-chat-settings-scroll-shell');
						const right = await shell.evaluate((el) => {
							el.scrollLeft = el.scrollWidth;
							return { actual: el.scrollLeft, max: el.scrollWidth - el.clientWidth };
						});
						assert.equal(right.actual, right.max);
						assert(right.max > 0);
						assert(
							await group
								.locator('label,p')
								.evaluateAll((nodes) =>
									nodes.every((node) => getComputedStyle(node).textOverflow !== 'ellipsis')
								)
						);
						await page.screenshot({ path: `${artifacts}/${language}-${scale}-${width}-right.png` });
					}
				}
				await page.setViewportSize({ width: 1440, height: 1000 });
			}
		}
		await page.locator('#chartsEnabled').check();
		await page.locator('#diagramsEnabled').check();
		await dialog.getByRole('button', { name: tr('settings.sectionGeneral'), exact: true }).click();
		for (const key of ['responsePrefCharts', 'responsePrefDiagrams']) {
			assert(await page.locator('#' + key).isVisible());
			assert.equal(await page.locator('#' + key).getAttribute('aria-checked'), 'true');
		}
		await dialog.getByRole('button', { name: tr('common.close'), exact: true }).click();
		assert.equal((await config()).chartsEnabled, false);
		assert.equal((await config()).diagramsEnabled, false);
		await open();
		await page.locator('#chartsEnabled').check();
		await page.locator('#diagramsEnabled').check();
		await dialog.getByRole('button', { name: tr('common.saveSettings'), exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		assert.equal((await config()).chartsEnabled, true);
		assert.equal((await config()).diagramsEnabled, true);
		await open();
		await page.locator('#chartsEnabled').uncheck();
		await page.locator('#diagramsEnabled').uncheck();
		await dialog.getByRole('button', { name: tr('common.saveSettings'), exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		await open();
		await dialog.getByRole('button', { name: tr('common.reset'), exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: tr('common.resetToDefault'), exact: true })
			.click();
		await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
		assert.equal((await config()).chartsEnabled, true);
		assert.equal((await config()).diagramsEnabled, true);
		assert.deepEqual(errors, []);
		reports.push({
			language,
			save: 'PASS',
			cancel: 'PASS',
			reset: 'PASS',
			responsive: ['en', 'pl', 'bg', 'el', 'de', 'csb', 'es'].includes(language)
				? '9 width/scale cases'
				: 'not requested'
		});
		console.log(
			`PASS ${language}: localized labels/fallback, visible preferences, Save/Cancel/Reset`
		);
		await context.close();
	}
} finally {
	await writeFile(`${artifacts}/report.json`, JSON.stringify(reports, null, 2));
	await browser.close();
}
