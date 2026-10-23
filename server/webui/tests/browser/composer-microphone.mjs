/** Isolated desktop rendering of the real microphone component and Frosted Glass CSS.
 * No microphone permission/media device: verify the existing callback contract.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const baseline = process.env.LLAMPART_MIC_BASELINE === '1';
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({ theme: 'frosted-glass', interfaceLanguage: 'en' })
	);
});
await page.route('**/__llampart/api/**', (route) => route.fulfill({ json: {} }));
const fixture = page.locator('#package-b-fixture');
const mic = fixture.locator('button.llampart-composer-action-button').first();
async function snapshot(name) {
	await mic.evaluate(async (el) => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		await Promise.all(
			el
				.getAnimations()
				.filter((a) => a.effect.getTiming().iterations !== Infinity)
				.map((a) => a.finished)
		);
	});
	const data = await fixture.locator('.llampart-chat-input-frame button').evaluateAll((buttons) =>
		buttons.map((el) => {
			const css = getComputedStyle(el),
				box = el.getBoundingClientRect();
			return {
				html: el.outerHTML,
				box: { x: box.x, y: box.y, width: box.width, height: box.height },
				background: css.backgroundColor,
				border: css.border,
				radius: css.borderRadius,
				shadow: css.boxShadow,
				filter: css.backdropFilter,
				animation: css.animationName,
				outline: css.outline,
				before: getComputedStyle(el, '::before').content,
				after: getComputedStyle(el, '::after').content
			};
		})
	);
	if (artifacts) {
		await mkdir(artifacts, { recursive: true });
		await writeFile(`${artifacts}/${name}.json`, JSON.stringify(data, null, 2));
		await page.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled' });
	}
	return data;
}
try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40135');
	await page.locator('textarea').first().waitFor();
	await page.evaluate(async () => {
		const { mount } = await import('/node_modules/svelte/src/index-client.js');
		const { default: Fixture } = await import('/tests/fixtures/PackageB.svelte');
		mount(Fixture, { target: document.body });
	});
	await mic.waitFor();
	assert(await mic.isDisabled());
	const before = await snapshot('disabled');
	if (!baseline)
		assert.equal(
			await fixture.locator('button button').count(),
			0,
			'No nested painted tooltip button'
		);
	const trigger = fixture.locator('[data-slot="tooltip-trigger"]').first();
	await trigger.hover();
	if (!baseline)
		await page.locator('[data-slot="tooltip-content"]').filter({ hasText: /audio/i }).waitFor();
	await page.mouse.move(0, 0);
	await page.mouse.click(before[baseline ? 1 : 0].box.x + 16, before[baseline ? 1 : 0].box.y + 16);
	assert.equal(await fixture.locator('output').innerText(), '0');
	await fixture.getByLabel('Audio', { exact: true }).check();
	assert(!(await mic.isDisabled()));
	await snapshot('idle');
	await mic.hover();
	await snapshot('hover');
	await page.mouse.down();
	await snapshot('active');
	await page.mouse.move(0, 0);
	await page.mouse.up();
	await page.keyboard.press('Tab');
	await mic.focus();
	await snapshot('focus');
	assert(await mic.evaluate((el) => el.matches(':focus-visible')));
	await mic.press('Space');
	assert.equal(await fixture.locator('output').innerText(), '1');
	assert.equal(await mic.locator('svg.lucide-square').count(), 1);
	const recording = await snapshot('recording');
	if (!baseline) {
		assert.match(recording[0].animation, /pulse/);
		assert.equal(
			await mic.evaluate((el) => {
				const probe = document.createElement('span');
				probe.style.backgroundColor = 'var(--color-red-500)';
				document.body.append(probe);
				const expected = getComputedStyle(probe).backgroundColor;
				probe.remove();
				return getComputedStyle(el).backgroundColor === expected;
			}),
			true
		);
		assert.equal(
			await mic.locator('svg').evaluate((el) => getComputedStyle(el).color),
			'rgb(255, 255, 255)'
		);
	}
	await mic.click();
	assert.equal(await fixture.locator('output').innerText(), '2');
	for (const label of ['Loading', 'Disabled']) {
		await fixture.getByLabel(label, { exact: true }).check();
		assert(await mic.isDisabled());
		await fixture.getByLabel(label, { exact: true }).uncheck();
	}
	assert.deepEqual(errors, []);
	console.log(
		'PASS microphone disabled/no audio tooltip, idle, hover, keyboard focus, recording/stop callback, loading/disabled'
	);
} finally {
	await browser.close();
}
