/** AUD-005: real composer, ChatStore, agentic lifecycle, ChatService and IndexedDB.
 * Synthetic HTTP and tool registry only; fresh Chromium storage per scenario.
 * Set LLAMPART_PLAYWRIGHT_MODULE, LLAMPART_TEST_URL, optional LLAMPART_TEST_ARTIFACTS.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40137';
const out = process.env.LLAMPART_TEST_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
const chunk = (index, delta) => ({ choices: [{ index, delta }] });
const sse = (frames) =>
	frames.map((data) => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n';

try {
	for (const provider of ['openai-compatible', 'vllm']) {
		for (const scenario of ['n', 'choices', 'tool-index', 'valid-regenerate']) {
			const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
			const errors = [],
				requests = [];
			await context.addInitScript(
				({ provider, scenario }) => {
					globalThis.aud005Rejections = [];
					addEventListener('unhandledrejection', (event) =>
						aud005Rejections.push(String(event.reason))
					);
					localStorage.setItem('llama-webui-migration-v2-done', '1');
					localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							apiProvider: provider,
							serverBaseUrl: 'http://synthetic.invalid',
							openAiCompatibleBaseUrl: 'http://synthetic.invalid',
							vllmBaseUrl: 'http://synthetic.invalid',
							apiKey: '',
							preEncodeConversation: false,
							titleGenerationUseLLM: false,
							askForTitleConfirmation: false,
							interfaceLanguage: 'en',
							custom: scenario === 'n' ? '{"n":2}' : ''
						})
					);
				},
				{ provider, scenario }
			);
			await context.route('**/*', (route) => {
				const request = route.request(),
					url = new URL(request.url());
				if (url.origin !== new URL(base).origin) return route.abort();
				if (!url.pathname.startsWith('/__llampart/api/')) return route.continue();
				if (url.pathname.endsWith('/models'))
					return route.fulfill({
						json: {
							object: 'list',
							data: [{ id: 'synthetic-model', capabilities: { tools: true } }]
						}
					});
				if (url.pathname.endsWith('/chat/completions')) {
					requests.push(request.postDataJSON());
					const frames =
						scenario === 'tool-index'
							? [
									chunk(0, {
										reasoning: 'safe plan',
										tool_calls: [
											{
												index: 0,
												id: 'call-a',
												type: 'function',
												function: { name: 'synthetic', arguments: '{"x":' }
											}
										]
									}),
									chunk(1, {
										reasoning: 'wrong plan',
										tool_calls: [{ index: 0, function: { arguments: '1}' } }]
									})
								]
							: scenario === 'choices'
								? [
										chunk(0, { content: 'safe partial' }),
										{
											choices: [
												chunk(0, { content: 'A' }).choices[0],
												chunk(1, { content: 'B' }).choices[0]
											]
										}
									]
								: [
										chunk(0, { content: 'AUD-005 valid answer' }),
										{ choices: [], usage: { completion_tokens: 2 } }
									];
					return route.fulfill({ contentType: 'text/event-stream', body: sse(frames) });
				}
				return route.fulfill({ json: [] });
			});
			const page = await context.newPage();
			page.on('pageerror', (error) => errors.push(error.message));
			try {
				await page.goto(base);
				const composer = page.locator('textarea');
				await composer.waitFor();
				await page.locator('.llampart-model-selector-trigger').last().click();
				await page.getByRole('option').filter({ hasText: 'synthetic-model' }).click();
				await page.evaluate(async (scenario) => {
					const { ChatService } = await import('/src/lib/services/chat.service.ts');
					const { agenticStore } = await import('/src/lib/stores/agentic.svelte.ts');
					const { toolsStore } = await import('/src/lib/stores/tools.svelte.ts');
					globalThis.aud005 = { complete: 0, error: 0, executions: 0 };
					const send = ChatService.sendMessage;
					ChatService.sendMessage = function (messages, options, ...rest) {
						return send.call(
							this,
							messages,
							{
								...options,
								onComplete: (...values) => {
									aud005.complete++;
									return options.onComplete?.(...values);
								},
								onError: (error) => {
									aud005.error++;
									return options.onError?.(error);
								}
							},
							...rest
						);
					};
					if (scenario === 'tool-index') {
						agenticStore.getConfig = () => ({
							enabled: true,
							maxTurns: 4,
							maxToolPreviewLines: 10
						});
						toolsStore.getEnabledToolEntriesForLLM = () => [
							{
								key: 'builtin:synthetic',
								apiName: 'synthetic',
								source: 'builtin',
								definition: {
									type: 'function',
									function: { name: 'synthetic', parameters: { type: 'object' } }
								}
							}
						];
						toolsStore.executeTool = async () => {
							aud005.executions++;
							throw new Error('Tool must never execute');
						};
					} else agenticStore.getConfig = () => ({ enabled: false });
				}, scenario);
				await composer.fill(`AUD-005 ${scenario}`);
				await composer.press('Enter');
				if (scenario === 'valid-regenerate') {
					await page.waitForFunction(() => aud005.complete === 1);
					// Real regeneration through ChatStore, retaining branching/persistence behavior.
					await page.evaluate(async () => {
						const { chat, conversations } =
							await import('/tests/browser/reasoning-props-cancellation-harness.ts');
						const assistant = conversations.activeMessages.find(
							(message) => message.role === 'assistant'
						);
						await chat.regenerateMessage(assistant.id);
					});
					await page.waitForFunction(() => aud005.complete === 2);
				} else {
					await page
						.getByRole('alertdialog')
						.getByText(
							scenario === 'n'
								? 'Chat Completions supports only one choice: n must be 1 or null (or omitted)'
								: 'Failed to parse provider stream data',
							{ exact: true }
						)
						.waitFor();
				}
				await page.waitForFunction(async () => {
					const { chat } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					return !chat.isLoading && !chat.isStreaming();
				});
				const state = await page.evaluate(async () => {
					const { db, chat, conversations } =
						await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					const messages = await db.getConversationMessages(conversations.activeConversation.id);
					return {
						callbacks: aud005,
						loading: chat.isLoading,
						streaming: chat.isStreaming(),
						rejections: aud005Rejections,
						tools: messages.filter((message) => message.role === 'tool').length,
						assistants: messages
							.filter((message) => message.role === 'assistant')
							.map((message) => ({
								content: message.content,
								reasoning: message.reasoningContent,
								agentic: message.agentic
							}))
					};
				});
				assert.equal(
					requests.length,
					scenario === 'n' ? 0 : scenario === 'valid-regenerate' ? 2 : 1,
					'No unwanted follow-up'
				);
				assert.deepEqual(state.callbacks, {
					complete: scenario === 'valid-regenerate' ? 2 : 0,
					error: scenario === 'valid-regenerate' ? 0 : 1,
					executions: 0
				});
				assert.equal(state.tools, 0);
				assert.equal(state.loading, false);
				assert.equal(state.streaming, false);
				assert.deepEqual(state.rejections, []);
				assert.deepEqual(errors, []);
				for (const assistant of state.assistants) {
					assert(!assistant.content.includes('AB'));
					assert(!assistant.reasoning?.includes('wrong plan'));
					if (scenario !== 'valid-regenerate') {
						assert.notEqual(assistant.agentic?.terminalReason, 'completed');
						assert.notEqual(assistant.agentic?.status, 'completed');
					}
				}
				for (const request of requests) assert(!Object.hasOwn(request, 'n'));
				results.push({ provider, scenario, requests: requests.length, state, errors });
				if (out) await page.screenshot({ path: `${out}/${provider}-${scenario}.png` });
				console.log(`PASS ${provider}/${scenario}`);
			} catch (error) {
				if (out) await page.screenshot({ path: `${out}/${provider}-${scenario}-failure.png` });
				throw error;
			} finally {
				await context.close();
			}
		}
	}
	if (out) await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
} finally {
	await browser.close();
}
