/**
 * OWN-001 / LLP-001: synthetic data, fresh Chromium contexts, real IndexedDB/stores.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/conversation-message-ownership.mjs
 * Optional LLAMPART_TEST_ARTIFACTS saves desktop screenshots and the result matrix.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	// The isolated fulfilled HTML has no network address-space metadata in Chromium.
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
const url = process.env.LLAMPART_TEST_URL || 'http://localhost:5173';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const errors = [];
const results = {};
if (artifacts) await mkdir(artifacts, { recursive: true });

async function contextWithMocks(viewport = { width: 1920, height: 1080 }) {
	const context = await browser.newContext({ viewport });
	await context.addInitScript(() => {
		localStorage.setItem('llama-webui-migration-v2-done', '1');
		localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.0');
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'llama-server',
				interfaceLanguage: 'en',
				serverBaseUrl: 'http://synthetic.test',
				llamaServerBaseUrl: 'http://synthetic.test',
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false,
				alwaysShowSidebarOnDesktop: true
			})
		);
	});
	await context.route('**/__llampart/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/props'))
			return route.fulfill({
				json: {
					build_info: 'ownership-test',
					role: 'model',
					default_generation_settings: { n_ctx: 8192, params: {} }
				}
			});
		if (path.endsWith('/models'))
			return route.fulfill({
				json: {
					object: 'list',
					data: [{ id: 'synthetic-model' }]
				}
			});
		return route.fulfill({ json: [] });
	});
	const page = await context.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return { context, page };
}

