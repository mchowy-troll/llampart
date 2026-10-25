/** Fresh Chromium + real stores/IndexedDB/registry; only final model/MCP I/O is synthetic.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
 * LLAMPART_TEST_URL=http://127.0.0.1:41994 node tests/browser/mcp-conversation-scope.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:41994';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
const results = [];
try {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		const context = await browser.newContext({ viewport });
		await context.addInitScript(() => {
			localStorage.setItem('llama-webui-migration-v2-done', '1');
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
		await page.addLocatorHandler(
			page.locator('.llampart-about-dialog-content'),
			async (welcome) => {
				await welcome.locator('#about-llampart-do-not-show-again').check();
				await welcome.getByRole('button', { name: 'OK', exact: true }).click();
			}
		);
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		try {
			await page.goto(base);
			await page.waitForSelector('textarea');
			const matrix = await page.evaluate(async () => {
				const {
					db,
					chat,
					conversations: c,
					settings,
					models
				} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				const { ChatService } = await import('/src/lib/services/chat.service.ts');
				const { ToolsService } = await import('/src/lib/services/tools.service.ts');
				const { MCPService } = await import('/src/lib/services/mcp.service.ts');
				const { sourceLifecycleService } =
					await import('/src/lib/services/source-lifecycle.service.ts');
				const { mcpStore: mcp } = await import('/src/lib/stores/mcp.svelte.ts');
				const { toolsStore: tools } = await import('/src/lib/stores/tools.svelte.ts');
				const { agenticStore: agent } = await import('/src/lib/stores/agentic.svelte.ts');
				const { permissionsStore: permissions } =
					await import('/src/lib/stores/permissions.svelte.ts');
				const { createConversationExportEnvelope, parseConversationImport } =
					await import('/src/lib/utils/conversation-import-export.ts');
				const { validateConversationGraph } = await import('/src/lib/utils/conversation-graph.ts');
				const { filterByLeafNodeId } = await import('/src/lib/utils/branching.ts');
				const { createCapabilitySnapshot } =
					await import('/src/lib/services/providers/provider-capabilities.ts');
				const check = (condition, label) => {
					if (!condition) throw new Error(label);
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
				const until = async (condition) => {
					const deadline = Date.now() + 10000;
					while (!condition()) {
						if (Date.now() > deadline) throw new Error('permission timeout');
						await new Promise((resolve) => setTimeout(resolve, 5));
					}
				};
				const originalSend = ChatService.sendMessage;
				const originalRun = agent.runAgenticFlow;
				const originalFetch = globalThis.fetch;
				const originalRefresh = models.refreshCapabilities;
				const builtin = {
					type: 'function',
					function: { name: 'builtin_tool', parameters: { type: 'object' } }
				};
				let executions = 0;
				const disconnected = [];
				ToolsService.list = async () => [{ name: 'builtin_tool', definition: builtin }];
				ToolsService.executeTool = async () => ({ content: 'BUILTIN_CONFIRMED' });
				MCPService.connect = async (serverName) => ({
					serverName,
					client: {},
					transport: {},
					transportType: 'streamable_http',
					tools: [{ name: 'foreign_mcp_tool', inputSchema: { type: 'object' } }]
				});
				MCPService.listTools = async (connection) => connection.tools;
				MCPService.disconnect = async (connection) => {
					disconnected.push(connection);
				};
				MCPService.callTool = async () => {
					executions++;
					return { content: 'B_CONFIRMED', isError: false };
				};
				settings.updateConfig(
					'mcpServers',
					JSON.stringify([{ id: 'mcp-B', enabled: true, url: 'https://mcp-b.test' }])
				);
				await tools.fetchBuiltinTools(ChatService.createProviderRequestContext());
				const on = [{ serverId: 'mcp-B', enabled: true }];
				check(await mcp.ensureInitialized(on), 'B initialization');
				const connection = mcp.getExistingConnection('mcp-B');
				const create = async (name, overrides) => {
					const conv = await db.createConversation(name);
					await db.createRootMessage(conv.id);
					await db.updateConversation(conv.id, { mcpServerOverrides: overrides });
					await c.loadConversations();
					return conv.id;
				};
				const b = await create('Scope B enabled', on);
				await c.loadConversation(b);
				const records = [];
				for (const scenario of [
					'A-empty',
					'A-undefined',
					'A-false',
					'B-remembered',
					'B-once',
					'B-deny',
					'B-stop',
					'B-navigate-snapshot',
					'B-refused-after-start'
				]) {
					const allowed = scenario.startsWith('B');
					const id = await create(
						`Scope ${scenario}`,
						allowed
							? on
							: scenario === 'A-undefined'
								? undefined
								: scenario === 'A-false'
									? [{ serverId: 'mcp-B', enabled: false }]
									: []
					);
					await c.loadConversation(b);
					await c.loadConversation(id); // B -> A without closing B's global connection.
					const before = executions;
					agent.runAgenticFlow = (params) =>
						originalRun.call(agent, {
							...params,
							callbacks: {
								...params.callbacks,
								onToolCallState: async (...args) => {
									const saved = await params.callbacks.onToolCallState(...args);
									if (scenario === 'B-refused-after-start' && args[2].status === 'started')
										mcp.updateServer('mcp-B', { url: 'https://replacement.test' });
									return saved;
								}
							}
						});
					permissions.revokeTool('mcp-mcp-B:foreign_mcp_tool');
					if (!['B-once', 'B-deny', 'B-stop', 'B-navigate-snapshot'].includes(scenario))
						permissions.allowTool('mcp-mcp-B:foreign_mcp_tool');
					let requests = 0;
					const advertised = [];
					ChatService.sendMessage = async (_history, options) => {
						advertised.push((options.tools ?? []).map((tool) => tool.function.name));
						if (++requests === 1) {
							options.onChunk?.('Synthetic scope request');
							options.onToolCallChunk?.(
								JSON.stringify([
									{
										id: 'scope-call',
										type: 'function',
										function: { name: 'foreign_mcp_tool', arguments: '{}' }
									}
								])
							);
						} else options.onChunk?.('Scope final answer');
					};
					const operation = chat.sendMessage('Synthetic scope question');
					if (['B-once', 'B-deny', 'B-stop', 'B-navigate-snapshot'].includes(scenario)) {
						await until(() => agent.pendingPermissionRequest(id));
						check(executions === before, 'executor before approval');
						if (scenario === 'B-stop') await chat.stopGenerationForChat(id);
						else {
							if (scenario === 'B-navigate-snapshot') {
								await c.setMcpServerOverride('mcp-B', false);
								await c.loadConversation(b);
								await c.loadConversation(records[0].id);
								await c.loadConversation(id); // A -> B -> A-style round trip, owner unchanged.
							}
							agent.resolvePermission(id, scenario === 'B-deny' ? 'deny' : 'once');
						}
					}
					await operation;
					agent.runAgenticFlow = originalRun;
					const rows = await db.getConversationMessages(id);
					const conv = await db.getConversation(id);
					validateConversationGraph(conv, rows);
					const calls = rows.flatMap((row) => row.agentic?.calls ?? []);
					const output = rows.filter((row) => row.role === 'tool');
					const expected =
						!allowed || scenario === 'B-refused-after-start'
							? 'error'
							: scenario === 'B-deny'
								? 'denied'
								: scenario === 'B-stop'
									? 'not_started'
									: 'completed';
					check(
						calls.length === 1 && calls[0].status === expected,
						`${scenario}: lifecycle ${JSON.stringify(calls)}`
					);
					check(
						executions - before === (expected === 'completed' ? 1 : 0),
						`${scenario}: dispatch count`
					);
					check(
						output.length === (expected === 'completed' ? 1 : 0),
						`${scenario}: fake/lost output`
					);
					check(
						advertised.every((names) => names.includes('foreign_mcp_tool') === allowed),
						`${scenario}: advertisement`
					);
					check(
						advertised.every((names) => names.includes('builtin_tool')),
						`${scenario}: builtin removed`
					);
					check(
						mcp.getExistingConnection('mcp-B') === connection && !disconnected.includes(connection),
						`${scenario}: shared B transport closed`
					);
					check(!chat.isLoading && !agent.isRunning(id), `${scenario}: loading`);
					if (!allowed) {
						const entry = tools.allTools.find((entry) => entry.apiName === 'foreign_mcp_tool');
						let rejected = false;
						try {
							await tools.executeTool(
								entry,
								{},
								ChatService.createProviderRequestContext(),
								undefined,
								mcp.createToolExecutionScope([])
							);
						} catch {
							rejected = true;
						}
						check(rejected && executions === before, `${scenario}: direct call bypass`);
					}
					const envelope = createConversationExportEnvelope([{ conv, messages: rows }], '1.9.0');
					check(
						stable(parseConversationImport(JSON.parse(JSON.stringify(envelope)))[0].messages) ===
							stable(rows),
						`${scenario}: V2 roundtrip`
					);
					chat.dismissErrorDialog();
					records.push({ scenario, id, rows, advertised, expected });
					if (scenario === 'B-refused-after-start')
						mcp.updateServer('mcp-B', { url: 'https://mcp-b.test' });
				}
				// Two operations overlap: B waits for permission while builtin-only A rejects a foreign call.
				const parallelB = await create('Scope parallel-B', on);
				const parallelA = await create('Scope parallel-A', []);
				const parallelAds = new Map();
				ChatService.sendMessage = async (_history, options, id) => {
					const turns = parallelAds.get(id) ?? [];
					turns.push((options.tools ?? []).map((tool) => tool.function.name));
					parallelAds.set(id, turns);
					if (turns.length === 1)
						options.onToolCallChunk?.(
							JSON.stringify([
								{
									id: 'parallel-call',
									type: 'function',
									function: { name: 'foreign_mcp_tool', arguments: '{}' }
								}
							])
						);
					else options.onChunk?.('Parallel final answer');
				};
				permissions.revokeTool('mcp-mcp-B:foreign_mcp_tool');
				await c.loadConversation(parallelB);
				const pendingB = chat.sendMessage('Parallel B question');
				await until(() => agent.pendingPermissionRequest(parallelB));
				await c.loadConversation(parallelA);
				await chat.sendMessage('Parallel A question');
				check(agent.isRunning(parallelB), 'A terminated B');
				await c.loadConversation(parallelB);
				await c.setMcpServerOverride('mcp-B', false);
				await c.loadConversation(parallelA);
				await c.loadConversation(parallelB);
				agent.resolvePermission(parallelB, 'once');
				await pendingB;
				chat.dismissErrorDialog();
				for (const [id, expected, scenario] of [
					[parallelA, 'error', 'parallel-A'],
					[parallelB, 'completed', 'parallel-B']
				]) {
					const rows = await db.getConversationMessages(id);
					const conv = await db.getConversation(id);
					validateConversationGraph(conv, rows);
					check(
						rows
							.flatMap((row) => row.agentic?.calls ?? [])
							.every((call) => call.status === expected),
						`${scenario}: state`
					);
					check(
						parallelAds
							.get(id)
							.every((names) => names.includes('foreign_mcp_tool') === (id === parallelB)),
						`${scenario}: scope`
					);
					check(
						mcp.getExistingConnection('mcp-B') === connection && !disconnected.includes(connection),
						`${scenario}: transport`
					);
					records.push({ scenario, id, rows, advertised: parallelAds.get(id), expected });
				}
				// Run the real serializer for every supported provider/protocol with scoped entries.
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
						capabilities: protocol === 'responses' ? { required_protocol: 'responses' } : undefined
					};
					await new Promise((resolve) => setTimeout(resolve, 0));
					await sourceLifecycleService.switchSource(
						{
							providerId,
							serverBaseUrl: String(settings.config.serverBaseUrl ?? ''),
							apiKey: String(settings.config.apiKey ?? ''),
							protocol
						},
						on
					);
					const requestContext = ChatService.createProviderRequestContext();
					tools.clear();
					if (providerId === 'llama-server') await tools.fetchBuiltinTools(requestContext);
					models.refreshCapabilities = () =>
						createCapabilitySnapshot(requestContext, 'synthetic-model', {
							capabilities: {
								tools: true,
								...(protocol === 'responses' ? { required_protocol: 'responses' } : {})
							}
						});
					const providerIdOfChat = await create(`Scope ${providerId}-${protocol}-MCP`, on);
					await c.loadConversation(providerIdOfChat);
					permissions.allowTool('mcp-mcp-B:foreign_mcp_tool');
					const providerAds = [];
					ChatService.sendMessage = async (_history, options) => {
						providerAds.push((options.tools ?? []).map((tool) => tool.function.name));
						if (providerAds.length === 1)
							options.onToolCallChunk?.(
								JSON.stringify([
									{
										id: 'provider-call',
										type: 'function',
										function: { name: 'foreign_mcp_tool', arguments: '{}' }
									}
								])
							);
						else options.onChunk?.('Provider final');
					};
					const beforeProvider = executions;
					await chat.sendMessage('Provider scope question');
					const providerRows = await db.getConversationMessages(providerIdOfChat);
					check(executions === beforeProvider + 1, `${providerId}/${protocol}: agent dispatch`);
					check(
						providerAds.length === 2 &&
							providerAds.every((names) => names.includes('foreign_mcp_tool')),
						`${providerId}/${protocol}: agent advertisement`
					);
					check(
						providerRows.some((row) =>
							row.agentic?.calls.some((call) => call.status === 'completed')
						),
						`${providerId}/${protocol}: agent lifecycle`
					);
					records.push({
						scenario: `${providerId}-${protocol}-MCP`,
						id: providerIdOfChat,
						rows: providerRows,
						advertised: providerAds,
						expected: 'completed'
					});
					for (const enabled of [false, true]) {
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
						const entries = tools.getEnabledToolEntriesForLLM(
							requestContext,
							mcp.createToolExecutionScope(enabled ? on : [])
						);
						const record = records.find(
							(record) => record.scenario === (enabled ? 'B-remembered' : 'A-empty')
						);
						const conv = await db.getConversation(record.id);
						await originalSend.call(
							ChatService,
							filterByLeafNodeId(record.rows, conv.currNode, false),
							{
								model: 'synthetic-model',
								stream: false,
								providerRequestContext: requestContext,
								tools: entries.map((entry) => entry.definition)
							},
							record.id
						);
						const names = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
						check(
							names.includes('foreign_mcp_tool') === enabled,
							`${providerId}/${protocol}: foreign tool`
						);
						check(
							names.includes('builtin_tool') === (providerId === 'llama-server'),
							`${providerId}/${protocol}: builtin contract`
						);
						payloads.push({ providerId, protocol, enabled, body });
					}
				}
				globalThis.fetch = originalFetch;
				models.refreshCapabilities = originalRefresh;
				ChatService.sendMessage = originalSend;
				return { records, payloads };
			});
			// Reload crosses the persistence boundary; no injected registry or callbacks survive.
			await page.reload();
			await page.waitForSelector('textarea');
			const reloaded = await page.evaluate(
				async (ids) => {
					const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					return Promise.all(ids.map((id) => db.getConversationMessages(id)));
				},
				matrix.records.map((record) => record.id)
			);
			assert.deepEqual(
				reloaded,
				matrix.records.map((record) => record.rows)
			);
			for (const scenario of ['A-empty', 'B-remembered', 'B-deny', 'B-stop']) {
				await page.getByText(`Scope ${scenario}`, { exact: true }).click();
				await page.getByText('Synthetic scope question', { exact: true }).waitFor();
				assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
				if (artifacts)
					await page.screenshot({ path: `${artifacts}/${viewport.width}-${scenario}.png` });
			}
			// Real composer, permission dialog and Stop. Reinstall only synthetic final I/O after reload.
			const liveResults = [];
			for (const scenario of ['A-reject', 'B-remembered', 'B-approve', 'B-stop']) {
				await page.evaluate(async (scenario) => {
					const {
						db,
						chat,
						conversations: c,
						settings
					} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					const { ChatService } = await import('/src/lib/services/chat.service.ts');
					const { ToolsService } = await import('/src/lib/services/tools.service.ts');
					const { MCPService } = await import('/src/lib/services/mcp.service.ts');
					const { mcpStore: mcp } = await import('/src/lib/stores/mcp.svelte.ts');
					const { toolsStore: tools } = await import('/src/lib/stores/tools.svelte.ts');
					const { permissionsStore: permissions } =
						await import('/src/lib/stores/permissions.svelte.ts');
					ToolsService.list = async () => [
						{
							name: 'builtin_tool',
							definition: {
								type: 'function',
								function: { name: 'builtin_tool', parameters: { type: 'object' } }
							}
						}
					];
					MCPService.connect = async (serverName) => ({
						serverName,
						client: {},
						transport: {},
						tools: [{ name: 'foreign_mcp_tool', inputSchema: { type: 'object' } }]
					});
					MCPService.listTools = async (connection) => connection.tools;
					MCPService.disconnect = async () => {};
					settings.updateConfig(
						'mcpServers',
						JSON.stringify([{ id: 'mcp-B', enabled: true, url: 'https://mcp-b.test' }])
					);
					await tools.fetchBuiltinTools(ChatService.createProviderRequestContext());
					await mcp.ensureInitialized([{ serverId: 'mcp-B', enabled: true }]);
					const conv = await db.createConversation(`Live scope ${scenario}`);
					await db.createRootMessage(conv.id);
					await db.updateConversation(conv.id, {
						mcpServerOverrides:
							scenario === 'A-reject' ? [] : [{ serverId: 'mcp-B', enabled: true }]
					});
					await c.loadConversations();
					permissions.revokeTool('mcp-mcp-B:foreign_mcp_tool');
					if (['A-reject', 'B-remembered'].includes(scenario))
						permissions.allowTool('mcp-mcp-B:foreign_mcp_tool');
					const state = {
						id: conv.id,
						executions: 0,
						advertised: [],
						chat,
						db,
						mcp,
						c,
						connection: mcp.getExistingConnection('mcp-B')
					};
					window.liveScope = state;
					MCPService.callTool = async () => {
						state.executions++;
						return { content: 'LIVE_B_CONFIRMED', isError: false };
					};
					ChatService.sendMessage = async (_history, options) => {
						state.advertised.push((options.tools ?? []).map((tool) => tool.function.name));
						if (state.advertised.length === 1)
							options.onToolCallChunk?.(
								JSON.stringify([
									{
										id: 'live-scope-call',
										type: 'function',
										function: { name: 'foreign_mcp_tool', arguments: '{}' }
									}
								])
							);
						else options.onChunk?.('Live scope final');
					};
				}, scenario);
				await page.getByText(`Live scope ${scenario}`, { exact: true }).click();
				await page.waitForFunction(
					() => window.liveScope.c.activeConversation?.id === window.liveScope.id
				);
				// The active-server indicator must follow chat overrides, not the live global transport.
				assert.equal(
					await page.locator('button[aria-label="MCP Servers"]').count(),
					scenario === 'A-reject' ? 0 : 1
				);
				await page.locator('button[aria-label="Add files, system prompt or MCP Servers"]').click();
				await page.locator('.llampart-composer-tools-submenu-trigger').hover();
				const toolList = page.locator('.llampart-tools-group-list');
				await toolList.waitFor();
				assert.equal(
					(await toolList.innerText()).includes('https://mcp-b.test'),
					scenario !== 'A-reject'
				);
				if (artifacts)
					await page.screenshot({
						path: `${artifacts}/${viewport.width}-live-${scenario}-tools.png`
					});
				await page.keyboard.press('Escape');
				await page.keyboard.press('Escape');
				await page.locator('button[aria-label="Add files, system prompt or MCP Servers"]').click();
				await page.locator('.llampart-composer-mcp-submenu-trigger').hover();
				const serverSwitch = page.locator('.llampart-composer-mcp-submenu [role="switch"]');
				await serverSwitch.waitFor();
				assert.equal(
					await serverSwitch.getAttribute('aria-checked'),
					scenario === 'A-reject' ? 'false' : 'true'
				);
				if (scenario === 'B-remembered') {
					await serverSwitch.click();
					await page.waitForFunction(() => !window.liveScope.c.isMcpServerEnabledForChat('mcp-B'));
					await serverSwitch.click();
					await page.waitForFunction(() => window.liveScope.c.isMcpServerEnabledForChat('mcp-B'));
				}
				await page.keyboard.press('Escape');
				await page.keyboard.press('Escape');
				await page.locator('textarea').fill(`Live ${scenario} question`);
				await page.locator('textarea').press('Enter');
				if (scenario === 'B-approve' || scenario === 'B-stop') {
					await page.getByRole('button', { name: 'Allow once', exact: true }).waitFor();
					await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
					assert.equal(await page.evaluate(() => window.liveScope.executions), 0);
					if (artifacts)
						await page.screenshot({
							path: `${artifacts}/${viewport.width}-live-${scenario}-waiting.png`
						});
					await page
						.getByRole('button', {
							name: scenario === 'B-stop' ? 'Stop' : 'Allow once',
							exact: true
						})
						.click();
				} else if (scenario === 'A-reject') {
					await page.getByRole('alertdialog').waitFor();
					if (artifacts)
						await page.screenshot({ path: `${artifacts}/${viewport.width}-live-A-error.png` });
					await page.evaluate(() => window.liveScope.chat.dismissErrorDialog());
				}
				await page.waitForFunction(() => !window.liveScope.chat.isLoading);
				const live = await page.evaluate(async () => {
					const state = window.liveScope;
					return {
						id: state.id,
						executions: state.executions,
						advertised: state.advertised,
						connected: state.mcp.getExistingConnection('mcp-B') === state.connection,
						rows: await state.db.getConversationMessages(state.id)
					};
				});
				assert.equal(live.executions, ['B-remembered', 'B-approve'].includes(scenario) ? 1 : 0);
				assert.equal(live.connected, true);
				assert(
					live.advertised.every(
						(names) => names.includes('foreign_mcp_tool') === (scenario !== 'A-reject')
					)
				);
				assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
				assert.equal(
					await page.getByRole('button', { name: 'Allow once', exact: true }).count(),
					0
				);
				if (artifacts)
					await page.screenshot({
						path: `${artifacts}/${viewport.width}-live-${scenario}-terminal.png`
					});
				liveResults.push({ scenario, ...live });
			}
			await page.reload();
			await page.waitForSelector('textarea');
			const liveReloaded = await page.evaluate(
				async (ids) => {
					const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
					return Promise.all(ids.map((id) => db.getConversationMessages(id)));
				},
				liveResults.map((record) => record.id)
			);
			assert.deepEqual(
				liveReloaded,
				liveResults.map((record) => record.rows)
			);
			assert.deepEqual(errors, []);
			results.push({ viewport, ...matrix, liveResults });
		} finally {
			await context.close();
		}
	}
	if (artifacts) await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
	console.log(
		`PASS: ${results.length} desktop viewports, ${results.reduce((sum, item) => sum + item.records.length, 0)} real IndexedDB scope flows, ${results.reduce((sum, item) => sum + item.payloads.length, 0)} provider/protocol payloads, reload and V2`
	);
} finally {
	await browser.close();
}
