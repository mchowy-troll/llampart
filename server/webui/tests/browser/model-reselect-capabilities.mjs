/** AUD-008: real selector/preview/reasoning controls, fresh Chromium storage, synthetic HTTP only.
 * Set LLAMPART_PLAYWRIGHT_MODULE, LLAMPART_TEST_URL and LLAMPART_TEST_ARTIFACTS.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.LLAMPART_PLAYWRIGHT_MODULE);
const base = process.env.LLAMPART_TEST_URL || 'http://127.0.0.1:42188';
const out = process.env.LLAMPART_TEST_ARTIFACTS;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.LLAMPART_CHROMIUM || '/usr/bin/chromium',
	headless: true,
	args: ['--no-sandbox', '--disable-background-networking']
});
const results = [];
const warning = /selected model does not support vision/i;

function syntheticPdf() {
	const content = 'BT /F1 12 Tf 30 100 Td (AUD-008 synthetic PDF) Tj ET';
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

async function session(provider) {
	const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
	const errors = [],
		payloads = [],
		requests = [];
	const backend = { vision: [false, true], ids: ['model-A', 'model-B'], responses: false };
	await context.addInitScript(
		({ provider }) => {
			globalThis.aud008Rejections = [];
			addEventListener('unhandledrejection', (event) =>
				aud008Rejections.push(String(event.reason))
			);
			localStorage.setItem('llama-webui-migration-v2-done', '1');
			localStorage.setItem('Llampart.aboutDismissedVersion', '2.0.1');
			localStorage.setItem(
				'LlamaCppWebui.config',
				JSON.stringify({
					apiProvider: provider,
					serverBaseUrl: 'http://synthetic.test',
					llamaServerBaseUrl: 'http://synthetic.test',
					openAiCompatibleBaseUrl: 'http://synthetic.test',
					vllmBaseUrl: 'http://synthetic.test',
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
		requests.push({ path: url.pathname + url.search, method: request.method() });
		if (url.pathname.endsWith('/props')) {
			const index = backend.ids.indexOf(url.searchParams.get('model') || backend.ids[0]);
			return route.fulfill({
				json: {
					build_info: 'synthetic-aud-008',
					role: 'router',
					modalities: { vision: backend.vision[index] },
					chat_template_caps: {
						supports_reasoning_effort: true,
						reasoning_effort_values: index === 0 ? ['low'] : ['high']
					},
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
						// vLLM text-only runtime evidence takes precedence over architecture hints.
						...(provider === 'vllm' && index === 0 && backend.vision[index] === false
							? { language_model_only: true }
							: {}),
						capabilities: {
							vision: provider === 'vllm' && index === 0 ? true : backend.vision[index],
							reasoning_effort: { supported: true, values: index === 0 ? ['low'] : ['high'] },
							...(backend.responses ? { required_protocol: 'responses' } : {})
						}
					}))
				}
			});
		if (url.pathname.endsWith('/chat/completions')) {
			const body = request.postDataJSON();
			payloads.push(body);
			return route.fulfill({
				contentType: 'text/event-stream',
				body: `data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: 'AUD-008 OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
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
		globalThis.aud008 = { ...h, discovery: [] };
		const refresh = h.models.refreshCapabilities;
		h.models.refreshCapabilities = function (...args) {
			aud008.discovery.push({ context: args[0], model: args[1] ?? this.selectedModelName });
			return refresh.apply(this, args);
		};
	});
	return { context, page, errors, payloads, requests, backend };
}

async function settle(page, model = 'model-A', vision = 'unsupported') {
	await page.waitForFunction(
		({ model, vision }) =>
			aud008.models.capabilitySnapshot?.model === model &&
			aud008.models.capabilitySnapshot.features.vision.state === vision,
		{ model, vision }
	);
	await page.waitForLoadState('networkidle');
}

async function select(page, model, vision) {
	await page.locator('.llampart-model-selector-trigger').last().click();
	await page.getByRole('option').filter({ hasText: model }).click();
	await settle(page, model, vision);
}

async function preview(page, unsupported) {
	await page
		.locator('.llampart-chat-form-root')
		.getByRole('button', { name: 'Preview aud-008.pdf', exact: true })
		.click();
	await page.locator('.llampart-attachment-pdf-preview-image').waitFor();
	const dialog = page.locator('.llampart-attachment-preview-dialog-content');
	assert.equal(warning.test(await dialog.innerText()), unsupported);
	return dialog;
}

async function reasoning(page, effort) {
	await page.locator('.llampart-reasoning-trigger').click();
	const labels = (await page.getByRole('menuitemradio').allTextContents()).map((label) =>
		label.trim()
	);
	assert.deepEqual(labels, ['Default / Auto', effort]);
	await page.keyboard.press('Escape');
	return labels;
}

async function finish(s, label, observations) {
	assert.deepEqual(s.errors, [], label);
	const rejections = await s.page.evaluate(() => aud008Rejections);
	assert.deepEqual(rejections, [], label);
	results.push({
		label,
		observations,
		requests: s.requests,
		payloads: s.payloads,
		errors: s.errors,
		rejections
	});
	await s.context.close();
}

try {
	for (const provider of ['openai-compatible', 'vllm', 'llama-server']) {
		let baseline;
		for (const reselect of [false, true]) {
			const s = await session(provider);
			const { page } = s;
			// Native router may initially have no selection; always exercise the actual selector.
			await select(page, 'model-A', 'unsupported');
			const beforeReasoning = await reasoning(page, 'Low');
			await page.locator('input[type=file]').first().setInputFiles({
				name: 'aud-008.pdf',
				mimeType: 'application/pdf',
				buffer: syntheticPdf()
			});
			const dialog = await preview(page, true);
			const beforeGeometry = await dialog.boundingBox();
			if (out && reselect) await page.screenshot({ path: `${out}/${provider}-A-before.png` });
			await page.keyboard.press('Escape');
			await page.waitForLoadState('networkidle');
			const beforeOpen = await page.evaluate(() => ({ discoveries: aud008.discovery.length }));
			const requestsBeforeOpen = s.requests.length;
			// Router menu opening already refreshes router metadata and replaces models.
			// Let that independent refresh finish before testing the selection no-op.
			// Control opens the same menu but dismisses it without selecting anything.
			await page.locator('.llampart-model-selector-trigger').last().click();
			await settle(page);
			const mark = await page.evaluate(() => {
				aud008.before = aud008.models.capabilitySnapshot;
				return { snapshot: aud008.before, discoveries: aud008.discovery.length };
			});
			const requestCount = s.requests.length;
			if (reselect) await page.getByRole('option').filter({ hasText: 'model-A' }).click();
			else await page.keyboard.press('Escape');
			await settle(page);
			const same = await page.evaluate(() => ({
				identity: aud008.before === aud008.models.capabilitySnapshot,
				snapshot: aud008.models.capabilitySnapshot,
				discoveries: aud008.discovery.length,
				id: aud008.models.selectedModelId,
				name: aud008.models.selectedModelName
			}));
			assert.equal(same.identity, true, 'A→A preserves object identity');
			assert.equal(same.discoveries, mark.discoveries, 'no redundant discovery');
			assert.equal(s.requests.length, requestCount, 'no redundant HTTP requests');
			assert.equal(same.id, 'model-A');
			assert.equal(same.name, 'model-A');
			assert.deepEqual(same.snapshot, mark.snapshot);
			assert.deepEqual(await reasoning(page, 'Low'), beforeReasoning);
			const afterDialog = await preview(page, true);
			assert.deepEqual(await afterDialog.boundingBox(), beforeGeometry);
			if (out && reselect)
				await page.screenshot({ path: `${out}/${provider}-A-after-reselect.png` });
			await page.keyboard.press('Escape');
			await select(page, 'model-B', 'supported');
			await reasoning(page, 'High');
			await preview(page, false);
			if (out && reselect) await page.screenshot({ path: `${out}/${provider}-B-supported.png` });
			await page.keyboard.press('Escape');
			await select(page, 'model-A', 'unsupported');
			await preview(page, true);
			await page.keyboard.press('Escape');
			await select(page, 'model-B', 'supported');
			await page.locator('textarea').fill('AUD-008 PDF request');
			await page.locator('textarea').press('Enter');
			await page.waitForFunction(() => !aud008.chat.isLoading && location.hash.includes('/chat/'));
			assert.equal(s.payloads.length, 1);
			assert.equal(s.payloads[0].model, 'model-B');
			assert(
				s.payloads[0].messages.some(
					(message) =>
						Array.isArray(message.content) &&
						message.content.some((part) => part.type === 'image_url')
				)
			);
			if (reselect)
				assert.deepEqual(s.payloads[0], baseline, 'actual request body unchanged by A→A');
			else baseline = s.payloads[0];
			await finish(s, `${provider}: ${reselect ? 'reselect' : 'control'}`, {
				mark,
				same,
				menuOpenRefresh: {
					discoveries: mark.discoveries - beforeOpen.discoveries,
					requests: requestCount - requestsBeforeOpen
				},
				beforeGeometry,
				requestHash: createHash('sha256').update(JSON.stringify(s.payloads[0])).digest('hex')
			});
		}
	}

	// Real layout effects, not manual store clear/refresh, own all these rediscoveries.
	{
		const s = await session('openai-compatible');
		const { page } = s;
		await select(page, 'model-A', 'unsupported');
		const changes = [];
		for (const change of ['metadata', 'provider', 'url', 'key', 'protocol']) {
			const before = await page.evaluate(() => {
				aud008.previous = aud008.models.capabilitySnapshot;
				return { snapshot: aud008.previous, sourceKey: aud008.models.modelListSourceKey };
			});
			s.backend.vision[0] = !s.backend.vision[0];
			if (change === 'protocol') s.backend.responses = true;
			await page.evaluate(async (change) => {
				if (change === 'metadata') await aud008.models.fetch(true);
				if (change === 'provider') aud008.settings.updateConfig('apiProvider', 'vllm');
				if (change === 'url')
					aud008.settings.updateConfig('vllmBaseUrl', 'http://second-synthetic.test');
				if (change === 'key') aud008.settings.updateConfig('apiKey', 'second-synthetic-key');
				if (change === 'protocol')
					aud008.settings.config = Object.assign({}, aud008.settings.config, {
						capabilities: { required_protocol: 'responses' }
					});
			}, change);
			await settle(page, 'model-A', s.backend.vision[0] ? 'supported' : 'unsupported');
			const after = await page.evaluate(() => ({
				snapshot: aud008.models.capabilitySnapshot,
				sourceKey: aud008.models.modelListSourceKey,
				sameObject: aud008.previous === aud008.models.capabilitySnapshot
			}));
			assert.equal(after.sameObject, false);
			assert.equal(after.snapshot.model, before.snapshot.model);
			if (change !== 'metadata') {
				assert.notEqual(after.sourceKey, before.sourceKey);
				assert.notEqual(after.snapshot.connectionIdentity, before.snapshot.connectionIdentity);
				assert.notEqual(after.snapshot.sourceGeneration, before.snapshot.sourceGeneration);
			}
			changes.push({ change, before, after });
		}
		// Removing the selected model keeps the existing stale-selection contract; no borrowing B.
		s.backend.ids = ['model-B'];
		await page.evaluate(() => aud008.models.fetch(true));
		await page.waitForFunction(
			() =>
				aud008.models.models.length === 1 &&
				aud008.models.capabilitySnapshot?.features.vision.state === 'unknown'
		);
		const removed = await page.evaluate(() => ({
			selected: aud008.models.selectedModelId,
			snapshot: aud008.models.capabilitySnapshot
		}));
		assert.equal(removed.selected, 'model-A');
		assert.equal(removed.snapshot.model, 'model-A');
		assert.equal(removed.snapshot.features.vision.state, 'unknown');
		await finish(s, 'catalog metadata, provider/URL/key/protocol ownership and removed model', {
			changes,
			removed
		});
	}
} catch (error) {
	if (out) {
		await writeFile(`${out}/failure.txt`, error.stack);
		for (const context of browser.contexts())
			for (const page of context.pages()) {
				await page.screenshot({ path: `${out}/failure.png` });
				await writeFile(
					`${out}/failure-state.json`,
					JSON.stringify(
						await page.evaluate(() => ({
							snapshot: globalThis.aud008?.models.capabilitySnapshot,
							selected: globalThis.aud008?.models.selectedModelId,
							models: globalThis.aud008?.models.models,
							discovery: globalThis.aud008?.discovery
						})),
						null,
						2
					)
				);
			}
	}
	throw error;
} finally {
	if (out) await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
	await browser.close();
}
console.log(
	`PASS: ${results.length} isolated Chromium scenarios; no pageerror, unhandled rejection or console error`
);
