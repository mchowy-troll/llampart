/** Isolated rendered UI smoke; all DB operations and provider failures are synthetic.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs LLAMPART_TEST_URL=http://127.0.0.1:41989 node tests/browser/tool-image-review-ui.mjs
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:41989';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const image =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
try {
	const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
	let generationRequests = 0;
	await context.addInitScript(() => {
		localStorage.setItem('llama-webui-migration-v2-done', '1');
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'llama-server',
				serverBaseUrl: 'http://synthetic.test',
				llamaServerBaseUrl: 'http://synthetic.test',
				apiKey: '',
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false,
				interfaceLanguage: 'en'
			})
		);
	});
	await context.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== new URL(base).origin) return route.abort();
		if (!url.pathname.startsWith('/__llampart/api/')) return route.continue();
		if (url.pathname.includes('/chat/completions') || url.pathname.endsWith('/responses'))
			generationRequests++;
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
	await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
		await welcome.locator('#about-llampart-do-not-show-again').check();
		await welcome.getByRole('button', { name: 'OK', exact: true }).click();
	});
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	try {
		await page.goto(base);
		await page.waitForSelector('textarea');
		const ids = await page.evaluate(async () => {
			const { db, conversations: c } =
				await import('/tests/browser/reasoning-props-cancellation-harness.ts');
			const ids = [];
			for (const name of ['Review A', 'Review B']) {
				const conv = await db.createConversation(name);
				ids.push(conv.id);
				const root = await db.createRootMessage(conv.id);
				if (name === 'Review A') {
					const assistant = await db.createMessageBranch(
						{
							convId: conv.id,
							parent: root,
							children: [],
							timestamp: 1,
							role: 'assistant',
							type: 'text',
							content: '',
							toolCalls: ''
						},
						root
					);
					const identity = {
						conversationId: conv.id,
						assistantMessageId: assistant.id,
						operationId: 'review'
					};
					await db.completeAgenticAssistant(identity, {
						content: '',
						toolCalls: JSON.stringify([
							{ id: 'call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
						])
					});
					await db.transitionAgenticToolCall(identity, 'call', { status: 'started' }, assistant.id);
					globalThis.__reviewIdentity = identity;
				} else {
					await db.createMessageBranch(
						{
							convId: conv.id,
							parent: root,
							children: [],
							timestamp: 2,
							role: 'user',
							type: 'text',
							content: 'B only',
							toolCalls: ''
						},
						root
					);
				}
			}
			await c.loadConversations();
			await c.loadConversation(ids[0]);
			return ids;
		});
		await page.evaluate(
			async ({ a, b, image }) => {
				const {
					db,
					chat,
					conversations: c
				} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				const { extractToolResultImages } = await import('/src/lib/utils/tool-result-images.ts');
				const identity = globalThis.__reviewIdentity;
				// Stop is before the late confirmed result; the synthetic tool completion is gated by navigation.
				await chat.stopGenerationForChat(a);
				await db.finishAgenticTurn(identity, 'stopped');
				await c.loadConversation(b);
				const { cleanedResult, attachments } = extractToolResultImages(`LATE\n${image}`);
				await db.transitionAgenticToolCall(
					identity,
					'call',
					{ status: 'completed', result: { content: cleanedResult, extras: attachments } },
					identity.assistantMessageId
				);
				const assistant = (await db.getConversationMessages(a)).find(
					(row) => row.id === identity.assistantMessageId
				);
				if (
					assistant?.agentic?.terminalReason !== 'stopped' ||
					assistant.agentic.calls[0].status !== 'completed'
				)
					throw new Error('Stop/late lifecycle changed');
				if (c.activeConversation?.id !== b) throw new Error('late result navigated away from B');
			},
			{ a: ids[0], b: ids[1], image }
		);
		await page.getByText('B only', { exact: true }).waitFor();
		assert.equal(
			await page.locator('img[alt^="mcp-attachment-"]').count(),
			0,
			'A image leaked into B'
		);
		await page.evaluate(async (id) => {
			const { conversations: c } =
				await import('/tests/browser/reasoning-props-cancellation-harness.ts');
			await c.loadConversation(id);
		}, ids[0]);
		await page.getByText('synthetic', { exact: true }).first().click();
		const images = page.locator('img[alt^="mcp-attachment-"]');
		await images.first().waitFor();
		assert.equal(await images.count(), 1, 'late image lost from A');
		await images.first().evaluate((img) => img.decode());
		if (artifacts) await page.screenshot({ path: `${artifacts}/review-stop-late-A-B.png` });

		const refusal = await page.evaluate(async (id) => {
			const { db, chat } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
			const { ChatService } = await import('/src/lib/services/chat.service.ts');
			const { ErrorDialogType } = await import('/src/lib/enums/index.ts');
			const rows = await db.getConversationMessages(id);
			const context = ChatService.createProviderRequestContext();
			let message;
			try {
				await ChatService.sendMessage(rows, {
					operationModel: {
						model: 'synthetic-model',
						requestContext: context,
						capabilities: Promise.resolve(undefined)
					},
					stream: false
				});
			} catch (error) {
				message = error.message;
			}
			if (!message?.includes('Tool result images')) throw new Error(`No image refusal: ${message}`);
			// Exercise the rendered dialog with the real refusal; the stream callback owns this assignment in production.
			chat.errorDialogState = { type: ErrorDialogType.SERVER, message };
			return message;
		}, ids[0]);
		assert.equal(generationRequests, 0, 'refused image triggered generation I/O');
		await page.getByText(refusal, { exact: true }).first().waitFor();
		if (artifacts) await page.screenshot({ path: `${artifacts}/review-refusal-dialog.png` });
		assert.deepEqual(pageErrors, []);
		console.log(
			'PASS UI Stop/late result + A→B isolation (synthetic DB transition); real ChatService refusal displayed in dialog'
		);
	} finally {
		await context.close();
	}
} finally {
	await browser.close();
}
