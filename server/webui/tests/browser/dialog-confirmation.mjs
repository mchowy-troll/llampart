/** Native Chromium keyboard events through the real Svelte/Bits UI component.
 * Disposable storage only. Set LLAMPART_PLAYWRIGHT_MODULE / TEST_URL / TEST_ARTIFACTS.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const out = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const results = [];
try {
	for (const width of [1440, 390]) {
		const context = await browser.newContext({ viewport: { width, height: 1000 } });
		await context.addInitScript(() => {
			localStorage.setItem('llama-webui-migration-v2-done', '1');
			localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'openai-compatible',
					openAiCompatibleBaseUrl: 'http://synthetic.invalid',
					theme: 'frosted-glass',
					interfaceLanguage: 'en'
				})
			);
		});
		const errors = [];
		const page = await context.newPage();
		page.on('pageerror', (error) => errors.push(error.message));
		await context.route('**/__llampart/api/**', (route) =>
			route.fulfill({ json: { data: [{ id: 'Synthetic' }] } })
		);
		await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
		await page.locator('textarea').first().waitFor();
		await page.evaluate(async () => {
			const { mount } = await import('/node_modules/svelte/src/index-client.js');
			const { default: Component } =
				await import('/tests/browser/dialog-confirmation-harness.svelte');
			const { DatabaseService: db } = await import('/src/lib/services/database.service.ts');
			const conversation = await db.createConversation('Synthetic AUD-013');
			globalThis.dialogAudit = { db, conversation, writes: 0 };
			for (const method of ['put', 'add', 'delete', 'clear']) {
				const original = IDBObjectStore.prototype[method];
				IDBObjectStore.prototype[method] = function (...args) {
					dialogAudit.writes++;
					return original.apply(this, args);
				};
			}
			const target = document.createElement('div');
			document.body.append(target);
			dialogAudit.component = mount(Component, {
				target,
				props: {
					confirm: () => {
						void db.deleteConversation(conversation.id);
					}
				}
			});
		});
		const dialog = page.getByRole('alertdialog');
		const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
		const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
		const reset = async (options = {}) => {
			await page.evaluate((o) => dialogAudit.component.reset(o), options);
			await dialog.waitFor();
		};
		const state = () =>
			page.evaluate(async () => ({
				...dialogAudit.component.inspect(),
				writes: dialogAudit.writes,
				exists: Boolean(await dialogAudit.db.getConversation(dialogAudit.conversation.id))
			}));
		await reset();
		// Reach Cancel with real Tab/Shift+Tab rather than dispatching synthetic events.
		await confirm.focus();
		await page.keyboard.press('Shift+Tab');
		assert.equal(await cancel.evaluate((e) => e === document.activeElement), true);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(250);
		const reproduction = await state();
		await writeFile(`${out}/cancel-enter-${width}.json`, JSON.stringify(reproduction, null, 2));
		assert.equal(reproduction.confirms, 0, 'Cancel+Enter must never confirm');
		assert.equal(reproduction.cancels, 1);
		assert.equal(reproduction.open, false);
		assert.equal(reproduction.exists, true);
		assert.equal(reproduction.writes, 0);
		results.push(`PASS ${width} DIALOG-01/12 Cancel Enter: ${JSON.stringify(reproduction)}`);
		for (const [id, button, key, count] of [
			['02', confirm, 'Enter', 'confirms'],
			['03', cancel, 'Space', 'cancels'],
			['04', confirm, 'Space', 'confirms'],
			['06', cancel, null, 'cancels'],
			['07', confirm, null, 'confirms']
		]) {
			await reset();
			await button.focus();
			if (key) await page.keyboard.press(key);
			else await button.click();
			const s = await state();
			assert.equal(s[count], 1, id);
			assert.equal(s[count === 'confirms' ? 'cancels' : 'confirms'], 0, id);
			results.push(`PASS ${width} DIALOG-${id}`);
		}
		await reset();
		await page.keyboard.press('Escape');
		assert.equal((await state()).confirms, 0);
		assert.equal((await state()).cancels, 1);
		results.push(`PASS ${width} DIALOG-05`);
		await reset({ pending: true });
		await page.keyboard.press('Enter');
		await page.keyboard.press('Escape');
		assert.equal(await cancel.isDisabled(), true);
		assert.equal(await confirm.isDisabled(), true);
		assert.deepEqual(
			(({ confirms, cancels, open }) => ({ confirms, cancels, open }))(await state()),
			{ confirms: 0, cancels: 0, open: true }
		);
		results.push(`PASS ${width} DIALOG-08`);
		await reset({ disabled: true });
		await cancel.focus();
		await page.keyboard.press('Enter');
		assert.equal((await state()).confirms, 0);
		results.push(`PASS ${width} DIALOG-09`);
		for (const label of ['Child input', 'Child textarea', 'Child checkbox']) {
			await reset();
			await dialog.getByLabel(label).focus();
			await page.keyboard.press('Enter');
			assert.equal((await state()).confirms, 0, label);
		}
		await reset();
		await dialog.getByRole('button', { name: 'Handled child' }).press('Enter');
		assert.equal((await state()).confirms, 0);
		results.push(`PASS ${width} DIALOG-10/defaultPrevented`);
		await reset({ enter: false });
		await dialog.getByLabel('Child input').press('Enter');
		assert.equal((await state()).confirms, 0);
		await confirm.press('Enter');
		assert.equal((await state()).confirms, 1);
		results.push(`PASS ${width} DIALOG-11 component`);
		await reset({ hold: true });
		await confirm.focus();
		await page.keyboard.down('Enter');
		await page.keyboard.down('Enter');
		await page.keyboard.up('Enter');
		assert.equal((await state()).confirms, 1);
		results.push(`PASS ${width} DIALOG-13`);
		await reset();
		await dialog.evaluate((element) => {
			element.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					cancelable: true,
					isComposing: true
				})
			);
			element.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					cancelable: true,
					repeat: true
				})
			);
		});
		assert.equal((await state()).confirms, 0);
		results.push(`PASS ${width} IME/repeat container guards (supplementary synthetic events)`);
		await reset();
		await cancel.focus();
		await page.screenshot({ path: `${out}/dialog-${width}.png` });
		assert.deepEqual(errors, []);
		results.push(`PASS ${width} DIALOG-14 / pageerror`);
		await context.close();
	}
} finally {
	await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
console.log(results.join('\n'));
