/**
 * Synthetic profiles only. Real Chromium/IndexedDB, browser restart, export/import and desktop UI.
 * LLAMPART_PLAYWRIGHT_MODULE=/absolute/path/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://localhost:5173 node tests/browser/legacy-migration.mjs
 * Optional LLAMPART_TEST_ARTIFACTS saves screenshots and results outside the repository.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const url = process.env.LLAMPART_TEST_URL || 'http://localhost:5173';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const errors = [];
const results = {};
const profiles = [];
const launchOptions = {
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks']
};
if (artifacts) await mkdir(artifacts, { recursive: true });

async function setup(context) {
	await context.route('**/migration-empty', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Synthetic migration only</title>'
		})
	);
	await context.route('**/__llampart/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/props'))
			return route.fulfill({
				json: {
					build_info: 'synthetic',
					role: 'model',
					default_generation_settings: { n_ctx: 8192, params: {} }
				}
			});
		if (path.endsWith('/models'))
			return route.fulfill({ json: { object: 'list', data: [{ id: 'synthetic-model' }] } });
		return route.fulfill({ json: [] });
	});
	const page = await context.newPage();
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.goto(`${url}/migration-empty`);
	return page;
}

async function read(page, id = 'persistent') {
	return page.evaluate(
		async (id) => (await import('/tests/browser/legacy-migration-harness.ts')).readFixture(id),
		id
	);
}

async function migrate(page) {
	await page.evaluate(async () =>
		(await import('/src/lib/utils/legacy-migration.ts')).runLegacyMigration()
	);
}

async function persistentProfile() {
	// Only these exact freshly allocated profiles are removed in finally.
	const profile = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'llampart-own002-'));
	profiles.push(profile);
	return profile;
}

