/** AUD-006: actual sidebar/dialog, stores and IndexedDB in disposable Chromium.
 * Set LLAMPART_PLAYWRIGHT_MODULE and LLAMPART_TEST_URL (development server).
 * LLAMPART_TEST_ARTIFACTS optionally saves screenshots/results outside the repo.
 * Only synthetic records in this fresh browser context are fault-injected. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const out = process.env.LLAMPART_TEST_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors = [],
	results = [];
page.on('pageerror', (error) => errors.push(error.message));
await context.addInitScript(() => {
	globalThis.aud006Rejections = [];
	addEventListener('unhandledrejection', (event) => aud006Rejections.push(String(event.reason)));
	localStorage.setItem('llama-webui-migration-v2-done', '1');
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			apiProvider: 'openai-compatible',
			openAiCompatibleBaseUrl: 'http://synthetic.invalid',
			alwaysShowSidebarOnDesktop: true,
			interfaceLanguage: 'en',
			preEncodeConversation: false,
			titleGenerationUseLLM: false,
			askForTitleConfirmation: false
		})
	);
});
await context.route('**/*', (route) => {
	const url = new URL(route.request().url());
	if (url.origin !== new URL(base).origin) return route.abort();
	if (!url.pathname.startsWith('/__llampart/api/')) return route.continue();
	return route.fulfill({
		json: url.pathname.endsWith('/models')
			? { object: 'list', data: [{ id: 'synthetic-model' }] }
			: {}
	});
});

const dialog = page.getByRole('alertdialog').filter({ hasText: 'Edit Conversation Name' });
const input = dialog.getByRole('textbox');
let ownerId;
const card = () => page.locator(`[data-conversation-selection-id="${ownerId}"]`);
async function openRename() {
	await card().locator('button[aria-label="Edit"]').click();
	await dialog.waitFor();
}
async function configure(mode = '', hold = false) {
	await page.evaluate(
		({ mode, hold }) => {
			aud006.mode = mode;
			aud006.calls = 0;
			aud006.puts = 0;
			aud006.maxActive = 0;
			aud006.gate = hold
				? new Promise((resolve) => {
						aud006.release = resolve;
					})
				: null;
		},
		{ mode, hold }
	);
}
async function snapshot(id = ownerId) {
	return page.evaluate(async (id) => {
		const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
		const { conversationsStore: store } = await import('/src/lib/stores/conversations.svelte.ts');
		return {
			db: (await db.getConversation(id)).name,
			list: store.conversations.find((item) => item.id === id).name,
			active: { id: store.activeConversation?.id, name: store.activeConversation?.name },
			calls: aud006.calls,
			puts: aud006.puts,
			maxActive: aud006.maxActive
		};
	}, id);
}
async function assertName(name) {
	const state = await snapshot();
	assert.equal(state.db, name);
	assert.equal(state.list, name);
	assert.deepEqual(state.active, { id: ownerId, name });
	assert.ok((await card().innerText()).includes(name));
	return state;
}
async function release() {
	await page.evaluate(() => aud006.release());
}

