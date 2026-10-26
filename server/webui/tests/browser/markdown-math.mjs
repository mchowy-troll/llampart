/** AUD-009: actual async MarkdownContent in desktop Chromium, synthetic chunks only.
 * LLAMPART_MATH_BASELINE=1 records failures without failing the diagnostic run.
 * Supply LLAMPART_PLAYWRIGHT_MODULE; optional URL, artifacts, typography reference JSON.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS;
const baseline = process.env.LLAMPART_MATH_BASELINE === '1';
if (artifacts) await mkdir(artifacts, { recursive: true });
const errors = [],
	results = [],
	typography = [],
	timeline = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => {
	if (message.type() === 'error') console.log('Browser console:', message.text());
});
await page.addInitScript(() => {
	localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
	localStorage.setItem(
		'LlamaCppWebui.config',
		JSON.stringify({
			theme: 'frosted-glass',
			interfaceLanguage: 'en',
			fontFamily: 'merriweather',
			fontSize: '13'
		})
	);
});
await page.route('**/__llampart/api/**', (route) =>
	route.fulfill({
		json: route.request().url().endsWith('/props')
			? {
					role: 'model',
					model_path: 'synthetic/model',
					build_info: 'package-b',
					default_generation_settings: { params: {} }
				}
			: route.request().url().endsWith('/models')
				? { object: 'list', data: [{ id: 'synthetic/model' }] }
				: []
	})
);
// Wrap the real processor only in this test browser: hold one asynchronous result.
// No production instrumentation, parser replacement, or fake KaTeX HTML.
await page.route('**/src/lib/markdown/markdown-runtime.ts*', async (route) => {
	const response = await route.fetch();
	const body = (await response.text()).replaceAll(
		'createMarkdownProcessor',
		'originalCreateMarkdownProcessor'
	);
	await route.fulfill({
		response,
		body:
			body +
			`
export async function createMarkdownProcessor(options) {
 const processor = await originalCreateMarkdownProcessor(options);
 const run = processor.run.bind(processor);
 processor.run = async (tree) => {
  const result = await run(tree);
  const gate = window.__mathGate;
  if (gate && !gate.claimed) { gate.claimed = true; await new Promise(resolve => gate.release = resolve); }
  return result;
 };
 return processor;
}
`
	});
});
let root = page.locator('#package-b-math .llampart-markdown-content');
async function settle() {
	await page.evaluate(async () => {
		for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
	});
}
async function update(content, streaming = false, disableMath = false, compact = false) {
	await page.evaluate(
		async (args) => window.__packageB.update(...args),
		[content, streaming, disableMath, compact]
	);
	timeline.push({
		content,
		streaming,
		disableMath,
		immediate: await root.evaluate((el) => ({
			text: el.innerText,
			katex: el.querySelectorAll('.katex').length,
			pending: el.querySelectorAll('.markdown-math-pending').length
		}))
	});
	await settle();
}
async function capture(name) {
	const dom = await root.evaluate((el) => ({
		html: el.innerHTML,
		text: el.innerText,
		katex: el.querySelectorAll('.katex').length,
		pending: el.querySelectorAll('.markdown-math-pending').length
	}));
	if (artifacts) {
		await writeFile(`${artifacts}/${name}.json`, JSON.stringify(dom, null, 2));
		await page.screenshot({ path: `${artifacts}/${name}.png`, animations: 'disabled' });
	}
	return dom;
}
async function check(name, fn) {
	if (process.env.LLAMPART_MATH_CASE && !name.includes(process.env.LLAMPART_MATH_CASE)) return;
	try {
		await fn();
		results.push({ name, status: 'PASS' });
	} catch (error) {
		results.push({ name, status: 'FAIL', error: error.message });
	}
	console.log(
		`${results.at(-1).status} ${name}${results.at(-1).error ? ': ' + results.at(-1).error : ''}`
	);
}
const integral = '$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx=\\sqrt{\\pi}\n$$';
const sum = '\\[\n\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}\n\\]';
const complex =
	'$$\n\\begin{pmatrix}a_1 & \\frac{1}{1+\\frac{1}{x}} \\\\ \\sqrt{\\alpha} & \\sum_{k=0}^{n}\\beta_k^2\\end{pmatrix}\n$$';
