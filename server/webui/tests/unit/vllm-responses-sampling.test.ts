import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { getApiProvider } from '$lib/services/providers';
import { buildResponsesBody } from '$lib/services/providers/openai-responses.protocol';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import { ChatService } from '$lib/services/chat.service';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import type { ProviderChatCompletionInput, ProviderRequestContext } from '$lib/types/provider';

const model = 'org/Exact-Model:revision-42';
const context: ProviderRequestContext = {
	providerId: 'vllm',
	serverBaseUrl: 'http://127.0.0.1:8000',
	apiKey: '',
	sourceGeneration: 1,
	protocol: 'responses'
};
const originalSettings = { ...settingsStore.config };
const nativeFetch = globalThis.fetch;

async function makeInput(
	custom: Record<string, unknown> = {},
	features: Record<string, unknown> = {},
	providerId: 'vllm' | 'openai-compatible' = 'vllm',
	protocol: 'responses' | 'chat-completions' = 'responses'
): Promise<ProviderChatCompletionInput> {
	return {
		serverBaseUrl: context.serverBaseUrl,
		apiKey: '',
		messages: [{ role: 'user', content: 'hello' }],
		options: { model, stream: false, custom },
		capabilities: await createCapabilitySnapshot({ ...context, providerId, protocol }, model, {
			capabilities: { required_protocol: protocol, ...features }
		})
	};
}

function request(input: ProviderChatCompletionInput) {
	return getApiProvider(input.capabilities!.providerId).buildChatCompletionRequest(input);
}

function body(input: ProviderChatCompletionInput): Record<string, unknown> {
	return JSON.parse(String(request(input).init.body));
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	settingsStore.updateMultipleConfig(originalSettings);
	modelsStore.clear();
	ChatService.invalidateProviderRequestContexts();
});