try {
	await page.goto(base);
	await page.locator('textarea').waitFor();
	const seeded = await page.evaluate(async () => {
		const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
		const { conversationsStore: store } = await import('/src/lib/stores/conversations.svelte.ts');
		const a = await db.createConversation('AUD-006 old A');
		const b = await db.createConversation('AUD-006 old B');
		for (const item of [a, b]) {
			const root = await db.createRootMessage(item.id);
			await db.createMessageBranch(
				{
					convId: item.id,
					type: 'text',
					role: 'user',
					content: 'Synthetic persisted message',
					timestamp: 1,
					toolCalls: '',
					children: []
				},
				root
			);
		}
		await store.loadConversations();
		globalThis.aud006 = { calls: 0, puts: 0, active: 0, maxActive: 0, mode: '', gate: null };
		const update = db.updateConversation;
		db.updateConversation = async function (id, updates) {
			if (!('name' in updates)) return update.call(this, id, updates);
			aud006.calls++;
			aud006.active++;
			aud006.maxActive = Math.max(aud006.maxActive, aud006.active);
			try {
				if (aud006.gate) await aud006.gate;
				return await update.call(this, id, updates);
			} finally {
				aud006.active--;
			}
		};
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (this.name === 'conversations' && [a.id, b.id].includes(args[0]?.id)) {
				aud006.puts++;
				const mode = aud006.mode;
				aud006.mode = '';
				if (mode === 'throw')
					throw new DOMException('AUD-006 synthetic quota', 'QuotaExceededError');
				const request = put.apply(this, args);
				if (mode === 'abort')
					request.addEventListener('success', () => this.transaction.abort(), { once: true });
				return request;
			}
			return put.apply(this, args);
		};
		return { a: a.id, b: b.id, messages: await db.getConversationMessages(a.id) };
	});
	ownerId = seeded.a;
	await card().click();
	await page.waitForFunction((id) => location.hash.includes(id), seeded.a);
	await page.waitForFunction(async (id) => {
		const { conversationsStore } = await import('/src/lib/stores/conversations.svelte.ts');
		return conversationsStore.activeConversation?.id === id;
	}, seeded.a);

	// A: real successful transaction and reopening via another conversation.
	await configure();
	await openRename();
	await input.fill('AUD-006 renamed A');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await dialog.waitFor({ state: 'hidden' });
	await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Edit');
	assert.equal((await assertName('AUD-006 renamed A')).calls, 1);
	await page.locator(`[data-conversation-selection-id="${seeded.b}"]`).click();
	await card().click();
	await page.waitForFunction(async (id) => {
		const { conversationsStore } = await import('/src/lib/stores/conversations.svelte.ts');
		return conversationsStore.activeConversation?.id === id;
	}, seeded.a);
	await assertName('AUD-006 renamed A');
	if (out) await page.screenshot({ path: `${out}/success.png`, fullPage: true });
	results.push('PASS A: committed DB/store/sidebar name, single write, reopen');

	// B/C: abort AFTER a successful IDB request, and a synchronous service-layer exception.
	for (const mode of ['abort', 'throw']) {
		const old = (await snapshot()).db;
		await configure(mode);
		await openRename();
		const draft = `AUD-006 retry ${mode}`;
		await input.fill(draft);
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		await dialog.getByRole('alert').waitFor();
		assert.match(await dialog.getByRole('alert').innerText(), /could not be saved.*try again/i);
		assert.equal(await input.inputValue(), draft);
		const state = await assertName(old);
		assert.equal(state.calls, 1);
		assert.equal(state.puts, 1); // proves the failure reached the actual IndexedDB write
		assert.equal(await dialog.getByRole('button', { name: 'Save', exact: true }).isEnabled(), true);
		assert.equal(
			await input.evaluate((element) =>
				element.closest('[role="alertdialog"]').contains(document.activeElement)
			),
			true
		);
		if (out) await page.screenshot({ path: `${out}/error-${mode}.png`, fullPage: true });
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		assert.equal((await assertName(draft)).calls, 2);
		results.push(
			`PASS B/C ${mode}: old DB/store/UI, preserved input, visible error, successful retry`
		);
	}

	// D: hold before the real transaction, dispatch multiple native inputs.
	await configure('', true);
	await openRename();
	await input.fill('AUD-006 serialized');
	await input.press('Enter');
	await page.waitForFunction(() => aud006.calls === 1);
	await input.press('Enter');
	await dialog.locator('[data-slot="alert-dialog-action"]').evaluate((button) => {
		button.click();
		button.click();
		button.click();
	});
	assert.equal(
		await dialog.getByRole('button', { name: 'Saving…', exact: true }).isDisabled(),
		true
	);
	assert.equal(
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(),
		true
	);
	await page.keyboard.press('Escape');
	await page.mouse.click(5, 5);
	assert.equal(await dialog.isVisible(), true);
	assert.equal((await snapshot()).calls, 1);
	await release();
	await dialog.waitFor({ state: 'hidden' });
	const serialized = await assertName('AUD-006 serialized');
	assert.equal(serialized.calls, 1);
	assert.equal(serialized.puts, 1);
	assert.equal(serialized.maxActive, 1);
	results.push('PASS D: Enter/clicks serialize; pending Save/Cancel/ESC/outside cannot dismiss');

	await configure('', true);
	await openRename();
	await input.fill('AUD-006 rapid clicks');
	await dialog.getByRole('button', { name: 'Save', exact: true }).evaluate((button) => {
		// Same event-loop turn, before Svelte can render disabled on the button.
		button.click();
		button.click();
		button.click();
	});
	await page.waitForFunction(() => aud006.calls === 1);
	await input.press('Enter');
	assert.equal((await snapshot()).calls, 1);
	await release();
	await dialog.waitFor({ state: 'hidden' });
	const rapid = await assertName('AUD-006 rapid clicks');
	assert.equal(rapid.calls, 1);
	assert.equal(rapid.puts, 1);
	assert.equal(rapid.maxActive, 1);
	results.push('PASS D: same-turn rapid Save clicks plus Enter produce one actual DB write');

	// Native Enter on Save must submit once; Enter on Cancel must never submit.
	await configure();
	await openRename();
	await input.fill('AUD-006 keyboard save');
	await dialog.getByRole('button', { name: 'Save', exact: true }).press('Enter');
	await dialog.waitFor({ state: 'hidden' });
	assert.equal((await assertName('AUD-006 keyboard save')).calls, 1);
	for (const method of ['escape', 'cancel-click', 'cancel-enter']) {
		await configure();
		await openRename();
		await input.fill('Must not persist');
		if (method === 'escape') await input.press('Escape');
		else if (method === 'cancel-enter')
			await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
		else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await dialog.waitFor({ state: 'hidden' });
		assert.equal((await assertName('AUD-006 keyboard save')).calls, 0);
		await openRename();
		assert.equal(await input.inputValue(), 'AUD-006 keyboard save');
		await input.press('Escape');
		await dialog.waitFor({ state: 'hidden' });
	}
	results.push(
		'PASS D: native Enter Save once; idle ESC/Cancel click/Cancel Enter discard without writes'
	);

	// Navigation and a replacement dialog while A is pending. The old result
	// persists only A and cannot close, clear or attach an error to B's dialog.
	for (const outcome of ['success', 'abort']) {
		await configure(outcome === 'abort' ? 'abort' : '', true);
		await openRename();
		await input.fill(`AUD-006 late ${outcome}`);
		await input.press('Enter');
		await page.waitForFunction(() => aud006.calls === 1);
		// Use the application's client-side navigation, not a native hash change
		// (SvelteKit may reload the document for the latter).
		await page
			.locator(`[data-conversation-selection-id="${seeded.b}"]`)
			.evaluate((element) => element.click());
		await page.waitForFunction(async (id) => {
			const { conversationsStore } = await import('/src/lib/stores/conversations.svelte.ts');
			return conversationsStore.activeConversation?.id === id;
		}, seeded.b);
		// Exercise B's real Edit handler even if A's modal still covers its card.
		await page
			.locator(`[data-conversation-selection-id="${seeded.b}"]`)
			.locator('button[aria-label="Edit"]')
			.evaluate((button) => button.click());
		await input.fill('Draft for B');
		await release();
		await page.waitForFunction(() => aud006.active === 0);
		assert.equal(await dialog.isVisible(), true);
		assert.equal(await input.inputValue(), 'Draft for B');
		assert.equal(await dialog.getByRole('alert').count(), 0);
		const b = await snapshot(seeded.b);
		assert.equal(b.db, 'AUD-006 old B');
		assert.deepEqual(b.active, { id: seeded.b, name: 'AUD-006 old B' });
		assert.equal((await snapshot()).db, 'AUD-006 late success');
		await input.press('Escape');
		await dialog.waitFor({ state: 'hidden' });
		await card().click();
		await page.waitForFunction(async (id) => {
			const { conversationsStore } = await import('/src/lib/stores/conversations.svelte.ts');
			return conversationsStore.activeConversation?.id === id;
		}, seeded.a);
	}
	results.push('PASS late success/rejection: owner A only, active B and newer B dialog untouched');
	assert.deepEqual(
		await page.evaluate(async (id) => {
			const { DatabaseService } = await import('/src/lib/services/database.service.ts');
			return DatabaseService.getConversationMessages(id);
		}, seeded.a),
		seeded.messages
	);
	results.push('PASS: persisted message tree untouched by successful/failed/retried renames');

	assert.deepEqual(await page.evaluate(() => aud006Rejections), []);
	assert.deepEqual(errors, []);
	results.push('PASS: no pageerror or unhandledrejection');
	console.log(results.join('\n'));
	if (out) await writeFile(`${out}/results.json`, JSON.stringify({ results, errors }, null, 2));
} catch (error) {
	if (out) await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
	throw error;
} finally {
	await context.close();
	await browser.close();
}