const mixed = `Zwykły akapit i [link](https://example.org/).\n\n# Nagłówek\n\n- Lista **bold** i *italic* oraz \`inline\`.\n\n> Cytat\n\nWynik wynosi $E=mc^2$ i jest dodatni. Pole koła wynosi \\(A=\\pi r^2\\).\n\n${integral}\n\n${sum}\n\n${complex}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`js\nconst value = 42;\n\`\`\``;
try {
	await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40135');
	await page.locator('textarea').first().waitFor();
	await page.evaluate(async () => {
		const { mount, Fixture } = await import('/tests/browser/package-b-harness.ts');
		window.__packageB = mount(Fixture, { target: document.body, props: { math: true } });
	});
	// Warm the real lazy runtime; later assertions concern rendering, not network latency.
	await update('$x$');
	await root.locator('.katex').waitFor();
	await check('MATH-01 standalone pending', async () => {
		await update('Poprzedni akapit.\n\n$$\n\\int_', true);
		const dom = await capture('01-pending');
		assert.equal(dom.pending, 1);
		assert(dom.text.includes('∑'));
		assert(dom.text.includes('Processing'));
		assert(dom.text.includes('Poprzedni akapit.'));
		assert(!dom.text.includes('\\int_'));
	});
	await check('MATH-01 same-line chunks', async () => {
		let value = '';
		for (const part of ['Wzór: $$\\int_', '{0}^{1} x', '^2\\,dx']) {
			value += part;
			await update(value, true);
			const dom = await capture(`01-chunk-${value.length}`);
			assert.equal(dom.pending, 1);
			assert(dom.text.includes('Wzór:'));
			assert(!dom.text.includes('\\int_'));
			if (value === 'Wzór: $$\\int_')
				await root.locator('p').evaluate((el) => {
					window.__mathPrefix = el;
				});
			else
				assert(
					await root.locator('p').evaluate((el) => el === window.__mathPrefix),
					'Keep the preceding DOM node stable'
				);
		}
	});
	await check('MATH-01 incomplete inline', async () => {
		for (const value of ['Wynik $E=mc', 'Pole \\(A=\\pi']) {
			await update(value, true);
			const dom = await capture(`01-inline-${value.length}`);
			assert.equal(dom.pending, 1);
		}
	});
	await check('MATH-02 close without navigation', async () => {
		// Include a chunk immediately before the closing delimiter: its normalized
		// offsets collide with the completed paragraph on the original renderer.
		const value = 'Wzór: $$\\int_{0}^{1} x^2\\,dx=\\frac{1}{3}';
		await update(value, true);
		await update(value + '$$', true);
		const dom = await capture('02-closed');
		assert.equal(dom.pending, 0);
		assert.equal(dom.katex, 1);
	});
	await check('MATH-03 unchanged-text finalization', async () => {
		const value = 'Wzór: $$\\int_{0}^{1} x^2\\,dx=\\frac{1}{3}$$';
		await update(value, false);
		const dom = await capture('03-final');
		assert.equal(dom.katex, 1);
		assert.equal(dom.pending, 0);
	});
	await check('MATH-02 bracket display streaming', async () => {
		await update('Przed wzorem.\n\n\\[\n\\sum_{n=1}', true);
		assert.equal(await root.locator('.markdown-math-pending').count(), 1);
		await update('Przed wzorem.\n\n' + sum, true);
		assert.equal(await root.locator('.katex-display').count(), 1);
		await update('Przed wzorem.\n\n' + sum, false);
		assert.equal(await root.locator('.katex-display').count(), 1);
	});
	await check('MATH-02 inline delimiter closure/cache', async () => {
		await update('Wynik wynosi $E=mc^2', true);
		await update('Wynik wynosi $E=mc^2$', true);
		const dom = await capture('02-inline-cache');
		assert.equal(dom.katex, 1);
		await update('Wynik wynosi $E=mc^2$', false);
		assert.equal(await root.locator('.katex').count(), 1);
	});
	await check('MATH-02 normalized-offset collision outside streaming', async () => {
		await update('Wynik wynosi $E=mc^2');
		await update('Wynik wynosi $E=mc^2$');
		const dom = await capture('02-offset-collision');
		assert.equal(dom.katex, 1);
	});
	await check('MATH-03 inline finalization / reopen', async () => {
		await update('Wynik wynosi $E=mc^2$');
		const dom = await capture('03-inline-final');
		await page.evaluate(() => window.__packageB.reopen());
		await settle();
		assert.equal(await root.locator('.katex').count(), 1);
		assert.equal(dom.katex, 1, 'Completed math must not require reopening');
	});
	await check('MATH-04 inline/display/complex', async () => {
		await update(mixed);
		const dom = await capture('04-mixed');
		assert.equal(dom.katex, 5);
		assert.equal(await root.locator('.katex-display').count(), 3);
		assert.equal(await root.locator('.katex-error').count(), 0);
	});
	await check('MATH-05 superseded asynchronous result', async () => {
		await update('');
		await page.evaluate(() => {
			window.__mathGate = {};
		});
		await page.evaluate(() => window.__packageB.update('Stare: $a$', true));
		await page.waitForFunction(() => Boolean(window.__mathGate.release));
		await page.evaluate(() => window.__packageB.update('Nowe: $b$', true));
		await page.evaluate(() => {
			window.__mathGate.release();
			window.__mathGate = null;
		});
		await settle();
		const dom = await capture('05-race');
		assert(dom.text.includes('Nowe:'));
		assert(!dom.text.includes('Stare:'));
		assert.equal(dom.katex, 1);
		assert.equal(await root.locator('annotation').textContent(), 'b');
	});
	await check('MATH-06 reopen', async () => {
		await update(mixed);
		await page.evaluate(() => window.__packageB.reopen());
		await settle();
		const dom = await capture('06-reopen');
		assert.equal(dom.katex, 5);
	});
	await check('MATH-07 code/currency', async () => {
		await update('Cena $5.99. `$$` i `\\(x\\)`.\n\n```latex\n$$\n\\int_0^1 x\n$$\n```');
		const dom = await capture('07-code');
		assert.equal(dom.katex, 0);
		assert.equal(dom.pending, 0);
		assert(dom.text.includes('$5.99'));
		assert((await root.locator('pre code').innerText()).includes('\\int_0'));
	});
	await check('MATH-08 disableMath / same content toggle', async () => {
		await update('Wynik $x^2$.', false, true);
		assert.equal(await root.locator('.katex').count(), 0);
		await update('Wynik $x^2$.', false, false);
		assert.equal(await root.locator('.katex').count(), 1);
		await update('Wynik $x^2$.', false, true);
		assert.equal(await root.locator('.katex').count(), 0);
		await update('Przed.\n\n$$\n\\frac{', true, true);
		assert.equal(await root.locator('.markdown-math-pending').count(), 0);
	});
	await check('MATH-09 ended invalid syntax', async () => {
		await update('Tekst.\n\n$$\n\\frac{', true);
		assert.equal(await root.locator('.markdown-math-pending').count(), 1);
		await update('Tekst.\n\n$$\n\\frac{', false);
		const dom = await capture('09-invalid-unclosed');
		assert.equal(dom.pending, 0);
		assert(dom.text.includes('Tekst.'));
		await update('$$\n\\notACommand{\n$$', false);
		assert.equal(await root.locator('.markdown-math-pending').count(), 0);
		assert.equal(await root.locator('.katex-error').count(), 1);
	});
	await check('MATH-10 typography and intrinsic math proportions', async () => {
		for (const family of ['merriweather', 'fira-sans'])
			for (const size of ['13', '18'])
				for (const variant of ['400', '600'])
					for (const compact of [false, true]) {
						await page.evaluate(
							async ({ family, size, variant }) => {
								const { settings } = await import('/tests/browser/charts-harness.ts');
								settings.updateConfig('fontFamily', family);
								settings.updateConfig('fontSize', size);
								settings.updateConfig('fontVariant', variant);
							},
							{ family, size, variant }
						);
						await update(mixed, false, false, compact);
						await page.evaluate(() => document.fonts.ready);
						await root.evaluate(async (el) => {
							await new Promise((resolve) =>
								requestAnimationFrame(() => requestAnimationFrame(resolve))
							);
							await Promise.all(
								el
									.getAnimations({ subtree: true })
									.filter((animation) => animation.effect.getTiming().iterations !== Infinity)
									.map((animation) => animation.finished)
							);
						});
						const metrics = await root.evaluate((el) =>
							[...el.querySelectorAll('p,h1,li,strong,em,blockquote,a,code,th,td,pre')]
								.filter((e) => !e.closest('.katex'))
								.map((e) => {
									const s = getComputedStyle(e);
									return {
										tag: e.tagName,
										text: e.textContent,
										fontFamily: s.fontFamily,
										fontSize: s.fontSize,
										fontWeight: s.fontWeight,
										lineHeight: s.lineHeight
									};
								})
						);
						const math = await root
							.locator('.katex')
							.first()
							.evaluate((el) => {
								const glyph = el.querySelector('.mathnormal'),
									sub = el.querySelector('.katex-sizing.reset-size6.size3');
								return {
									family: getComputedStyle(glyph).fontFamily,
									size: parseFloat(getComputedStyle(el).fontSize),
									parent: parseFloat(getComputedStyle(el.parentElement).fontSize),
									subSize: sub ? parseFloat(getComputedStyle(sub).fontSize) : null
								};
							});
						typography.push({ family, size, variant, compact, metrics, math });
						await capture(`10-${family}-${size}-${variant}-${compact}`);
					}
		if (process.env.LLAMPART_TYPOGRAPHY_REFERENCE) {
			const before = JSON.parse(await readFile(process.env.LLAMPART_TYPOGRAPHY_REFERENCE, 'utf8'));
			const prose = ({ family, size, variant, compact, metrics }) => ({
				family,
				size,
				variant,
				compact,
				metrics
			});
			assert.deepEqual(typography.map(prose), before.map(prose));
		}
		assert(
			typography.every((entry) => entry.math.family.includes('KaTeX_Math')),
			'KaTeX font must not inherit the prose family'
		);
		assert(
			typography.every((entry) => Math.abs(entry.math.size / entry.math.parent - 1.21) < 0.01),
			'Retain KaTeX 1.21em scaling'
		);
		assert(
			typography.every((entry) => entry.math.subSize > 0 && entry.math.subSize < entry.math.size),
			'Superscripts retain their own smaller size'
		);
	});
	await check('MATH-11 Mermaid/charts/Markdown preview', async () => {
		await page.evaluate(async () => {
			const { settings } = await import('/tests/browser/charts-harness.ts');
			settings.updateConfig('fontFamily', 'merriweather');
			settings.updateConfig('fontSize', '13');
			settings.updateConfig('fontVariant', '400');
		});
		const chart = {
			type: 'bar',
			title: 'Synthetic',
			xKey: 'x',
			series: [{ key: 'y', label: 'Y' }],
			data: [{ x: 'A', y: 2 }]
		};
		const document =
			mixed +
			'\n\n```mermaid\nflowchart LR\n A[Start] --> B[Koniec]\n```\n\n```llampart-chart\n' +
			JSON.stringify(chart) +
			'\n```\n\n```markdown\n# Preview\n\n**Text**\n```';
		const ids = await page.evaluate(async (content) => {
			const { unmount } = await import('/tests/browser/package-b-harness.ts');
			await unmount(window.__packageB);
			const { db } = await import('/tests/browser/charts-harness.ts');
			const ids = [];
			for (const value of [content, 'Synthetic second conversation.']) {
				const conversation = await db.createConversation('Package B synthetic');
				const root = await db.createRootMessage(conversation.id);
				await db.createMessageBranch(
					{
						convId: conversation.id,
						type: 'text',
						role: 'assistant',
						timestamp: Date.now(),
						content: value,
						children: [],
						parent: root,
						model: 'synthetic/model'
					},
					root
				);
				ids.push(conversation.id);
			}
			return ids;
		}, document);
		const url = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40135';
		await page.goto(`${url}/#/chat/${ids[0]}`);
		root = page.locator('.llampart-assistant-markdown').first();
		await root.locator('.katex').first().waitFor();
		await capture('11-before-ready');
		console.log(
			'Visualization typography:',
			await root.locator('.llampart-chart-frame').evaluate((el) => ({
				family: getComputedStyle(el).fontFamily,
				size: getComputedStyle(el).fontSize
			}))
		);
		if (await root.locator('.llampart-diagram-fallback').count()) {
			await root
				.locator('.llampart-diagram-fallback')
				.getByRole('button', { name: 'Show code', exact: true })
				.click();
			await page.locator('[role="dialog"]').waitFor();
			console.log('Diagram fallback source:', await page.locator('[role="dialog"]').innerText());
			await page.keyboard.press('Escape');
		}
		await root.locator('.llampart-diagram-frame svg').first().waitFor();
		await root.locator('.llampart-chart-frame svg').first().waitFor();
		assert.equal(await root.locator('table').count(), 1);
		assert((await root.locator('.hljs-keyword').count()) > 0);
		assert.equal(await root.locator('a[href="https://example.org/"]').count(), 1);
		assert.equal(await root.locator('.markdown-rendered-code-content h1').innerText(), 'Preview');
		await capture('11-other-blocks');
		await page.goto(`${url}/#/chat/${ids[1]}`);
		await root.getByText('Synthetic second conversation.').waitFor();
		await page.goto(`${url}/#/chat/${ids[0]}`);
		await root.locator('.katex').first().waitFor();
		assert.equal(await root.locator('.katex').count(), 5);
		console.log('PASS MATH-06 real synthetic conversation navigation and saved history');
	});
	assert.deepEqual(errors, []);
} finally {
	if (artifacts) {
		await writeFile(`${artifacts}/results.json`, JSON.stringify({ results, errors }, null, 2));
		await writeFile(`${artifacts}/typography.json`, JSON.stringify(typography, null, 2));
		await writeFile(`${artifacts}/timeline.json`, JSON.stringify(timeline, null, 2));
	}
	await browser.close();
}
if (!baseline)
	assert(
		results.every((result) => result.status === 'PASS'),
		'See per-case results'
	);
