/** AUD-002: real composer, dialogs, PDF.js and request serialization; synthetic HTTP only.
 * LLAMPART_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs
 * LLAMPART_TEST_URL=http://127.0.0.1:42181
 * LLAMPART_TEST_ARTIFACTS=/tmp/opencode/llampart-aud-002/browser
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:42181';
const out = process.env.LLAMPART_TEST_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
const warning = /selected model does not support vision/i;

// Valid one-page PDF with extractable text and no external resources.
function syntheticPdf() {
	const content = 'BT /F1 12 Tf 30 100 Td (AUD-002 synthetic PDF) Tj ET';
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`
	];
	let pdf = '%PDF-1.4\n';
	const offsets = [];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf);
}
const pdf = { name: 'aud-002.pdf', mimeType: 'application/pdf', buffer: syntheticPdf() };

async function session(provider, vision, mode = 'selectable') {
	// Each context has fresh, in-memory Chromium storage; never use an existing profile.
	const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
	const errors = [],
		payloads = [];
	const backend = { vision, ids: mode === 'single' ? ['model-A'] : ['model-A', 'model-B'] };
	await context.addInitScript(
		({ provider }) => {
			globalThis.aud002Rejections = [];
			addEventListener('unhandledrejection', (event) => {
				globalThis.aud002Rejections.push(String(event.reason));
			});
			if (localStorage.getItem('aud-002-seeded')) return;
			localStorage.setItem('aud-002-seeded', '1');
			localStorage.setItem('llama-webui-migration-v2-done', '1');
			localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: provider,
					serverBaseUrl: 'http://synthetic.test',
					openAiCompatibleBaseUrl: 'http://synthetic.test',
					vllmBaseUrl: 'http://synthetic.test',
					apiKey: '',
					interfaceLanguage: 'en',
					pdfAsImage: true,
					preEncodeConversation: false,
					titleGenerationUseLLM: false,
					askForTitleConfirmation: false
				})
			);
		},
		{ provider }
	);
	await context.route('**/*', (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin !== new URL(base).origin) return route.abort();
		if (!url.pathname.startsWith('/__llampart/api/')) return route.continue();
		if (url.pathname.endsWith('/props')) {
			const index = backend.ids.indexOf(url.searchParams.get('model') || backend.ids[0]);
			return route.fulfill({
				json: {
					build_info: 'synthetic',
					role: mode === 'single' ? 'model' : 'router',
					model_alias: mode === 'single' ? 'model-A' : undefined,
					modalities: { vision: backend.vision[index] },
					default_generation_settings: { n_ctx: 8192, params: {} }
				}
			});
		}
		if (url.pathname.endsWith('/models'))
			return route.fulfill({
				json: {
					object: 'list',
					data: backend.ids.map((id, index) => ({
						id,
						status: { value: 'loaded' },
						capabilities:
							backend.vision[index] === undefined ? {} : { vision: backend.vision[index] }
					}))
				}
			});
		if (url.pathname.endsWith('/chat/completions')) {
			const body = request.postDataJSON();
			payloads.push(body);
			return route.fulfill({
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: 'AUD-002 OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
			});
		}
		return route.fulfill({ json: [] });
	});
	const page = await context.newPage();
	page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(`console: ${message.text()}`);
	});
	await page.goto(base);
	await page.waitForSelector('textarea');
	await page.evaluate(async () => {
		const h = await import('/tests/browser/attachment-preview-model-harness.ts');
		globalThis.aud002 = { ...h, calls: [] };
		const original = h.models.modelSupportsVision;
		h.models.modelSupportsVision = function (model) {
			const supported = original.call(this, model);
			// Observe the real component's capability lookup, without changing its result.
			if (new Error().stack.includes('ChatAttachmentPreview.svelte')) {
				aud002.calls.push({
					model,
					supported,
					provider: h.settings.config.apiProvider,
					snapshotModel: this.capabilitySnapshot?.model,
					vision: this.capabilitySnapshot?.features.vision,
					modalities: this.getModelModalities(model)
				});
			}
			return supported;
		};
	});
	return { context, page, errors, payloads, backend };
}

async function select(page, model) {
	await page.locator('.llampart-model-selector-trigger').last().click();
	await page.getByRole('option').filter({ hasText: model }).click();
	await page.waitForFunction((model) => aud002.models.selectedModelName === model, model);
	await page.waitForFunction((model) => aud002.models.capabilitySnapshot?.model === model, model);
}

