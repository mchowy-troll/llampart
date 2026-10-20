/** Real rendered UI and IndexedDB, synthetic messages only.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs LLAMPART_TEST_URL=http://127.0.0.1:41989 node tests/browser/tool-image-ui.mjs
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:41989';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const red =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const green =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC';
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
try {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		const context = await browser.newContext({ viewport });
		await context.addInitScript(() => {
			localStorage.setItem('llama-webui-migration-v2-done', '1');
			localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://synthetic.test',
					llamaServerBaseUrl: 'http://synthetic.test',
					apiKey: '',
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false,
					interfaceLanguage: 'en',
					minimalAgenticIndicators: false
				})
			);
		});
		await context.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.origin !== new URL(base).origin) return route.abort();
			if (!url.pathname.startsWith('/__llampart/api/')) return route.continue();
			if (url.pathname.endsWith('/props'))
				return route.fulfill({
					json: {
						build_info: 'synthetic',
						role: 'model',
						default_generation_settings: { n_ctx: 8192, params: {} }
					}
				});
			if (url.pathname.endsWith('/models'))
				return route.fulfill({ json: { object: 'list', data: [{ id: 'synthetic-model' }] } });
			return route.fulfill({ json: [] });
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		try {
			await page.goto(base);
			await page.waitForSelector('textarea');
			const ids = await page.evaluate(
				async ({ red, green }) => {
					const { db, conversations: c } =
						await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					const { extractToolResultImages } = await import('/src/lib/utils/tool-result-images.ts');
					const ids = [];
					for (const [name, images] of [
						['One tool PNG', [red]],
						['Two tool PNGs', [red, green]]
					]) {
						const conv = await db.createConversation(name);
						ids.push(conv.id);
						const root = await db.createRootMessage(conv.id);
						const assistant = await db.createMessageBranch(
							{
								convId: conv.id,
								role: 'assistant',
								type: 'text',
								content: '',
								toolCalls: '',
								parent: root,
								children: [],
								timestamp: 1
							},
							root
						);
						const identity = {
							conversationId: conv.id,
							assistantMessageId: assistant.id,
							operationId: 'synthetic-ui'
						};
						await db.completeAgenticAssistant(identity, {
							content: '',
							toolCalls: JSON.stringify([
								{ id: 'call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
							])
						});
						await db.transitionAgenticToolCall(
							identity,
							'call',
							{ status: 'started' },
							assistant.id
						);
						const { cleanedResult, attachments } = extractToolResultImages(
							`TEXT\n${images.join('\nBETWEEN\n')}`
						);
						await db.transitionAgenticToolCall(
							identity,
							'call',
							{ status: 'completed', result: { content: cleanedResult, extras: attachments } },
							assistant.id
						);
						await db.finishAgenticTurn(identity, 'completed');
					}
					await c.loadConversations();
					return ids;
				},
				{ red, green }
			);
			for (const [index, [name, count]] of [
				['One tool PNG', 1],
				['Two tool PNGs', 2]
			].entries()) {
				await page.evaluate(async (id) => {
					const { conversations: c } =
						await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					await c.loadConversation(id);
				}, ids[index]);
				await page.getByText('synthetic', { exact: true }).first().click();
				const images = page.locator('img[alt^="mcp-attachment-"]');
				await images.first().waitFor();
				assert.equal(await images.count(), count);
				await images.evaluateAll((nodes) => Promise.all(nodes.map((node) => node.decode())));
				assert.deepEqual(
					await images.evaluateAll((nodes) =>
						nodes.map((node) => ({ width: node.naturalWidth, height: node.naturalHeight }))
					),
					Array.from({ length: count }, () => ({ width: 1, height: 1 }))
				);
				if (artifacts)
					await page.screenshot({
						path: `${artifacts}/${viewport.width}-${name.replaceAll(' ', '-')}.png`
					});
				await page.reload();
				await page.waitForSelector('textarea');
				await page.evaluate(async (id) => {
					const { conversations: c } =
						await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					await c.loadConversations();
					await c.loadConversation(id);
				}, ids[index]);
				await page.getByText('synthetic', { exact: true }).first().click();
				await images.first().waitFor();
				assert.equal(await images.count(), count, 'reload duplicated or lost image');
			}
			assert.deepEqual(errors, []);
			console.log(
				`PASS UI ${viewport.width}x${viewport.height} single/two images, decoded PNG, reload`
			);
		} finally {
			await context.close();
		}
	}
} finally {
	await browser.close();
}
