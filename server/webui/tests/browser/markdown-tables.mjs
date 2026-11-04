/** Real app/Chromium; no inference. Same scenario in development and production.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/markdown-tables.mjs
 * LLAMPART_TEST_PRODUCTION=1 skips only the dev-store streaming/live-accent probes.
 * --materials-only: dark fenced surfaces and unchanged ordinary glass in either build.
 * Optional LLAMPART_ORDINARY_BASELINE points to a pre-patch computed-style capture;
 * explicit ordinary-material assertions also run without that comparison file.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assertTextActionStyles } from './export-transparency.mjs';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const artifacts = process.env.LLAMPART_TEST_ARTIFACTS || '/tmp/opencode/llampart-markdown-tables';
await mkdir(artifacts, { recursive: true });
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:40138';
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox']
});
const longTable =
	'| Numer | Nazwa | Cena | Uwagi |\n|---|---|---|---|\n' +
	Array.from({ length: 105 }, (_, i) => `| ${i + 1} | Wiersz ${i + 1} | 4,50 | Łódź 東京 |`).join(
		'\n'
	);
const csvTable =
	'| Nazwa | Cena (zł) | Uwagi |\n|---|---|---|\n' +
	'| **Mleko** | 4,50 | Zwykłe |\n' +
	'| Ser "żółty" | 24,90 | Produkt, nabiał |\n' +
	'| *Łódź 東京 😀* | `-1.25` | pierwszy<br>drugi |\n' +
	'| | | |\n| Koniec | -1,25 | <ul><li>A</li><li>B<br>C</li></ul> |\n' +
	'| =SUM(A1) | +cmd | @SUM(A1) |\n| -cmd | -12 | bez formuły |';
const expectedCsv =
	'\uFEFFNazwa,Cena (zł),Uwagi\r\nMleko,"4,50",Zwykłe\r\n' +
	'"Ser ""żółty""","24,90","Produkt, nabiał"\r\n' +
	'Łódź 東京 😀,-1.25,"pierwszy\ndrugi"\r\n,,\r\nKoniec,"-1,25","A\nB\nC"\r\n' +
	"'=SUM(A1),'+cmd,'@SUM(A1)\r\n'-cmd,-12,bez formuły\r\n";
const chart =
	'```llampart-chart\n' +
	JSON.stringify({
		type: 'line',
		title: 'Kontrola CSV',
		xKey: 'x',
		series: [{ key: 'y', label: 'Wartość' }],
		data: [{ x: 'Łódź', y: -1.25 }]
	}) +
	'\n```';
const code = '```js\n' + 'const safe = true;\n'.repeat(110) + '```';
const wide =
	'| ' +
	Array.from({ length: 15 }, (_, i) => `Kolumna ${i + 1}`).join(' | ') +
	' |\n|' +
	'---|'.repeat(15) +
	'\n| ' +
	Array.from({ length: 15 }, () => 'długi tekst '.repeat(25) + 'X'.repeat(180)).join(' | ') +
	' |';
const reports = [];

// Focused task-5 contract: REAL DOM/CSS/raster/clipboard/CSV, MOCK HTTP/SSE.
// --materials-only is production-compatible (no imports from the dev runtime).
async function materialRegression() {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 1000 },
		acceptDownloads: true,
		permissions: ['clipboard-read', 'clipboard-write']
	});
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(() => {
		localStorage.setItem('Llampart.aboutDismissedVersion', '2.1.0');
		if (!localStorage.getItem('LlamaCppWebui.config'))
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'llama-server',
					llamaServerBaseUrl: 'http://mock.test',
					interfaceLanguage: 'en',
					theme: 'frosted-glass',
					fontFamily: 'merriweather',
					fontSize: '13',
					alwaysShowSidebarOnDesktop: false,
					autoShowSidebarOnNewChat: false,
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false
				})
			);
	});
	const content =
		'> Outer **quote**.\n>\n> > Nested quote.\n>\n> | A | B |\n> |---|---|\n> | Quote table | 1 |\n\n' +
		'| A | B |\n|---|---|\n| Ordinary table | 2 |\n\n' +
		'```markdown\n# Fence heading\n\n| A | B |\n|---|---|\n| Fenced table | 3 |\n| Second row | 19.5 |\n\n' +
		' > Nested fence quote\n >\n > > Inner dark quote\n > >\n > > | A | B |\n > > |---|---|\n > > | Fenced quote table | 4 |\n > > | Second row | 28.5 |\n```\n\n' +
		'```js\nconst sample = "dark control";\n```';
	await page.route('**/__llampart/api/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		return route.fulfill(
			path.endsWith('/chat/completions')
				? {
						contentType: 'text/event-stream',
						body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
					}
				: {
						json: path.endsWith('/props')
							? {
									build_info: 'MOCK',
									model_path: 'mock.gguf',
									default_generation_settings: { params: {} }
								}
							: path.endsWith('/models')
								? { object: 'list', data: [{ id: 'mock.gguf' }] }
								: []
					}
		);
	});
	await page.goto(base);
	await page.locator('textarea').first().fill('MOCK materials');
	await page.waitForFunction(
		() => document.querySelector('.llampart-composer-send-button')?.disabled === false
	);
	await page.locator('textarea').first().press('Enter');
	const ordinaryBaseline = process.env.LLAMPART_ORDINARY_BASELINE
		? JSON.parse(await readFile(process.env.LLAMPART_ORDINARY_BASELINE, 'utf8'))
		: null;
	const results = [];
	for (const wallpaper of ['01', '03'])
		for (const milk of [0, 50, 75, 100])
			for (const opaque of [false, true]) {
				await page.locator('.markdown-rendered-code-content td').first().waitFor();
				await page.evaluate(
					(config) =>
						localStorage.setItem(
							'LlamaCppWebui.config',
							JSON.stringify({
								...JSON.parse(localStorage.getItem('LlamaCppWebui.config')),
								...config
							})
						),
					{
						frostedGlassWallpaper: `frosted-glass-${wallpaper}`,
						frostedGlassMilkiness: milk,
						frostedGlassOpaque: opaque
					}
				);
				await page.reload();
				const assistant = page.locator('.llampart-assistant-markdown').first();
				await assistant.locator('.markdown-rendered-code-content td').first().waitFor();
				await page.evaluate(() => document.fonts.ready);
				await page
					.locator('.llampart-chat-scroll-container')
					.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
				const glass = await page.evaluate(() => {
					const probe = document.createElement('span');
					document.body.append(probe);
					const resolve = (token) => {
						probe.style.backgroundColor = `var(${token})`;
						return getComputedStyle(probe).backgroundColor;
					};
					const result = {
						quote: resolve('--llampart-glass-white-100'),
						table: resolve('--llampart-glass-white-110')
					};
					probe.remove();
					return result;
				});
				const states = {};
				for (const state of ['normal', 'hover']) {
					if (state === 'normal') await page.mouse.move(1275, 995);
					else {
						await assistant
							.locator('blockquote')
							.first()
							.hover({ position: { x: 10, y: 10 } });
						await page.waitForFunction(() =>
							document.querySelector('.llampart-assistant-markdown blockquote').matches(':hover')
						);
					}
					await page.waitForTimeout(250);
					states[state] = await assistant.evaluate((root) =>
						[
							...root.querySelectorAll(
								'blockquote,blockquote p,.table-block,.table-wrapper,table,th,td,.table-cell-content'
							)
						]
							.filter((el) => !el.closest('.markdown-rendered-code-content'))
							.map((el) => ({
								tag: el.tagName,
								cls: el.className,
								style: Object.fromEntries(
									[
										'backgroundColor',
										'backgroundImage',
										'borderTop',
										'borderLeft',
										'borderRadius',
										'color',
										'opacity',
										'backdropFilter',
										'textShadow',
										'boxShadow',
										'transform'
									].map((key) => [key, getComputedStyle(el)[key]])
								)
							}))
					);
					// These are intentional current values, including the deferred production blur issue.
					for (const entry of states[state]) {
						assert.equal(entry.style.opacity, '1');
						if (entry.tag === 'BLOCKQUOTE' || entry.cls === 'table-block')
							assert.equal(
								entry.style.backdropFilter,
								opaque || process.env.LLAMPART_TEST_PRODUCTION
									? 'none'
									: 'blur(10px) saturate(1.04)'
							);
					}
				}
				for (const entry of states.normal) {
					if (entry.tag === 'BLOCKQUOTE') {
						assert.equal(entry.style.backgroundColor, glass.quote);
						assert.equal(entry.style.color, 'rgb(0, 0, 0)');
						assert.equal(entry.style.borderLeft, '4px solid rgba(255, 255, 255, 0.28)');
					}
					if (entry.cls === 'table-block') {
						assert.equal(entry.style.backgroundColor, glass.table);
						assert.equal(entry.style.borderTop, '1px solid rgba(255, 255, 255, 0.12)');
					}
				}
				assert.equal(states.hover[0].style.backgroundColor, 'rgba(255, 255, 255, 0.12)');
				if (ordinaryBaseline) {
					const before = ordinaryBaseline.find(
						(entry) =>
							entry.wallpaper === wallpaper && entry.milk === milk && entry.opaque === opaque
					);
					assert(before, 'Every ordinary material case must have a pre-patch capture');
					assert.deepEqual(
						states,
						before.states,
						`Ordinary surfaces must not change: ${wallpaper}/${milk}/${opaque}`
					);
				}
				const surfaces = [];
				for (const surface of await assistant
					.locator('.markdown-rendered-code-content :is(.table-block, blockquote)')
					.all()) {
					const kind = await surface.evaluate((el) =>
						el.tagName === 'BLOCKQUOTE' ? 'quote' : 'table'
					);
					const cell = surface.locator(kind === 'quote' ? 'p' : 'td').first();
					// The composer overlays the bottom of the scroll viewport. Center the
					// actual sample, rather than measuring pixels through that overlay.
					await cell.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
					await page.mouse.move(1275, 995);
					await page.waitForTimeout(250);
					const hit = await cell.evaluate((el) => {
						const r = el.getBoundingClientRect();
						const target = document.elementFromPoint(r.right - 6, r.bottom - 6);
						return {
							belongs: el.contains(target),
							rect: r.toJSON(),
							target: target?.outerHTML.slice(0, 500)
						};
					});
					if (!hit.belongs) await page.screenshot({ path: `${artifacts}/hit-failure.png` });
					assert(hit.belongs, JSON.stringify({ wallpaper, milk, opaque, kind, hit }));
					const raster = await cell.screenshot({ animations: 'disabled' });
					const measured = await cell.evaluate(async (el, png) => {
						const canvas = document.createElement('canvas');
						const image = new Image();
						image.src = `data:image/png;base64,${png}`;
						await image.decode();
						canvas.width = image.width;
						canvas.height = image.height;
						const ctx = canvas.getContext('2d');
						ctx.drawImage(image, 0, 0);
						// Empty cell padding, away from glyphs, borders and rounded corners.
						const background = [
							...ctx.getImageData(image.width - 6, image.height - 6, 1, 1).data
						].slice(0, 3);
						const text = getComputedStyle(el.querySelector('.table-cell-content') || el).color;
						ctx.clearRect(0, 0, 1, 1);
						ctx.fillStyle = text;
						ctx.fillRect(0, 0, 1, 1);
						const foreground = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
						const luminance = (rgb) =>
							rgb
								.map((v) => v / 255)
								.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
								.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
						const a = luminance(foreground),
							b = luminance(background);
						const block = getComputedStyle(el.closest('.table-block, blockquote'));
						return {
							text,
							foreground,
							background,
							contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
							material: block.background,
							border: block.border,
							blur: block.backdropFilter,
							opacity: block.opacity
						};
					}, raster.toString('base64'));
					if (measured.contrast < 4.5) {
						await writeFile(`${artifacts}/contrast-failure.png`, raster);
						await page.screenshot({ path: `${artifacts}/contrast-failure-page.png` });
					}
					assert(measured.contrast >= 4.5, JSON.stringify({ wallpaper, milk, opaque, measured }));
					assert.equal(measured.opacity, '1');
					assert.equal(
						measured.blur,
						'none',
						'Embedded surfaces use the existing dark code material'
					);
					assert(
						measured.material.startsWith('rgba(0, 0, 0, 0)'),
						'Frame fill must reveal the code material without double painting'
					);
					assert(
						measured.background.every((channel) => channel < 100),
						'No light islands inside dark Markdown fences'
					);
					await surface.hover({ position: { x: 10, y: 10 } });
					await page.waitForTimeout(250);
					const hover = await surface.evaluate((el) => {
						const style = getComputedStyle(el);
						return {
							background: style.backgroundColor,
							color: style.color,
							blur: style.backdropFilter,
							opacity: style.opacity
						};
					});
					assert.equal(hover.background, 'rgba(0, 0, 0, 0)');
					assert.equal(hover.color, 'rgb(230, 237, 243)');
					assert.equal(hover.blur, 'none');
					assert.equal(hover.opacity, '1');
					let cells;
					if (kind === 'table') {
						assert.equal(
							await surface
								.locator('th')
								.first()
								.evaluate((el) => getComputedStyle(el).color),
							measured.text
						);
						cells = await surface.evaluate((block) => {
							const probe = document.createElement('span');
							probe.hidden = true;
							block.append(probe);
							const ink = (percent) => {
								probe.style.color = `color-mix(in srgb, var(--llampart-code-foreground) ${percent}%, transparent)`;
								return getComputedStyle(probe).color;
							};
							const expectedGrid = ink(8),
								expectedRow = ink(2);
							probe.remove();
							return {
								expectedGrid,
								expectedRow,
								rows: [...block.querySelectorAll('tbody tr')].map(
									(el) => getComputedStyle(el).backgroundColor
								),
								nodes: [...block.querySelectorAll('table, th, td')].map((el) => {
									const style = getComputedStyle(el);
									return {
										tag: el.tagName,
										background: style.backgroundColor,
										grid: style.borderTopColor,
										color: style.color
									};
								})
							};
						});
						for (const node of cells.nodes) {
							assert.equal(
								node.background,
								'rgba(0, 0, 0, 0)',
								'No extra white cell/table material inside code'
							);
							assert.equal(node.grid, cells.expectedGrid, 'Grid uses only 8% of existing code ink');
							assert.equal(node.color, measured.text);
						}
						assert.equal(cells.rows.length, 2);
						assert.equal(
							cells.rows[1],
							cells.expectedRow,
							'Even-row cue remains subtle at 2% code ink'
						);
					}
					surfaces.push({ kind, ...measured, hover, cells });
				}
				if (surfaces.filter((entry) => entry.kind === 'quote').length !== 2)
					await writeFile(`${artifacts}/unexpected-markdown.html`, await assistant.innerHTML());
				assert.equal(surfaces.filter((entry) => entry.kind === 'table').length, 2);
				assert.equal(surfaces.filter((entry) => entry.kind === 'quote').length, 2);
				assert.equal(
					await assistant
						.locator('.markdown-rendered-code-content h1')
						.evaluate((el) => getComputedStyle(el).color),
					'rgb(230, 237, 243)'
				);
				const js = assistant.locator('.code-block-wrapper').last();
				assert.equal(
					await js.evaluate((el) => getComputedStyle(el).backgroundColor),
					opaque ? 'rgb(34, 40, 49)' : 'rgba(34, 40, 49, 0.9)'
				);
				assert.equal(await js.evaluate((el) => getComputedStyle(el).backdropFilter), 'none');
				if (process.env.LLAMPART_TEST_PRODUCTION && milk === 75) {
					await page.mouse.move(0, 0);
					await page.setViewportSize({ width: 1280, height: 2200 });
					await assistant.screenshot({
						path: `${artifacts}/A-E-${wallpaper}-${opaque ? 'opaque' : 'glass'}.png`,
						animations: 'disabled'
					});
					await page.setViewportSize({ width: 1280, height: 1000 });
				}
				results.push({ wallpaper, milk, opaque, states, surfaces });
			}
	const table = page.locator('.markdown-rendered-code-content .table-block').first();
	await table.locator('.table-copy-button').click();
	await page.waitForFunction(async () =>
		(await navigator.clipboard.readText()).includes('Fenced table\t3')
	);
	const csv = table.locator('.table-csv-button');
	await table.locator('.table-copy-button').focus();
	await page.keyboard.press('Shift+Tab');
	assert(await csv.evaluate((el) => el === document.activeElement && el.matches(':focus-visible')));
	await page
		.locator('[data-slot="tooltip-content"]')
		.filter({ hasText: 'Download table as CSV' })
		.waitFor();
	const pending = page.waitForEvent('download');
	await csv.press('Enter');
	const file = await pending;
	assert.equal(
		await readFile(await file.path(), 'utf8'),
		'\uFEFFA,B\r\nFenced table,3\r\nSecond row,19.5\r\n'
	);
	await table.locator('.table-preview-button').click();
	await page.locator('.llampart-table-preview-dialog').waitFor();
	await page.keyboard.press('Escape');
	await page.locator('.llampart-table-preview-dialog').waitFor({ state: 'hidden' });
	await page.locator('.llampart-markdown-rendered-code-preview-btn').click();
	await page.locator('.markdown-rendered-preview-dialog-content').waitFor();
	await page.keyboard.press('Escape');
	assert.deepEqual(errors, []);
	await writeFile(`${artifacts}/materials.json`, JSON.stringify(results, null, 2));
	console.log(
		'REAL PASS: 16 material configurations, 32 ordinary normal/hover states, 64 dark-surface raster samples >=4.5, clipboard/CSV/preview/focus/tooltip; MOCK HTTP/SSE'
	);
	await context.close();
}