async function openPdf(page) {
	await page.locator('input[type=file]').first().setInputFiles(pdf);
	await page
		.locator('.llampart-chat-form-root')
		.getByRole('button', { name: 'Preview aud-002.pdf', exact: true })
		.click();
	await page.locator('.llampart-attachment-pdf-preview-image').waitFor();
}

async function previewState(page, model, supported) {
	await page.waitForFunction(
		({ model, supported }) => {
			const last = aud002.calls.at(-1);
			return last?.model === model && last.supported === supported;
		},
		{ model, supported }
	);
	const dialog = page.locator('.llampart-attachment-preview-dialog-content');
	await page.waitForFunction(
		(supported) =>
			/selected model does not support vision/i.test(
				document.querySelector('.llampart-attachment-preview-dialog-content')?.textContent || ''
			) === !supported,
		supported
	);
	assert.equal(warning.test(await dialog.innerText()), !supported);
	return page.evaluate(() => aud002.calls.at(-1));
}

async function finish(s, label, observations) {
	assert.deepEqual(s.errors, [], `${label}: browser errors`);
	assert.deepEqual(await s.page.evaluate(() => aud002Rejections), [], `${label}: rejections`);
	results.push({ label, observations, payloads: s.payloads, errors: s.errors, rejections: [] });
	await s.context.close();
}