describe('AUD-003 vLLM Responses sampling', () => {
	it.each([
		{ stop: 'END' },
		{ stop: ['END', 'STOP'] },
		{ seed: 0 },
		{ seed: 42 },
		{ stop: ['END', 'STOP'], seed: 0 },
		{ seed: Number.MIN_SAFE_INTEGER },
		{ seed: Number.MAX_SAFE_INTEGER },
		{ stop: ['A', 'B', 'C', 'D'] },
		{ stop: [] }
	])('serializes explicit %j flat through the serializer and actual provider', async (custom) => {
		// Exercise the actual Settings Custom JSON string boundary too.
		const input = await makeInput();
		input.options.custom = JSON.stringify(custom);
		const expected = {
			model,
			input: [{ role: 'user', content: 'hello' }],
			store: false,
			stream: false,
			include: ['reasoning.encrypted_content'],
			...custom
		};
		expect(buildResponsesBody(input)).toEqual(expected);
		expect(body(input)).toEqual(expected);
		expect(request(input).url).toBe('/__llampart/api/vllm/v1/responses');
		expect(body(input)).not.toHaveProperty('extra_body');
	});

	it('does not opt in from options or defaults; Custom overrides options without dropping zero', async () => {
		const input = await makeInput();
		expect(body(input)).not.toHaveProperty('stop');
		expect(body(input)).not.toHaveProperty('seed');
		input.options = { ...input.options, seed: 42, stop: ['SETTINGS'] };
		expect(body(input)).not.toHaveProperty('stop');
		expect(body(input)).not.toHaveProperty('seed');
		input.options.custom = { seed: 0, stop: ['CUSTOM'] };
		expect(body(input)).toMatchObject({ seed: 0, stop: ['CUSTOM'] });
	});

	it.each([
		{ seed: '42' },
		{ seed: 0.5 },
		{ seed: Number.MAX_SAFE_INTEGER + 1 },
		{ seed: Number.MIN_SAFE_INTEGER - 1 },
		{ seed: NaN },
		{ seed: Infinity },
		{ seed: -Infinity },
		{ seed: null },
		{ seed: undefined },
		{ stop: 42 },
		{ stop: { value: 'END' } },
		{ stop: ['END', 42] },
		{ stop: ['END', {}] },
		{ stop: ['A', 'B', 'C', 'D', 'E'] },
		{ stop: null },
		{ stop: undefined }
	])('rejects invalid explicit object value %j, never silently omitting it', async (custom) => {
		const input = await makeInput(custom);
		expect(() => buildResponsesBody(input)).toThrow();
		expect(() => request(input)).toThrow();
	});

	it.each(['{"seed":"42"}', '{"seed":1.5}', '{"seed":9223372036854775807}', '{"seed":1e999}'])(
		'rejects invalid or precision-losing JSON %s',
		async (custom) => {
			const input = await makeInput();
			input.options.custom = custom;
			expect(() => request(input)).toThrow();
		}
	);

	it.each(['stop', 'seed'] as const)('respects published unsupported %s', async (key) => {
		const input = await makeInput({ [key]: key === 'stop' ? 'END' : 0 }, { [key]: false });
		expect(input.capabilities!.features[key]).toMatchObject({
			state: 'unsupported',
			source: 'model-metadata'
		});
		expect(() => buildResponsesBody(input)).toThrow(`not supported by this backend/model: ${key}`);
		expect(() => request(input)).toThrow(`not supported by this backend/model: ${key}`);
	});

	it('respects published numeric ranges and enumerated values via the shared validator', async () => {
		for (const seed of [-1, 43]) {
			const input = await makeInput(
				{ seed },
				{ seed: { supported: true, minimum: 0, maximum: 42 } }
			);
			expect(() => request(input)).toThrow("outside this model's range: seed");
		}
		for (const seed of [0, 42])
			expect(
				body(await makeInput({ seed }, { seed: { supported: true, minimum: 0, maximum: 42 } }))
			).toHaveProperty('seed', seed);
		for (const [key, value] of Object.entries({ stop: 'OTHER', seed: 41 })) {
			const input = await makeInput(
				{ [key]: value },
				{ [key]: { supported: true, values: key === 'stop' ? ['END'] : [0, 42] } }
			);
			expect(() => request(input)).toThrow(`Value is not supported by this model: ${key}`);
		}
		expect(
			body(await makeInput({ stop: 'END' }, { stop: { supported: true, values: ['END'] } }))
		).toHaveProperty('stop', 'END');
	});

	it('allows explicit extensions on unknown capabilities without mutating the snapshot', async () => {
		const input = await makeInput({ stop: ['END'], seed: 0 });
		const before = structuredClone(input.capabilities);
		for (const key of ['stop', 'seed'])
			expect(input.capabilities!.features[key]).toEqual({ state: 'unknown' });
		expect(body(input)).toMatchObject({ stop: ['END'], seed: 0 });
		expect(input.capabilities).toEqual(before);
	});

	it.each(['stop', 'seed'] as const)(
		'keeps OpenAI-compatible Responses rejecting %s even if metadata says supported',
		async (key) => {
			const input = await makeInput(
				{ [key]: key === 'stop' ? 'END' : 42 },
				{ [key]: true },
				'openai-compatible'
			);
			expect(() => request(input)).toThrow(
				`Custom parameter is not supported by Responses serialization: ${key}`
			);
		}
	);

	it.each(['vllm', 'openai-compatible'] as const)(
		'preserves logprobs rejection and Chat Completions sampling for %s',
		async (providerId) => {
			const responses = await makeInput({ logprobs: true }, {}, providerId);
			expect(() => request(responses)).toThrow(
				'Custom parameter is not supported by Responses serialization: logprobs'
			);
			const input = await makeInput(
				{ stop: ['END', 'STOP'], seed: 0, logprobs: true },
				{},
				providerId,
				'chat-completions'
			);
			expect(request(input).url).toBe(`/__llampart/api/${providerId}/v1/chat/completions`);
			expect(body(input)).toMatchObject({ model, stop: ['END', 'STOP'], seed: 0, logprobs: true });
			input.options.custom = {};
			input.options.stop = 'OPTIONS';
			input.options.seed = 42;
			expect(body(input)).toMatchObject({ stop: 'OPTIONS', seed: 42 });
		}
	);

	it.each([
		'messages',
		'input',
		'model',
		'stream',
		'tools',
		'store',
		'previous_response_id',
		'background',
		'stream_options',
		'__proto__',
		'constructor',
		'prototype'
	])('still protects Custom JSON key %s', async (key) => {
		const input = await makeInput({ stop: 'END', seed: 42, [key]: false });
		expect(() => request(input)).toThrow(`protected chat request keys: ${key}`);
	});

	it('adds only stop/seed, preserving the remaining Responses and vLLM fields', async () => {
		const custom = {
			top_k: 20,
			min_p: 0.1,
			repetition_penalty: 1.1,
			ignore_eos: true,
			instructions: 'rules',
			text: { format: { type: 'json_object' } },
			temperature: 0.5,
			top_p: 0.8,
			max_output_tokens: 32
		};
		const input = await makeInput(custom);
		const before = body(input);
		input.options.custom = { ...custom, stop: ['END'], seed: 0 };
		expect(body(input)).toEqual({ ...before, stop: ['END'], seed: 0 });
		expect(before).toMatchObject(custom);
	});
	// n/multiple choices (AUD-005) intentionally remains outside this patch.
});

