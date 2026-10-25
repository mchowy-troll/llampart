/** OWN-008: rendered UI, real stores/IndexedDB, isolated synthetic provider I/O.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:41988 node tests/browser/system-message-ownership.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:41988';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
});
const results = [];

async function setup(viewport) {
	const context = await browser.newContext({ viewport });
	await context.addInitScript(() => {
		localStorage.setItem('llama-webui-migration-v2-done', '1');
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				apiProvider: 'llama-server',
				interfaceLanguage: 'en',
				serverBaseUrl: 'http://synthetic.test',
				llamaServerBaseUrl: 'http://synthetic.test',
				titleGenerationUseLLM: false,
				askForTitleConfirmation: false,
				preEncodeConversation: false,
				showSystemMessage: true
			})
		);
	});
	const payloads = [];
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
		if (url.pathname.endsWith('/chat/completions')) {
			payloads.push(route.request().postDataJSON());
			return route.fulfill({
				json: {
					choices: [
						{ message: { role: 'assistant', content: 'Synthetic answer' }, finish_reason: 'stop' }
					]
				}
			});
		}
		return route.fulfill({ json: [] });
	});
	const page = await context.newPage();
	await page.addLocatorHandler(page.locator('.llampart-about-dialog-content'), async (welcome) => {
		await welcome.locator('#about-llampart-do-not-show-again').check();
		await welcome.getByRole('button', { name: 'OK', exact: true }).click();
	});
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.evaluate(async () => {
		const { db, conversations: c } =
			await import('/tests/browser/reasoning-props-cancellation-harness.ts');
		for (const id of ['A', 'B']) {
			const msg = (suffix, role, parent, children, content, type = 'text') => ({
				id: `${id}-${suffix}`,
				convId: id,
				role,
				parent,
				children,
				content,
				type,
				timestamp: 1,
				toolCalls: ''
			});
			await db.importConversations([
				{
					conv: { id, name: `OWN008 ${id}`, currNode: `${id}-answer`, lastModified: 1 },
					messages: [
						msg('root', 'system', null, [`${id}-system`], '', 'root'),
						msg(
							'system',
							'system',
							`${id}-root`,
							[`${id}-user`],
							id === 'A' ? 'Instrukcja stara' : 'Instrukcja B',
							'system'
						),
						msg('user', 'user', `${id}-system`, [`${id}-answer`], `Pytanie ${id}`),
						msg('answer', 'assistant', `${id}-user`, [], `Odpowiedź ${id}`)
					]
				}
			]);
		}
		await c.loadConversations();
		await c.loadConversation('A');
	});
	await page
		.locator('.llampart-system-message-content')
		.filter({ hasText: 'Instrukcja stara' })
		.waitFor();
	return { context, page, errors, payloads };
}

async function openEdit(page, content = 'Instrukcja nowa') {
	const system = page.locator('.llampart-system-message');
	await system.locator('button[aria-label="Edit"]').click();
	await system.locator('textarea').fill(content);
	return system;
}

async function snapshot(page, id) {
	return page.evaluate(async (id) => {
		const { db, conversations: c } =
			await import('/tests/browser/reasoning-props-cancellation-harness.ts');
		return {
			conv: await db.getConversation(id),
			rows: await db.getConversationMessages(id),
			active: c.activeConversation,
			visible: c.activeMessages
		};
	}, id);
}

async function navigate(page, id) {
	await page.evaluate(async (id) => {
		const { conversations: c } =
			await import('/tests/browser/reasoning-props-cancellation-harness.ts');
		await c.loadConversation(id);
	}, id);
}

async function gateSave(page) {
	await page.evaluate(async () => {
		const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
		let release;
		const gate = new Promise((done) => (release = done));
		globalThis.__own008 = { calls: 0, release };
		for (const name of ['updateMessage', 'updateConversationMessage']) {
			const original = db[name];
			db[name] = async (...args) => {
				globalThis.__own008.calls++;
				await gate;
				return original.apply(db, args);
			};
		}
	});
}

async function waitForSave(page) {
	await page.waitForFunction(() => globalThis.__own008.calls > 0);
}

try {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		for (const scenario of ['standard', 'navigation', 'failure', 'pending']) {
			const { context, page, errors, payloads } = await setup(viewport);
			try {
				const before = await snapshot(page, 'A');
				if (scenario === 'standard') {
					const content =
						'Instrukcja nowa\nZażółć gęślą jaźń\n' + 'Wieloliniowa instrukcja.\n'.repeat(30);
					const system = await openEdit(page, `  ${content}  `);
					if (artifacts)
						await page.screenshot({ path: `${artifacts}/${viewport.width}-editing.png` });
					await system.getByRole('button', { name: 'Save', exact: true }).click();
					await system
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Instrukcja nowa' })
						.waitFor();
					const after = await snapshot(page, 'A');
					assert.deepEqual(
						after.rows,
						before.rows.map((row) =>
							row.id === 'A-system' ? { ...row, content: content.trim() } : row
						)
					);
					assert.equal(after.conv.currNode, before.conv.currNode);
					await page.reload();
					await page.waitForSelector('textarea');
					await navigate(page, 'A');
					await page
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Zażółć gęślą jaźń' })
						.waitFor();
					await page.evaluate(async () => {
						const { conversations: c } =
							await import('/tests/browser/reasoning-props-cancellation-harness.ts');
						const { ChatService } = await import('/src/lib/services/chat.service.ts');
						await ChatService.sendMessage(
							c.activeMessages,
							{ stream: false, model: 'synthetic-model' },
							'A'
						);
					});
					assert.equal(payloads.length, 1);
					assert.equal(payloads[0].messages[0].role, 'system');
					assert.equal(payloads[0].messages[0].content.endsWith(content.trim()), true);
					assert.equal(payloads[0].messages[0].content.includes('Instrukcja stara'), false);
					if (artifacts)
						await page.screenshot({ path: `${artifacts}/${viewport.width}-saved-reloaded.png` });
					const edit = await openEdit(page, '   ');
					assert.equal(
						await edit.getByRole('button', { name: 'Save', exact: true }).isDisabled(),
						true
					);
					// Cancel intentionally retains the existing removal policy (not a new discard contract).
					await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
					await page.waitForFunction(async () => {
						const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
						return !(await db.getConversationMessages('A')).some((row) => row.id === 'A-system');
					});
					const cancelled = await snapshot(page, 'A');
					assert.equal(cancelled.rows.find((row) => row.id === 'A-user').parent, 'A-root');
					assert.equal(cancelled.conv.currNode, before.conv.currNode);
				} else if (scenario === 'navigation') {
					await gateSave(page);
					const system = await openEdit(page);
					await system.getByRole('button', { name: 'Save', exact: true }).click();
					await waitForSave(page);
					await navigate(page, 'B');
					const beforeB = await snapshot(page, 'B');
					await page.evaluate(() => globalThis.__own008.release());
					await page.waitForFunction(async () => {
						const { db } = await import('/tests/browser/reasoning-props-cancellation-harness.ts');
						return (
							(await db.getConversationMessages('A')).find((row) => row.id === 'A-system')
								.content === 'Instrukcja nowa'
						);
					});
					assert.deepEqual(await snapshot(page, 'B'), beforeB);
					await page
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Instrukcja B' })
						.waitFor();
					await navigate(page, 'A');
					await page
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Instrukcja nowa' })
						.waitFor();
				} else if (scenario === 'failure') {
					await page.evaluate(() => {
						const original = IDBObjectStore.prototype.put;
						IDBObjectStore.prototype.put = function (...args) {
							const request = original.apply(this, args);
							if (this.name === 'messages') {
								IDBObjectStore.prototype.put = original;
								this.transaction.abort();
							}
							return request;
						};
					});
					const system = await openEdit(page, 'Draft niezapisany');
					await system.getByRole('button', { name: 'Save', exact: true }).click();
					await page.locator('[data-sonner-toast][data-type="error"]').waitFor({ timeout: 5000 });
					await page.waitForFunction(() => {
						const toast = document.querySelector('[data-sonner-toast][data-type="error"]');
						return (
							toast?.getAttribute('data-mounted') === 'true' &&
							getComputedStyle(toast).opacity === '1'
						);
					});
					assert.equal(await system.locator('textarea').inputValue(), 'Draft niezapisany');
					assert.deepEqual(await snapshot(page, 'A'), before);
					if (artifacts)
						await page.screenshot({
							path: `${artifacts}/${viewport.width}-error-draft.png`,
							animations: 'disabled'
						});
					await system.getByRole('button', { name: 'Save', exact: true }).click();
					await system
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Draft niezapisany' })
						.waitFor();
				} else {
					await gateSave(page);
					const system = await openEdit(page, 'Pierwszy draft');
					await system.getByRole('button', { name: 'Save', exact: true }).click();
					await waitForSave(page);
					assert.equal(
						await system.getByRole('button', { name: 'Save', exact: true }).isDisabled(),
						true,
						'second Save enabled'
					);
					assert.equal(
						await system.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(),
						true,
						'Cancel during pending enabled'
					);
					assert.equal(
						await system.locator('textarea').isDisabled(),
						true,
						'draft editable during pending'
					);
					await system.locator('textarea').dispatchEvent('keydown', { key: 'Enter' });
					await system.locator('textarea').dispatchEvent('keydown', { key: 'Escape' });
					assert.equal(await page.evaluate(() => globalThis.__own008.calls), 1);
					if (artifacts)
						await page.screenshot({ path: `${artifacts}/${viewport.width}-pending.png` });
					await page.evaluate(() => globalThis.__own008.release());
					await system
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Pierwszy draft' })
						.waitFor();
					await openEdit(page, 'Drugi draft');
					await system.getByRole('button', { name: 'Save', exact: true }).click();
					await system
						.locator('.llampart-system-message-content')
						.filter({ hasText: 'Drugi draft' })
						.waitFor();
					assert.equal((await snapshot(page, 'A')).rows.length, before.rows.length);
				}
				assert.deepEqual(errors, []);
				if (artifacts)
					await page.screenshot({ path: `${artifacts}/${viewport.width}-${scenario}.png` });
				results.push({ viewport, scenario, ok: true });
			} catch (error) {
				results.push({ viewport, scenario, ok: false, error: error.message, errors });
			} finally {
				await context.close();
			}
		}
	}
	const { context, page, errors } = await setup({ width: 1920, height: 1080 });
	try {
		const matrix = await page.evaluate(async () => {
			const { systemMessageStoreScenarios } =
				await import('/tests/browser/system-message-harness.ts');
			return systemMessageStoreScenarios();
		});
		assert.deepEqual(errors, []);
		results.push({ scenario: 'store-matrix', ok: true, matrix });
	} catch (error) {
		results.push({ scenario: 'store-matrix', ok: false, error: error.message, errors });
	} finally {
		await context.close();
	}
} finally {
	await browser.close();
}
console.log(JSON.stringify(results, null, 2));
if (artifacts) await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
assert.equal(results.filter((result) => !result.ok).length, 0, 'OWN-008 UI scenarios failed');
