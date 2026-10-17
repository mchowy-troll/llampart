/** Real app/Chromium; no inference. Same scenario in development and production.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
 * LLAMPART_TEST_URL=http://127.0.0.1:40138 node tests/browser/markdown-tables.mjs
 * LLAMPART_TEST_PRODUCTION=1 skips only the dev-store streaming/live-accent probes.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

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

try {
	for (const fullHeight of [false, true]) {
		const context = await browser.newContext({
			viewport: { width: 1600, height: 1000 },
			acceptDownloads: true,
			permissions: ['clipboard-read', 'clipboard-write']
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.addInitScript((fullHeight) => {
			if (window.top !== window) return;
			localStorage.setItem('Llampart.aboutDismissedVersion', '1.9.0');
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
		assert(await csvButton.evaluate((el) => getComputedStyle(el).boxShadow !== 'none'));
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
		async function exportButtonStyle(button, state) {
			await page.mouse.move(0, 0);
			await page.evaluate(() => document.activeElement?.blur());
			await button.scrollIntoViewIfNeeded();
			if (state === 'hover') await button.hover();
			if (state === 'focus') {
				await page.keyboard.press('Tab');
				await button.focus();
			}
			return button.evaluate(async (el) => {
				await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
				await Promise.all(el.getAnimations().map((animation) => animation.finished));
				const css = getComputedStyle(el);
				return Object.fromEntries(
					[
						'backgroundColor',
						'borderRadius',
						'height',
						'padding',
						'fontSize',
						'fontWeight',
						'lineHeight',
						'transitionProperty',
						'transitionDuration',
						'transitionTimingFunction',
						'backdropFilter',
						'outlineStyle',
						'boxShadow',
						'transform'
					].map((key) => [key, css[key]])
				);
			});
		}
		const buttonStyles = {};
		for (const state of ['rest', 'hover', 'focus']) {
			const reference = await exportButtonStyle(chartCsvButton, state);
			buttonStyles[state] = await exportButtonStyle(csvButton, state);
			assert.deepEqual(
				buttonStyles[state],
				reference,
				`Table CSV must match chart ghost style: ${state}`
			);
		}
		assert.notEqual(buttonStyles.hover.backgroundColor, buttonStyles.rest.backgroundColor);
		assert.notEqual(buttonStyles.hover.transitionDuration, '0s');
		assert.notEqual(buttonStyles.focus.boxShadow, 'none');
		await csvButton.hover();
		await page.screenshot({ path: `${artifacts}/csv-ghost-hover-${fullHeight}.png` });

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
				await page.waitForFunction(() =>
					document.documentElement.style
						.getPropertyValue('--llampart-theme-wallpaper')
						.includes('data:image/png')
				);
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
