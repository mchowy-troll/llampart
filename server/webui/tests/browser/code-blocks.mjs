/** Real Markdown renderer, downloads, clipboard and shared chart action states in Chromium.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/code-blocks.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTextActionStyles, assertTransparentExport } from './export-transparency.mjs';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-code-blocks';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const samples = [
	[
		'python',
		'PY',
		'py',
		'# Zażółć gęślą jaźń\ndef hello(name: str):\n    return f"Łódź {name}"\n\nprint(hello("świat"))'
	],
	[
		'javascript',
		'JS',
		'js',
		'// Polski tekst\nconst data = { city: "Łódź", count: 42 };\nconsole.log(data);'
	],
	[
		'html',
		'HTML',
		'html',
		'<!doctype html>\n<html lang="pl"><body><h1>Łódź &amp; świat</h1></body></html>'
	],
	['unknown-language', 'TXT', 'txt', '0 O 1 l I\n{ } [ ] ( ) ; : , . _ - =\nzażółć gęślą jaźń 😀'],
	['', 'TXT', 'txt', 'Bez języka\nDruga linia'],
	['typescript', 'TS', 'ts', 'type City = { name: string };\nconst city: City = { name: "Łódź" };'],
	['markdown', 'MD', 'md', '# Nagłówek Markdown\n\n**Treść** i `inline` kod.']
];
const chart =
	'```llampart-chart\n' +
	JSON.stringify({
		type: 'bar',
		title: 'Kontrola',
		xKey: 'x',
		series: [{ key: 'y', label: 'Wartość' }],
		data: [
			{ x: 'Łódź', y: 42 },
			{ x: 'Kraków', y: 21 }
		]
	}) +
	'\n```';
const content =
	'Zwykły **Markdown** i `inline_code`.\n\n' +
	samples.map(([language, , , source]) => `\`\`\`${language}\n${source}\n\`\`\``).join('\n\n') +
	'\n\n| Miasto | Liczba |\n|---|---|\n| Łódź | 42 |\n\n' +
	chart +
	'\n\n```mermaid\nflowchart LR\n A[Start] --> B[Koniec]\n```\n\n\\[x^2+\\frac{1}{2}\\]\n\nKoniec.';
const reports = [];

try {
	for (const fullHeight of [false, true]) {
		const fontFamily =
			process.env.LLAMPART_TEST_CODE_FONT || (fullHeight ? 'fira-sans' : 'merriweather');
		const context = await browser.newContext({
			viewport: { width: Number(process.env.LLAMPART_TEST_WIDTH || 1600), height: 1000 },
			acceptDownloads: true,
			permissions: ['clipboard-read', 'clipboard-write']
		});
		const page = await context.newPage();
		const errors = [];
		page.on('console', (message) => {
			if (message.type() === 'error') console.error(message.text());
		});
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript(
			({ fullHeight, fontFamily }) => {
				if (window.top !== window) return;
				localStorage.setItem('llama-webui-migration-v2-done', '1');
				localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
				localStorage.setItem(
					'LlamaCppWebui.config',
					JSON.stringify({
						apiProvider: 'llama-server',
						serverBaseUrl: 'http://code.test',
						llamaServerBaseUrl: 'http://code.test',
						interfaceLanguage: 'pl',
						theme: 'frosted-glass',
						frostedGlassOpaque: fullHeight,
						fontFamily,
						fontVariant: '400',
						fullHeightCodeBlocks: fullHeight,
						renderReasoningContentAsMarkdown: true,
						minimalAgenticIndicators: false,
						titleGenerationUseLLM: false,
						askForTitleConfirmation: false
					})
				);
			},
			{ fullHeight, fontFamily }
		);
		let responseContent = content;
		await page.route('**/__llampart/api/**', (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/chat/completions'))
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `data: ${JSON.stringify({ choices: [{ delta: { content: responseContent, reasoning_content: '```python\nprint("Myślenie Łódź")\n```' } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
				});
			return route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'code-test',
							model_path: 'code.gguf',
							default_generation_settings: { params: {} }
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'code.gguf' }] }
						: []
			});
		});
		await page.goto(process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138');
		await page.locator('textarea').first().fill('Pokaż kod');
		await page.waitForFunction(
			() => document.querySelector('.llampart-composer-send-button')?.disabled === false
		);
		await page.locator('textarea').first().press('Enter');
		const assistant = page.locator('.llampart-assistant-markdown').first();
		const blocks = assistant.locator('.code-block-wrapper');
		await blocks.nth(6).locator('.download-code-btn[data-listener-bound=true]').waitFor();
		await assistant.locator('.llampart-chart-frame svg').first().waitFor();
		await assistant.locator('.llampart-diagram-frame svg').first().waitFor();
		await assistant.locator('.llampart-math-frame .format-export-action').last().waitFor();
		await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
		assert.equal(
			await page
				.locator('html')
				.evaluate((el) => el.classList.contains('has-frosted-glass-opaque')),
			fullHeight
		);
		assert.equal(await blocks.count(), samples.length);
		async function download(button, filename, expected, key) {
			const pending = page.waitForEvent('download');
			if (key) await button.press(key);
			else await button.click();
			const file = await pending;
			assert.equal(file.suggestedFilename(), filename);
			const path = `${artifacts}/${fullHeight}-${filename}`;
			await file.saveAs(path);
			assert.equal(await readFile(path, 'utf8'), expected);
		}
		const colors = [];
		for (const [index, [, label, extension, source]] of samples.entries()) {
			const block = blocks.nth(index);
			const button = block.locator('.download-code-btn');
			assert.equal(await button.innerText(), label);
			assert.equal(await button.getAttribute('aria-label'), `Pobierz kod jako ${label}`);
			assert(
				await button.evaluate((el) => el.nextElementSibling.classList.contains('copy-code-btn'))
			);
			await download(
				button,
				`code-block-${index + 1}.${extension}`,
				source + (label === 'MD' ? '' : '\n'),
				index % 2 ? 'Enter' : 'Space'
			);
			await block.locator('.copy-code-btn').click();
			await page.waitForFunction(
				async (expected) => (await navigator.clipboard.readText()) === expected,
				source + (label === 'MD' ? '' : '\n')
			);
			const style = await block.evaluate((el) => ({
				background: getComputedStyle(el).backgroundColor,
				backdrop: getComputedStyle(el).backdropFilter,
				label: getComputedStyle(el.querySelector('.code-language')).color,
				font: getComputedStyle(el.querySelector('code')).fontFamily
			}));
			assert.equal(style.background, fullHeight ? 'rgb(34, 40, 49)' : 'rgba(34, 40, 49, 0.9)');
			assert.equal(style.backdrop, 'none');
			assert.equal(style.label, 'rgb(230, 237, 243)');
			assert(
				style.font.includes('Cascadia Code') &&
					!style.font.includes('Merriweather') &&
					!style.font.includes('Fira Sans')
			);
			colors.push(style);
		}
		const tokenColors = await blocks
			.first()
			.locator('[class^="hljs-"]')
			.evaluateAll((els) =>
				els.map((el) => ({ token: el.className, color: getComputedStyle(el).color }))
			);
		const renderedMarkdown = blocks.last().locator('.markdown-rendered-code-content');
		assert.equal(
			await renderedMarkdown.evaluate((el) => getComputedStyle(el).backgroundColor),
			'rgba(0, 0, 0, 0)'
		);
		assert.equal(
			await renderedMarkdown.locator('h1').evaluate((el) => getComputedStyle(el).color),
			'rgb(230, 237, 243)'
		);
		assert(new Set(tokenColors.map((item) => item.color)).size >= 4);
		assert(tokenColors.every((item) => item.color !== 'rgb(0, 0, 0)'));
		const luminance = (rgb) => {
			const channels = rgb
				.match(/\d+/g)
				.slice(0, 3)
				.map(Number)
				.map((value) => {
					const channel = value / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				});
			return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
		};
		for (const { color } of tokenColors) {
			assert(
				// Conservative composited background: 90% graphite over pure white.
				(luminance(color) + 0.05) / (luminance('rgb(57, 62, 70)') + 0.05) >= 4.5,
				`Readable syntax contrast: ${color}`
			);
		}
		const codeButton = blocks.first().locator('.download-code-btn');
		const chartButton = assistant.locator('.chart-actions button').filter({ hasText: /^CSV$/ });
		const formatStates = [];
		const formatButtons = assistant.locator(
			'.format-export-action, .table-csv-button, .download-code-btn'
		);
		for (const button of await formatButtons.all()) {
			const label = (await button.innerText()).trim();
			const measured = await assertTextActionStyles(page, button);
			formatStates.push({ label, measured });
		}
		assert.deepEqual(
			formatStates.map(({ label }) => label),
			[
				'PY',
				'JS',
				'HTML',
				'TXT',
				'TXT',
				'TS',
				'MD',
				'CSV',
				'PNG',
				'SVG',
				'CSV',
				'PNG',
				'SVG',
				'PNG',
				'SVG'
			]
		);
		for (const frame of [
			assistant.locator('.llampart-chart-frame'),
			assistant.locator('.llampart-diagram-frame'),
			assistant.locator('.llampart-math-frame')
		]) {
			for (const format of ['PNG', 'SVG']) {
				const pending = page.waitForEvent('download');
				await frame
					.getByRole('button', { name: new RegExp(` ${format}$`) })
					.press(format === 'PNG' ? 'Space' : 'Enter');
				const file = await pending;
				assert(file.suggestedFilename().endsWith(`.${format.toLowerCase()}`));
				const path = `${artifacts}/${fullHeight}-${file.suggestedFilename()}`;
				await file.saveAs(path);
				const bytes = await readFile(path);
				if (format === 'PNG') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
				else assert.match(bytes.toString(), /<svg[\s>]/);
				await assertTransparentExport(page, bytes, format);
			}
			await frame.locator('.visualization-preview-action').last().click();
			await page.locator('[role="dialog"]').waitFor();
			await page.keyboard.press('Escape');
		}
		await codeButton.hover();
		assert.equal(
			await codeButton.evaluate((el) => getComputedStyle(el, '::after').content),
			'"Pobierz kod jako PY"'
		);
		for (const selector of ['.copy-code-btn', '.preview-code-btn']) {
			const icon = blocks.nth(2).locator(selector);
			await icon.hover();
			assert.equal(
				await icon.evaluate((el) => getComputedStyle(el, '::after').content),
				JSON.stringify(await icon.getAttribute('data-llampart-code-tooltip'))
			);
		}
		await assistant.locator('.chart-actions .format-export-action').first().hover();
		await page
			.locator('[data-slot="tooltip-content"]')
			.filter({ hasText: 'Eksportuj wykres jako PNG' })
			.waitFor();
		await page.screenshot({ path: `${artifacts}/code-hover-${fullHeight}.png` });
		await blocks.nth(2).locator('.preview-code-btn').click();
		await page.locator('[role="dialog"]').waitFor();
		await page.keyboard.press('Escape');
		await download(
			assistant.locator('.table-csv-button'),
			'table-1.csv',
			'\uFEFFMiasto,Liczba\r\nŁódź,42\r\n'
		);
		await download(
			chartButton,
			'chart-Kontrola.csv',
			'\uFEFFx,Wartość\r\nŁódź,42\r\nKraków,21\r\n'
		);
		const reasoning = page.locator('.llampart-agentic-panel').first();
		await reasoning.locator('button[aria-expanded]').click();
		const reasoningCode = reasoning.locator('pre code');
		await reasoningCode.waitFor();
		assert(
			(await reasoningCode.evaluate((el) => getComputedStyle(el).fontFamily)).includes(
				'Cascadia Code'
			)
		);
		assert.equal(
			await reasoningCode.evaluate((el) => getComputedStyle(el).color),
			'rgb(232, 239, 247)'
		);
		await download(
			reasoning.locator('.download-code-btn'),
			'code-block-1.py',
			'print("Myślenie Łódź")\n'
		);
		await reasoning.locator('button[aria-expanded]').click();
		// Same real ChatService stream/finalization in dev and production, no source imports.
		await page.evaluate(() => {
			const original = window.fetch;
			window.fetch = (input, init) => {
				const url =
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (!url.includes('/chat/completions')) return original(input, init);
				const encoder = new TextEncoder();
				return Promise.resolve(
					new Response(
						new ReadableStream({
							start(controller) {
								window.codeToken = (content) =>
									controller.enqueue(
										encoder.encode(
											`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
										)
									);
								window.finishCode = () => {
									controller.enqueue(
										encoder.encode(
											'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
										)
									);
									controller.close();
									window.fetch = original;
								};
							}
						}),
						{ headers: { 'Content-Type': 'text/event-stream' } }
					)
				);
			};
		});
		await page.locator('textarea').first().fill('Strumień kodu');
		await page.locator('textarea').first().press('Enter');
		await page.waitForFunction(() => typeof window.codeToken === 'function');
		await page.evaluate(() =>
			window.codeToken('```js\nconst first = 1;\n```\n\n```python\nprint("Strumień')
		);
		const streaming = page.locator('.llampart-assistant-markdown').last();
		const pending = streaming.locator('.streaming-code-block .download-code-btn');
		await pending.waitFor();
		assert(await pending.isDisabled());
		const disabled = await pending.evaluate((el) => ({
			classes: [...el.classList],
			pointerEvents: getComputedStyle(el).pointerEvents,
			opacity: getComputedStyle(el).opacity,
			height: el.getBoundingClientRect().height,
			backdrop: getComputedStyle(el).backdropFilter
		}));
		assert(disabled.classes.includes('llampart-button-text-action'));
		assert(!disabled.classes.includes('backdrop-blur-sm'));
		assert.equal(disabled.pointerEvents, 'none');
		assert.equal(disabled.opacity, '0.5');
		assert.equal(disabled.backdrop, 'none');
		let disabledDownloads = 0;
		const onDownload = () => disabledDownloads++;
		page.on('download', onDownload);
		await pending.evaluate((el) => el.click());
		await page.keyboard.press('Tab');
		assert(await pending.evaluate((el) => document.activeElement !== el));
		await page.evaluate(() => {
			window.codeToken(' Łódź")\n```');
			window.finishCode();
		});
		await page.locator('.llampart-composer-stop-action').waitFor({ state: 'hidden' });
		await streaming.locator('.streaming-code-block').waitFor({ state: 'hidden' });
		assert.equal(disabledDownloads, 0);
		page.off('download', onDownload);
		const finalized = streaming.locator('.download-code-btn').nth(1);
		assert(await finalized.isEnabled());
		assert.equal(
			await finalized.evaluate((el) => el.getBoundingClientRect().height),
			disabled.height
		);
		await assertTextActionStyles(page, finalized);
		await download(finalized, 'code-block-2.py', 'print("Strumień Łódź")\n', 'Enter');
		const longSource = 'const x = "' + 'x'.repeat(300) + '";\n' + '// Łódź\n'.repeat(100);
		responseContent = '```js\n' + longSource + '```';
		await page.locator('textarea').first().fill('Długi kod');
		await page.locator('textarea').first().press('Enter');
		const longBlock = page
			.locator('.llampart-assistant-markdown')
			.last()
			.locator('.code-block-wrapper');
		await longBlock.locator('code').filter({ hasText: 'const x' }).waitFor();
		const geometry = await longBlock.locator('.code-block-scroll-container').evaluate((el) => ({
			maxHeight: getComputedStyle(el).maxHeight,
			width: el.clientWidth,
			scrollWidth: el.scrollWidth,
			height: el.clientHeight
		}));
		assert.equal(geometry.maxHeight, 'none');
		assert(geometry.scrollWidth > geometry.width && geometry.height > 1000);
		await download(longBlock.locator('.download-code-btn'), 'code-block-1.js', longSource);
		const productionCss = await page.evaluate(() => {
			function rules(list) {
				return [...list].flatMap((r) => [
					...(r.selectorText?.includes('.llampart-button-text-action') ? [r.cssText] : []),
					...(r.cssRules ? rules(r.cssRules) : [])
				]);
			}
			return [...document.styleSheets].map((sheet) => ({
				href: sheet.href,
				rules: rules(sheet.cssRules)
			}));
		});
		assert(
			productionCss.some((sheet) => sheet.rules.some((rule) => rule.includes('box-shadow: none')))
		);
		assert(
			productionCss.every((sheet) => sheet.rules.every((rule) => !rule.includes('!important')))
		);
		if (process.env.LLAMPART_TEST_PRODUCTION) {
			assert(
				productionCss.some(
					(sheet) => sheet.rules.length && sheet.href?.includes('/_app/immutable/assets/')
				),
				'assert the final transformed production CSS chunk, not dev CSS'
			);
		}
		assert.deepEqual(errors, []);
		reports.push({
			fullHeight,
			opaque: fullHeight,
			fontFamily,
			colors,
			tokenColors,
			formatStates,
			disabled,
			productionCss,
			errors
		});
		await context.close();
	}
	await writeFile(`${artifacts}/report.json`, JSON.stringify(reports, null, 2));
	console.log(
		'REAL PASS UI/export/CSS; MOCK provider HTTP/SSE: code, Markdown, tables, charts, Mermaid, KaTeX, tooltips, keyboard, disabled/finalization, overflow; Frosted Glass and opaque mode.'
	);
} finally {
	await browser.close();
}
