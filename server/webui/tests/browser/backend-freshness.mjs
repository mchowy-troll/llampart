/** AUD-011B: two real synthetic HTTP servers sequentially bound to one port.
 * Disposable Chromium contexts only. No user storage or live inference.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
const base = process.env.LLAMPART_TEST_URL;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
async function backend(version, router, port = 0) {
	const requests = [],
		captures = [];
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://synthetic');
		requests.push({ path: url.pathname + url.search, method: req.method });
		const json = (body) => {
			// Deliberately cacheable: the client freshness path must bypass HTTP cache.
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Cache-Control': 'public, max-age=3600'
			});
			res.end(JSON.stringify(body));
		};
		if (url.pathname.endsWith('/props'))
			return json({
				build_info: 'synthetic-AUD-011B',
				role: router ? 'router' : 'model',
				model_alias: 'same-alias',
				model_path: `/synthetic/${version}.gguf`,
				chat_template: `synthetic-${version}`,
				chat_template_caps: { supports_tool_calls: version === 'B' },
				default_generation_settings: { n_ctx: version === 'B' ? 16384 : 8192, params: {} },
				modalities: { vision: version === 'B' }
			});
		if (url.pathname.endsWith('/models'))
			return json({
				object: 'list',
				data: [
					{
						id: 'same-alias',
						status: { value: 'loaded' },
						capabilities: { vision: version === 'B', tools: version === 'B' }
					}
				]
			});
		if (url.pathname.endsWith('/chat/completions')) {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			const body = JSON.parse(raw);
			captures.push(body);
			res.writeHead(200, { 'Content-Type': 'text/event-stream' });
			res.write(
				`data: ${JSON.stringify({ model: 'same-alias', choices: [{ index: 0, delta: { reasoning_content: `Synthetic ${version} plan.`, content: `Synthetic ${version} answer.` }, finish_reason: 'stop' }] })}\n\n`
			);
			return res.end('data: [DONE]\n\n');
		}
		return json([]);
	});
	await new Promise((done) => server.listen(port, '127.0.0.1', done));
	return {
		server,
		requests,
		captures,
		port: server.address().port,
		close: async () => {
			server.closeAllConnections();
			await new Promise((done) => server.close(done));
		}
	};
}
async function state(page) {
	return page.evaluate(async () => {
		const { models, server, conversations, chat } =
			await import('/tests/browser/attachment-preview-model-harness.ts');
		const { db } = await import('/tests/browser/charts-harness.ts');
		globalThis.freshness = { models, server, conversations, chat, db };
		return {
			snapshot: models.capabilitySnapshot,
			metadataState: {
				role: server.role,
				selected: models.selectedModelName,
				error: models.error,
				serverError: server.error,
				capabilityGeneration: models.capabilityGeneration,
				requestGeneration: models.requestGeneration
			},
			props: server.props,
			conversation: conversations.activeConversation,
			messages: conversations.activeConversation
				? await db.getConversationMessages(conversations.activeConversation.id)
				: []
		};
	});
}
async function send(page, version) {
	await page.locator('textarea').first().fill(`Synthetic ${version} question`);
	await page.locator('textarea').first().press('Enter');
	await page.getByText(`Synthetic ${version} answer.`, { exact: true }).waitFor();
	await page.waitForFunction(() => !freshness.chat.isLoading);
}
try {
	const cases = [false, true].flatMap((router) =>
		['focus', 'visibility', 'online', 'offline-reconnect', 'new', 'generation'].map((event) => ({
			provider: 'llama-server',
			router,
			event
		}))
	);
	cases.push(
		...['vllm', 'openai-compatible'].map((provider) => ({
			provider,
			router: false,
			event: 'generation'
		}))
	);
	for (const [index, { provider, router, event }] of cases.entries()) {
		const label = `${provider}-${router ? 'ROUTER' : 'MODEL'}-${event}`;
		let a = await backend('A', router),
			b;
		const errors = [],
			rejections = [];
		const context = await browser.newContext({
			viewport: { width: index % 2 ? 390 : 1440, height: 1000 }
		});
		try {
			const url = `http://127.0.0.1:${a.port}`;
			await context.addInitScript(
				({ provider, url }) => {
					globalThis.auditRejections = [];
					addEventListener('unhandledrejection', (e) => auditRejections.push(String(e.reason)));
					localStorage.setItem('llama-webui-migration-v2-done', '1');
					localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							apiProvider: provider,
							serverBaseUrl: url,
							llamaServerBaseUrl: url,
							vllmBaseUrl: url,
							openAiCompatibleBaseUrl: url,
							theme: 'frosted-glass',
							titleGenerationUseLLM: false,
							askForTitleConfirmation: false,
							preEncodeConversation: false,
							showThoughtInProgress: true,
							minimalAgenticIndicators: false
						})
					);
				},
				{ provider, url }
			);
			const page = await context.newPage();
			page.on('pageerror', (e) => errors.push(e.message));
			await page.goto(base);
			await page.waitForFunction(
				async () =>
					(await import('/tests/browser/attachment-preview-model-harness.ts')).models
						.capabilitySnapshot?.features.vision.state === 'unsupported'
			);
			await page.waitForLoadState('networkidle');
			await state(page);
			if (router) {
				await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').click();
				await page.getByRole('option').filter({ hasText: 'same-alias' }).click();
				await page.locator('.llampart-model-selector-menu').waitFor({ state: 'hidden' });
				await page.waitForLoadState('networkidle');
			}
			await send(page, 'A');
			await page.waitForLoadState('networkidle');
			const before = await state(page);
			assert.equal(before.snapshot.features.vision.state, 'unsupported');
			await page.screenshot({ path: `${out}/${label}-A.png` });
			const initialRequests = [...a.requests];
			const port = a.port;
			await a.close();
			a = null;
			if (event === 'offline-reconnect') {
				await page.evaluate(async () => {
					await freshness.models.refreshBackend().catch(() => undefined);
					const { connection } = await import('/tests/browser/charts-harness.ts');
					await connection.check();
				});
				await page.waitForFunction(() => freshness.models.capabilitySnapshot === null);
				assert.equal((await state(page)).props, null);
			}
			b = await backend('B', router, port);
			assert.equal(b.port, port);
			if (event !== 'new' && event !== 'generation' && event !== 'offline-reconnect')
				await page.locator('textarea').first().fill('Synthetic preserved draft');
			if (event === 'focus') await page.evaluate(() => window.dispatchEvent(new Event('focus')));
			if (event === 'visibility')
				await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
			if (event === 'online') await page.evaluate(() => window.dispatchEvent(new Event('online')));
			if (event === 'offline-reconnect')
				await page.evaluate(async () => {
					const { connection } = await import('/tests/browser/charts-harness.ts');
					window.dispatchEvent(new Event('online'));
					await connection.check();
				});
			if (event === 'new') await page.keyboard.press('Control+Shift+O');
			if (event !== 'generation') {
				await page.waitForFunction(
					() => freshness.models.capabilitySnapshot?.features.vision.state === 'supported'
				);
				const refreshed = await state(page);
				assert.notEqual(refreshed.snapshot.backendIdentity, before.snapshot.backendIdentity);
				assert.equal(refreshed.snapshot.features.tools.state, 'supported');
				if (event !== 'new')
					assert.deepEqual(
						refreshed.messages,
						before.messages,
						'metadata refresh never rewrites history'
					);
				if (event !== 'new' && event !== 'offline-reconnect')
					assert.equal(
						await page.locator('textarea').first().inputValue(),
						'Synthetic preserved draft'
					);
			}
			await send(page, 'B');
			await page.waitForLoadState('networkidle');
			const after = await state(page);
			assert.equal(after.snapshot.features.vision.state, 'supported');
			assert.notEqual(after.snapshot.backendIdentity, before.snapshot.backendIdentity);
			assert.equal(after.snapshot.connectionIdentity, before.snapshot.connectionIdentity);
			assert.equal(b.captures.length, 1);
			const completion = b.requests.findIndex((r) => r.path.endsWith('/chat/completions'));
			assert(
				b.requests.slice(0, completion).some((r) => r.path.endsWith('/v1/models')),
				'catalog checked before generation'
			);
			if (provider === 'llama-server') {
				assert(
					b.requests.slice(0, completion).some((r) => r.path.split('?')[0].endsWith('/props')),
					'props checked before generation'
				);
				if (router)
					assert(b.requests.slice(0, completion).some((r) => r.path.includes('/props?model=')));
				assert.equal(after.props.model_path, '/synthetic/B.gguf');
			} else assert(![...b.requests, ...initialRequests].some((r) => r.path.includes('/props')));
			for (const key of [
				'reasoning',
				'reasoning_effort',
				'reasoning_format',
				'reasoning_control',
				'enable_thinking',
				'chat_template_kwargs'
			])
				assert(!Object.hasOwn(b.captures[0], key));
			const oldMessages = await page.evaluate(
				(id) => freshness.db.getConversationMessages(id),
				before.conversation.id
			);
			for (const message of before.messages) {
				const saved = oldMessages.find((m) => m.id === message.id);
				// Continuing an existing conversation legitimately appends a graph edge;
				// all historical content, reasoning, model and timestamps must remain exact.
				assert.deepEqual(saved, { ...message, children: saved.children });
			}
			assert.equal(await page.locator('.llampart-reasoning-trigger').count(), 0);
			assert.equal(
				await page.locator('.llampart-chat-form-root .llampart-model-selector-trigger').count(),
				1
			);
			await page.screenshot({ path: `${out}/${label}-B.png` });
			rejections.push(...(await page.evaluate(() => auditRejections)));
			assert.deepEqual(errors, []);
			assert.deepEqual(rejections, []);
			results.push({
				label,
				result: 'PASS',
				port,
				before: before.snapshot,
				after: after.snapshot,
				requests: b.requests,
				captures: b.captures,
				errors,
				rejections
			});
			console.log(`PASS ${label}`);
		} catch (error) {
			for (const page of context.pages()) {
				await page.screenshot({ path: `${out}/${label}-failure.png` });
				console.log(
					label,
					JSON.stringify({
						state: await state(page),
						errors,
						aRequests: a?.requests,
						bRequests: b?.requests
					})
				);
			}
			throw error;
		} finally {
			await context.close();
			if (a) await a.close();
			if (b) await b.close();
		}
	}
} finally {
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
