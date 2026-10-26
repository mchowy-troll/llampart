/** Real desktop UI in Firefox AND Chromium. Synthetic conversations only.
 * Supply LLAMPART_PLAYWRIGHT_MODULE, LLAMPART_TEST_ARTIFACTS, optionally
 * LLAMPART_VISUAL_BASELINE=1 / LLAMPART_VISUAL_REFERENCE (baseline artifacts).
 * Firefox is installed outside the project with PLAYWRIGHT_BROWSERS_PATH.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const engines = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
await mkdir(artifacts, { recursive: true });
const baseline = process.env.LLAMPART_VISUAL_BASELINE === '1';
const url = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40135';
const math = String.raw`Inline: $E=mc^2$ oraz \(A=\pi r^2\) pozostają częścią zdania.

Całka, zwarty zapis display:
\[\int_{-\infty}^{\infty} e^{-x^2}\,dx=\sqrt{\pi}\]

Suma, zwarty zapis dolarowy:
$$\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}$$

Macierz:
\[\begin{pmatrix}a_1 & \frac{1}{1+\frac{1}{x}} \\ \sqrt{\alpha} & \beta_k^2\end{pmatrix}\]

Wzór: \[\frac{-b\pm\sqrt{b^2-4ac}}{2a}\] Dalszy tekst.

**Pogrubienie**, *kursywa*, [link](https://example.org/) i @@inline@@. Cena $5.99.

## Nagłówek

- Zwykła lista.

> Cytat.

| A | B |
|---|---|
| 1 | 2 |`.replaceAll('@@', '`');
const chart = {
	type: 'bar',
	title: 'Eksport bez kapsułki',
	xKey: 'x',
	series: [{ key: 'y', label: 'Y' }],
	data: [
		{ x: 'A', y: 2 },
		{ x: 'B', y: 4 }
	]
};
const exportsMarkdown =
	'```llampart-chart\n' +
	JSON.stringify(chart) +
	'\n```\n\n```mermaid\nflowchart LR\n A[Start] --> B[Koniec]\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst answer = 42;\n```\n\n```markdown\n# Markdown\n\n**Treść**.\n```';
const formats = '.format-export-action, .table-csv-button, .download-code-btn';
const report = [];
for (const name of ['firefox', 'chromium']) {
	const browser = await engines[name].launch({
		headless: true,
		...(name === 'chromium' ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {})
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		acceptDownloads: true
	});
	const page = await context.newPage();
	const result = {
		browser: name,
		version: browser.version(),
		errors: [],
		console: [],
		cases: [],
		settings: [],
		downloads: []
	};
	result.requestFailures = [];
	let phase = 'initial load';
	page.on('requestfailed', (request) =>
		result.requestFailures.push({ phase, url: request.url(), error: request.failure()?.errorText })
	);
	report.push(result);
	page.on('pageerror', (e) => result.errors.push({ phase, message: e.message, stack: e.stack }));
	page.on('console', (m) => {
		if (m.type() === 'error') result.console.push(m.text());
	});
	await page.addInitScript(() => {
		localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
		localStorage.setItem(
			'LlamaCppWebui.config',
			JSON.stringify({
				theme: 'frosted-glass',
				interfaceLanguage: 'en',
				fontFamily: 'merriweather',
				fontSize: '13',
				fontVariant: '400',
				alwaysShowSidebarOnDesktop: false
			})
		);
	});
	// Synthetic provider data only; asset/font/module requests stay native.
	// Provider transport/SSE behaviour is not under test here.
	await page.addInitScript(() => {
		const nativeFetch = window.fetch.bind(window);
		window.fetch = (input, init) => {
			const url = new URL(
				typeof input === 'string' || input instanceof URL ? input : input.url,
				location.href
			);
			if (!url.pathname.startsWith('/__llampart/api/')) return nativeFetch(input, init);
			const json = url.pathname.endsWith('/props')
				? {
						role: 'model',
						model_path: 'synthetic/model',
						build_info: 'visual-correction',
						default_generation_settings: { params: {} }
					}
				: url.pathname.endsWith('/models')
					? { object: 'list', data: [{ id: 'synthetic/model' }] }
					: [];
			return Promise.resolve(Response.json(json));
		};
	});
	let root = page.locator('.llampart-assistant-markdown').first();
	async function settled() {
		await root.evaluate(async (el) => {
			await document.fonts.ready;
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			await Promise.all(
				el
					.getAnimations({ subtree: true })
					.filter((a) => a.effect.getTiming().iterations !== Infinity)
					.map((a) => a.finished.catch(() => {}))
			);
		});
	}
	async function check(label, fn) {
		try {
			await fn();
			result.cases.push({ label, status: 'PASS' });
		} catch (e) {
			result.cases.push({ label, status: 'FAIL', error: e.message });
		}
		console.log(name, result.cases.at(-1));
	}
	async function update(content, streaming = false) {
		await page.evaluate(
			async ({ content, streaming }) => {
				const { conversations } = await import('/tests/browser/charts-harness.ts');
				const { chatStore } = await import('/src/lib/stores/chat.svelte.ts');
				// Synthetic presentation state, not provider/SSE behaviour under test.
				chatStore.setStreamingActive(streaming);
				const assistant = conversations.activeMessages.find((m) => m.role === 'assistant');
				conversations.updateMessageAtIndex(conversations.findMessageIndex(assistant.id), {
					content
				});
			},
			{ content, streaming }
		);
		await page.waitForTimeout(250);
		await settled();
	}
	const style = (el) => {
		const s = getComputedStyle(el),
			box = el.getBoundingClientRect();
		const keys = [
			'fontFamily',
			'fontSize',
			'fontWeight',
			'lineHeight',
			'textAlign',
			'display',
			'backgroundColor',
			'backgroundImage',
			'borderTopWidth',
			'borderTopColor',
			'boxShadow',
			'backdropFilter',
			'filter',
			'outlineStyle',
			'outlineWidth',
			'padding',
			'gap'
		];
		return {
			...Object.fromEntries(keys.map((k) => [k, s[k]])),
			width: box.width,
			height: box.height
		};
	};
	try {
		await page.goto(`${url}/#/`);
		await page.locator('textarea').first().waitFor();
		await page.waitForLoadState('networkidle');
		const id = await page.evaluate(async (content) => {
			const { db } = await import('/tests/browser/charts-harness.ts');
			const conv = await db.createConversation('Syntetyczna kontrola wizualna');
			const parent = await db.createRootMessage(conv.id);
			await db.createMessageBranch(
				{
					convId: conv.id,
					type: 'text',
					role: 'assistant',
					timestamp: Date.now(),
					content,
					children: [],
					parent,
					model: 'synthetic/model'
				},
				parent
			);
			return conv.id;
		}, math);
		// Use the app's delegated link navigation. Editing location.hash directly
		// deliberately triggers a full document reload in SvelteKit's hash router.
		await page.evaluate((id) => {
			const link = document.createElement('a');
			link.href = `#/chat/${id}`;
			document.body.append(link);
			link.click();
			link.remove();
		}, id);
		await root.locator('.katex').first().waitFor();
		const sidebar = page.locator('.llampart-sidebar-v-trigger-open');
		if (await sidebar.count()) await sidebar.click();
		for (const [family, size] of [
			['merriweather', '13'],
			['fira-sans', '18']
		]) {
			phase = `math ${family} ${size}`;
			await page.evaluate(
				async ({ family, size }) => {
					const { settings } = await import('/tests/browser/charts-harness.ts');
					settings.updateConfig('fontFamily', family);
					settings.updateConfig('fontSize', size);
				},
				{ family, size }
			);
			await update(math);
			const tokens = await page.evaluate(async (source) => {
				const { preprocessLaTeX } = await import('/src/lib/utils/latex-protection.ts');
				const { createMarkdownProcessor } = await import('/src/lib/markdown/markdown-runtime.ts');
				const normalized = preprocessLaTeX(source);
				const proc = await createMarkdownProcessor({});
				const ast = proc.parse(normalized);
				const math = [];
				function visit(n) {
					if (n.type === 'math' || n.type === 'inlineMath') math.push(n);
					for (const child of n.children || []) visit(child);
				}
				visit(ast);
				return { source, normalized, math };
			}, math);
			const prose = await root
				.locator('p,h2,li,strong,em,a,code,th,td,blockquote')
				.evaluateAll((els) =>
					els
						.filter((el) => !el.closest('.katex'))
						.map((el) => {
							const s = getComputedStyle(el);
							return {
								tag: el.tagName,
								text: el.textContent,
								family: s.fontFamily,
								size: s.fontSize,
								weight: s.fontWeight,
								lineHeight: s.lineHeight
							};
						})
				);
			const formulas = [];
			for (const el of await root.locator('.katex').all())
				formulas.push({
					tex: await el.locator('annotation').textContent(),
					displayMath: await el.evaluate((el) => !!el.closest('.katex-display')),
					style: await el.evaluate(style),
					displayStyle: await el.evaluate((el) => {
						const display = el.closest('.katex-display');
						if (!display) return null;
						const s = getComputedStyle(display);
						return {
							fontSize: s.fontSize,
							fontFamily: s.fontFamily,
							lineHeight: s.lineHeight,
							textAlign: s.textAlign
						};
					}),
					glyph: await el.locator('.mathnormal').first().evaluate(style)
				});
			const fonts = await page.evaluate(() => ({
				mainLoaded: document.fonts.check('13px KaTeX_Main'),
				mathLoaded: document.fonts.check('italic 13px KaTeX_Math'),
				// Vite inlines these woff2 faces as data URLs: no network resource
				// entry is expected. Record their real source, without huge base64.
				sources: [...document.styleSheets].flatMap((sheet) => {
					try {
						return [...sheet.cssRules]
							.filter((r) => r.type === CSSRule.FONT_FACE_RULE && r.cssText.includes('KaTeX'))
							.map((r) => ({
								family: r.style.fontFamily,
								source: r.style.getPropertyValue('src').slice(0, 85),
								sourceLength: r.style.getPropertyValue('src').length
							}));
					} catch {
						return [];
					}
				}),
				faces: [...document.fonts]
					.filter((f) => f.family.includes('KaTeX'))
					.map((f) => ({ family: f.family, status: f.status, weight: f.weight, style: f.style })),
				resources: performance
					.getEntriesByType('resource')
					.filter((r) => /KaTeX.*woff/.test(r.name))
					.map((r) => ({ url: r.name, bytes: r.decodedBodySize }))
			}));
			const entry = { family, size, tokens, prose, formulas, fonts };
			result.settings.push(entry);
			await root.evaluate((el) => el.scrollIntoView({ block: 'start' }));
			await page.screenshot({
				path: `${artifacts}/${name}-math-${family}-${size}.png`,
				animations: 'disabled'
			});
			await root.screenshot({
				path: `${artifacts}/${name}-math-full-${family}-${size}.png`,
				animations: 'disabled'
			});
			await check(`inline vs display / loaded fonts ${family} ${size}`, () => {
				assert.equal(tokens.math.filter((n) => n.type === 'math').length, 4);
				assert.equal(tokens.math.filter((n) => n.type === 'inlineMath').length, 2);
				assert.equal(formulas.filter((f) => f.displayMath).length, 4);
				assert(
					fonts.faces.some(
						(f) => f.family.replaceAll('"', '') === 'KaTeX_Math' && f.status === 'loaded'
					)
				);
				assert(
					fonts.faces.some(
						(f) => f.family.replaceAll('"', '') === 'KaTeX_Main' && f.status === 'loaded'
					)
				);
				assert(
					formulas
						.filter((f) => f.displayMath)
						.every(
							(f) =>
								parseFloat(f.style.fontSize) >= Number(size) * 1.35 &&
								f.style.textAlign === 'center'
						)
				);
			});
			if (process.env.LLAMPART_VISUAL_REFERENCE)
				await check(`unchanged prose ${family} ${size}`, async () => {
					const before = JSON.parse(
						await readFile(`${process.env.LLAMPART_VISUAL_REFERENCE}/results.json`, 'utf8')
					)
						.find((r) => r.browser === name)
						.settings.find((s) => s.family === family);
					// Only compare non-math prose. Correctly splitting display out of a
					// paragraph intentionally changes the math-bearing paragraph's text.
					const plain = (items) =>
						items.filter((p) => p.tag !== 'P' || /^(Pogrubienie|Cytat\.)/.test(p.text));
					assert.deepEqual(plain(prose), plain(before.prose));
				});
		}
		await page.evaluate(async () => {
			const { settings } = await import('/tests/browser/charts-harness.ts');
			settings.updateConfig('fontFamily', 'merriweather');
			settings.updateConfig('fontSize', '13');
		});
		await check('readable pending → closed → finalized, same conversation', async () => {
			phase = 'pending and finalization';
			await update('Poprzedzający tekst.\n\n\\[\\int_0^1 x^2', true);
			await root.locator('.markdown-math-pending').waitFor();
			result.pending = await root.locator('.markdown-math-pending').evaluate(style);
			await page.screenshot({ path: `${artifacts}/${name}-pending.png`, animations: 'disabled' });
			await update('Poprzedzający tekst.\n\n\\[\\int_0^1 x^2\\,dx=\\frac{1}{3}\\]', true);
			assert.equal(await root.locator('.katex').count(), 1);
			await update('Poprzedzający tekst.\n\n\\[\\int_0^1 x^2\\,dx=\\frac{1}{3}\\]', false);
			assert.equal(await root.locator('.katex-display').count(), 1);
			assert.equal(await root.locator('.markdown-math-pending').count(), 0);
			assert(parseFloat(result.pending.fontSize) >= 13);
		});
		phase = 'exports';
		await update(exportsMarkdown);
		await root.locator('.chart-plot svg').first().waitFor();
		await root.locator('.diagram-surface svg').first().waitFor();
		await settled();
		await root
			.locator('.llampart-chart-frame')
			.evaluate((el) => el.scrollIntoView({ block: 'start' }));
		await page.screenshot({ path: `${artifacts}/${name}-exports.png`, animations: 'disabled' });
		result.exports = [];
		for (const button of await root.locator(formats).all()) {
			const label = (await button.innerText()).trim();
			const states = {};
			for (const state of ['normal', 'hover', 'active', 'focus']) {
				await page.mouse.move(0, 0);
				await page.evaluate(() => document.activeElement?.blur());
				await button.scrollIntoViewIfNeeded();
				if (state === 'hover' || state === 'active') await button.hover();
				if (state === 'active') await page.mouse.down();
				if (state === 'focus') {
					await page.keyboard.press('Tab');
					await button.focus();
				}
				await settled();
				states[state] = await button.evaluate(style);
				states[state].focusVisible = await button.evaluate((el) => el.matches(':focus-visible'));
				states[state].pseudo = await button.evaluate((el) =>
					['::before', '::after'].map((pseudo) => {
						const s = getComputedStyle(el, pseudo);
						return {
							pseudo,
							content: s.content,
							position: s.position,
							background: s.backgroundColor,
							bottom: s.bottom,
							filter: s.backdropFilter
						};
					})
				);
				if (result.exports.length === 0 && state !== 'normal')
					await page.screenshot({
						path: `${artifacts}/${name}-export-${state}.png`,
						animations: 'disabled'
					});
				if (state === 'active') {
					await page.mouse.move(0, 0);
					await page.mouse.up();
				}
			}
			result.exports.push({ label, states });
			await check(`text-only export ${result.exports.length}: ${label}`, () => {
				for (const [state, s] of Object.entries(states)) {
					assert.equal(s.backgroundColor, 'rgba(0, 0, 0, 0)', state);
					assert.equal(s.backgroundImage, 'none', state);
					assert.equal(s.backdropFilter, 'none', state);
					assert.equal(s.filter, 'none', state);
					assert(s.borderTopWidth === '0px' || s.borderTopColor === 'rgba(0, 0, 0, 0)', state);
					if (state !== 'focus') assert.equal(s.boxShadow, 'none', state);
					assert(
						s.pseudo.every((p) => p.content === 'none' || p.content === 'normal'),
						`no decorative pseudo surface: ${state}`
					);
				}
				assert(states.focus.focusVisible, 'keyboard focus-visible');
				assert(
					states.focus.boxShadow !== 'none' || states.focus.outlineStyle !== 'none',
					'visible keyboard focus'
				);
			});
			await page.mouse.move(0, 0);
			await page.evaluate(() => document.activeElement?.blur());
			try {
				const pending = page.waitForEvent('download', { timeout: 8000 });
				await button.click();
				const file = await pending;
				const dest = `${artifacts}/${name}-${result.exports.length}-${file.suggestedFilename()}`;
				await file.saveAs(dest);
				const bytes = await readFile(dest),
					filename = file.suggestedFilename();
				if (label === 'PNG') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
				else if (label === 'SVG') assert.match(bytes.toString(), /<svg[\s>]/);
				else if (label === 'CSV') assert(bytes.toString().includes('2'));
				else if (label === 'JS') assert.equal(bytes.toString(), 'const answer = 42;\n');
				else if (label === 'MD') assert.equal(bytes.toString(), '# Markdown\n\n**Treść**.');
				else assert.fail(`Unexpected format ${label}`);
				result.downloads.push({ label, filename, bytes: bytes.length });
			} catch (e) {
				result.cases.push({ label: `download ${label}`, status: 'FAIL', error: e.message });
			}
		}
		await root.locator('.code-block-wrapper').last().scrollIntoViewIfNeeded();
		await page.screenshot({
			path: `${artifacts}/${name}-code-exports.png`,
			animations: 'disabled'
		});
		if (process.env.LLAMPART_VISUAL_REFERENCE)
			await check('export typography and hitboxes unchanged', async () => {
				const before = JSON.parse(
					await readFile(`${process.env.LLAMPART_VISUAL_REFERENCE}/results.json`, 'utf8')
				).find((r) => r.browser === name);
				const geometry = (entries) =>
					entries.map(({ label, states }) => ({
						label,
						...Object.fromEntries(
							[
								'fontFamily',
								'fontSize',
								'fontWeight',
								'lineHeight',
								'padding',
								'gap',
								'width',
								'height'
							].map((k) => [k, states.normal[k]])
						)
					}));
				assert.deepEqual(geometry(result.exports), geometry(before.exports));
			});
		await check('no page errors', () => assert.deepEqual(result.errors, []));
	} finally {
		await browser.close();
		await writeFile(`${artifacts}/results.json`, JSON.stringify(report, null, 2));
	}
}
if (!baseline)
	assert(
		report.every((r) => r.cases.every((c) => c.status === 'PASS')),
		'Visual/DOM failures remain; review screenshots and results.json'
	);
