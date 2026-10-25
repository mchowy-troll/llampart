/**
 * Dev-only integration regression: real stores, real IndexedDB and rendered chat.
 * Only provider HTTP is mocked; barriers expose the cancellation/cleanup races.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/reasoning-props-cancellation.mjs
 */
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const url = process.env.LLAMPART_TEST_URL || 'http://localhost:5173';
const errors = [];

try {
	for (const scenario of ['abort', 'stale-context', 'replacement']) {
		const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
		const page = await context.newPage();
		await page.addLocatorHandler(
			page.locator('.llampart-about-dialog-content'),
			async (welcome) => {
				await welcome.locator('#about-llampart-do-not-show-again').check();
				await welcome.getByRole('button', { name: 'OK', exact: true }).click();
			}
		);
		page.on('pageerror', (error) => errors.push(error.message));
		const requests = [];
		let releaseProps, releaseResponse, captureCompletion;
		const propsGate = new Promise((done) => {
			releaseProps = done;
		});
		const responseGate = new Promise((done) => {
			releaseResponse = done;
		});
		const completionCaptured = new Promise((done) => {
			captureCompletion = done;
		});
		try {
			await page.addInitScript(() => {
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({
						apiProvider: 'llama-server',
						interfaceLanguage: 'en',
						serverBaseUrl: 'http://source-a.test',
						llamaServerBaseUrl: 'http://source-a.test',
						titleGenerationUseLLM: false,
						askForTitleConfirmation: false,
						alwaysShowSidebarOnDesktop: true
					})
				);
			});
			await page.route('**/__llampart/api/**', async (route) => {
				const request = route.request();
				const path = new URL(request.url());
				const source = request.headers()['x-llampart-host'];
				if (path.pathname.endsWith('/chat/completions')) {
					requests.push({ source, body: request.postDataJSON() });
					captureCompletion();
					await responseGate;
					return route.fulfill({
						contentType: 'text/event-stream',
						body:
							'data: {"choices":[{"delta":{"content":"New source answer"}}]}\n\n' +
							'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
					});
				}
				if (path.pathname.endsWith('/props')) {
					const model = path.searchParams.get('model');
					if (model && source === 'source-a.test') await propsGate;
					return route.fulfill({
						json: {
							build_info: 'props-cancellation-test',
							role: model ? 'model' : 'router',
							default_generation_settings: { n_ctx: 8192, params: {} },
							chat_template: model ? '{% if enable_thinking %}think{% endif %}' : ''
						}
					});
				}
				if (path.pathname.endsWith('/models'))
					return route.fulfill({
						json: {
							object: 'list',
							data: [{ id: 'test-model', status: { value: 'loaded' } }]
						}
					});
				return route.fulfill({ json: [] });
			});
			await page.goto(url);
			await page.waitForSelector('textarea');
			const fixture = await page.evaluate(async () => {
				const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				const conv = await db.createConversation('Preserved history');
				const root = await db.createRootMessage(conv.id);
				const create = (role, content, parent) =>
					db.createMessageBranch(
						{
							convId: conv.id,
							role,
							content,
							type: 'text',
							timestamp: Date.now(),
							children: [],
							toolCalls: ''
						},
						parent
					);
				const priorUser = await create('user', 'Earlier question', root);
				const priorAssistant = await create('assistant', 'Earlier correct answer', priorUser.id);
				return {
					convId: conv.id,
					priorUser: (await db.getConversationMessages(conv.id)).find(
						(message) => message.id === priorUser.id
					),
					priorAssistant
				};
			});
			await page.goto(`${url.replace(/\/$/, '')}/#/chat/${fixture.convId}`);
			await page.getByText('Earlier correct answer', { exact: true }).waitFor();
			await page.evaluate(async (fixture) => {
				const { db, chat, conversations, settings, models } =
					await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				window.cancellationTest = { db, chat, conversations, settings, models, ...fixture };
			}, fixture);
			await page.waitForFunction(() => window.cancellationTest.models.models.length > 0);
			await page.evaluate(async () => {
				const t = window.cancellationTest;
				await t.models.selectModelById('test-model');
				t.oldSend = t.chat.sendMessage('Keep this pending question');
			});
			await page.waitForFunction(() => {
				const t = window.cancellationTest;
				return (
					t.chat.abortControllers.has(t.convId) &&
					t.conversations.activeMessages.some(
						(message) => message.role === 'assistant' && !message.content
					)
				);
			});
			assert.equal(
				await page.locator('.llampart-assistant-message:not(.agentic-content)').count(),
				2
			);
			await page.evaluate((scenario) => {
				const t = window.cancellationTest;
				t.pending = t.conversations.activeMessages.find(
					(message) => message.role === 'assistant' && !message.content
				);
				t.originalDelete = t.db.deleteEmptyAssistantMessage;
				t.cleanupGate = new Promise((done) => {
					t.releaseCleanup = done;
				});
				t.db.deleteEmptyAssistantMessage = async (...args) => {
					t.cleanupStarted = true;
					await t.cleanupGate;
					return t.originalDelete(...args);
				};
				if (scenario === 'stale-context') {
					// Exercise the context guard independently of the AbortSignal path.
					t.originalSwitch = t.chat.handleProviderSourceSwitch;
					t.chat.handleProviderSourceSwitch = () => {};
				}
				t.settings.updateMultipleConfig({
					serverBaseUrl: 'http://source-b.test',
					llamaServerBaseUrl: 'http://source-b.test'
				});
			}, scenario);
			if (scenario === 'stale-context') releaseProps();
			await page.waitForFunction(() => window.cancellationTest.cleanupStarted);
			assert.deepEqual(requests, [], 'No completion request may reach the old source');

			if (scenario === 'replacement') {
				await page.waitForFunction(() =>
					window.cancellationTest.models.getModelProps('test-model')
				);
				const replacementRequest = page.waitForRequest((request) =>
					request.url().endsWith('/chat/completions')
				);
				await page.evaluate(async () => {
					const t = window.cancellationTest;
					// Start a real replacement generation while old cleanup is suspended,
					// on a sibling leaf in the SAME conversation (stronger than switching chats).
					t.newAssistant = await t.db.createMessageBranch(
						{
							convId: t.convId,
							role: 'assistant',
							type: 'text',
							content: '',
							timestamp: Date.now(),
							children: [],
							toolCalls: '',
							model: null
						},
						t.pending.parent
					);
					t.conversations.addMessageToActive(t.newAssistant);
					await t.conversations.updateCurrentNode(t.newAssistant.id);
					t.chat.setChatLoading(t.convId, true);
					t.newSend = t.chat.streamChatCompletion(
						t.conversations.activeMessages.filter(
							(message) => ![t.pending.id, t.newAssistant.id].includes(message.id)
						),
						t.newAssistant,
						undefined,
						undefined,
						t.chat.captureGenerationModel()
					);
				});
				await replacementRequest;
				await completionCaptured;
				assert.equal(requests.length, 1);
				assert.equal(requests[0].source, 'source-b.test');
			}
			const state = await page.evaluate(async () => {
				const t = window.cancellationTest;
				t.releaseCleanup();
				await t.oldSend;
				return {
					conversation: await t.db.getConversation(t.convId),
					messages: await t.db.getConversationMessages(t.convId),
					active: t.conversations.activeConversation,
					uiMessages: t.conversations.activeMessages,
					pending: t.pending,
					newer: t.newAssistant,
					priorUser: t.priorUser,
					priorAssistant: t.priorAssistant,
					loading: t.chat.isChatLoadingPublic(t.convId),
					isLoading: t.chat.isLoading,
					streaming: t.chat.isStreaming(),
					error: t.chat.errorDialogState
				};
			});
			assert(!state.messages.some((message) => message.id === state.pending.id));
			assert(!state.uiMessages.some((message) => message.id === state.pending.id));
			assert(
				state.messages.some(
					(message) => message.content === 'Keep this pending question' && message.role === 'user'
				)
			);
			assert.deepEqual(
				state.messages.find((message) => message.id === state.priorUser.id),
				state.priorUser
			);
			assert.equal(
				state.messages.find((message) => message.id === state.priorAssistant.id).content,
				'Earlier correct answer'
			);
			for (const message of state.messages) {
				for (const child of message.children)
					assert.equal(state.messages.find((item) => item.id === child)?.parent, message.id);
				if (message.parent)
					assert(
						state.messages.find((item) => item.id === message.parent)?.children.includes(message.id)
					);
			}
			assert.equal(state.conversation.currNode, state.newer?.id || state.pending.parent);
			assert.equal(state.active.currNode, state.conversation.currNode);
			assert.equal(state.loading, scenario === 'replacement');
			assert.equal(state.isLoading, scenario === 'replacement');
			assert.equal(state.streaming, scenario === 'replacement');
			assert.equal(state.error, null);
			await page.getByText('Earlier correct answer', { exact: true }).waitFor();
			assert.equal(
				await page.locator('.llampart-assistant-message:not(.agentic-content)').count(),
				scenario === 'replacement' ? 2 : 1
			);
			assert.equal(
				await page.locator('.llampart-composer-stop-action').count(),
				scenario === 'replacement' ? 1 : 0
			);
			releaseProps();
			if (scenario === 'replacement') {
				releaseResponse();
				await page.evaluate(() => window.cancellationTest.newSend);
				await page.getByText('New source answer', { exact: true }).waitFor();
				assert.equal(await page.evaluate(() => window.cancellationTest.chat.isLoading), false);
			}
			assert.equal(requests.filter((request) => request.source === 'source-a.test').length, 0);
			console.log(
				`PASS Chromium ${scenario}: actual IndexedDB, reciprocal graph/currNode, user/history/UI preserved, no old-source HTTP`
			);
		} catch (error) {
			console.error(
				'Cancellation scenario diagnostics',
				scenario,
				await page.evaluate(async () => {
					const t = window.cancellationTest;
					return t
						? {
								active: t.conversations.activeConversation,
								ui: t.conversations.activeMessages,
								db: await t.db.getConversationMessages(t.convId),
								loading: t.chat.getAllLoadingChats(),
								controllers: [...t.chat.abortControllers.keys()],
								error: t.chat.errorDialogState,
								model: t.models.selectedModelName,
								operationLocks: [...t.chat.conversationOperationLocks],
								url: location.href
							}
						: null;
				})
			);
			throw error;
		} finally {
			releaseProps();
			releaseResponse();
			await context.close();
		}
	}
	assert.deepEqual(errors, []);
} finally {
	await browser.close();
}
