/** Fresh Chromium/IndexedDB, real stores/adapters and rendered selector; synthetic final I/O only.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
 * LLAMPART_TEST_URL=http://127.0.0.1:41996
 * LLAMPART_TEST_ARTIFACTS=/tmp/opencode/llampart-own006/browser
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:41996';
const out = process.env.LLAMPART_TEST_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
const image =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
const results = [],
	failures = [];
function check(value, label) {
	if (!value) failures.push(label);
}
try {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		const context = await browser.newContext({ viewport });
		const payloads = [],
			errors = [],
			expectedErrors = [];
		let requests = 0,
			toolTurns = 1,
			protocol = 'chat-completions';
		await context.addInitScript(() => {
			if (localStorage.getItem('own006-initialized')) return;
			localStorage.setItem('own006-initialized', '1');
			localStorage.setItem('llama-webui-migration-v2-done', '1');
			localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'openai-compatible',
					serverBaseUrl: 'http://synthetic.test',
					openAiCompatibleBaseUrl: 'http://synthetic.test',
					apiKey: '',
					preEncodeConversation: false,
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false,
					interfaceLanguage: 'en',
					minimalAgenticIndicators: false
				})
			);
		});
		await context.route('**/*', async (route) => {
			const request = route.request(),
				url = new URL(request.url());
			if (url.origin !== new URL(base).origin) return route.abort();
			if (url.pathname === '/own006-empty')
				return route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>OWN006 isolated stores</title><script>globalThis.__SVELTEKIT_APP_VERSION__="own006";globalThis.__SVELTEKIT_EXPERIMENTAL_EXPLICIT_ENVIRONMENT_VARIABLES__=false</script>'
				});
			if (!url.pathname.startsWith('/__llampart/api/')) return route.continue();
			if (url.pathname.endsWith('/v1/models'))
				return route.fulfill({
					json: {
						object: 'list',
						data: [
							{
								id: 'model-A',
								capabilities: {
									vision: false,
									...(protocol === 'responses' ? { required_protocol: 'responses' } : {})
								}
							},
							{
								id: 'model-B',
								capabilities: {
									vision: true,
									...(protocol === 'responses' ? { required_protocol: 'responses' } : {})
								}
							},
							{
								id: 'unknown-model',
								capabilities: protocol === 'responses' ? { required_protocol: 'responses' } : {}
							}
						]
					}
				});
			if (url.pathname.endsWith('/props'))
				return route.fulfill({
					json: {
						build_info: 'synthetic',
						role: 'router',
						default_generation_settings: { n_ctx: 8192, params: {} }
					}
				});
			if (url.pathname.endsWith('/chat/completions') || url.pathname.endsWith('/responses')) {
				requests++;
				const body = request.postDataJSON();
				payloads.push({ url: url.pathname, body });
				const tool = requests <= toolTurns;
				const call = {
					id: `call-${requests}`,
					type: 'function',
					function: { name: 'synthetic', arguments: '{}' }
				};
				const responses = url.pathname.endsWith('/responses');
				const event = responses
					? {
							type: 'response.completed',
							response: {
								id: `response-${requests}`,
								model: body.model,
								status: 'completed',
								output: [
									{ type: 'reasoning', id: 'opaque', encrypted_content: 'SYNTHETIC_OPAQUE' },
									tool
										? {
												type: 'function_call',
												call_id: call.id,
												name: 'synthetic',
												arguments: '{}'
											}
										: { type: 'message', content: [{ type: 'output_text', text: 'FINAL OWN006' }] }
								]
							}
						}
					: {
							model: body.model,
							choices: [
								{
									delta: tool
										? { tool_calls: [{ ...call, index: 0 }] }
										: { content: 'FINAL OWN006' },
									finish_reason: tool ? 'tool_calls' : 'stop'
								}
							]
						};
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `data: ${JSON.stringify(event)}\n\n${responses ? '' : 'data: [DONE]\n\n'}`
				});
			}
			return route.fulfill({ json: [] });
		});
		const page = await context.newPage();
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			if (message.type() !== 'error') return;
			if (/does not support vision|explicitly does not support vision/.test(message.text()))
				expectedErrors.push(message.text());
			else errors.push(message.text());
		});
		const setup = async () =>
			page.evaluate(async () => {
				const h = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				const { agenticStore: agent } = await import('/src/lib/stores/agentic.svelte.ts');
				const { toolsStore: tools } = await import('/src/lib/stores/tools.svelte.ts');
				const { permissionsStore: permissions } =
					await import('/src/lib/stores/permissions.svelte.ts');
				const { mcpStore: mcp } = await import('/src/lib/stores/mcp.svelte.ts');
				const { ChatService } = await import('/src/lib/services/chat.service.ts');
				const { serverStore: server } = await import('/src/lib/stores/server.svelte.ts');
				const { validateConversationGraph } = await import('/src/lib/utils/conversation-graph.ts');
				const state = (globalThis.own006 = {
					...h,
					agent,
					tools,
					permissions,
					ChatService,
					server,
					validateConversationGraph,
					entered: false,
					gate: 'executor'
				});
				const entry = {
					key: 'builtin:synthetic',
					apiName: 'synthetic',
					source: 'builtin',
					definition: {
						type: 'function',
						function: { name: 'synthetic', parameters: { type: 'object' } }
					}
				};
				agent.getConfig = () => ({ enabled: true, maxTurns: 4, maxToolPreviewLines: 10 });
				tools.hasBuiltinToolsForContext = () => true;
				tools.getEnabledToolEntriesForLLM = () => [entry];
				tools.validateToolExecution = () => {};
				permissions.hasTool = () => state.gate !== 'permission';
				mcp.hasEnabledServers = () => false;
				tools.executeTool = async () => {
					state.entered = true;
					if (state.gate === 'executor')
						await new Promise((done) => {
							state.release = done;
						});
					return { content: 'CONFIRMED OWN006' };
				};
			});
		await page.goto(base);
		await page.waitForSelector('textarea');
		await setup();
		await page.evaluate(async () => {
			await own006.models.fetch();
			await own006.models.selectModelById('model-A');
			const original = own006.db.createRootMessage;
			own006.db.createRootMessage = async (...args) => {
				own006.db.createRootMessage = original;
				own006.creating = true;
				await new Promise((done) => {
					own006.releaseCreation = done;
				});
				return original.apply(own006.db, args);
			};
		});
		// Real UI send, then real dropdown change while the synthetic executor is waiting.
		await page.locator('textarea').fill('OWN006 UI operation');
		await page.locator('textarea').press('Enter');
		await page.waitForFunction(() => own006.creating);
		await page.evaluate(async () => {
			await own006.models.selectModelById('model-B');
			own006.releaseCreation();
		});
		await page.waitForFunction(() => own006.entered);
		check(
			payloads[0]?.body.model === 'model-A',
			`${viewport.width}: new conversation recaptured model after persistence await`
		);
		await page.evaluate(() => own006.models.selectModelById('model-A'));
		const owner = await page.evaluate(() => own006.conversations.activeConversation.id);
		check(
			await page.evaluate(
				() =>
					own006.chat.isLoading &&
					own006.agent.isRunning(own006.conversations.activeConversation.id)
			),
			`${viewport.width}: loading during tool`
		);
		check(
			await page.locator('.llampart-composer-stop-action').isVisible(),
			`${viewport.width}: Stop during tool`
		);
		await page.locator('.llampart-model-selector-trigger').last().click();
		await page.getByRole('option').filter({ hasText: 'model-B' }).click();
		await page.waitForFunction(() => own006.models.selectedModelName === 'model-B');
		check(requests === 1, `${viewport.width}: selector must not restart generation`);
		if (out) await page.screenshot({ path: `${out}/${viewport.width}-waiting.png` });
		await page.evaluate(() => own006.release());
		await page.waitForFunction(
			() =>
				!own006.chat.isLoading &&
				!own006.agent.isRunning(own006.conversations.activeConversation.id)
		);
		check(
			JSON.stringify(payloads.map((item) => item.body.model)) ===
				JSON.stringify(['model-A', 'model-A']),
			`${viewport.width}: FAIL operation payloads ${JSON.stringify(payloads.map((item) => item.body.model))}`
		);
		await page.getByText('FINAL OWN006', { exact: true }).waitFor();
		if (out) await page.screenshot({ path: `${out}/${viewport.width}-completed.png` });
		const firstPayloads = structuredClone(payloads);
		toolTurns = 0;
		await page.locator('textarea').fill('OWN006 FOLLOWUP');
		await page.locator('textarea').press('Enter');
		await page.waitForFunction(
			() =>
				!own006.chat.isLoading &&
				own006.conversations.activeMessages.filter((row) => row.content === 'FINAL OWN006')
					.length === 2
		);
		check(payloads.at(-1).body.model === 'model-B', `${viewport.width}: next operation respects B`);
		requests = 0;
		toolTurns = 1;
		const permissionStart = payloads.length;
		await page.locator('.llampart-model-selector-trigger').last().click();
		await page.getByRole('option').filter({ hasText: 'model-A' }).click();
		await page.evaluate(() => {
			own006.gate = 'permission';
			own006.entered = false;
		});
		await page.locator('textarea').fill('OWN006 PERMISSION');
		await page.locator('textarea').press('Enter');
		await page.locator('.llampart-tool-permission-card').waitFor();
		await page.locator('.llampart-model-selector-trigger').last().click();
		await page.getByRole('option').filter({ hasText: 'model-B' }).click();
		check(requests === 1, `${viewport.width}: dropdown restarted pending permission`);
		if (out) await page.screenshot({ path: `${out}/${viewport.width}-permission.png` });
		await page
			.locator('.llampart-tool-permission-card')
			.getByRole('button', { name: 'Allow once', exact: true })
			.click();
		await page.waitForFunction(
			() =>
				!own006.chat.isLoading &&
				!own006.agent.isRunning(own006.conversations.activeConversation.id)
		);
		const permissionPayloads = payloads.slice(permissionStart);
		check(
			JSON.stringify(permissionPayloads.map((item) => item.body.model)) ===
				JSON.stringify(['model-A', 'model-A']),
			`${viewport.width}: permission changed operation model`
		);
		toolTurns = 0;
		const imageStart = payloads.length;
		await page
			.locator('input[type="file"]')
			.last()
			.setInputFiles({
				name: 'synthetic.png',
				mimeType: 'image/png',
				buffer: Buffer.from(image.split(',')[1], 'base64')
			});
		await page.getByRole('img', { name: 'synthetic.png', exact: true }).first().waitFor();
		if (out) await page.screenshot({ path: `${out}/${viewport.width}-image-composer.png` });
		await page.locator('textarea').fill('OWN006 IMAGE');
		await page.locator('textarea').press('Enter');
		await page.waitForFunction(
			() =>
				!own006.chat.isLoading &&
				own006.conversations.activeMessages.some(
					(row) => row.role === 'user' && row.content === 'OWN006 IMAGE'
				)
		);
		check(
			payloads.length === imageStart + 1 &&
				payloads.at(-1).body.model === 'model-B' &&
				JSON.stringify(payloads.at(-1)).includes(image),
			`${viewport.width}: uploaded image not serialized with selected vision model`
		);
		await page.locator('.llampart-model-selector-trigger').last().click();
		await page.getByRole('option').filter({ hasText: 'model-A' }).click();
		const unsupportedStart = payloads.length;
		await page.locator('textarea').fill('OWN006 UNSUPPORTED HISTORY');
		await page.locator('textarea').press('Enter');
		await page.waitForFunction(
			() => !own006.chat.isLoading && /vision/i.test(own006.chat.errorDialogState?.message || '')
		);
		check(
			payloads.length === unsupportedStart,
			`${viewport.width}: unsupported active historical image reached provider`
		);
		if (out) await page.screenshot({ path: `${out}/${viewport.width}-vision-error.png` });
		await page.evaluate(() => own006.chat.dismissErrorDialog());
		const saved = await page.evaluate(async (id) => {
			const conversation = await own006.db.getConversation(id),
				rows = await own006.db.getConversationMessages(id);
			own006.validateConversationGraph(conversation, rows);
			return { conversation, rows };
		}, owner);
		await page.reload();
		await page.waitForSelector('textarea');
		await setup();
		const reloaded = await page.evaluate(
			async (id) => ({
				conversation: await own006.db.getConversation(id),
				rows: await own006.db.getConversationMessages(id)
			}),
			owner
		);
		assert.deepEqual(reloaded.rows, saved.rows);
		assert.equal(reloaded.conversation.currNode, saved.conversation.currNode);
		check(
			reloaded.rows.some((row) => row.role === 'tool' && row.content === 'CONFIRMED OWN006'),
			'durable tool result after reload'
		);
		check(
			JSON.stringify(reloaded.rows).includes(image),
			'uploaded image lost after rejected request/reload'
		);
		if (out) await page.screenshot({ path: `${out}/${viewport.width}-reload.png` });
		// No rendered-layout source effects in this part: real stores/IndexedDB, controlled sources.
		await page.goto(`${base}/own006-empty`);
		await setup();
		toolTurns = 0;
		const vision = [];
		for (const providerId of ['llama-server', 'openai-compatible', 'vllm']) {
			const before = payloads.length;
			const data = await page.evaluate(
				async ({ providerId, image }) => {
					const h = own006;
					h.settings.updateMultipleConfig({
						apiProvider: providerId,
						serverBaseUrl: 'http://synthetic.test',
						apiKey: ''
					});
					h.models.clear();
					h.server.role = providerId === 'llama-server' ? 'router' : null;
					h.server.props = { role: 'router' };
					await h.models.fetch();
					if (providerId === 'llama-server')
						h.models.models = h.models.models.map((model) => ({
							...model,
							modalities: {
								vision: model.model === 'unknown-model' ? undefined : model.model === 'model-B'
							}
						}));
					const conversation = await h.db.createConversation(`OWN006 images ${providerId}`);
					const root = await h.db.createRootMessage(conversation.id);
					const { AttachmentType } = await import('/src/lib/enums/index.ts');
					await h.db.createMessageBranch(
						{
							convId: conversation.id,
							type: 'text',
							role: 'user',
							content: 'synthetic image',
							children: [],
							timestamp: 1,
							toolCalls: '',
							extra: [{ type: AttachmentType.IMAGE, name: 'synthetic.png', base64Url: image }]
						},
						root
					);
					const rows = await h.db.getConversationMessages(conversation.id);
					const beforeRows = JSON.stringify(rows);
					await h.models.selectModelById('model-B');
					await h.ChatService.sendMessage(rows, { model: 'model-B', stream: true });
					await h.models.selectModelById('unknown-model');
					await h.ChatService.sendMessage(rows, { model: 'unknown-model', stream: true });
					const unknownState = h.models.capabilitySnapshot?.features.vision.state;
					// Reorder catalog so the vision-capable model is first.
					h.models.models = [...h.models.models].reverse();
					await h.models.selectModelById('model-A');
					let error;
					try {
						await h.ChatService.sendMessage(rows, { model: 'model-A', stream: true });
					} catch (caught) {
						error = caught.message;
					}
					const afterRows = JSON.stringify(await h.db.getConversationMessages(conversation.id));
					// Image in an inactive sibling must not enter the selected text branch.
					const text = await h.db.createMessageBranch(
						{
							convId: conversation.id,
							type: 'text',
							role: 'user',
							content: 'active text branch',
							children: [],
							timestamp: 2,
							toolCalls: ''
						},
						root
					);
					const { filterByLeafNodeId } = await import('/src/lib/utils/branching.ts');
					await h.ChatService.sendMessage(
						filterByLeafNodeId(await h.db.getConversationMessages(conversation.id), text.id, false),
						{ model: 'model-A', stream: true }
					);
					const all = await h.db.getConversationMessages(conversation.id);
					h.validateConversationGraph(await h.db.getConversation(conversation.id), all);
					return {
						providerId,
						error,
						unknownState,
						unchanged: beforeRows === afterRows,
						id: conversation.id,
						rows: all
					};
				},
				{ providerId, image }
			);
			const sent = payloads.slice(before);
			check(
				sent.length === 3,
				`${viewport.width}/${providerId}: unsupported image must send zero requests (sent total ${sent.length}, expected vision+unknown+text)`
			);
			check(
				/vision/i.test(data.error || ''),
				`${viewport.width}/${providerId}: explicit vision error missing`
			);
			check(data.unchanged, `${providerId}: image lost from IndexedDB`);
			check(data.unknownState === 'unknown', `${providerId}: unknown must remain unknown`);
			check(
				JSON.stringify(sent[0]).includes(image) && JSON.stringify(sent[1]).includes(image),
				`${providerId}: supported/unknown image lost`
			);
			check(
				!JSON.stringify(sent.at(-1)).includes(image),
				`${providerId}: inactive branch leaked into payload`
			);
			vision.push({ ...data, payloads: sent });
		}
		const protocols = [];
		for (const [providerId, selectedProtocol] of [
			['llama-server', 'chat-completions'],
			['openai-compatible', 'chat-completions'],
			['vllm', 'chat-completions'],
			['openai-compatible', 'responses'],
			['vllm', 'responses']
		]) {
			protocol = selectedProtocol;
			requests = 0;
			toolTurns = 2;
			const start = payloads.length;
			const data = await page.evaluate(
				async ({ providerId, protocol }) => {
					const h = own006;
					h.settings.config = {
						...h.settings.config,
						apiProvider: providerId,
						serverBaseUrl: 'http://synthetic.test',
						capabilities: protocol === 'responses' ? { required_protocol: 'responses' } : undefined
					};
					h.models.clear();
					h.server.role = providerId === 'llama-server' ? 'router' : null;
					h.server.props = { role: 'router' };
					await h.models.fetch();
					await h.models.selectModelById('model-A');
					h.gate = 'none';
					h.tools.executeTool = async () => {
						await h.models.selectModelById('model-B');
						h.models.models = [...h.models.models].reverse();
						return { content: 'CONFIRMED MULTITURN', isError: false };
					};
					const conversation = await h.db.createConversation(`OWN006 ${providerId}/${protocol}`);
					await h.db.createRootMessage(conversation.id);
					await h.conversations.loadConversations();
					await h.conversations.loadConversation(conversation.id);
					h.chat.syncLoadingStateForChat(conversation.id);
					await h.chat.sendMessage('OWN006 protocol tools');
					const first = await h.db.getConversationMessages(conversation.id);
					await h.chat.sendMessage('OWN006 protocol followup');
					const rows = await h.db.getConversationMessages(conversation.id),
						saved = await h.db.getConversation(conversation.id);
					h.validateConversationGraph(saved, rows);
					return {
						providerId,
						protocol,
						id: conversation.id,
						first,
						rows,
						currNode: saved.currNode,
						terminal: h.agent.getSession(conversation.id).terminalReason
					};
				},
				{ providerId, protocol }
			);
			const sent = payloads.slice(start);
			check(
				JSON.stringify(sent.map((item) => item.body.model)) ===
					JSON.stringify(['model-A', 'model-A', 'model-A', 'model-B']),
				`${providerId}/${protocol}: multi-turn ownership ${JSON.stringify(sent.map((item) => item.body.model))}`
			);
			check(
				data.first.filter((row) => row.role === 'tool').length === 2 &&
					data.terminal === 'completed',
				`${providerId}/${protocol}: tool lifecycle`
			);
			if (protocol === 'responses') {
				check(
					sent.every((item) => item.body.store === false && !item.body.previous_response_id),
					`${providerId}: stateless Responses`
				);
				check(
					JSON.stringify(sent[1]).includes('SYNTHETIC_OPAQUE'),
					`${providerId}: opaque continuation lost`
				);
			}
			protocols.push({ ...data, payloads: sent });
		}
		protocol = 'chat-completions';
		toolTurns = 0;
		const entrypoints = [];
		for (const operation of [
			'send',
			'update',
			'regenerate',
			'regenerate-branch',
			'override-branch',
			'edit-branch',
			'source-switch'
		]) {
			const start = payloads.length;
			const data = await page.evaluate(async (operation) => {
				const h = own006;
				h.settings.config = {
					...h.settings.config,
					apiProvider: 'openai-compatible',
					serverBaseUrl: 'http://synthetic.test',
					capabilities: undefined
				};
				h.models.clear();
				await h.models.fetch();
				await h.models.selectModelById(operation === 'override-branch' ? 'model-B' : 'model-A');
				const conversation = await h.db.createConversation(`OWN006 entry ${operation}`);
				const root = await h.db.createRootMessage(conversation.id);
				const user = await h.db.createMessageBranch(
					{
						convId: conversation.id,
						role: 'user',
						type: 'text',
						content: 'ENTRY USER',
						children: [],
						timestamp: 1,
						toolCalls: ''
					},
					root
				);
				const answer = await h.db.createMessageBranch(
					{
						convId: conversation.id,
						role: 'assistant',
						type: 'text',
						content: 'ENTRY ANSWER',
						model: 'model-A',
						children: [],
						timestamp: 2,
						toolCalls: ''
					},
					user.id
				);
				await h.conversations.loadConversations();
				await h.conversations.loadConversation(conversation.id);
				h.chat.syncLoadingStateForChat(conversation.id);
				h.agent.getConfig = () => ({ enabled: false, maxTurns: 4, maxToolPreviewLines: 10 });
				let entered, release;
				const ready = new Promise((done) => {
						entered = done;
					}),
					gate = new Promise((done) => {
						release = done;
					});
				const key = 'createMessageBranch',
					original = h.db[key];
				let once = false;
				h.db[key] = async (...args) => {
					if (!once) {
						once = true;
						entered();
						await gate;
					}
					return original.apply(h.db, args);
				};
				let pending;
				try {
					pending =
						operation === 'update'
							? h.chat.updateMessage(user.id, 'UPDATED')
							: operation === 'regenerate'
								? h.chat.regenerateMessage(answer.id)
								: ['regenerate-branch', 'override-branch'].includes(operation)
									? h.chat.regenerateMessageWithBranching(
											answer.id,
											operation === 'override-branch' ? 'model-B' : undefined
										)
									: operation === 'edit-branch'
										? h.chat.editMessageWithBranching(user.id, 'BRANCHED')
										: h.chat.sendMessage('ENTRY FOLLOWUP');
					await Promise.race([
						ready,
						pending.then(() => {
							throw new Error(`missing persistence gate: ${operation}`);
						})
					]);
					await h.models.selectModelById(operation === 'override-branch' ? 'model-A' : 'model-B');
					if (operation === 'source-switch') {
						h.settings.updateMultipleConfig({ serverBaseUrl: 'http://changed.synthetic.test' });
						h.chat.handleProviderSourceSwitch();
					}
					release();
					await pending;
				} finally {
					release();
					h.db[key] = original;
				}
				const id = conversation.id;
				const rows = await h.db.getConversationMessages(id),
					saved = await h.db.getConversation(id);
				h.validateConversationGraph(saved, rows);
				return { operation, id, rows, currNode: saved.currNode, error: h.chat.errorDialogState };
			}, operation);
			const sent = payloads.slice(start),
				expected = operation === 'override-branch' ? 'model-B' : 'model-A';
			check(
				operation === 'source-switch'
					? sent.length === 0
					: sent.length === 1 && sent[0].body.model === expected,
				`${operation}: snapshot before persistence await ${JSON.stringify(sent.map((item) => item.body.model))}`
			);
			entrypoints.push({ ...data, payloads: sent });
		}
		requests = 0;
		toolTurns = 2;
		const parallelStart = payloads.length;
		const parallel = await page.evaluate(async () => {
			const h = own006;
			h.settings.updateMultipleConfig({
				apiProvider: 'openai-compatible',
				serverBaseUrl: 'http://synthetic.test'
			});
			h.models.clear();
			await h.models.fetch();
			await h.models.selectModelById('model-A');
			h.agent.getConfig = () => ({ enabled: true, maxTurns: 4, maxToolPreviewLines: 10 });
			let readyA, readyB, releaseA, releaseB;
			const aReady = new Promise((done) => {
					readyA = done;
				}),
				bReady = new Promise((done) => {
					readyB = done;
				});
			let executions = 0;
			h.tools.executeTool = async () => {
				executions++;
				const first = executions === 1;
				await new Promise((done) => {
					if (first) {
						releaseA = done;
						readyA();
					} else {
						releaseB = done;
						readyB();
					}
				});
				return { content: first ? 'PARALLEL_RESULT_A' : 'PARALLEL_RESULT_B', isError: false };
			};
			const a = await h.db.createConversation('OWN006 parallel A'),
				b = await h.db.createConversation('OWN006 parallel B');
			await h.db.createRootMessage(a.id);
			await h.db.createRootMessage(b.id);
			await h.conversations.loadConversations();
			await h.conversations.loadConversation(a.id);
			h.chat.syncLoadingStateForChat(a.id);
			const aPending = h.chat.sendMessage('PARALLEL_A');
			await Promise.race([
				aReady,
				aPending.then(() => {
					throw new Error('A ended before executor');
				})
			]);
			await h.models.selectModelById('model-B');
			await h.conversations.loadConversation(b.id);
			h.chat.syncLoadingStateForChat(b.id);
			const bPending = h.chat.sendMessage('PARALLEL_B');
			await Promise.race([
				bReady,
				bPending.then(() => {
					throw new Error('B ended before executor');
				})
			]);
			releaseA();
			await aPending;
			const bStillLoading = h.chat.isLoading && h.chat.isChatLoadingPublic(b.id);
			const visibleOwned = h.conversations.activeMessages.every((row) => row.convId === b.id);
			releaseB();
			await bPending;
			const records = await Promise.all(
				[a.id, b.id].map(async (id) => {
					const conversation = await h.db.getConversation(id),
						rows = await h.db.getConversationMessages(id);
					h.validateConversationGraph(conversation, rows);
					return { id, rows, currNode: conversation.currNode };
				})
			);
			return { bStillLoading, visibleOwned, records };
		});
		const parallelPayloads = payloads.slice(parallelStart);
		check(
			JSON.stringify(parallelPayloads.map((item) => item.body.model)) ===
				JSON.stringify(['model-A', 'model-B', 'model-A', 'model-B']),
			'parallel operation model isolation'
		);
		check(parallel.bStillLoading && parallel.visibleOwned, 'A completion changed visible B state');
		results.push({
			viewport,
			owner,
			firstPayloads,
			permissionPayloads,
			payloads,
			saved,
			vision,
			protocols,
			entrypoints,
			parallel: { ...parallel, payloads: parallelPayloads },
			errors,
			expectedErrors
		});
		check(
			errors.length === 0,
			`${viewport.width}: unexpected console/page errors ${JSON.stringify(errors)}`
		);
		await context.close();
	}
} finally {
	if (out) await writeFile(`${out}/results.json`, JSON.stringify({ results, failures }, null, 2));
	await browser.close();
}
assert.deepEqual(failures, []);
console.log(
	'PASS effective-model ownership: real UI dropdown, tool gate, next operation, IndexedDB/reload, vision and inactive branches, both desktop sizes'
);
