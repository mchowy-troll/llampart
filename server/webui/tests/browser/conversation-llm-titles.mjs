/** Real Chromium/WebUI/IndexedDB and HTTP transport, synthetic inference only.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/conversation-llm-titles.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
const requests = [],
	results = [],
	errors = [];
let mode = 'reasoning',
	releaseTitle,
	releaseAnswer;
const title = 'Synthetic LLM Topic Verified';
const answer = 'Synthetic completed assistant answer.';
const backend = http.createServer(async (req, res) => {
	if (req.url.endsWith('/models')) {
		res.setHeader('Content-Type', 'application/json');
		return res.end(JSON.stringify({ object: 'list', data: [{ id: 'title-test-model' }] }));
	}
	if (!req.url.endsWith('/chat/completions')) {
		res.setHeader('Content-Type', 'application/json');
		return res.end('{}');
	}
	let raw = '';
	for await (const chunk of req) raw += chunk;
	const body = JSON.parse(raw);
	const isTitle =
		body.messages.length === 1 &&
		body.messages[0].content.startsWith('Based on the following interaction');
	const record = { body, isTitle, mode, ended: false };
	requests.push(record);
	if (isTitle && mode === 'error') {
		res.writeHead(500, { 'Content-Type': 'application/json' });
		record.ended = true;
		return res.end(JSON.stringify({ error: { message: 'Synthetic title failure' } }));
	}
	res.writeHead(200, { 'Content-Type': 'text/event-stream' });
	res.flushHeaders();
	const send = (delta, finish_reason) =>
		res.write(
			`data: ${JSON.stringify({ model: 'title-test-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
		);
	if (isTitle && mode === 'hold')
		await new Promise((resolve) => {
			releaseTitle = resolve;
			backend.emit('held-request');
		});
	if (!isTitle && mode === 'hold-answer')
		await new Promise((resolve) => {
			releaseAnswer = resolve;
			backend.emit('held-request');
		});
	if (isTitle && mode === 'reasoning')
		send({ reasoning_content: 'Synthetic reasoning needs 96 tokens before producing a title.' });
	// Model fixture: max_tokens covers reasoning AND visible output. With the old
	// 64-token cap a thinking model reaches length before any title content.
	const exhausted = isTitle && mode === 'reasoning' && body.max_tokens > 0 && body.max_tokens <= 96;
	if (!exhausted)
		send({
			content: isTitle ? (mode === 'empty' ? '' : mode === 'invalid' ? '""' : title) : answer
		});
	send({}, exhausted ? 'length' : 'stop');
	res.end('data: [DONE]\n\n');
	record.ended = true;
});
await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
const backendUrl = `http://127.0.0.1:${backend.address().port}`;
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript((backendUrl) => {
	localStorage.setItem('llama-webui-migration-v2-done', '1');
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
	if (!localStorage.getItem('LlamaCppWebui.config'))
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'openai-compatible',
				openAiCompatibleBaseUrl: backendUrl,
				interfaceLanguage: 'en',
				alwaysShowSidebarOnDesktop: true,
				preEncodeConversation: false,
				titleGenerationUseLLM: false,
				titleGenerationUseFirstLine: false,
				askForTitleConfirmation: false
			})
		);
	globalThis.titleRejections = [];
	addEventListener('unhandledrejection', (event) => titleRejections.push(String(event.reason)));
}, backendUrl);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
const harness = '/tests/browser/reasoning-props-cancellation-harness.ts';
const settingsDialog = page.locator('.llampart-chat-settings-dialog-content');
async function settings(enabled, firstLine = false, expectedCurrent) {
	await page.locator('button[aria-label="Settings"]').click();
	await settingsDialog.getByRole('button', { name: 'Chat', exact: true }).click();
	if (expectedCurrent !== undefined) {
		assert.equal(
			await page.locator('#titleGenerationUseLLM').getAttribute('aria-checked'),
			String(expectedCurrent)
		);
	}
	await page.locator('#titleGenerationUseLLM').setChecked(enabled);
	await page.locator('#titleGenerationUseFirstLine').setChecked(firstLine);
	await settingsDialog.getByRole('button', { name: 'Save settings', exact: true }).click();
	await settingsDialog.waitFor({ state: 'hidden' });
	assert.equal(
		await page.evaluate(
			() => JSON.parse(localStorage.getItem('LlamaCppWebui.config')).titleGenerationUseLLM
		),
		enabled
	);
}
async function idle() {
	await page.waitForFunction(() => {
		const { chat } = globalThis.titlesHarness;
		return (
			!chat.conversationOperationLocks?.size && ![...chat.chatLoadingStates.values()].some(Boolean)
		);
	});
}
async function send(text) {
	await page.locator('textarea').first().fill(text);
	await page.locator('textarea').first().press('Enter');
}
async function activeId() {
	return page.evaluate(
		async (harness) => (await import(harness)).conversations.activeConversation.id,
		harness
	);
}
async function snapshot(id) {
	return page.evaluate(
		async ({ harness, id }) => {
			const { db, conversations } = await import(harness);
			return {
				name: (await db.getConversation(id)).name,
				list: conversations.conversations.find((item) => item.id === id).name,
				messages: await db.getConversationMessages(id),
				activeId: conversations.activeConversation?.id
			};
		},
		{ harness, id }
	);
}
async function assertName(id, expected) {
	const state = await snapshot(id);
	assert.equal(state.name, expected);
	assert.equal(state.list, expected);
	assert.ok(
		(await page.locator(`[data-conversation-selection-id="${id}"]`).innerText())
			.replace(/\s+/g, ' ')
			.includes(expected.replace(/\s+/g, ' '))
	);
	assert.ok(
		state.messages.some((message) => message.role === 'assistant' && message.content === answer)
	);
	if (state.activeId === id) {
		assert.ok(
			(await page.locator('.llampart-assistant-markdown').last().innerText()).includes(answer)
		);
	}
}
async function newChat() {
	await page.getByRole('link', { name: 'New chat', exact: true }).click();
	await page.waitForFunction(() => !titlesHarness.conversations.activeConversation);
}
async function rename(id, name) {
	await page.locator(`[data-conversation-selection-id="${id}"] button[aria-label="Edit"]`).click();
	const dialog = page.getByRole('alertdialog').filter({ hasText: 'Edit Conversation Name' });
	await dialog.getByRole('textbox').fill(name);
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
}
const titleRequests = () => requests.filter((request) => request.isTitle);
try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
	await page.locator('textarea').waitFor();
	await page.evaluate(async (harness) => {
		globalThis.titlesHarness = await import(harness);
	}, harness);
	await settings(true);
	await send('Explain synthetic telescope observations.');
	await page.waitForFunction(() => {
		const { conversations } = titlesHarness;
		return conversations.activeMessages.some(
			(message) => message.role === 'assistant' && message.content
		);
	});
	await idle();
	const owner = await activeId();
	assert.equal(titleRequests().length, 1);
	assert.equal(titleRequests()[0].body.model, 'title-test-model');
	assert.ok(titleRequests()[0].body.messages[0].content.includes(answer));
	assert.ok(
		titleRequests()[0].body.messages[0].content.includes(
			'Explain synthetic telescope observations.'
		)
	);
	await assertName(owner, title);
	results.push(
		'MOCK PASS A: separate HTTP title request, frozen model/context, reasoning budget, exact DB/store/sidebar title'
	);
	await page.reload();
	await page.locator('textarea').waitFor();
	await page.evaluate(async (harness) => {
		globalThis.titlesHarness = await import(harness);
	}, harness);
	await page.waitForFunction(
		(owner) => titlesHarness.conversations.activeConversation?.id === owner,
		owner
	);
	await assertName(owner, title);
	assert.equal(
		await page.evaluate(() => titlesHarness.settings.config.titleGenerationUseLLM),
		true
	);
	await settings(true, false, true);
	assert.equal(titleRequests().length, 1);
	results.push(
		'MOCK PASS C: setting and exact generated title survive reload; no startup regeneration'
	);
	await send('Second question must not regenerate the title.');
	await idle();
	assert.equal(titleRequests().length, 1);
	await assertName(owner, title);
	results.push('MOCK PASS D: second answer does not generate or overwrite title');

	for (const firstLine of [false, true]) {
		await settings(false, firstLine);
		await newChat();
		await send('Standard first line\nStandard second line');
		await idle();
		await assertName(
			await activeId(),
			firstLine ? 'Standard first line' : 'Standard first line\nStandard second line'
		);
		assert.equal(titleRequests().length, 1);
	}
	results.push(
		'MOCK PASS B: disabled sends no title request; both independent first-line settings preserved'
	);
	await settings(true);

	for (const scenario of ['navigation', 'rename', 'rename-before', 'error', 'empty', 'invalid']) {
		mode =
			scenario === 'rename-before'
				? 'hold-answer'
				: ['navigation', 'rename'].includes(scenario)
					? 'hold'
					: scenario;
		const count = titleRequests().length;
		const heldRequest = ['hold', 'hold-answer'].includes(mode)
			? once(backend, 'held-request', { signal: AbortSignal.timeout(30000) })
			: null;
		await newChat();
		await send(`Fallback ${scenario}`);
		await page.waitForFunction(() => !!titlesHarness.conversations.activeConversation);
		const id = await activeId();
		if (scenario === 'rename-before') {
			await heldRequest;
			await rename(id, 'Manual before completion');
			releaseAnswer();
		} else if (mode === 'hold') {
			await heldRequest;
			assert.equal(titleRequests().length, count + 1);
			// Multiple sends while auxiliary work is pending must not admit a duplicate.
			const total = requests.length;
			await page.evaluate(async (harness) => {
				const { chat } = await import(harness);
				await Promise.all([chat.sendMessage('duplicate'), chat.sendMessage('duplicate')]);
			}, harness);
			assert.equal(titleRequests().length, count + 1);
			assert.equal(requests.length, total);
			if (scenario === 'rename') await rename(id, 'Manual title wins');
			else await page.locator(`[data-conversation-selection-id="${owner}"]`).click();
			releaseTitle();
		}
		await idle();
		assert.equal(await page.getByRole('alertdialog').count(), 0);
		await assertName(
			id,
			scenario === 'rename'
				? 'Manual title wins'
				: scenario === 'rename-before'
					? 'Manual before completion'
					: scenario === 'navigation'
						? title
						: `Fallback ${scenario}`
		);
		if (scenario === 'navigation') {
			assert.equal((await snapshot(id)).activeId, owner);
			await assertName(owner, title);
		}
		if (scenario === 'rename-before') assert.equal(titleRequests().length, count);
		results.push(`MOCK PASS D ${scenario}: safe owner/title/fallback, completed answer retained`);
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(await page.evaluate(() => titleRejections), []);
	if (out) await page.screenshot({ path: `${out}/success.png`, fullPage: true });
} catch (error) {
	console.error('FAIL:', error.message, JSON.stringify(requests, null, 2));
	if (out) await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
	throw error;
} finally {
	console.log(results.join('\n'));
	if (out)
		await writeFile(`${out}/results.json`, JSON.stringify({ results, requests, errors }, null, 2));
	releaseTitle?.();
	releaseAnswer?.();
	await browser.close();
	backend.closeAllConnections();
	await new Promise((resolve) => backend.close(resolve));
}
