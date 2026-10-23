/** AUD-007: synthetic data in fresh Chromium contexts, no user profile. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
try {
	for (const width of [1440, 390]) {
		for (const fullHeightCodeBlocks of [false, true]) {
			console.log({ width, fullHeightCodeBlocks });
			const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await page.addInitScript((fullHeightCodeBlocks) => {
				localStorage.setItem('llama-webui-migration-v2-done', '1');
				localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({
						apiProvider: 'llama-server',
						llamaServerBaseUrl: 'http://synthetic.invalid',
						interfaceLanguage: 'en',
						theme: 'frosted-glass',
						fullHeightCodeBlocks,
						alwaysShowSidebarOnDesktop: true,
						titleGenerationUseLLM: false,
						askForTitleConfirmation: false
					})
				);
			}, fullHeightCodeBlocks);
			await page.route('**/__llampart/api/**', (route) =>
				route.fulfill({
					json: route.request().url().endsWith('/models')
						? { data: [{ id: 'synthetic.gguf' }] }
						: { model_path: 'synthetic.gguf', default_generation_settings: { params: {} } }
				})
			);
			await page.goto(process.env.LLAMPART_TEST_URL);
			await page.locator('textarea').first().waitFor();
			await page.locator('button[aria-label="Settings"]:visible').click();
			const dialog = page.locator('.llampart-chat-settings-dialog-content');
			await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
			await page.setViewportSize({ width, height: 900 });
			assert.equal(
				await dialog.locator('#fullHeightCodeBlocks').count(),
				process.env.AUD_BASELINE ? 1 : 0
			);
			await dialog.locator('#renderReasoningContentAsMarkdown').scrollIntoViewIfNeeded();
			await page.screenshot({
				path: `${artifacts}/${process.env.AUD_BASELINE ? 'before' : 'after'}-${width}-${fullHeightCodeBlocks}.png`
			});
			assert.deepEqual(errors, []);
			results.push({ width, fullHeightCodeBlocks, errors, result: 'PASS' });
			await context.close();
		}
	}
	await writeFile(
		`${artifacts}/settings-results-${process.env.AUD_BASELINE ? 'before' : 'after'}.json`,
		JSON.stringify(results, null, 2)
	);
	console.log(`PASS ${results.length} isolated desktop/mobile legacy settings cases`);
} finally {
	await browser.close();
}
