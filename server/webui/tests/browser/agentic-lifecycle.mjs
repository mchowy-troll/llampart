/** Synthetic executors only; fresh Chromium context, real stores/IndexedDB/UI.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
 * LLAMPART_TEST_URL=http://127.0.0.1:41989 node tests/browser/agentic-lifecycle.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:41989';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
const errors = [],
	results = [];
try {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		const context = await browser.newContext({ viewport });
		await context.addInitScript(() => {
			localStorage.setItem('llama-webui-migration-v2-done', '1');
			localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://synthetic.test',
					llamaServerBaseUrl: 'http://synthetic.test',
					apiKey: '',
					preEncodeConversation: false,
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false,
					interfaceLanguage: 'en',
					minimalAgenticIndicators: false,
					alwaysShowSidebarOnDesktop: true
				})
			);
		});
		await context.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.origin !== new URL(base).origin) return route.abort();
			if (url.pathname === '/own003-empty')
				return route.fulfill({
					contentType: 'text/html',
					body: '<!doctype html><title>Isolated lifecycle</title><script>globalThis.__SVELTEKIT_APP_VERSION__="own003";globalThis.__SVELTEKIT_EXPERIMENTAL_EXPLICIT_ENVIRONMENT_VARIABLES__=false</script>'
				});
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
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			if (
				message.type() === 'error' &&
				!message.text().startsWith('Streaming error: Error: Synthetic HTTP 503')
			)
				errors.push(message.text());
		});
		try {
			await page.goto(`${base}/own003-empty`);
			const matrix = await page.evaluate(async () => {
				const {
					db,
					chat,
					conversations: c,
					settings,
					models
				} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				const { ChatService } = await import('/src/lib/services/chat.service.ts');
				const { agenticStore: agent } = await import('/src/lib/stores/agentic.svelte.ts');
				const { toolsStore: tools } = await import('/src/lib/stores/tools.svelte.ts');
				const { mcpStore: mcp } = await import('/src/lib/stores/mcp.svelte.ts');
				const { permissionsStore: permissions } =
					await import('/src/lib/stores/permissions.svelte.ts');
				const { ToolPermissionDecision } = await import('/src/lib/enums/index.ts');
				const { filterByLeafNodeId } = await import('/src/lib/utils/branching.ts');
				const { validateConversationGraph } = await import('/src/lib/utils/conversation-graph.ts');
				const { createConversationExportEnvelope, parseConversationImport } =
					await import('/src/lib/utils/conversation-import-export.ts');
				const { createCapabilitySnapshot } =
					await import('/src/lib/services/providers/provider-capabilities.ts');
				const check = (value, label) => {
					if (!value) throw new Error(label);
				};
				const stable = (value) =>
					JSON.stringify(value, (_key, item) =>
						item && typeof item === 'object' && !Array.isArray(item)
							? Object.fromEntries(
									Object.keys(item)
										.sort()
										.map((key) => [key, item[key]])
								)
							: item
					);
				const defer = () => {
					let resolve;
					const promise = new Promise((done) => {
						resolve = done;
					});
					return { promise, resolve };
				};
				const until = async (predicate) => {
					const deadline = Date.now() + 10000;
					while (!predicate()) {
						if (Date.now() > deadline) throw new Error('gate timeout');
						await new Promise((done) => setTimeout(done, 5));
					}
				};
				const original = {
					send: ChatService.sendMessage,
					run: agent.runAgenticFlow,
					refresh: models.refreshCapabilities,
					fetch: globalThis.fetch
				};
				const entry = {
					key: 'builtin:synthetic',
					apiName: 'synthetic',
					source: 'builtin',
					definition: {
						type: 'function',
						function: { name: 'synthetic', parameters: { type: 'object' } }
					}
				};
				const call = (id) => ({
					id,
					type: 'function',
					function: { name: 'synthetic', arguments: '{}' }
				});
				tools.hasBuiltinToolsForContext = () => true;
				tools.getEnabledToolEntriesForLLM = () => [entry];
				// This suite replaces registry and execution; real scope resolution has its own suite.
				tools.validateToolExecution = () => {};
				mcp.hasEnabledServers = () => false;
				const records = [];
				for (const scenario of [
					'plain',
					'one-tool',
					'several-tools',
					'limit',
					'first-error',
					'partial-error',
					'later-error',
					'stop-before-permission',
					'stop-permission',
					'stop-after-permission',
					'stop-before-execution',
					'stop-executing-abort',
					'stop-executing-resolve',
					'stop-before-result',
					'stop-during-persistence',
					'stop-between-calls',
					'stop-partial',
					'denied',
					'tool-error',
					'tool-transport-error',
					'delayed-stream-callbacks',
					'A-B'
				]) {
					const conv = await db.createConversation(`own003-${scenario}`),
						id = conv.id;
					await db.createRootMessage(id);
					await c.loadConversations();
					await c.loadConversation(id);
					chat.syncLoadingStateForChat(id);
					settings.config = {
						...settings.config,
						apiProvider: 'llama-server',
						capabilities: undefined
					};
					agent.getConfig = () => ({
						enabled: true,
						maxTurns: scenario === 'limit' ? 1 : 4,
						maxToolPreviewLines: 10
					});
					permissions.hasTool = () =>
						!['stop-permission', 'stop-after-permission', 'denied'].includes(scenario);
					const ready = defer(),
						gate = defer(),
						bReady = defer(),
						bGate = defer();
					let previousStream;
					let requests = 0,
						executions = 0,
						beforeError,
						currentIdentity;
					agent.runAgenticFlow = (params) =>
						original.run.call(agent, {
							...params,
							callbacks: {
								...params.callbacks,
								onAssistantTurnComplete: async (...args) => {
									currentIdentity = args[0];
									await params.callbacks.onAssistantTurnComplete?.(...args);
									if (scenario === 'stop-before-permission' && args[4]?.length)
										await chat.stopGenerationForChat(id);
								},
								onToolCallState: async (...args) => {
									if (scenario === 'stop-during-persistence' && args[2].result) {
										ready.resolve();
										await gate.promise;
									}
									const result = await params.callbacks.onToolCallState?.(...args);
									if (scenario === 'stop-before-execution' && args[2].status === 'started')
										await chat.stopGenerationForChat(id);
									if (scenario === 'stop-between-calls' && result)
										await chat.stopGenerationForChat(id);
									return result;
								}
							}
						});
					tools.executeTool = async (_entry, _args, _context, signal) => {
						executions++;
						const rows = await db.getConversationMessages(id);
						check(
							rows.some((row) => row.agentic?.calls.some((call) => call.status === 'started')),
							`${scenario}: start not durable`
						);
						if (scenario === 'tool-error') return { content: 'ACTUAL_TOOL_ERROR', isError: true };
						if (scenario === 'tool-transport-error') throw new Error('Synthetic HTTP 503');
						if (scenario === 'stop-executing-abort') {
							ready.resolve();
							await new Promise((_, reject) =>
								signal.addEventListener(
									'abort',
									() => reject(new DOMException('unknown effect', 'AbortError')),
									{ once: true }
								)
							);
						}
						if (['stop-executing-resolve', 'A-B'].includes(scenario)) {
							ready.resolve();
							await gate.promise;
						}
						if (scenario === 'stop-before-result') await chat.stopGenerationForChat(id);
						return { content: `CONFIRMED_RESULT_${executions}`, isError: false };
					};
					ChatService.sendMessage = async (_history, options, convId, signal) => {
						if (convId !== id) {
							bReady.resolve();
							await bGate.promise;
							options.onChunk?.('B completed');
							await options.onComplete?.('B completed');
							return;
						}
						requests++;
						if (scenario === 'delayed-stream-callbacks') {
							if (previousStream) {
								previousStream.onChunk?.('STALE_TEXT');
								previousStream.onReasoningChunk?.('STALE_REASONING');
								previousStream.onToolCallChunk?.(JSON.stringify([call('stale-call')]));
								await previousStream.onStreamCheckpoint?.({
									content: 'STALE_CHECKPOINT',
									reasoningContent: '',
									toolCalls: []
								});
							}
							previousStream = options;
						}
						if (scenario === 'stop-partial') {
							options.onChunk?.('PARTIAL_TEXT');
							options.onReasoningChunk?.('PARTIAL_REASONING');
							ready.resolve();
							await new Promise((done) => signal.addEventListener('abort', done, { once: true }));
							return;
						}
						if (
							['first-error', 'partial-error'].includes(scenario) ||
							(scenario === 'later-error' && requests === 3)
						) {
							beforeError = await db.getConversationMessages(id);
							if (scenario === 'partial-error') {
								options.onChunk?.('PARTIAL_TEXT');
								options.onReasoningChunk?.('PARTIAL_REASONING');
							}
							throw new Error('Synthetic HTTP 503');
						}
						const rounds = ['several-tools', 'later-error'].includes(scenario) ? 2 : 1;
						if (scenario !== 'plain' && requests <= rounds) {
							const calls =
								scenario === 'stop-between-calls'
									? [call('first'), call('second')]
									: [call(`call-${requests}`)];
							options.onChunk?.(`ASSISTANT_TURN_${requests}`);
							options.onReasoningChunk?.(`REASONING_${requests}`);
							options.onToolCallChunk?.(JSON.stringify(calls));
							await options.onComplete?.('', undefined, undefined, JSON.stringify(calls));
						} else {
							options.onChunk?.('FINAL_TEXT');
							await options.onComplete?.('FINAL_TEXT');
						}
					};
					const running = chat.sendMessage('Synthetic question');
					if (['stop-permission', 'stop-after-permission', 'denied'].includes(scenario)) {
						await until(() => agent.pendingPermissionRequest(id));
						if (scenario === 'denied') agent.resolvePermission(id, ToolPermissionDecision.DENY);
						else {
							if (scenario === 'stop-after-permission')
								agent.resolvePermission(id, ToolPermissionDecision.ONCE);
							await chat.stopGenerationForChat(id);
						}
					}
					if (
						[
							'stop-executing-abort',
							'stop-executing-resolve',
							'stop-during-persistence',
							'stop-partial',
							'A-B'
						].includes(scenario)
					) {
						await ready.promise;
						let bRunning;
						if (scenario === 'A-B') {
							const b = await db.createConversation('B owned');
							await db.createRootMessage(b.id);
							await c.loadConversations();
							await c.loadConversation(b.id);
							chat.syncLoadingStateForChat(b.id);
							bRunning = chat.sendMessage('B question');
							await bReady.promise;
						}
						await chat.stopGenerationForChat(id);
						gate.resolve();
						await running;
						if (bRunning) {
							check(chat.isLoading && chat.isStreaming(), 'Stop(A) cleared B generation');
							check(
								c.activeMessages.every((row) => row.convId !== id),
								'foreign A message in B'
							);
							bGate.resolve();
							await bRunning;
						}
					}
					await running;
					const savedConv = await db.getConversation(id),
						rows = await db.getConversationMessages(id);
					validateConversationGraph(savedConv, rows);
					if (scenario === 'delayed-stream-callbacks')
						check(
							!JSON.stringify(rows).includes('STALE') &&
								!JSON.stringify(rows).includes('stale-call'),
							'late stream callback mutated another turn'
						);
					const outputs = rows.filter((row) => row.role === 'tool'),
						states = rows.flatMap((row) => row.agentic?.calls ?? []);
					const expectedReason =
						scenario.startsWith('stop-') || scenario === 'A-B'
							? 'stopped'
							: scenario.includes('error') && scenario !== 'tool-error'
								? 'error'
								: scenario === 'limit'
									? 'limit'
									: 'completed';
					check(
						agent.getSession(id).terminalReason === expectedReason,
						`${scenario}: wrong terminal reason`
					);
					check(
						!chat.isChatLoadingPublic(id) && !agent.pendingPermissionRequest(id),
						`${scenario}: stuck loading/permission`
					);
					check(
						!states.some((call) => call.status === 'started'),
						`${scenario}: started left after terminal`
					);
					if (scenario === 'later-error')
						check(
							beforeError
								.filter((row) => row.content || row.toolCalls)
								.every((row) =>
									rows.some((saved) => saved.id === row.id && saved.content === row.content)
								),
							'LLP-003 lost completed history'
						);
					if (scenario === 'limit')
						check(
							outputs[0].content === 'CONFIRMED_RESULT_1' && outputs[0].role === 'tool',
							'LLP-004 overwritten output'
						);
					if (
						[
							'denied',
							'stop-permission',
							'stop-before-permission',
							'stop-before-execution',
							'stop-executing-abort'
						].includes(scenario)
					)
						check(outputs.length === 0, `${scenario}: fake stored output`);
					if (
						[
							'stop-before-permission',
							'stop-permission',
							'stop-after-permission',
							'stop-before-execution',
							'denied'
						].includes(scenario)
					)
						check(executions === 0, `${scenario}: unexpected execution`);
					if (
						[
							'stop-executing-resolve',
							'stop-before-result',
							'stop-during-persistence',
							'stop-between-calls',
							'A-B'
						].includes(scenario)
					)
						check(
							outputs[0]?.content === 'CONFIRMED_RESULT_1',
							`${scenario}: lost confirmed output`
						);
					if (scenario === 'stop-between-calls')
						check(executions === 1 && states[1].status === 'not_started', 'second call executed');
					if (['partial-error', 'stop-partial'].includes(scenario))
						check(
							rows.some(
								(row) =>
									row.content.includes('PARTIAL_TEXT') &&
									row.reasoningContent === 'PARTIAL_REASONING'
							),
							'partial/reasoning lost'
						);
					if (scenario === 'tool-transport-error')
						check(
							requests === 1 &&
								executions === 1 &&
								states[0].status === 'interrupted_unknown' &&
								outputs.length === 0,
							'transport rejection retried or treated as confirmed error'
						);
					const envelope = createConversationExportEnvelope(
						[{ conv: savedConv, messages: rows }],
						'1.9.0'
					);
					const imported = parseConversationImport(JSON.parse(JSON.stringify(envelope)));
					check(
						envelope.formatVersion === 2 && stable(imported[0].messages) === stable(rows),
						`${scenario}: export loss`
					);
					const payloads = [];
					for (const [providerId, protocol] of [
						['llama-server', 'chat-completions'],
						['openai-compatible', 'chat-completions'],
						['vllm', 'chat-completions'],
						['openai-compatible', 'responses'],
						['vllm', 'responses']
					]) {
						settings.config = {
							...settings.config,
							apiProvider: providerId,
							capabilities:
								protocol === 'responses' ? { required_protocol: 'responses' } : undefined
						};
						const ctx = ChatService.createProviderRequestContext();
						models.refreshCapabilities = () =>
							createCapabilitySnapshot(
								ctx,
								'synthetic-model',
								protocol === 'responses' ? { capabilities: { required_protocol: 'responses' } } : {}
							);
						let body;
						globalThis.fetch = async (_url, init) => {
							body = JSON.parse(init.body);
							return new Response(
								JSON.stringify(
									protocol === 'responses'
										? {
												status: 'completed',
												output: [
													{ type: 'message', content: [{ type: 'output_text', text: 'next' }] }
												]
											}
										: { choices: [{ message: { content: 'next' } }] }
								),
								{ headers: { 'Content-Type': 'application/json' } }
							);
						};
						await original.send.call(
							ChatService,
							filterByLeafNodeId(rows, savedConv.currNode, false),
							{ model: 'synthetic-model', stream: false, providerRequestContext: ctx },
							id
						);
						const calls =
							protocol === 'responses'
								? body.input
										.filter((item) => item.type === 'function_call')
										.map((item) => item.call_id)
								: body.messages.flatMap((msg) => (msg.tool_calls ?? []).map((call) => call.id));
						const outs =
							protocol === 'responses'
								? body.input
										.filter((item) => item.type === 'function_call_output')
										.map((item) => item.call_id)
								: body.messages.filter((msg) => msg.role === 'tool').map((msg) => msg.tool_call_id);
						check(
							calls.length === outs.length && calls.every((id) => outs.includes(id)),
							`${scenario}/${providerId}/${protocol}: incomplete protocol`
						);
						check(
							!JSON.stringify(body).includes('"operationId"') &&
								!JSON.stringify(body).includes('"agentic"'),
							'internal lifecycle leaked into protocol'
						);
						check(
							outputs.every((output) => JSON.stringify(body).includes(output.content)),
							'confirmed output missing from payload'
						);
						if (protocol === 'responses')
							check(
								body.store === false && !body.previous_response_id,
								'stateful Responses fallback'
							);
						payloads.push({ providerId, protocol, body });
					}
					globalThis.fetch = original.fetch;
					models.refreshCapabilities = original.refresh;
					records.push({
						scenario,
						id,
						rows,
						states,
						requests,
						executions,
						payloads,
						identity: currentIdentity
					});
					chat.dismissErrorDialog();
				}
				// Simulate a process dying after its durable start barrier. Loading
				// the application must not backfill, retry, or recover this record.
				const crashConv = await db.createConversation('Crash fixture');
				const crashRoot = await db.createRootMessage(crashConv.id);
				const crashAssistant = await db.createMessageBranch(
					{
						convId: crashConv.id,
						role: 'assistant',
						type: 'text',
						content: '',
						children: [],
						timestamp: 1,
						toolCalls: ''
					},
					crashRoot
				);
				const crashIdentity = {
					conversationId: crashConv.id,
					operationId: 'crash-operation',
					assistantMessageId: crashAssistant.id
				};
				await db.completeAgenticAssistant(crashIdentity, {
					content: 'CRASH_PARTIAL',
					reasoningContent: 'CRASH_REASONING',
					toolCalls: JSON.stringify([call('crash-call')]),
					providerContinuation: {
						protocol: 'responses',
						providerId: 'openai-compatible',
						model: 'synthetic-model',
						sourceFingerprint: 'sha256:' + 'a'.repeat(64),
						reasoningItems: [{ type: 'reasoning', encrypted_content: 'CRASH_OPAQUE' }]
					}
				});
				await db.transitionAgenticToolCall(
					crashIdentity,
					'crash-call',
					{ status: 'started' },
					crashAssistant.id
				);
				records.push({
					scenario: 'crash-started',
					id: crashConv.id,
					rows: await db.getConversationMessages(crashConv.id),
					requests: 0,
					executions: 0,
					payloads: []
				});
				ChatService.sendMessage = original.send;
				agent.runAgenticFlow = original.run;
				settings.config = {
					...settings.config,
					apiProvider: 'llama-server',
					capabilities: undefined
				};
				return records;
			});
			results.push({ viewport, matrix });
			await page.goto(base);
			await page.waitForSelector('textarea');
			const allReloaded = await page.evaluate(
				async (ids) => {
					const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					return Promise.all(ids.map((id) => db.getConversationMessages(id)));
				},
				matrix.map((record) => record.id)
			);
			assert.deepEqual(
				allReloaded,
				matrix.map((record) => record.rows)
			);
			for (const scenario of ['limit', 'stop-permission', 'later-error']) {
				await page.getByText(`own003-${scenario}`, { exact: true }).click();
				await page.getByText('Synthetic question', { exact: true }).waitFor();
				if (scenario === 'limit')
					await page.getByText('Turn limit reached', { exact: true }).waitFor();
				const output = page.getByText(
					scenario === 'stop-permission'
						? 'Tool was not executed: the operation stopped before execution.'
						: 'CONFIRMED_RESULT_1',
					{ exact: true }
				);
				if (!(await output.isVisible()))
					await page.getByText('synthetic', { exact: true }).first().click();
				await output.waitFor();
				if (artifacts)
					await page.screenshot({ path: `${artifacts}/${viewport.width}-${scenario}.png` });
				await page.reload();
				await page.getByText('Synthetic question', { exact: true }).waitFor();
				if (scenario === 'limit')
					await page.getByText('Turn limit reached', { exact: true }).waitFor();
				const after = await page.evaluate(
					async (id) => {
						const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
						return db.getConversationMessages(id);
					},
					matrix.find((record) => record.scenario === scenario).id
				);
				assert.deepEqual(after, matrix.find((record) => record.scenario === scenario).rows);
			}
			// Exercise actual approval and Stop controls while the rendered operation waits.
			for (const live of ['permission', 'error']) {
				await page.evaluate(async (kind) => {
					const {
						db,
						chat,
						conversations: c
					} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					const { ChatService } = await import('/src/lib/services/chat.service.ts');
					const { agenticStore: agent } = await import('/src/lib/stores/agentic.svelte.ts');
					const { toolsStore: tools } = await import('/src/lib/stores/tools.svelte.ts');
					const { mcpStore: mcp } = await import('/src/lib/stores/mcp.svelte.ts');
					const { permissionsStore: permissions } =
						await import('/src/lib/stores/permissions.svelte.ts');
					const entry = {
						key: 'builtin:synthetic',
						apiName: 'synthetic',
						source: 'builtin',
						definition: {
							type: 'function',
							function: { name: 'synthetic', parameters: { type: 'object' } }
						}
					};
					tools.hasBuiltinToolsForContext = () => true;
					tools.getEnabledToolEntriesForLLM = () => [entry];
					tools.validateToolExecution = () => {};
					mcp.hasEnabledServers = () => false;
					permissions.hasTool = () => kind !== 'permission';
					agent.getConfig = () => ({ enabled: true, maxTurns: 3, maxToolPreviewLines: 10 });
					let requests = 0,
						executions = 0;
					tools.executeTool = async () => {
						executions++;
						return { content: 'LIVE_CONFIRMED', isError: false };
					};
					ChatService.sendMessage = async (_history, options) => {
						if (++requests > 1) throw new Error('Synthetic HTTP 503');
						options.onChunk?.('LIVE_ASSISTANT');
						options.onToolCallChunk?.(
							JSON.stringify([
								{
									id: 'live-call',
									type: 'function',
									function: { name: 'synthetic', arguments: '{}' }
								}
							])
						);
						await options.onComplete?.('LIVE_ASSISTANT');
					};
					const conv = await db.createConversation(`Live ${kind}`);
					await db.createRootMessage(conv.id);
					await c.loadConversations();
					window.liveAgentic = { id: conv.id, chat, db, getExecutions: () => executions };
				}, live);
				await page.getByText(`Live ${live}`, { exact: true }).click();
				await page.locator('textarea').fill(`Live ${live} question`);
				await page.locator('textarea').press('Enter');
				if (live === 'permission') {
					await page.getByRole('button', { name: 'Allow once', exact: true }).waitFor();
					await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
					if (artifacts)
						await page.screenshot({ path: `${artifacts}/${viewport.width}-approval-wait.png` });
					await page.getByRole('button', { name: 'Stop', exact: true }).click();
					await page
						.getByRole('button', { name: 'Allow once', exact: true })
						.waitFor({ state: 'hidden' });
					await page.waitForFunction(() => !window.liveAgentic.chat.isLoading);
					assert.equal(await page.evaluate(() => window.liveAgentic.getExecutions()), 0);
				} else {
					await page.getByRole('alertdialog').waitFor();
					if (artifacts)
						await page.screenshot({ path: `${artifacts}/${viewport.width}-error-dialog.png` });
					await page.evaluate(() => window.liveAgentic.chat.dismissErrorDialog());
					const output = page.getByText('LIVE_CONFIRMED', { exact: true });
					if (!(await output.isVisible()))
						await page.getByText('synthetic', { exact: true }).first().click();
					await output.waitFor();
				}
				assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
				if (artifacts)
					await page.screenshot({
						path: `${artifacts}/${viewport.width}-live-${live}-terminal.png`
					});
				await page.reload();
				await page.getByText(`Live ${live} question`, { exact: true }).waitFor();
			}
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(errors, []);
	if (artifacts)
		await writeFile(`${artifacts}/results.json`, JSON.stringify({ results, errors }, null, 2));
	console.log(
		`PASS: ${results.reduce((count, result) => count + result.matrix.length, 0)} real IndexedDB agentic scenarios, ${results.reduce((count, result) => count + result.matrix.reduce((sum, record) => sum + record.payloads.length, 0), 0)} serialized requests, V2 roundtrips, Stop races, A→B, reload and two rendered desktop viewports`
	);
} finally {
	await browser.close();
}
