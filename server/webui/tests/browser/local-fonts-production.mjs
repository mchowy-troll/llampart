/** Real production Chromium/CDP/exports; synthetic provider fixture, NOT real LLM.
 * Serve the separately built static output; no dev server or runtime font CDN. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40144';
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-font-production';
await mkdir(artifacts, { recursive: true });
const samples = {
	pl: 'Zażółć gęślą jaźń ĄĆĘŁŃÓŚŹŻ',
	bg: 'Български Щъркелът ѝ Ѝ вгджзийклнптфцчшщьъю',
	el: 'Ελληνικά άέήίόύώ ΐΰϊϋΪΫ ἄνθρωπος'
};
const mixed = Object.values(samples).join(' ');
const chart = {
	type: 'bar',
	title: mixed,
	description: mixed,
	xKey: 'name',
	series: [{ key: 'value', label: 'Łódź София Αθήνα' }],
	data: [
		{ name: 'Łódź София Αθήνα', value: 12 },
		{ name: 'Żółć Щъркел ΐΰ', value: 20 }
	]
};
const markdown = `${mixed}\n\n**${mixed}**\n\n*${mixed}*\n\n***${mixed}***\n\n> ${mixed}\n\n| PL | BG | EL |\n|---|---|---|\n|${samples.pl}|${samples.bg}|${samples.el}|\n\n\`const ł = 1;\`\n\n$$x^2+y^2=z^2$$\n\n\`\`\`llampart-chart\n${JSON.stringify(chart)}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n A["Łódź София Αθήνα"] --> B["Żółć Щъркел ΐΰ"]\n\`\`\``;
const families = [
	['merriweather', 'Merriweather', 'Merriweather', 'Tinos'],
	['google-sans', 'Google Sans', 'Google Sans', 'Google Sans'],
	['barlow', 'Barlow', 'Inter', 'Inter'],
	['inter', 'Inter', 'Inter', 'Inter'],
	['fira-sans', 'Fira Sans', 'Fira Sans', 'Fira Sans'],
	['literata', 'Literata', 'Literata', 'Literata'],
	['domine', 'Domine', 'Literata', 'Literata']
];
const browser = await chromium.launch({
	executablePath: '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const evidence = [];
async function platform(cdp, selector) {
	const { root } = await cdp.send('DOM.getDocument');
	const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
	assert(nodeId, selector);
	const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
	assert(
		fonts.length && fonts.every((f) => f.isCustomFont),
		`${selector}: ${JSON.stringify(fonts)}`
	);
	return fonts;
}
async function settle(page) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise(requestAnimationFrame);
	});
}
try {
	for (const [id, pl, bg, el] of families) {
		const context = await browser.newContext({
			viewport: { width: 1600, height: 1000 },
			acceptDownloads: true
		});
		const page = await context.newPage();
		const requests = [],
			fontResponses = [],
			errors = [],
			failures = [],
			external = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('request', (r) => {
			if (new URL(r.url()).pathname.startsWith('/fonts/')) requests.push(r.url());
			if (!r.url().startsWith(base) && !/^(blob|data):/.test(r.url())) external.push(r.url());
		});
		page.on('response', (r) => {
			if (new URL(r.url()).pathname.startsWith('/fonts/'))
				fontResponses.push({ url: r.url(), status: r.status() });
			if (r.status() >= 400) failures.push([r.status(), r.url()]);
		});
		await context.addInitScript(
			({ id }) => {
				if (!localStorage.getItem('LlamaCppWebui.config'))
					localStorage.setItem(
						'LlamaCppWebui.config',
						JSON.stringify({
							apiProvider: 'llama-server',
							llamaServerBaseUrl: 'http://fonts.test',
							serverBaseUrl: 'http://fonts.test',
							interfaceLanguage: 'pl',
							fontFamily: id,
							fontSize: '13',
							fontVariant: '400',
							titleGenerationUseLLM: false,
							askForTitleConfirmation: false,
							alwaysShowSidebarOnDesktop: true
						})
					);
			},
			{ id }
		);
		await page.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.pathname.includes('/__llampart/api/'))
				return route.fulfill(
					url.pathname.endsWith('/chat/completions')
						? {
								contentType: 'text/event-stream',
								body: `data: ${JSON.stringify({ choices: [{ delta: { content: markdown } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
							}
						: {
								json: url.pathname.endsWith('/props')
									? {
											build_info: 'font-fixture',
											model_path: 'fixture.gguf',
											default_generation_settings: { params: {} }
										}
									: url.pathname.endsWith('/models')
										? { object: 'list', data: [{ id: 'fixture.gguf' }] }
										: []
							}
				);
			return url.origin === new URL(base).origin ? route.continue() : route.abort();
		});
		await page.goto(base);
		const welcome = page.locator('.llampart-about-dialog-content');
		await welcome.waitFor();
		await welcome.locator('#about-llampart-do-not-show-again').check();
		await welcome.getByRole('button', { name: 'OK', exact: true }).click();
		await page.waitForSelector('textarea');
		await settle(page);
		assert.equal(await page.locator('html').getAttribute('lang'), 'pl');
		const initialRequests = [...requests];
		const allowed =
			id === 'merriweather'
				? ['merriweather', 'tinos']
				: id === 'barlow'
					? ['barlow', 'inter']
					: id === 'domine'
						? ['domine', 'literata']
						: [id];
		assert(
			initialRequests.every((url) =>
				allowed.some((prefix) => new URL(url).pathname.startsWith(`/fonts/${prefix}-`))
			),
			JSON.stringify(initialRequests)
		);
		assert(
			!initialRequests.some((url) =>
				/-italic|tinos-|greek-cyrillic-|merriweather-cyrillic/.test(url)
			),
			JSON.stringify(initialRequests)
		);
		await page.locator('button[aria-label="Ustawienia"]').click();
		const dialog = page.locator('.llampart-chat-settings-dialog-content');
		await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
		await page.locator('#fontFamily').click();
		assert.deepEqual(
			(await page.getByRole('option').allTextContents()).map((s) => s.trim()),
			[
				'Merriweather (domyślna)',
				'Google Sans',
				'Barlow',
				'Inter',
				'Fira Sans',
				'Literata',
				'Domine'
			]
		);
		await page.keyboard.press('Escape');
		await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
		await page.locator('textarea').first().fill('Fixture: PL BG EL — bez rzeczywistego LLM');
		await page.locator('textarea').first().press('Enter');
		await page
			.locator('.llampart-assistant-markdown .diagram-surface svg')
			.waitFor({ timeout: 60000 });
		await page.locator('.llampart-assistant-markdown .chart-plot svg').first().waitFor();
		const cdp = await context.newCDPSession(page);
		await cdp.send('DOM.enable');
		await cdp.send('CSS.enable');
		const glyphs = [];
		for (const weight of [400, 700])
			for (const style of ['normal', 'italic']) {
				await page.evaluate(
					({ samples, weight, style }) => {
						document.getElementById('font-probes')?.remove();
						const host = document.createElement('div');
						host.id = 'font-probes';
						host.style.cssText =
							'position:fixed;top:0;left:0;background:white;color:black;z-index:99999';
						for (const [lang, sample] of Object.entries(samples))
							for (const form of ['NFC', 'NFD']) {
								const span = document.createElement('div');
								span.id = `probe-${lang}-${form}`;
								span.lang = lang;
								span.style.cssText = `font-family:var(--llampart-font-family);font-size:32px;font-weight:${weight};font-style:${style};font-synthesis:none`;
								span.textContent = sample.normalize(form);
								host.append(span);
							}
						document.body.append(host);
					},
					{ samples, weight, style }
				);
				await settle(page);
				for (const [lang, expected] of [
					['pl', pl],
					['bg', bg],
					['el', el]
				])
					for (const form of ['NFC', 'NFD']) {
						const fonts = await platform(cdp, `#probe-${lang}-${form}`);
						assert(
							fonts.every((f) => [pl, bg, el].some((name) => f.familyName.includes(name))),
							`${id}: unexpected local fallback ${JSON.stringify(fonts)}`
						);
						if (id === 'merriweather' && lang === 'pl')
							assert(fonts.every((f) => f.familyName.includes('Merriweather')));
						assert(
							fonts.some((f) => f.familyName.includes(expected)),
							`${id}/${lang}: ${JSON.stringify(fonts)}`
						);
						glyphs.push({ weight, style, lang, form, fonts });
					}
				if (id === 'merriweather') {
					const probe = page.locator('#probe-bg-NFC');
					const localized = await probe.screenshot();
					await probe.evaluate((n) => (n.lang = 'en'));
					assert(
						!localized.equals(await probe.screenshot()),
						`No visible BGR locl ${weight}/${style}`
					);
					await probe.evaluate((n) => (n.lang = 'bg'));
					await probe.screenshot({ path: `${artifacts}/bg-locl-${weight}-${style}.png` });
				}
			}
		await page.locator('#font-probes').evaluate((n) => n.remove());
		await settle(page);
		for (const selector of [
			'.llampart-assistant-markdown p',
			'.llampart-assistant-markdown td',
			'.llampart-assistant-markdown blockquote p'
		])
			await platform(cdp, selector);
		const technical = await page.evaluate(() => ({
			code: getComputedStyle(document.querySelector('.llampart-assistant-markdown code'))
				.fontFamily,
			math: getComputedStyle(document.querySelector('.katex')).fontFamily
		}));
		assert(!technical.code.includes(pl));
		assert(technical.math.includes('KaTeX'));
		const exports = [];
		for (const kind of ['chart', 'diagram'])
			for (const format of ['svg', 'png']) {
				const frame = page.locator(`.llampart-assistant-markdown .llampart-${kind}-frame`).first();
				if (kind === 'chart') {
					// Controlled export-style fixture: four real combinations, not a
					// claim that the UI offers an italic base-family selector.
					await frame.evaluate((n) => {
						for (const [selector, weight, style] of [
							['.chart-title', '700', 'italic'],
							['.chart-description', '400', 'italic'],
							['.chart-legend button', '700', 'normal']
						])
							for (const element of n.querySelectorAll(selector)) {
								element.style.setProperty('font-weight', weight, 'important');
								element.style.setProperty('font-style', style, 'important');
							}
					});
					await settle(page);
				}
				if (id === 'merriweather') {
					// Controlled known-language fixture, not message language detection.
					await frame.evaluate((n) => ((n.closest('.diagram-typography') || n).lang = 'bg'));
				}
				await frame.scrollIntoViewIfNeeded();
				const [download] = await Promise.all([
					page.waitForEvent('download'),
					frame.getByRole('button', { name: new RegExp(`${format.toUpperCase()}$`) }).click()
				]);
				const path = `${artifacts}/${id}-${kind}.${format}`;
				await download.saveAs(path);
				const bytes = await readFile(path);
				const reopened = await context.newPage();
				await reopened.route('**/font-export.*', (r) =>
					r.fulfill({ contentType: format === 'svg' ? 'image/svg+xml' : 'image/png', body: bytes })
				);
				await reopened.goto(`${base}/font-export.${format}`);
				await settle(reopened);
				if (format === 'svg') {
					if (kind === 'chart') {
						assert.deepEqual(
							await reopened
								.locator('svg > text')
								.first()
								.evaluate((n) => ({
									weight: getComputedStyle(n).fontWeight,
									style: getComputedStyle(n).fontStyle
								})),
							{ weight: '700', style: 'italic' }
						);
					}
					assert.equal(
						await reopened.locator('svg').first().getAttribute('lang'),
						id === 'merriweather' ? 'bg' : 'pl'
					);
					if (id === 'google-sans')
						assert.equal(
							await reopened
								.locator('svg')
								.first()
								.evaluate((n) => getComputedStyle(n).fontOpticalSizing),
							'none'
						);
					assert.equal(await reopened.locator('parsererror').count(), 0);
					assert((bytes.toString().match(/@font-face/g) || []).length <= 12);
					assert(bytes.toString().includes('data:font/woff2;base64,'));
					const session = await context.newCDPSession(reopened);
					await session.send('DOM.enable');
					await session.send('CSS.enable');
					const count = await reopened.locator('svg text, svg tspan').count();
					assert(count > 0);
					for (let i = 0; i < count; i++) {
						const node = reopened.locator('svg text, svg tspan').nth(i);
						if (
							!(await node.evaluate((n) =>
								[...n.childNodes]
									.filter((c) => c.nodeType === 3)
									.map((c) => c.textContent)
									.join('')
									.trim()
							))
						)
							continue;
						await node.evaluate((n, i) => (n.id = `export-text-${i}`), i);
						await platform(session, `#export-text-${i}`);
					}
					await session.detach();
				} else
					assert(await reopened.locator('img').evaluate((n) => n.complete && n.naturalWidth > 0));
				await reopened.screenshot({ path: `${artifacts}/${id}-${kind}-${format}-reopened.png` });
				await reopened.close();
				exports.push({
					kind,
					format,
					bytes: bytes.length,
					faces:
						format === 'svg' ? (bytes.toString().match(/@font-face/g) || []).length : undefined,
					controlledFourStyles: kind === 'chart',
					genuinePrimaryItalic: id !== 'domine'
				});
			}
		assert.deepEqual(errors, []);
		assert.deepEqual(failures, []);
		assert.deepEqual(external, []);
		const report = {
			id,
			glyphs,
			technical,
			initialRequests,
			requests: [...new Set(requests)],
			fontResponses,
			exports,
			errors,
			failures,
			external
		};
		if (id === 'merriweather') {
			await page.locator('button[aria-label="Ustawienia"]').click();
			await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
			await page.locator('#interfaceLanguage').click();
			await page.getByRole('option', { name: 'Български', exact: true }).click();
			assert.equal(
				await page.locator('html').getAttribute('lang'),
				'pl',
				'Unsaved draft must not mislabel the untranslated UI'
			);
			await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
			assert.equal(await page.locator('html').getAttribute('lang'), 'pl');
			await page.locator('button[aria-label="Ustawienia"]').click();
			await dialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
			await page.locator('#interfaceLanguage').click();
			await page.getByRole('option', { name: 'Български', exact: true }).click();
			await dialog.getByRole('button', { name: 'Zapisz ustawienia', exact: true }).click();
			await page.waitForFunction(() => document.documentElement.lang === 'bg');
			await page.reload();
			await page.waitForSelector('textarea');
			assert.equal(await page.locator('html').getAttribute('lang'), 'bg');
			report.documentLanguage =
				'REAL PASS pl, unsaved/cancel pl, save/reload bg (UI only; no content detection)';
			for (const retired of ['frank-ruhl-libre', 'crimson-text', 'libre-caslon-condensed']) {
				await page.evaluate((retired) => {
					const settings = JSON.parse(localStorage.getItem('LlamaCppWebui.config'));
					Object.assign(settings, {
						fontFamily: retired,
						fontVariant: '600',
						fontSize: '19',
						temperature: 0.3
					});
					localStorage.setItem('LlamaCppWebui.config', JSON.stringify(settings));
				}, retired);
				await page.reload();
				await page.waitForSelector('textarea');
				await page.waitForFunction(
					() =>
						document.documentElement.dataset.llampartFont === 'merriweather' &&
						getComputedStyle(document.body).fontWeight === '600' &&
						getComputedStyle(document.body).fontSize === '19px'
				);
				assert.equal(
					await page.evaluate(
						() => JSON.parse(localStorage.getItem('LlamaCppWebui.config')).temperature
					),
					0.3
				);
			}
			report.migration = 'REAL PASS three retired IDs, 600/19 and unrelated temperature retained';
		}
		assert.deepEqual(errors, []);
		assert.deepEqual(failures, []);
		assert.deepEqual(external, []);
		evidence.push(report);
		await writeFile(`${artifacts}/evidence.json`, JSON.stringify(evidence, null, 2));
		console.log(
			`REAL PASS ${id}: PL/BG/EL NFC/NFD CDP, Markdown/table/quote, SVG/PNG reopens; MOCK provider`
		);
		await context.close();
	}
	// No Playwright routing here: offline must really disconnect the browser,
	// not accidentally succeed through fixture fulfill handlers or an offline shell.
	const offlineContext = await browser.newContext();
	const offlinePage = await offlineContext.newPage();
	await offlinePage.goto(base);
	await offlinePage.waitForSelector('textarea');
	assert.equal(
		await offlinePage.evaluate(
			async () => (await navigator.serviceWorker.getRegistrations()).length
		),
		0
	);
	await offlineContext.setOffline(true);
	let disconnected = '';
	try {
		await offlinePage.reload({ waitUntil: 'domcontentloaded' });
	} catch (error) {
		disconnected = error.message;
	}
	assert(disconnected.includes('ERR_INTERNET_DISCONNECTED'), disconnected);
	await offlineContext.setOffline(false);
	await offlinePage.goto(base);
	await offlinePage.waitForSelector('textarea');
	await writeFile(
		`${artifacts}/offline.json`,
		JSON.stringify(
			{ noRouting: true, disconnected, localServerReload: 'PASS', serviceWorkers: 0 },
			null,
			2
		)
	);
	await offlineContext.close();
} finally {
	await browser.close();
}