let context;
let browser;
try {
	const profile = await persistentProfile();
	context = await chromium.launchPersistentContext(profile, launchOptions);
	let page = await setup(context);
	await page.evaluate(async () => {
		const { fixture } = await import('/tests/browser/legacy-migration-harness.ts');
		const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
		await db.importConversations([fixture('persistent', 2)]);
	});
	const original = await read(page);
	const failed = await page.evaluate(async () => {
		const { runLegacyMigration } = await import('/src/lib/utils/legacy-migration.ts');
		const put = IDBObjectStore.prototype.put;
		const log = console.error;
		const logs = [];
		try {
			console.error = (...args) => logs.push(args.map(String).join(' '));
			IDBObjectStore.prototype.put = function (value, key) {
				if (value.id === 'persistent-next0') this.transaction.abort();
				return put.call(this, value, key);
			};
			await runLegacyMigration();
		} finally {
			IDBObjectStore.prototype.put = put;
			console.error = log;
		}
		return { logs, done: localStorage.getItem('llama-webui-migration-v2-done') };
	});
	assert.equal(failed.logs.length, 1);
	assert.equal(failed.done, null);
	await context.close();
	context = await chromium.launchPersistentContext(profile, launchOptions);
	page = await setup(context);
	assert.deepEqual(await read(page), original, 'Rollback survives full browser restart');
	await page.evaluate(async () => {
		const set = Storage.prototype.setItem;
		try {
			Storage.prototype.setItem = function (key, value) {
				if (key === 'llama-webui-migration-v2-done')
					throw new Error('synthetic storage quota failure');
				return set.call(this, key, value);
			};
			await (await import('/src/lib/utils/legacy-migration.ts')).runLegacyMigration();
		} finally {
			Storage.prototype.setItem = set;
		}
	});
	const success = await read(page);
	assert.equal(success.conv.currNode, 'persistent-tail');
	assert.equal(success.messages.length, original.messages.length + 2);
	await context.close();
	context = await chromium.launchPersistentContext(profile, launchOptions);
	page = await setup(context);
	assert.deepEqual(await read(page), success, 'Committed graph survives full browser restart');
	assert.equal(
		await page.evaluate(() => localStorage.getItem('llama-webui-migration-v2-done')),
		null
	);
	await migrate(page);
	assert.deepEqual(await read(page), success);
	assert(await page.evaluate(() => localStorage.getItem('llama-webui-migration-v2-done')));
	// Post-commit/pre-marker interruption is also safe after another restart.
	await page.evaluate(() => localStorage.removeItem('llama-webui-migration-v2-done'));
	await context.close();
	context = await chromium.launchPersistentContext(profile, launchOptions);
	page = await setup(context);
	await migrate(page);
	assert.deepEqual(await read(page), success);
	const exported = await page.evaluate(async () => {
		const { readFixture } = await import('/tests/browser/legacy-migration-harness.ts');
		const { createConversationExportEnvelope } =
			await import('/src/lib/utils/conversation-import-export.ts');
		return JSON.stringify(
			createConversationExportEnvelope([await readFixture('persistent')], '1.9.0')
		);
	});
	await context.close();
	const fresh = await persistentProfile();
	context = await chromium.launchPersistentContext(fresh, launchOptions);
	page = await setup(context);
	await page.evaluate(async (exported) => {
		const { parseConversationImport } =
			await import('/src/lib/utils/conversation-import-export.ts');
		const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
		await db.importConversations(parseConversationImport(JSON.parse(exported)));
	}, exported);
	await context.close();
	context = await chromium.launchPersistentContext(fresh, launchOptions);
	page = await setup(context);
	assert.deepEqual(
		await read(page),
		JSON.parse(JSON.stringify(success)),
		'Export → import into a fresh profile → restart (JSON omits undefined optional fields)'
	);
	await context.close();
	context = null;
	results.persistence =
		'PASS: rollback/retry/commit/done-cache retry/export-import across browser restarts';

	browser = await chromium.launch(launchOptions);
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1600, height: 1200 }
	]) {
		context = await browser.newContext({ viewport });
		page = await setup(context);
		await page.evaluate(async () => {
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
			const { fixture } = await import('/tests/browser/legacy-migration-harness.ts');
			const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
			await db.importConversations([fixture('Synthetic legacy', 2)]);
		});
		// Exercise actual startup, not a manual migration before mounting the app.
		await page.goto(url);
		await page.waitForSelector('textarea');
		await page.getByText('Synthetic legacy', { exact: true }).click();
		await page.getByText('Existing tail 0', { exact: true }).waitFor();
		await page.getByText('Final answer', { exact: true }).waitFor();
		await page.getByText('test_tool', { exact: true }).click();
		await page.getByText('Saved result', { exact: true }).waitFor();
		const order = await page.evaluate(() => {
			const text = document.body.innerText;
			return ['Original question', 'Before', 'Final answer', 'Next 0', 'Existing tail 0'].map(
				(part) => text.indexOf(part)
			);
		});
		assert(
			order.every(
				(position, index) => position >= 0 && (index === 0 || position > order[index - 1])
			),
			'Rendered history follows graph order'
		);
		if (artifacts) await page.screenshot({ path: `${artifacts}/${viewport.width}-legacy.png` });
		await page.getByRole('button', { name: 'Next message version', exact: true }).last().click();
		await page.getByText('Existing tail 1', { exact: true }).waitFor();
		assert.equal((await read(page, 'Synthetic legacy')).conv.currNode, 'Synthetic legacy-tail1');
		await page.reload();
		await page.getByText('Existing tail 1', { exact: true }).waitFor();
		assert.equal((await read(page, 'Synthetic legacy')).conv.currNode, 'Synthetic legacy-tail1');
		await page
			.getByRole('button', { name: 'Previous message version', exact: true })
			.last()
			.click();
		await page.getByText('Existing tail 0', { exact: true }).waitFor();
		if (artifacts)
			await page.screenshot({ path: `${artifacts}/${viewport.width}-branch-return.png` });
		results[`desktop-${viewport.width}x${viewport.height}`] = 'PASS';
		await context.close();
		context = null;
	}
	assert.deepEqual(errors, [], 'No console errors or pageerrors');
	results.errors = errors;
	if (artifacts) await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
	console.log(JSON.stringify(results, null, 2));
} finally {
	await context?.close();
	await browser?.close();
	for (const profile of profiles)
		await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
