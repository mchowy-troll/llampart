/** AUD-004: real composer/ChatStore/ChatService with mocked llama-server SSE.
 * New disposable Chromium context and synthetic IndexedDB only. No real backend.
 * Set LLAMPART_PLAYWRIGHT_MODULE, LLAMPART_TEST_URL; optionally ARTIFACTS/CHROMIUM. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40136';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let requests = 0;
await context.addInitScript(() => {
	localStorage.setItem('llama-webui-migration-v2-done', '1');
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://synthetic.invalid',
			llamaServerBaseUrl: 'http://synthetic.invalid',
			preEncodeConversation: false,
			titleGenerationUseLLM: false,
			askForTitleConfirmation: false,
			alwaysShowSidebarOnDesktop: true,
			interfaceLanguage: 'en'
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
		return route.fulfill({
			json: {
				object: 'list',
				data: [{ id: 'synthetic-model' }]
			}
		});
	if (url.pathname.endsWith('/chat/completions')) {
		requests++;
		return route.fulfill({
			contentType: 'text/event-stream',
			body:
				'data: {"choices":[{"delta":{"content":"Synthetic partial response"}}]}\n\n' +
				'data: {"error":{"code":500,"type":"server_error","message":"AUDIT backend error"}}\n\n' +
				'data: [DONE]\n\n'
		});
	}
	return route.fulfill({ json: [] });
});
try {
	await page.goto(base);
	const composer = page.locator('textarea');
	await composer.waitFor();
	await page.waitForFunction(() => {
		const input = document.querySelector('textarea');
		return input && !input.disabled;
	});
	if (artifacts) await page.screenshot({ path: `${artifacts}/ui-before.png` });
	await page.evaluate(async () => {
		const { ChatService } = await import('/src/lib/services/chat.service.ts');
		const send = ChatService.sendMessage;
		globalThis.terminalCounts = { complete: 0, error: 0 };
		ChatService.sendMessage = function (messages, options, ...rest) {
			return send.call(
				this,
				messages,
				{
					...options,
					onComplete: (...values) => {
						globalThis.terminalCounts.complete++;
						return options.onComplete?.(...values);
					},
					onError: (error) => {
						globalThis.terminalCounts.error++;
						return options.onError?.(error);
					}
				},
				...rest
			);
		};
	});
	await composer.fill('Synthetic AUD-004 prompt');
	await composer.press('Enter');
	const errorDialog = page.getByRole('alertdialog');
	await errorDialog
		.getByText('llama-server reported an error (server_error, code 500)', { exact: true })
		.waitFor();
	const result = await page.evaluate(async () => {
		const { chat, conversations, db } =
			await import('/tests/browser/reasoning-props-cancellation-harness.ts');
		const { loadResumableStreamStates } = await import('/src/lib/utils/resumable-stream-state.ts');
		const conversation = conversations.activeConversation;
		const messages = await db.getConversationMessages(conversation.id);
		return {
			loading: chat.isLoading,
			streaming: chat.isStreaming(),
			callbacks: globalThis.terminalCounts,
			messageRoles: messages.map((message) => message.role),
			assistant: messages
				.filter((message) => message.role === 'assistant')
				.map((message) => ({
					content: message.content,
					agentic: message.agentic
				})),
			resumable: loadResumableStreamStates()
		};
	});
	assert.equal(
		requests,
		1,
		'No tool continuation, pre-encode or reconnect after the backend error'
	);
	assert.equal(result.loading, false);
	assert.equal(result.streaming, false);
	assert.deepEqual(result.callbacks, { complete: 0, error: 1 });
	assert.deepEqual(result.resumable, []);
	for (const assistant of result.assistant) {
		assert.notEqual(assistant.agentic?.terminalReason, 'completed');
		assert.notEqual(assistant.agentic?.status, 'completed');
	}
	assert.deepEqual(errors, []);
	if (artifacts) {
		await page.screenshot({ path: `${artifacts}/ui-backend-error.png` });
		await writeFile(
			`${artifacts}/browser-results.json`,
			JSON.stringify({ requests, result, errors }, null, 2)
		);
	}
	await errorDialog.getByRole('button', { name: /close/i }).click();
	await errorDialog.waitFor({ state: 'hidden' });
	assert(await composer.isEnabled());
	console.log(
		'PASS: real composer → HTTP 200 SSE partial/error/DONE → existing error dialog, no completion/continuation, cleared loading/resumable state, no pageerror'
	);
} catch (error) {
	if (artifacts) await page.screenshot({ path: `${artifacts}/failure.png` });
	throw error;
} finally {
	await context.close();
	await browser.close();
}