try {
	const { context, page } = await contextWithMocks();
	try {
		await page.route('**/ownership-empty', (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><title>Isolated ownership tests</title><script>globalThis.__SVELTEKIT_APP_VERSION__ = "ownership-harness"; globalThis.__SVELTEKIT_EXPERIMENTAL_EXPLICIT_ENVIRONMENT_VARIABLES__ = false</script>'
			})
		);
		await page.goto(`${url}/ownership-empty`);
		results.matrix = await page.evaluate(async () => {
			const {
				db,
				chat,
				conversations: c
			} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
			const { ChatService } = await import('/src/lib/services/chat.service.ts');
			const { createConversationExportEnvelope, parseConversationImport } =
				await import('/src/lib/utils/conversation-import-export.ts');
			const initDeadline = Date.now() + 10_000;
			while (!c.isInitialized) {
				if (Date.now() > initDeadline) throw new Error('Store initialization timed out');
				await new Promise((done) => setTimeout(done, 10));
			}
			const check = (value, label) => {
				if (!value) throw new Error(label);
			};
			ChatService.sendMessage = async (history, options, convId) => {
				check(
					history.every((message) => message.convId === convId),
					'foreign request history'
				);
				options.onChunk?.('Synthetic completed');
				await options.onComplete?.('Synthetic completed');
			};
			const methods = [
				'getConversation',
				'getConversationMessages',
				'createRootMessage',
				'createMessageBranch',
				'insertSystemPrompt',
				'updateCurrentNode',
				'updateConversationMessage',
				'replaceUserMessageAndTruncateBranch',
				'truncateBranchForRegeneration'
			];
			const originals = Object.fromEntries(methods.map((name) => [name, db[name]]));
			let serial = 0;
			const matrix = [];
			const scenarios = [
				'user',
				'assistant',
				'system',
				'empty',
				'send',
				'system-prompt',
				'edit-user',
				'edit-assistant',
				'branch-assistant',
				'replace-user',
				'regenerate',
				'branch-regenerate',
				'branch-user',
				'leaf-user',
				'resume',
				'sibling'
			];
			async function run(scenario, target = -1, phase = 'after', returnToA = false) {
				const prefix = `fixture-${++serial}`;
				const a = `${prefix}-A`,
					b = `${prefix}-B`;
				const msg = (id, convId, parent, children, role = 'user', type = 'text') => ({
					id,
					convId,
					parent,
					children,
					role,
					type,
					content: id,
					timestamp: serial * 10 + (type === 'root' ? 0 : role === 'assistant' ? 2 : 1),
					toolCalls: ''
				});
				for (const id of [a, b]) {
					const empty = id === a && scenario === 'empty';
					const leaf = id === a && scenario === 'leaf-user';
					await db.importConversations([
						{
							conv: {
								id,
								name: id,
								currNode: empty ? '' : `${id}-${leaf ? 'user' : 'assistant'}`,
								lastModified: 1
							},
							messages: empty
								? []
								: [
										msg(`${id}-root`, id, null, [`${id}-user`], 'system', 'root'),
										msg(`${id}-user`, id, `${id}-root`, leaf ? [] : [`${id}-assistant`]),
										...(leaf ? [] : [msg(`${id}-assistant`, id, `${id}-user`, [], 'assistant')])
									]
						}
					]);
				}
				await c.loadConversations();
				await c.loadConversation(a);
				chat.syncLoadingStateForChat(a);
				const beforeB = await db.getConversation(b);
				const messagesB = await db.getConversationMessages(b);
				let navigating = false,
					hit = false;
				const trace = [];
				const navigate = async () => {
					hit = true;
					navigating = true;
					await c.loadConversation(b);
					chat.syncLoadingStateForChat(b);
					if (returnToA) {
						await c.loadConversation(a);
						chat.syncLoadingStateForChat(a);
					}
					navigating = false;
				};
				for (const name of methods)
					db[name] = async (...args) => {
						if (navigating) return originals[name].apply(db, args);
						const index = trace.length;
						trace.push(name);
						if (index === target && phase === 'before') await navigate();
						const value = await originals[name].apply(db, args);
						if (index === target && phase === 'after') await navigate();
						return value;
					};
				try {
					if (['user', 'assistant', 'system'].includes(scenario))
						await chat.addMessage(scenario, 'Owned by A');
					if (scenario === 'empty') await chat.addMessage('user', 'First question');
					if (scenario === 'send') await chat.sendMessage('New question');
					if (scenario === 'system-prompt') await chat.addSystemPrompt();
					if (scenario === 'edit-user')
						await chat.editUserMessagePreserveResponses(`${a}-user`, 'Edited');
					if (scenario === 'edit-assistant')
						await chat.editAssistantMessage(`${a}-assistant`, 'Edited', false);
					if (scenario === 'branch-assistant')
						await chat.editAssistantMessage(`${a}-assistant`, 'Edited', true);
					if (scenario === 'replace-user') await chat.updateMessage(`${a}-user`, 'Edited');
					if (scenario === 'regenerate') await chat.regenerateMessage(`${a}-assistant`);
					if (scenario === 'branch-regenerate')
						await chat.regenerateMessageWithBranching(`${a}-assistant`);
					if (['branch-user', 'leaf-user'].includes(scenario))
						await chat.editMessageWithBranching(`${a}-user`, 'Edited');
					if (scenario === 'sibling') await c.navigateToSibling(`${a}-user`);
					if (scenario === 'resume') {
						const saved = [
							ChatService.getResumableState,
							ChatService.canResumeStream,
							ChatService.resumeStream
						];
						try {
							ChatService.getResumableState = () => ({
								conversationId: a,
								assistantMessageId: `${a}-assistant`
							});
							ChatService.canResumeStream = async () => true;
							ChatService.resumeStream = async (_state, callbacks) => {
								await callbacks.onComplete('Resumed answer');
								return true;
							};
							await chat.resumeStreamForChat(a);
						} finally {
							[
								ChatService.getResumableState,
								ChatService.canResumeStream,
								ChatService.resumeStream
							] = saved;
						}
					}
				} finally {
					for (const name of methods) db[name] = originals[name];
				}
				check(target < 0 || hit, `${scenario}: barrier not reached`);
				const activeId = hit && !returnToA ? b : a;
				check(
					c.activeConversation?.id === activeId,
					`${scenario}/${target}/${phase}/${returnToA}: selection drift (${c.activeConversation?.id} != ${activeId}); trace=${trace}`
				);
				check(
					c.activeMessages.every((item) => item.convId === activeId),
					`${scenario}: foreign visible message`
				);
				check(
					new Set(c.activeMessages.map((item) => item.id)).size === c.activeMessages.length,
					`${scenario}: duplicate visible message`
				);
				check(
					JSON.stringify(await db.getConversation(b)) === JSON.stringify(beforeB),
					`${scenario}: B metadata changed`
				);
				check(
					JSON.stringify(await db.getConversationMessages(b)) === JSON.stringify(messagesB),
					`${scenario}: B history changed`
				);
				check(!chat.isChatLoadingPublic(a) && !chat.isLoading, `${scenario}: stuck loading`);
				check(!chat.errorDialogState, `${scenario}: error dialog`);
				const conv = await db.getConversation(a),
					messages = await db.getConversationMessages(a);
				check(
					messages.some((item) => item.id === conv.currNode && item.convId === a),
					`${scenario}: foreign/dangling currNode`
				);
				if (scenario.startsWith('branch-'))
					check(
						messages.some((item) => item.id === `${a}-assistant`),
						`${scenario}: original branch lost`
					);
				if (['user', 'assistant', 'system'].includes(scenario))
					check(
						messages.find((item) => item.content === 'Owned by A')?.parent === `${a}-assistant`,
						`${scenario}: selected tail lost`
					);
				if (scenario === 'send') {
					const user = messages.find((item) => item.content === 'New question');
					check(user?.parent === `${a}-assistant`, 'send: wrong user parent');
					check(
						messages.find((item) => item.content === 'Synthetic completed')?.parent === user.id,
						'send: wrong assistant parent'
					);
				}
				if (['regenerate', 'branch-regenerate', 'replace-user'].includes(scenario))
					check(
						messages.find((item) => item.content === 'Synthetic completed')?.parent === `${a}-user`,
						`${scenario}: wrong assistant parent`
					);
				if (['replace-user', 'regenerate'].includes(scenario))
					check(
						!messages.some((item) => item.id === `${a}-assistant`),
						`${scenario}: old branch retained`
					);
				const exported = parseConversationImport(
					JSON.parse(
						JSON.stringify(createConversationExportEnvelope([{ conv, messages }], '1.9.0'))
					)
				);
				// Actual export -> delete synthetic fixture -> strict import -> reload round-trip.
				await db.deleteConversation(a);
				const imported = await db.importConversations(exported);
				check(imported.imported === 1, `${scenario}: export/import round-trip`);
				await c.loadConversation(a);
				check(c.activeConversation.currNode === conv.currNode, `${scenario}: reload selection`);
				check(
					c.activeMessages.every((item) => item.convId === a),
					`${scenario}: reload ownership`
				);
				await db.deleteConversation(a);
				await db.deleteConversation(b);
				c.clearActiveConversation();
				chat.clearUIState();
				return trace;
			}
			for (const scenario of scenarios) {
				const trace = await run(scenario);
				matrix.push({ scenario, mode: 'active', trace });
				for (let index = 0; index < trace.length; index++) {
					for (const phase of ['before', 'after'])
						for (const returnToA of [false, true]) {
							await run(scenario, index, phase, returnToA);
							matrix.push({
								scenario,
								index,
								method: trace[index],
								phase,
								navigation: returnToA ? 'A-B-A' : 'A-B'
							});
						}
				}
			}
			return matrix;
		});
	} finally {
		await context.close();
	}

	// Rendered desktop smoke: real route navigation, simultaneous legal A/B sends,
	// loading, completion, active branch, reload and exported persisted histories.
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		const { context, page } = await contextWithMocks(viewport);
		try {
			await page.goto(url);
			await page.waitForSelector('textarea');
			await page.evaluate(async () => {
				const {
					db,
					chat,
					conversations: c
				} = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
				const { ChatService } = await import('/src/lib/services/chat.service.ts');
				const ids = [];
				for (const name of ['Visible A', 'Visible B']) {
					const conv = await db.createConversation(name),
						root = await db.createRootMessage(conv.id);
					await db.createMessageBranch(
						{
							convId: conv.id,
							role: 'user',
							type: 'text',
							content: `${name} history`,
							timestamp: 1,
							children: [],
							toolCalls: ''
						},
						root
					);
					ids.push(conv.id);
				}
				await c.loadConversations();
				const pending = new Map();
				ChatService.sendMessage = async (history, options, convId) => {
					if (!history.every((message) => message.convId === convId))
						throw new Error('foreign rendered request history');
					await new Promise((resolve) =>
						pending.set(convId, async () => {
							options.onChunk('Completed ' + (convId === ids[0] ? 'A' : 'B'));
							await options.onComplete();
							resolve();
						})
					);
				};
				window.ownershipTest = { db, chat, c, ids, pending };
			});
			await page.getByText('Visible A', { exact: true }).click();
			await page.getByText('Visible A history', { exact: true }).waitFor();
			await page.locator('textarea').fill('Question for A');
			await page.locator('textarea').press('Enter');
			await page.waitForFunction(() =>
				window.ownershipTest.pending.has(window.ownershipTest.ids[0])
			);
			await page.getByText('Visible B', { exact: true }).click();
			await page.getByText('Visible B history', { exact: true }).waitFor();
			assert.equal(await page.getByText('Question for A', { exact: true }).count(), 0);
			await page.locator('textarea').fill('Question for B');
			await page.locator('textarea').press('Enter');
			await page.waitForFunction(() =>
				window.ownershipTest.pending.has(window.ownershipTest.ids[1])
			);
			await page.evaluate(async () => {
				const t = window.ownershipTest;
				await t.pending.get(t.ids[0])();
			});
			assert(
				await page.evaluate(() => {
					const t = window.ownershipTest;
					return t.chat.isLoading && t.chat.isChatLoadingPublic(t.ids[1]) && t.chat.isStreaming();
				})
			);
			assert.equal(await page.getByText('Completed A', { exact: true }).count(), 0);
			if (artifacts)
				await page.screenshot({ path: `${artifacts}/${viewport.width}-B-loading.png` });
			await page.evaluate(async () => {
				const t = window.ownershipTest;
				await t.pending.get(t.ids[1])();
			});
			await page.getByText('Completed B', { exact: true }).waitFor();
			await page.waitForFunction(() => !window.ownershipTest.chat.isLoading);
			await page.getByText('Visible A', { exact: true }).click();
			await page.getByText('Completed A', { exact: true }).waitFor();
			assert.equal(await page.getByText('Completed B', { exact: true }).count(), 0);
			assert(
				await page.evaluate(() => {
					const t = window.ownershipTest;
					return t.c.activeMessages.at(-1).id === t.c.activeConversation.currNode;
				})
			);
			if (artifacts)
				await page.screenshot({ path: `${artifacts}/${viewport.width}-A-completed.png` });
			await page.reload();
			await page.getByText('Completed A', { exact: true }).waitFor();
			results[`desktop-${viewport.width}x${viewport.height}`] = 'PASS';
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(errors, [], 'No browser/console errors');
	results.errors = errors;
	if (artifacts) await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
	console.log(
		`PASS: ${results.matrix.length} IndexedDB interleavings; 2 rendered desktop viewports; no console/page errors`
	);
} finally {
	await browser.close();
}