if (process.argv.includes('--materials-only')) {
	try {
		await materialRegression();
	} finally {
		await browser.close();
	}
	process.exit(0);
}

try {
	for (const fullHeight of [false, true]) {
		const context = await browser.newContext({
			viewport: { width: 1600, height: 1000 },
			acceptDownloads: true,
			permissions: ['clipboard-read', 'clipboard-write']
		});
		const page = await context.newPage();
		await page.addLocatorHandler(
			page.locator('.llampart-about-dialog-content'),
			async (welcome) => {
				await welcome.locator('#about-llampart-do-not-show-again').check();
				await welcome.getByRole('button', { name: 'OK', exact: true }).click();
			}
		);
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript((fullHeight) => {
			if (window.top !== window) return;
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: 'llama-server',
					serverBaseUrl: 'http://tables.test',
					llamaServerBaseUrl: 'http://tables.test',
					interfaceLanguage: 'pl',
					theme: 'frosted-glass',
					frostedGlassWallpaper: 'frosted-glass-02',
					fullHeightCodeBlocks: fullHeight,
					renderUserContentAsMarkdown: true,
					renderReasoningContentAsMarkdown: true,
					minimalAgenticIndicators: false,
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false,
					alwaysShowSidebarOnDesktop: true
				})
			);
			window.tableDownloads = { created: [], revoked: [] };
			const create = URL.createObjectURL.bind(URL);
			URL.createObjectURL = (blob) => {
				const url = create(blob);
				window.tableDownloads.created.push({ url, type: blob.type });
				return url;
			};
			const revoke = URL.revokeObjectURL.bind(URL);
			URL.revokeObjectURL = (url) => {
				window.tableDownloads.revoked.push(url);
				revoke(url);
			};
		}, fullHeight);
		let content = `Przed tabelą.\n\n${longTable}\n\n${csvTable}\n\n${chart}\n\n${code}\n\nKoniec.`;
		await page.route('**/__llampart/api/**', (route) => {
			const path = new URL(route.request().url()).pathname;
			if (path.endsWith('/chat/completions'))
				return route.fulfill({
					contentType: 'text/event-stream',
					body: `data: ${JSON.stringify({ choices: [{ delta: { content, reasoning_content: longTable } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
				});
			return route.fulfill({
				json: path.endsWith('/props')
					? {
							build_info: 'tables-test',
							model_path: 'tables.gguf',
							default_generation_settings: { params: {} }
						}
					: path.endsWith('/models')
						? { object: 'list', data: [{ id: 'tables.gguf' }] }
						: []
			});
		});
		await page.goto(base);
		await page.locator('textarea').first().fill('Długa wiadomość użytkownika.\n'.repeat(120));
		await page.waitForFunction(
			() => document.querySelector('.llampart-composer-send-button')?.disabled === false
		);
		await page.locator('textarea').first().press('Enter');
		const assistant = page.locator('.llampart-assistant-markdown').first();
		const blocks = assistant.locator('.table-block');
		await blocks.nth(1).locator('.table-csv-button[data-listener-bound=true]').waitFor();
		await assistant.locator('.llampart-chart-frame svg').first().waitFor();
		assert.equal(await blocks.count(), 2);
		assert.equal(
			await assistant.evaluate((el) => el.classList.contains('full-height-code-blocks')),
			fullHeight
		);
		for (const block of await blocks.all()) {
			assert.deepEqual(
				await block
					.locator('.table-actions button')
					.evaluateAll((els) =>
						els.map((el) =>
							['table-csv-button', 'table-copy-button', 'table-preview-button'].find((name) =>
								el.classList.contains(name)
							)
						)
					),
				['table-csv-button', 'table-copy-button', 'table-preview-button']
			);
		}
		const geometry = await blocks.first().evaluate((block) => {
			const wrapper = block.querySelector('.table-wrapper');
			const table = wrapper.querySelector('table');
			const last = table.rows[table.rows.length - 1].getBoundingClientRect();
			return {
				rows: table.rows.length,
				first: table.rows[1].cells[0].textContent,
				last: table.rows[105].cells[0].textContent,
				blockHeight: block.clientHeight,
				tableHeight: table.getBoundingClientRect().height,
				wrapperHeight: wrapper.clientHeight,
				wrapperScroll: wrapper.scrollHeight,
				lastInside: last.bottom <= block.getBoundingClientRect().bottom,
				actionsAbove:
					block.querySelector('.table-actions').getBoundingClientRect().bottom <
					table.getBoundingClientRect().top,
				maxHeight: getComputedStyle(wrapper).maxHeight,
				chatScrollable:
					document.querySelector('.llampart-chat-scroll-container').scrollHeight >
					document.querySelector('.llampart-chat-scroll-container').clientHeight
			};
		});
		assert.equal(geometry.rows, 106);
		assert.equal(geometry.first, '1');
		assert.equal(geometry.last, '105');
		assert(geometry.lastInside && geometry.actionsAbove && geometry.chatScrollable);
		assert.equal(geometry.maxHeight, 'none');
		assert(geometry.wrapperScroll <= geometry.wrapperHeight + 1);
		assert(geometry.blockHeight > geometry.tableHeight);
		await blocks.first().locator('tbody tr').last().scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${artifacts}/long-last-row-${fullHeight}.png` });
		const userScroll = await page
			.locator('.llampart-user-message-scroll-area')
			.first()
			.evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
		assert(userScroll.scroll > userScroll.height);
		const reasoningPanel = page.locator('.llampart-agentic-panel').first();
		await reasoningPanel.locator('button[aria-expanded]').click();
		const reasoningWrapper = reasoningPanel.locator('.table-wrapper');
		await reasoningWrapper.waitFor();
		assert.equal(await reasoningWrapper.locator('tbody tr').count(), 105);
		assert(await reasoningWrapper.evaluate((el) => el.scrollHeight <= el.clientHeight + 1));
		await reasoningPanel.locator('button[aria-expanded]').click();

		let downloads = 0;
		page.on('download', () => downloads++);
		async function download(button, filename, expected, keyboard = false) {
			const pending = page.waitForEvent('download');
			if (keyboard) await button.press('Enter');
			else await button.click();
			const file = await pending;
			assert.equal(file.suggestedFilename(), filename);
			const path = `${artifacts}/${fullHeight}-${filename}`;
			await file.saveAs(path);
			const bytes = await readFile(path);
			assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
			assert.equal(bytes.toString('utf8'), expected);
		}
		const csvButton = blocks.nth(1).locator('.table-csv-button');
		await csvButton.scrollIntoViewIfNeeded();
		await blocks.nth(1).locator('.table-copy-button').focus();
		await page.keyboard.press('Shift+Tab');
		assert(await csvButton.evaluate((el) => document.activeElement === el));
		await page
			.locator('[data-slot="tooltip-content"]')
			.filter({ hasText: 'Pobierz tabelę jako CSV' })
			.waitFor()
			.catch(async (error) => {
				console.error(
					await page.evaluate(() => ({
						active: document.activeElement?.outerHTML,
						tooltips: [...document.querySelectorAll('[data-slot="tooltip-content"]')].map(
							(el) => el.outerHTML
						)
					})),
					errors
				);
				await page.screenshot({ path: `${artifacts}/tooltip-failure.png` });
				throw error;
			});
		assert(
			await csvButton.evaluate(
				(el) =>
					el.matches(':focus-visible') &&
					getComputedStyle(el).textDecorationLine.includes('underline')
			)
		);
		assert.equal(await csvButton.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
		assert(
			await page
				.locator('[data-slot="tooltip-content"]')
				.evaluate((el) => !el.closest('.llampart-markdown-content'))
		);
		await download(csvButton, 'table-2.csv', expectedCsv, true);
		await download(
			blocks.first().locator('.table-csv-button'),
			'table-1.csv',
			'\uFEFFNumer,Nazwa,Cena,Uwagi\r\n' +
				Array.from({ length: 105 }, (_, i) => `${i + 1},Wiersz ${i + 1},"4,50",Łódź 東京\r\n`).join(
					''
				)
		);
		await blocks.nth(1).locator('.table-copy-button').click();
		await page.waitForFunction(async () =>
			(await navigator.clipboard.readText()).includes('Ser "żółty"\t24,90\tProdukt, nabiał')
		);
		await download(
			assistant.locator('.chart-actions button').filter({ hasText: /^CSV$/ }),
			'chart-Kontrola-CSV.csv',
			'\uFEFFx,Wartość\r\nŁódź,-1.25\r\n'
		);
		assert.equal(
			await csvButton.evaluate((el) => getComputedStyle(el).fontSize),
			await assistant
				.locator('.chart-actions button')
				.filter({ hasText: /^CSV$/ })
				.evaluate((el) => getComputedStyle(el).fontSize)
		);
		const chartCsvButton = assistant.locator('.chart-actions button').filter({ hasText: /^CSV$/ });
		const buttonStyles = await assertTextActionStyles(page, csvButton);
		const chartStyles = await assertTextActionStyles(page, chartCsvButton);
		for (const state of ['rest', 'hover', 'focus', 'active']) {
			const geometry = (style) =>
				Object.fromEntries(
					['height', 'padding', 'fontSize', 'fontWeight', 'lineHeight'].map((key) => [
						key,
						style[key]
					])
				);
			assert.deepEqual(
				geometry(buttonStyles[state]),
				geometry(chartStyles[state]),
				`Table CSV must retain shared chart text action geometry: ${state}`
			);
		}
		await csvButton.hover();
		await page.screenshot({ path: `${artifacts}/csv-text-hover-${fullHeight}.png` });

		const eye = blocks.first().locator('.table-preview-button');
		const preview = page.locator('.llampart-table-preview-dialog');
		async function openPreview() {
			await eye.click();
			await preview.waitFor();
		}
		async function closePreview() {
			await page.keyboard.press('Escape');
			await preview.waitFor({ state: 'hidden' });
			await page.waitForFunction((el) => document.activeElement === el, await eye.elementHandle());
		}
		async function colors() {
			const result = await preview.evaluate((el) => {
				const probe = document.createElement('span');
				probe.hidden = true;
				el.append(probe);
				const expected = (weight) => {
					probe.style.backgroundColor = `color-mix(in srgb, var(--llampart-frosted-glass-accent) ${weight}%, var(--llampart-frosted-preview-surface-background, var(--background)))`;
					return getComputedStyle(probe).backgroundColor;
				};
				try {
					return {
						header: getComputedStyle(el.querySelector('thead th')).backgroundColor,
						even: getComputedStyle(el.querySelector('tbody tr:nth-child(2) td')).backgroundColor,
						odd: getComputedStyle(el.querySelector('tbody tr:first-child td')).backgroundColor,
						text: getComputedStyle(el.querySelector('td')).color,
						base: getComputedStyle(el).backgroundColor,
						accent: getComputedStyle(el).getPropertyValue('--llampart-frosted-glass-accent').trim(),
						expectedHeader: expected(12),
						expectedEven: expected(8.4)
					};
				} finally {
					probe.remove();
				}
			});
			assert.equal(result.header, result.expectedHeader);
			assert.equal(result.even, result.expectedEven);
			assert.notEqual(result.header, result.even);
			return result;
		}
		await openPreview();
		const bounds = await preview.boundingBox();
		assert(bounds.width <= 1281 && bounds.height <= 801);
		assert(
			await preview
				.locator('.table-preview-wrapper')
				.evaluate((el) => el.scrollHeight > el.clientHeight)
		);
		await preview.locator('.table-preview-wrapper').evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		assert(await preview.locator('.table-preview-wrapper').evaluate((el) => el.scrollTop > 0));
		const initialColors = await colors();
		assert.notEqual(initialColors.even, initialColors.odd);
		assert.equal(initialColors.text, 'oklch(0.145 0 0)');
		await page.screenshot({ path: `${artifacts}/preview-${fullHeight}.png` });
		await closePreview();

		// Real Settings transactions; changing wallpaper must change actual cell computed color.
		const settingsDialog = page.locator('.llampart-chat-settings-dialog-content');
		async function settings() {
			await page.locator('button[aria-label="Ustawienia"]').click();
			await settingsDialog.getByRole('button', { name: 'Wygląd', exact: true }).click();
		}
		async function endSettings(save) {
			await settingsDialog
				.getByRole('button', { name: save ? 'Zapisz ustawienia' : 'Zamknij', exact: true })
				.click();
			await settingsDialog.waitFor({ state: 'hidden' });
		}
		const wallpaperColors = [];
		if (!fullHeight) {
			for (const id of ['01', '02', '03', '04', '05']) {
				await settings();
				await settingsDialog
					.getByRole('button', { name: `Frosted Glass ${id}`, exact: true })
					.click();
				await endSettings(true);
				await page.waitForFunction(
					() =>
						document.documentElement.style.getPropertyValue('--llampart-frosted-glass-accent') !==
						'#899492'
				);
				await openPreview();
				wallpaperColors.push({ id, ...(await colors()) });
				await page.screenshot({ path: `${artifacts}/wallpaper-${id}.png` });
				await closePreview();
			}
			assert(new Set(wallpaperColors.map((item) => item.even)).size >= 2);
			await settings();
			await settingsDialog.getByRole('button', { name: 'Frosted Glass 01', exact: true }).click();
			await page.locator('#frostedGlassMilkiness').fill('17');
			await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
			await endSettings(false);
			await openPreview();
			assert.equal((await colors()).even, wallpaperColors.at(-1).even);
			await closePreview();
			await settings();
			await page.locator('#frostedGlassMilkiness').fill('90');
			await page.getByLabel('Wyłącz przezroczystość', { exact: true }).check();
			await endSettings(true);
			await openPreview();
			assert.equal((await colors()).even, wallpaperColors.at(-1).even);
			await closePreview();
			const image = Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
				'base64'
			);
			for (const save of [false, true]) {
				await settings();
				await settingsDialog
					.locator('input[type=file]')
					.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: image });
				// Wallpaper persistence is a Data URL, but the renderer now owns a short Blob URL.
				await page.waitForFunction(() =>
					document.documentElement.style
						.getPropertyValue('--llampart-theme-wallpaper')
						.includes('blob:')
				);
				const uploaded = await page.evaluate(async () => {
					const css = document.documentElement.style.getPropertyValue('--llampart-theme-wallpaper');
					const url = css.match(/url\(["']?([^"')]+)["']?\)/)[1];
					const response = await fetch(url);
					return {
						type: response.headers.get('content-type'),
						bytes: [...new Uint8Array(await response.arrayBuffer())]
					};
				});
				assert.equal(uploaded.type, 'image/png');
				assert.deepEqual(uploaded.bytes, [...image]);
				await endSettings(save);
				await openPreview();
				if (save) assert.notEqual((await colors()).even, wallpaperColors.at(-1).even);
				else assert.equal((await colors()).even, wallpaperColors.at(-1).even);
				await closePreview();
			}
		}

		if (!process.env.LLAMPART_TEST_PRODUCTION) {
			await openPreview();
			const before = await colors();
			await page.evaluate(async () => {
				const { settings } = await import('/tests/browser/charts-harness.ts');
				settings.updateConfig('frostedGlassWallpaper', 'frosted-glass-01');
			});
			await page.waitForFunction(
				(color) =>
					getComputedStyle(
						document.querySelector('.llampart-table-preview-dialog tbody tr:nth-child(2) td')
					).backgroundColor !== color,
				before.even
			);
			await closePreview();
			// Reconcile partial, appended and replaced HTML many times, then export the latest DOM once.
			for (let i = 1; i <= 12; i++) {
				await page.evaluate(
					async (text) => {
						const { conversations } = await import('/tests/browser/charts-harness.ts');
						const message = conversations.activeMessages.find(
							(message) => message.role === 'assistant'
						);
						conversations.updateMessageAtIndex(conversations.findMessageIndex(message.id), {
							content: text
						});
					},
					csvTable + `\n| Aktualny ${i} | ${i} | streaming |`
				);
				await assistant
					.locator('td')
					.filter({ hasText: `Aktualny ${i}` })
					.waitFor();
			}
			const count = downloads;
			await download(
				assistant.locator('.table-csv-button'),
				'table-1.csv',
				expectedCsv + 'Aktualny 12,12,streaming\r\n'
			);
			assert.equal(downloads, count + 1);
		}

		// A second normal response: wide table, rendered Markdown table, code and XSS fallback.
		content = `${wide}\n\n\`\`\`markdown\n${csvTable}\n\`\`\`\n\n${code}\n\n\`\`\`html\n<p>Podgląd kodu</p>\n\`\`\`\n\n<img src=x onerror="window.tableXss=1">`;
		await page.locator('textarea').first().fill('Szeroka tabela i regresje.');
		await page.locator('textarea').first().press('Enter');
		const mixed = page.locator('.llampart-assistant-markdown').last();
		await mixed.locator('.markdown-rendered-code-block .table-csv-button').waitFor();
		const wideWrapper = mixed.locator('.table-wrapper').first();
		const width = await wideWrapper.evaluate((el) => {
			el.scrollLeft = 200;
			return {
				width: el.clientWidth,
				scroll: el.scrollWidth,
				left: el.scrollLeft,
				pageOverflow: document.documentElement.scrollWidth > innerWidth,
				cellMax: getComputedStyle(el.querySelector('.table-cell-content')).maxWidth,
				rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
				wrapping: getComputedStyle(el.querySelector('.table-cell-content')).overflowWrap,
				inside:
					el.getBoundingClientRect().right <=
					el.closest('.llampart-assistant-markdown').getBoundingClientRect().right + 1,
				actionsInside:
					el.closest('.table-block').querySelector('.table-actions').getBoundingClientRect()
						.right <= el.closest('.table-block').getBoundingClientRect().right
			};
		});
		assert(
			width.scroll > width.width &&
				width.left > 0 &&
				width.inside &&
				width.actionsInside &&
				!width.pageOverflow
		);
		assert.equal(width.cellMax, `${30 * width.rootFontSize}px`);
		assert.equal(width.wrapping, 'break-word');
		await wideWrapper.scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${artifacts}/wide-${fullHeight}.png` });
		const renderedCode = mixed.locator('.markdown-rendered-code-content');
		// c509c656's final CSS already expands both ordinary and rendered Markdown code.
		// Preserve that actual baseline rather than inventing a new code-height policy here.
		assert.equal(await renderedCode.evaluate((el) => getComputedStyle(el).maxHeight), 'none');
		assert.equal(
			await mixed
				.locator('.code-block-scroll-container')
				.first()
				.evaluate((el) => getComputedStyle(el).maxHeight),
			'none'
		);
		await mixed
			.locator('.code-block-wrapper:not(.markdown-rendered-code-block) .preview-code-btn')
			.click();
		const codePreview = page.locator(
			'.table-preview-dialog-content:not(.llampart-table-preview-dialog)'
		);
		await codePreview.waitFor();
		assert.equal(await codePreview.locator('.table-preview-wrapper').count(), 0);
		assert.equal(
			await codePreview.evaluate((el) => getComputedStyle(el).backgroundColor),
			initialColors.base
		);
		await page.keyboard.press('Escape');
		await codePreview.waitFor({ state: 'hidden' });
		await mixed.locator('.llampart-markdown-rendered-code-preview-btn').click();
		const markdownPreview = page.locator('.markdown-rendered-preview-dialog-content');
		await markdownPreview.waitFor();
		assert.equal(await markdownPreview.locator('.table-actions').count(), 0);
		assert.equal(await markdownPreview.locator('.llampart-table-preview-dialog').count(), 0);
		assert.equal(
			await markdownPreview.evaluate((el) => getComputedStyle(el).backgroundColor),
			initialColors.base
		);
		await page.keyboard.press('Escape');
		await markdownPreview.waitFor({ state: 'hidden' });
		assert.equal(await mixed.locator('img').count(), 0);
		assert.equal(await page.evaluate(() => window.tableXss), undefined);
		await page.waitForFunction(() =>
			window.tableDownloads.created
				.filter((item) => item.type === 'text/csv;charset=utf-8')
				.every((item) => window.tableDownloads.revoked.includes(item.url))
		);
		assert.deepEqual(errors, []);
		reports.push({
			fullHeight,
			geometry,
			width,
			initialColors,
			wallpaperColors,
			downloads,
			buttonStyles,
			errors
		});
		await context.close();
		console.log(`PASS tables: fullHeightCodeBlocks=${fullHeight}`);
	}
	await writeFile(`${artifacts}/results.json`, JSON.stringify(reports, null, 2));
} finally {
	await browser.close();
}