try {
	for (const provider of ['openai-compatible', 'vllm']) {
		for (const vision of [false, true]) {
			const s = await session(provider, [!vision, vision]);
			const { page } = s;
			await select(page, 'model-B');
			await openPdf(page);
			const selected = await previewState(page, 'model-B', vision);
			const geometry = () =>
				page.evaluate(() => {
					const rect = (selector) => {
						const { x, y, width, height } = document
							.querySelector(selector)
							.getBoundingClientRect();
						return { x, y, width, height };
					};
					return {
						composer: rect('.llampart-chat-input-frame'),
						dialog: rect('.llampart-attachment-preview-dialog-content')
					};
				});
			const beforeGeometry = await geometry();
			if (out) await page.screenshot({ path: `${out}/${provider}-B-${vision}.png` });
			// A modal traps focus, so update the same store used by the real selector while it stays open.
			// Selection itself was exercised through the real dropdown above.
			await page.evaluate(() => aud002.models.selectModelById('model-A'));
			const switched = await previewState(page, 'model-A', !vision);
			if (out) await page.screenshot({ path: `${out}/${provider}-switched-A-${!vision}.png` });
			await page.evaluate(() => aud002.models.selectModelById('model-B'));
			await previewState(page, 'model-B', vision);
			assert.deepEqual(await geometry(), beforeGeometry, 'A/B roundtrip preserves layout');
			await page.keyboard.press('Escape');
			await page.locator('textarea').fill('AUD-002 PDF request');
			await page.locator('textarea').press('Enter');
			await page.waitForFunction(() => !aud002.chat.isLoading && location.hash.includes('/chat/'));
			assert.equal(s.payloads.length, 1);
			const body = s.payloads[0];
			assert.equal(body.model, 'model-B');
			const hasImages = body.messages.some(
				(message) =>
					Array.isArray(message.content) &&
					message.content.some((part) => part.type === 'image_url')
			);
			assert.equal(hasImages, vision);
			if (!vision) assert.match(JSON.stringify(body.messages), /AUD-002 synthetic PDF/);
			const stored = await page.evaluate(() =>
				aud002.conversations.activeMessages
					.flatMap((message) => message.extra || [])
					.find((extra) => extra.type === 'PDF')
			);
			assert(stored?.base64Data, 'PDF retains original data for history preview');
			assert.equal(stored.processedAsImages, vision);
			if (vision) assert.equal(stored.images.length, 1);
			else assert.match(stored.content, /AUD-002 synthetic PDF/);
			// History uses the same existing preview renderer, independently of composer uploads.
			await page.getByRole('button', { name: 'Preview aud-002.pdf', exact: true }).first().click();
			await page.locator('.llampart-attachment-pdf-preview-image').waitFor();
			await page.keyboard.press('Escape');
			await finish(s, `${provider}: selected B vision=${vision}`, {
				selected,
				switched,
				stored,
				geometry: beforeGeometry
			});
		}
	}

	for (const mode of ['router', 'single']) {
		const s = await session('llama-server', [true, false], mode);
		const { page } = s;
		if (mode === 'router') {
			// The native composer auto-selects the first loaded model. Exercise actual changes.
			await select(page, 'model-B');
			await select(page, 'model-A');
		} else await page.evaluate(() => aud002.models.clearSelection());
		await openPdf(page);
		const initial = await previewState(page, 'model-A', true);
		let switched;
		let conversationFallback;
		if (mode === 'router') {
			await page.evaluate(() => aud002.models.selectModelById('model-B'));
			switched = await previewState(page, 'model-B', false);
			await page.evaluate(async () => {
				aud002.models.models = aud002.models.models.map((option) => ({
					...option,
					id: `selector-${option.model}`,
					name: `Display ${option.model}`
				}));
				await aud002.models.selectModelById('selector-model-A');
			});
			await previewState(page, 'model-A', true);
			await page.evaluate(() => aud002.models.selectModelById('selector-model-B'));
			await previewState(page, 'model-B', false);
			await page.keyboard.press('Escape');
			await page.locator('textarea').fill('AUD-002 router conversation context');
			await page.locator('textarea').press('Enter');
			await page.waitForFunction(() => !aud002.chat.isLoading && location.hash.includes('/chat/'));
			await page.waitForLoadState('networkidle');
			assert.equal(s.payloads[0].model, 'model-B');
			await openPdf(page);
			await previewState(page, 'model-B', false);
			await page.evaluate(() => {
				// No loaded-model auto-selection: exercise the real conversation fallback branch.
				aud002.models.routerModels = [];
				aud002.models.clearSelection();
			});
			conversationFallback = await previewState(page, 'model-B', false);
			assert.equal(await page.evaluate(() => aud002.models.selectedModelId), null);
			await page.evaluate(() => (aud002.models.selectedModelId = 'removed-selector-id'));
			await previewState(page, 'model-B', false);
			s.backend.ids = [];
			await page.evaluate(() => aud002.models.fetch(true));
			// The selector may rediscover an empty list; preview must stay unbound throughout.
			await page.waitForFunction(() => aud002.models.models.length === 0);
			await page.evaluate(() => {
				aud002.calls.length = 0;
				aud002.models.selectedModelId = 'still-removed-selector-id';
			});
			await page.evaluate(() => new Promise(requestAnimationFrame));
			assert.deepEqual(await page.evaluate(() => aud002.calls), []);
			assert(
				!warning.test(await page.locator('.llampart-attachment-preview-dialog-content').innerText())
			);
		}
		await finish(s, `llama-server ${mode}`, { initial, switched, conversationFallback });
	}

	for (const unknown of [undefined, { state: 'unknown' }]) {
		const s = await session('openai-compatible', [false, unknown]);
		await select(s.page, 'model-B');
		await openPdf(s.page);
		const state = await previewState(s.page, 'model-B', true);
		assert.equal(state.snapshotModel, 'model-B');
		assert.equal(state.vision.state, 'unknown', 'UI availability must not become proof of support');
		await finish(s, `capabilities ${unknown ? 'unknown' : 'absent'}`, state);
	}

	{
		const s = await session('openai-compatible', [false, true]);
		const { page } = s;
		await select(page, 'model-B');
		const images = await page.evaluate(() => {
			const canvas = document.createElement('canvas');
			canvas.width = canvas.height = 8;
			canvas.getContext('2d').fillRect(0, 0, 8, 8);
			return ['image/png', 'image/jpeg'].map((type) => canvas.toDataURL(type).split(',')[1]);
		});
		await page
			.locator('input[type=file]')
			.first()
			.setInputFiles([
				pdf,
				{
					name: 'aud-002.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('AUD-002 text attachment')
				},
				{ name: 'aud-002.png', mimeType: 'image/png', buffer: Buffer.from(images[0], 'base64') },
				{ name: 'aud-002.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(images[1], 'base64') }
			]);
		await page.locator('.llampart-attachments-view-all-trigger').click();
		const all = page.locator('.llampart-attachments-view-all-dialog-content');
		assert.match(await all.innerText(), /All attachments \(4\)/);
		await all.getByRole('button', { name: 'Preview aud-002.txt', exact: true }).click();
		const textPreview = page.locator('.llampart-attachment-preview-dialog-content');
		assert.match(await textPreview.innerText(), /AUD-002 text attachment/);
		assert(!warning.test(await textPreview.innerText()));
		await page.keyboard.press('Escape');
		for (const name of ['aud-002.png', 'aud-002.jpg']) {
			await all.locator(`img[alt="${name}"]`).click();
			await page.locator('.llampart-attachment-image-preview').waitFor();
			assert(
				!warning.test(await page.locator('.llampart-attachment-preview-dialog-content').innerText())
			);
			await page.keyboard.press('Escape');
		}
		await all.getByRole('button', { name: 'Preview aud-002.pdf', exact: true }).click();
		await page.locator('.llampart-attachment-pdf-preview-image').waitFor();
		const viewAllPreview = await previewState(page, 'model-B', true);
		await page.evaluate(() => aud002.models.selectModelById('model-A'));
		await previewState(page, 'model-A', false);
		await page.keyboard.press('Escape');
		await all.getByRole('button', { name: 'Remove file', exact: true }).last().click();
		assert.match(await all.innerText(), /All attachments \(3\)/);
		await page.keyboard.press('Escape');
		// Dispatch actual drop/paste DOM events through the existing UI handlers.
		await page.evaluate(() => {
			const transfer = new DataTransfer();
			transfer.items.add(new File(['drop text'], 'drop.txt', { type: 'text/plain' }));
			document
				.querySelector('[role="main"][aria-label]')
				.dispatchEvent(
					new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
				);
		});
		await page.locator('.llampart-attachments-view-all-trigger').click();
		await all.getByRole('button', { name: 'Preview drop.txt', exact: true }).waitFor();
		await page.keyboard.press('Escape');
		await page.evaluate(() => aud002.settings.updateConfig('pasteLongTextToFileLen', 10));
		await page.locator('textarea').evaluate((textarea) => {
			const transfer = new DataTransfer();
			transfer.setData('text/plain', 'AUD-002 pasted synthetic long text');
			textarea.dispatchEvent(
				new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
			);
		});
		await page.locator('.llampart-attachments-view-all-trigger').click();
		assert.match(await all.innerText(), /All attachments \(5\)/);
		await finish(s, 'PNG/JPEG, text, list, View All, remove, drop and paste', { viewAllPreview });
	}

	// Same mounted composer and attachment across provider/source changes and catalog refresh.
	{
		const s = await session('openai-compatible', [true, false]);
		const { page } = s;
		await select(page, 'model-B');
		await openPdf(page);
		const before = await previewState(page, 'model-B', false);
		s.backend.vision = [false, true];
		await page.evaluate(() => aud002.settings.updateConfig('apiProvider', 'vllm'));
		await page.waitForFunction(() => aud002.models.models.length === 2 && !aud002.models.loading);
		await page.evaluate(() => aud002.models.selectModelById('model-B'));
		const providerSwitch = await previewState(page, 'model-B', true);
		s.backend.vision = [true, false];
		await page.evaluate(() =>
			aud002.settings.updateConfig('vllmBaseUrl', 'http://second-synthetic.test')
		);
		await page.waitForFunction(
			() => aud002.models.capabilitySnapshot?.serverBaseUrl === 'http://second-synthetic.test'
		);
		await page.evaluate(() => aud002.models.selectModelById('model-B'));
		const sourceSwitch = await previewState(page, 'model-B', false);
		await page.evaluate(() => aud002.models.clearSelection());
		await page.waitForFunction(() => !aud002.models.selectedModelId);
		assert(!warning.test(await page.getByRole('dialog').innerText()));
		await page.evaluate(() => {
			aud002.models.selectedModelId = 'removed-id';
			aud002.models.selectedModelName = 'removed-model';
		});
		s.backend.ids = ['model-A'];
		await page.evaluate(() => aud002.models.fetch(true));
		await page.evaluate(() => (aud002.calls.length = 0));
		// Force a resolver recomputation with a second stale id after the refresh.
		await page.evaluate(() => (aud002.models.selectedModelId = 'still-removed'));
		await page.evaluate(() => new Promise(requestAnimationFrame));
		assert.deepEqual(await page.evaluate(() => aud002.calls), []);
		assert(!warning.test(await page.getByRole('dialog').innerText()));
		await finish(s, 'provider/source switch, missing and stale selection', {
			before,
			providerSwitch,
			sourceSwitch
		});
	}
} catch (error) {
	if (out) {
		await writeFile(`${out}/failure.txt`, error.stack);
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				await page.screenshot({ path: `${out}/failure.png` });
				await writeFile(
					`${out}/failure-state.json`,
					JSON.stringify(
						await page.evaluate(() => ({
							calls: globalThis.aud002?.calls,
							selectedId: globalThis.aud002?.models.selectedModelId,
							selectedName: globalThis.aud002?.models.selectedModelName,
							models: globalThis.aud002?.models.models,
							messages: globalThis.aud002?.conversations.activeMessages
						})),
						null,
						2
					)
				);
			}
		}
	}
	throw error;
} finally {
	if (out) await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
console.log(
	`PASS: ${results.length} isolated Chromium scenarios; no pageerror, rejection or console error`
);
