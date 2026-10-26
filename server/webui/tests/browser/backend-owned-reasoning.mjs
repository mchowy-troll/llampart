/** AUD-011A: real gateway, chunked synthetic HTTP and disposable Chromium storage. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
const controls = [
	'reasoning_effort',
	'reasoning',
	'reasoning_strength',
	'enable_thinking',
	'chat_template_kwargs',
	'thinking_budget',
	'thinking_budget_tokens',
	'reasoning_budget',
	'reasoning_control',
	'reasoning_format',
	'include_reasoning'
];
try {
	for (const [provider, protocol, router] of [
		['llama-server', 'chat-completions', false],
		['llama-server', 'chat-completions', true],
		['vllm', 'chat-completions', false],
		['openai-compatible', 'chat-completions', false],
		['vllm', 'responses', false],
		['openai-compatible', 'responses', false]
	]) {
		for (const width of [1440, 390]) {
			const captures = [],
				errors = [];
			let finish;
			const server = createServer(async (req, res) => {
				const path = new URL(req.url, 'http://synthetic');
				const json = (data) => {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(data));
				};
				if (path.pathname.endsWith('/props'))
					return json({
						build_info: 'synthetic-AUD-011A',
						role: router ? 'router' : 'model',
						model_path: 'synthetic.gguf',
						model_alias: 'synthetic',
						default_generation_settings: { n_ctx: 8192, params: {} },
						modalities: { vision: false }
					});
				if (path.pathname.endsWith('/models'))
					return json({
						object: 'list',
						data: [
							{
								id: 'synthetic',
								status: { value: 'loaded' },
								capabilities: { required_protocol: protocol, tools: true }
							}
						]
					});
				if (
					req.method !== 'POST' ||
					(!path.pathname.endsWith('/completions') && !path.pathname.endsWith('/responses'))
				) {
					res.writeHead(404, { 'Content-Type': 'application/json' });
					return res.end('[]');
				}
				let raw = '';
				for await (const chunk of req) raw += chunk;
				const body = JSON.parse(raw);
				captures.push(body);
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
				const event = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
				if (protocol === 'responses') {
					event({
						type: 'response.created',
						response: { id: 'response-synthetic', status: 'in_progress' }
					});
					event({ type: 'response.reasoning_summary_text.delta', delta: '**Synthetic plan** ' });
				} else
					event({
						id: 'chat-synthetic',
						model: 'synthetic',
						choices: [
							{
								index: 0,
								delta: {
									[provider === 'vllm' ? 'reasoning' : 'reasoning_content']: '**Synthetic plan** '
								}
							}
						]
					});
				finish = () => {
					if (protocol === 'responses') {
						event({ type: 'response.reasoning_summary_text.delta', delta: 'continued.' });
						event({ type: 'response.output_text.delta', delta: 'Synthetic final answer.' });
						event({
							type: 'response.completed',
							response: {
								id: 'response-synthetic',
								model: 'synthetic',
								status: 'completed',
								output: [
									{
										type: 'reasoning',
										id: 'rs-synthetic',
										encrypted_content: 'OPAQUE_SYNTHETIC',
										summary: [{ type: 'summary_text', text: '**Synthetic plan** continued.' }]
									},
									{
										type: 'message',
										content: [{ type: 'output_text', text: 'Synthetic final answer.' }]
									}
								],
								usage: {
									input_tokens: 8,
									output_tokens: 12,
									output_tokens_details: { reasoning_tokens: 7 }
								}
							}
						});
					} else {
						event({ choices: [{ index: 0, delta: { reasoning_content: 'continued.' } }] });
						event({
							choices: [
								{ index: 0, delta: { content: 'Synthetic final answer.' }, finish_reason: 'stop' }
							],
							usage: {
								prompt_tokens: 8,
								completion_tokens: 12,
								completion_tokens_details: { reasoning_tokens: 7 }
							}
						});
					}
					res.end('data: [DONE]\n\n');
				};
			});
			await new Promise((done) => server.listen(0, '127.0.0.1', done));
			const backend = `http://127.0.0.1:${server.address().port}`;
			const context = await browser.newContext({ viewport: { width, height: 1000 } });
			try {
				await context.addInitScript(
					({ provider, backend }) => {
						globalThis.auditRejections = [];
						addEventListener('unhandledrejection', (e) => auditRejections.push(String(e.reason)));
						localStorage.setItem('llama-webui-migration-v2-done', '1');
						localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
						if (localStorage.getItem('audit-seeded')) return;
						localStorage.setItem('audit-seeded', '1');
						localStorage.setItem('LlamaCppWebui.reasoningEffortDefault', 'high');
						localStorage.setItem('LlamaCppWebui.thinkingEnabledDefault', 'false');
						localStorage.setItem('LlamaCppWebui.reasoningPreference', '{"mode":"off"}');
						localStorage.setItem(
							'LlamaCppWebui.config',
							JSON.stringify({
								apiProvider: provider,
								serverBaseUrl: backend,
								llamaServerBaseUrl: backend,
								vllmBaseUrl: backend,
								openAiCompatibleBaseUrl: backend,
								theme: 'frosted-glass',
								minimalAgenticIndicators: false,
								showThoughtInProgress: true,
								renderReasoningContentAsMarkdown: true,
								titleGenerationUseLLM: false,
								askForTitleConfirmation: false,
								preEncodeConversation: false
							})
						);
					},
					{ provider, backend }
				);
				const page = await context.newPage();
				page.on('pageerror', (error) => errors.push(error.message));
				await page.goto(process.env.LLAMPART_TEST_URL);
				await page.waitForFunction(
					async () =>
						(await import('/src/lib/stores/models.svelte.ts')).modelsStore.models.length > 0
				);
				await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').waitFor();
				if (router) {
					await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').click();
					await page.getByRole('option').filter({ hasText: 'synthetic' }).click();
				}
				assert.equal(await page.locator('.llampart-reasoning-trigger').count(), 0);
				assert.equal(
					await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').count(),
					1
				);
				await page.locator('textarea').first().fill('Synthetic question');
				await page.locator('textarea').first().press('Enter');
				const panel = page.locator('.llampart-agentic-panel').first();
				await panel.getByText('Synthetic plan', { exact: true }).waitFor();
				await page.screenshot({
					path: `${out}/${provider}-${protocol}-${router}-${width}-streaming.png`
				});
				finish();
				await page.getByText('Synthetic final answer.', { exact: true }).waitFor();
				await page.waitForFunction(
					async () => !(await import('/src/lib/stores/chat.svelte.ts')).chatStore.isLoading
				);
				const state = await page.evaluate(async () => {
					const { conversations, db } = await import('/tests/browser/charts-harness.ts');
					return {
						conv: await db.getConversation(conversations.activeConversation.id),
						messages: await db.getConversationMessages(conversations.activeConversation.id)
					};
				});
				const message = state.messages.find((message) => message.role === 'assistant');
				assert.equal(message.reasoningContent, '**Synthetic plan** continued.');
				assert.equal(message.content, 'Synthetic final answer.');
				assert.equal(state.conv.reasoning, undefined);
				assert.equal(captures.length, 1);
				for (const key of controls) assert.equal(Object.hasOwn(captures[0], key), false, key);
				await panel.locator('button[aria-expanded]').click();
				await panel.locator('button[aria-expanded]').click();
				await page.reload();
				await page.getByText('Synthetic final answer.', { exact: true }).waitFor();
				const reopened = page.locator('.llampart-agentic-panel').first();
				if (
					(await reopened.locator('button[aria-expanded]').getAttribute('aria-expanded')) ===
					'false'
				)
					await reopened.locator('button[aria-expanded]').click();
				await reopened.getByText('Synthetic plan', { exact: true }).waitFor();
				assert.match(await reopened.innerText(), /continued\./);
				await page.screenshot({
					path: `${out}/${provider}-${protocol}-${router}-${width}-reopened.png`
				});
				assert.deepEqual(errors, []);
				assert.deepEqual(await page.evaluate(() => auditRejections), []);
				results.push({ provider, protocol, router, width, captures, message, result: 'PASS' });
				console.log(`PASS ${provider}/${protocol}/${router ? 'ROUTER' : 'MODEL'} ${width}`);
			} finally {
				await context.close();
				server.closeAllConnections();
				await new Promise((done) => server.close(done));
			}
		}
	}
} finally {
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