describe('AUD-003 ChatService synthetic HTTP integration (not live vLLM)', () => {
	it('sends flat sampling fields to /v1/responses, parses completion, and blocks unsupported/OpenAI before HTTP', async () => {
		const received: { path: string | undefined; body: unknown }[] = [];
		// Minimal documented Responses completed envelope; no model inference.
		const syntheticResponse = {
			id: 'resp-aud003',
			object: 'response',
			created_at: 0,
			status: 'completed',
			model,
			output: [
				{
					type: 'message',
					id: 'msg-aud003',
					role: 'assistant',
					status: 'completed',
					content: [{ type: 'output_text', text: 'synthetic answer', annotations: [] }]
				}
			],
			usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
		};
		const upstream = createServer(async (req, res) => {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			received.push({ path: req.url, body: JSON.parse(raw) });
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(syntheticResponse));
		});
		upstream.listen(0, '127.0.0.1');
		await once(upstream, 'listening');
		try {
			const address = upstream.address();
			if (!address || typeof address === 'string') throw new Error('Missing mock HTTP address');
			const origin = `http://127.0.0.1:${address.port}`;
			const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
				// Only translate the known same-origin gateway route to our loopback mock.
				expect(String(url)).toBe('/__llampart/api/vllm/v1/responses');
				return nativeFetch(`${origin}/v1/responses`, init);
			});
			vi.stubGlobal('fetch', fetchMock);
			let features: Record<string, unknown> = {};
			vi.spyOn(modelsStore, 'refreshCapabilities').mockImplementation((ctx, selectedModel) =>
				createCapabilitySnapshot(ctx, selectedModel ?? null, {
					capabilities: { required_protocol: 'responses', ...features }
				})
			);
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				serverBaseUrl: origin,
				apiKey: ''
			});
			const onComplete = vi.fn(),
				onError = vi.fn(),
				onProviderResult = vi.fn();
			const options = {
				model,
				stream: false,
				custom: '{"stop":["END","STOP"],"seed":0}',
				onComplete,
				onError,
				onProviderResult
			};
			await ChatService.sendMessage([{ role: 'user', content: 'hello' }], options);
			expect(received).toEqual([
				{
					path: '/v1/responses',
					body: {
						model,
						input: [{ role: 'user', content: 'hello' }],
						store: false,
						stream: false,
						include: ['reasoning.encrypted_content'],
						stop: ['END', 'STOP'],
						seed: 0
					}
				}
			]);
			expect(onComplete).toHaveBeenCalledOnce();
			expect(onComplete.mock.calls[0][0]).toBe('synthetic answer');
			expect(onProviderResult).toHaveBeenCalledWith(
				expect.objectContaining({
					content: 'synthetic answer',
					status: 'completed',
					model,
					usage: expect.objectContaining({ promptTokens: 1, completionTokens: 2, totalTokens: 3 })
				})
			);
			expect(onError).not.toHaveBeenCalled();

			const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			for (const key of ['stop', 'seed']) {
				features = { [key]: false };
				await expect(
					ChatService.sendMessage([{ role: 'user', content: 'hello' }], options)
				).rejects.toThrow(`not supported by this backend/model: ${key}`);
			}
			features = {};
			settingsStore.updateMultipleConfig({
				apiProvider: 'openai-compatible',
				serverBaseUrl: origin,
				apiKey: ''
			});
			for (const custom of ['{"stop":"END"}', '{"seed":42}'])
				await expect(
					ChatService.sendMessage([{ role: 'user', content: 'hello' }], { ...options, custom })
				).rejects.toThrow('Custom parameter is not supported by Responses serialization:');
			expect(fetchMock).toHaveBeenCalledOnce();
			expect(received).toHaveLength(1);
			expect(onComplete).toHaveBeenCalledOnce();
			expect(onError).toHaveBeenCalledTimes(4);
			expect(errorLog).toHaveBeenCalledTimes(4);
			console.info('AUD-003 synthetic HTTP capture:', JSON.stringify(received[0]));
		} finally {
			await new Promise<void>((resolve, reject) =>
				upstream.close((err) => (err ? reject(err) : resolve()))
			);
		}
	});
});
