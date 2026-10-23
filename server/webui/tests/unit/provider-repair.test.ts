import '../fixtures/verified-backend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPartType } from '$lib/enums';
import {
	connectionProtocol,
	createCapabilitySnapshot
} from '$lib/services/providers/provider-capabilities';
import { getApiProvider } from '$lib/services/providers';
import { buildChatBody } from '$lib/services/providers/openai-chat.protocol';
import {
	buildResponsesBody,
	createResponsesStreamParser
} from '$lib/services/providers/openai-responses.protocol';
import { parseSettingsStorage } from '$lib/utils/settings-schema';
import { ChatService } from '$lib/services/chat.service';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import type { ProviderChatCompletionInput, ProviderRequestContext } from '$lib/types/provider';

const context: ProviderRequestContext = {
	providerId: 'vllm',
	serverBaseUrl: 'http://localhost:8000',
	apiKey: '',
	sourceGeneration: 0
};
const input: ProviderChatCompletionInput = {
	serverBaseUrl: context.serverBaseUrl,
	apiKey: '',
	messages: [{ role: 'user', content: 'hi' }],
	options: { model: 'exact', stream: true }
};
const original = { ...settingsStore.config };
afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.updateMultipleConfig(original);
	modelsStore.clear();
	vi.unstubAllGlobals();
});

describe('automatic protocol contract', () => {
	it.each(['vllm', 'openai-compatible'])(
		'prefers Chat and requires explicit Responses evidence for %s',
		(provider) => {
			expect(connectionProtocol(provider)).toBe('chat-completions');
			expect(
				connectionProtocol(provider, {
					vllmProtocol: 'responses',
					openAiCompatibleProtocol: 'responses'
				})
			).toBe('chat-completions');
			expect(
				connectionProtocol(provider, {
					capabilities: { protocols: ['responses', 'chat-completions'] }
				})
			).toBe('chat-completions');
			expect(connectionProtocol(provider, { capabilities: { protocols: ['responses'] } })).toBe(
				'responses'
			);
			expect(connectionProtocol(provider, { capabilities: { responses: true } })).toBe(
				'chat-completions'
			);
			expect(
				connectionProtocol(provider, { capabilities: { chat_completions: false, responses: true } })
			).toBe('responses');
		}
	);
	it('ignores and removes obsolete saved choices without rejecting legacy storage', () => {
		const settings = parseSettingsStorage(
			JSON.stringify({
				vllmProtocol: 'responses',
				openAiCompatibleProtocol: 'future',
				temperature: 0.7
			})
		);
		expect(settings).not.toHaveProperty('vllmProtocol');
		expect(settings).not.toHaveProperty('openAiCompatibleProtocol');
		expect(settings.temperature).toBe(0.7);
	});
	it('binds selected protocol into identity and uses adapter capabilities rather than manual options', async () => {
		const unknown = await createCapabilitySnapshot(context, 'exact');
		const responses = await createCapabilitySnapshot(context, 'exact', {
			capabilities: { required_protocol: 'responses' }
		});
		expect(responses.connectionIdentity).not.toBe(unknown.connectionIdentity);
		expect(
			getApiProvider('vllm').buildChatCompletionRequest({
				...input,
				options: { ...input.options, protocol: 'responses' }
			}).url
		).toContain('/chat/completions');
		expect(
			getApiProvider('vllm').buildChatCompletionRequest({ ...input, capabilities: responses }).url
		).toContain('/responses');
	});
	it.each([404, 405, 501])(
		'never retries or falls back after unsupported endpoint HTTP %s',
		async (status) => {
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				serverBaseUrl: context.serverBaseUrl,
				apiKey: ''
			});
			const fetch = vi.fn().mockResolvedValue(new Response('Endpoint unavailable', { status }));
			vi.stubGlobal('fetch', fetch);
			const expectedLog = ['Error in sendMessage:', 'HttpError', `Server error (${status}): `];
			const originalError = console.error;
			const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => {
				if (args.length !== expectedLog.length || args.some((arg, i) => arg !== expectedLog[i]))
					originalError(...args);
			});
			await expect(ChatService.sendMessage(input.messages, input.options)).rejects.toMatchObject({
				name: 'HttpError',
				message: `Server error (${status}): `
			});
			expect(errorLog).toHaveBeenCalledExactlyOnceWith(...expectedLog);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(fetch.mock.calls[0][0]).toContain('/chat/completions');
		}
	);
	it.each([404, 405, 501])(
		'does not fall back from explicitly required Responses after HTTP %s',
		async (status) => {
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				serverBaseUrl: context.serverBaseUrl,
				apiKey: ''
			});
			vi.spyOn(modelsStore, 'refreshCapabilities').mockImplementation((ctx, model) =>
				createCapabilitySnapshot(ctx, model ?? null, {
					capabilities: { required_protocol: 'responses' }
				})
			);
			const fetch = vi.fn().mockResolvedValue(new Response('Endpoint unavailable', { status }));
			vi.stubGlobal('fetch', fetch);
			const expectedLog = ['Error in sendMessage:', 'HttpError', `Server error (${status}): `];
			const originalError = console.error;
			const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => {
				if (args.length !== expectedLog.length || args.some((arg, i) => arg !== expectedLog[i]))
					originalError(...args);
			});
			await expect(ChatService.sendMessage(input.messages, input.options)).rejects.toMatchObject({
				name: 'HttpError',
				message: `Server error (${status}): `
			});
			expect(errorLog).toHaveBeenCalledExactlyOnceWith(...expectedLog);
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(fetch.mock.calls[0][0]).toContain('/responses');
		}
	);
});

describe('shared reasoning and explicit custom extensions', () => {
	it('uses only explicit Custom JSON and does not constrain efforts to discovered values', async () => {
		const supported = await createCapabilitySnapshot(context, 'exact', {
			capabilities: { reasoning_effort: { supported: true, values: ['low', 'none'] } }
		});
		const options = {
			...input.options,
			custom: '{"reasoning_effort":"high"}'
		};
		expect(buildChatBody({ ...input, options, capabilities: supported }).reasoning_effort).toBe(
			'high'
		);
		const responses = await createCapabilitySnapshot(context, 'exact', {
			capabilities: {
				required_protocol: 'responses',
				reasoning_effort: { supported: true, values: ['low', 'none'] }
			}
		});
		expect(
			buildResponsesBody({
				...input,
				options: { ...input.options, custom: '{"reasoning":{"effort":"high"}}' },
				capabilities: responses
			}).reasoning
		).toMatchObject({ effort: 'high' });
		expect(
			buildChatBody({
				...input,
				capabilities: supported,
				options: input.options
			}).reasoning_effort
		).toBeUndefined();
		const unsupported = await createCapabilitySnapshot(context, 'exact', {
			capabilities: { reasoning: false, reasoning_effort: false }
		});
		expect(() => buildChatBody({ ...input, options, capabilities: unsupported })).toThrow(
			/not supported/
		);
	});
	it('passes arbitrary flat backend extensions or explicitly rejects confirmed unsupported ones', async () => {
		for (const provider of ['vllm', 'openai-compatible']) {
			const request = getApiProvider(provider).buildChatCompletionRequest({
				...input,
				options: { ...input.options, custom: '{"vendor_flag":{"enabled":true},"top_k":7}' }
			});
			expect(JSON.parse(String(request.init.body))).toMatchObject({
				vendor_flag: { enabled: true },
				top_k: 7
			});
		}
		const capabilities = await createCapabilitySnapshot(context, 'exact', {
			capabilities: { top_k: false }
		});
		expect(() =>
			buildChatBody({
				...input,
				capabilities,
				options: { ...input.options, custom: '{"top_k":7}' }
			})
		).toThrow('top_k');
		expect(() =>
			buildResponsesBody({ ...input, options: { ...input.options, custom: '{"stop":["x"]}' } })
		).toThrow('stop');
		expect(
			buildResponsesBody({
				...input,
				options: { ...input.options, custom: '{"vendor_flag":true}' }
			})
		).toHaveProperty('vendor_flag', true);
	});
});

describe('Responses generation parameters', () => {
	it.each(['presence_penalty', 'frequency_penalty'] as const)(
		'handles neutral, intentional and backend-supported %s without silent loss',
		async (name) => {
			for (const state of [undefined, false, true]) {
				const capabilities = await createCapabilitySnapshot(context, 'exact', {
					capabilities: { required_protocol: 'responses', [name]: state }
				});
				const neutral = buildResponsesBody({
					...input,
					capabilities,
					options: { ...input.options, [name]: 0 }
				});
				if (state === true) expect(neutral[name]).toBe(0);
				else expect(neutral).not.toHaveProperty(name);
				for (const value of [-1, 0.5]) {
					const request = { ...input, capabilities, options: { ...input.options, [name]: value } };
					if (state === true) expect(buildResponsesBody(request)[name]).toBe(value);
					else
						expect(() => buildResponsesBody(request)).toThrow(
							`Responses API does not support ${name}`
						);
				}
				for (const value of [0, 0.5]) {
					const request = {
						...input,
						capabilities,
						options: {
							...input.options,
							[name]: 1,
							custom: JSON.stringify({ [name]: value })
						}
					};
					if (state === true) expect(buildResponsesBody(request)[name]).toBe(value);
					else expect(() => buildResponsesBody(request)).toThrow(name);
				}
			}
			expect(buildResponsesBody(input)).not.toHaveProperty(name);
		}
	);
	it.each(['presence_penalty', 'frequency_penalty'] as const)(
		'validates the schema and declared range for the %s extension',
		async (name) => {
			const capabilities = await createCapabilitySnapshot(context, 'exact', {
				capabilities: { required_protocol: 'responses', [name]: { supported: true, maximum: 1 } }
			});
			for (const value of ['bad', 3, NaN, 1.5])
				expect(() =>
					buildResponsesBody({
						...input,
						capabilities,
						options: { ...input.options, [name]: value } as typeof input.options
					})
				).toThrow();
		}
	);
	it('maps standard Responses fields and leaves Chat-only fields out', () => {
		const body = buildResponsesBody({
			...input,
			options: {
				...input.options,
				temperature: 0.3,
				top_p: 0.9,
				max_tokens: 16,
				custom: '{"top_logprobs":4,"vendor_flag":true}'
			}
		});
		expect(body).toMatchObject({
			temperature: 0.3,
			top_p: 0.9,
			max_output_tokens: 16,
			top_logprobs: 4,
			vendor_flag: true
		});
		for (const name of [
			'max_tokens',
			'messages',
			'stream_options',
			'presence_penalty',
			'frequency_penalty'
		])
			expect(body).not.toHaveProperty(name);
		for (const name of ['stop', 'seed', 'logprobs'])
			expect(() =>
				buildResponsesBody({
					...input,
					options: {
						...input.options,
						custom: JSON.stringify({ [name]: name === 'stop' ? ['x'] : name === 'seed' ? 1 : true })
					}
				})
			).toThrow(name);
	});
	it.each(['model', 'input', 'stream', 'store', 'previous_response_id', 'tools', 'background'])(
		'keeps %s protected even with supported extensions',
		(name) => {
			expect(() =>
				buildResponsesBody({
					...input,
					options: {
						...input.options,
						custom: JSON.stringify({ [name]: 'override' })
					}
				})
			).toThrow('protected');
		}
	);
});

describe('Responses function reconciliation', () => {
	const item = { type: 'function_call', call_id: 'call', name: 'tool', arguments: '{"x":1}' };
	const send = (
		parser: ReturnType<typeof createResponsesStreamParser>,
		type: string,
		extra: Record<string, unknown>
	) => parser(JSON.stringify({ type, ...extra }), type);
	it('retains calls present only in completed output', () => {
		const parser = createResponsesStreamParser();
		expect(
			send(parser, 'response.completed', { response: { status: 'completed', output: [item] } })
				?.toolCalls
		).toEqual([
			{
				index: 0,
				id: 'call',
				type: 'function',
				function: { name: 'tool', arguments: item.arguments }
			}
		]);
		expect(parser('[DONE]')).toBeNull();
	});
	it('reconciles partial arguments once across item.done and completed', () => {
		const parser = createResponsesStreamParser();
		send(parser, 'response.output_item.added', {
			output_index: 0,
			item: { ...item, arguments: '' }
		});
		send(parser, 'response.function_call_arguments.delta', { output_index: 0, delta: '{"x":' });
		expect(
			send(parser, 'response.output_item.done', { output_index: 0, item })?.toolCalls?.[0].function
				?.arguments
		).toBe('1}');
		expect(
			send(parser, 'response.completed', { response: { status: 'completed', output: [item] } })
				?.toolCalls
		).toBeUndefined();
	});
	it('rejects changed IDs, argument corruption and duplicate calls', () => {
		const ids = createResponsesStreamParser();
		send(ids, 'response.output_item.added', {
			output_index: 0,
			item: { ...item, id: 'fc-one', arguments: '' }
		});
		expect(() =>
			send(ids, 'response.function_call_arguments.delta', {
				output_index: 0,
				item_id: 'fc-other',
				delta: '{}'
			})
		).toThrow('ID mismatch');
		const parser = createResponsesStreamParser();
		send(parser, 'response.output_item.added', {
			output_index: 0,
			item: { ...item, arguments: 'bad' }
		});
		expect(() =>
			send(parser, 'response.completed', { response: { status: 'completed', output: [item] } })
		).toThrow('does not match');
		expect(() =>
			send(createResponsesStreamParser(), 'response.completed', {
				response: { status: 'completed', output: [item, item] }
			})
		).toThrow('Duplicate');
	});
});

describe('multimodal unknown versus unsupported', () => {
	it('preserves image and audio input without metadata, but fails explicitly when unsupported', async () => {
		const messages: ProviderChatCompletionInput['messages'] = [
			{
				role: 'user',
				content: [
					{ type: ContentPartType.IMAGE_URL, image_url: { url: 'data:image/png;base64,YQ==' } },
					{ type: ContentPartType.INPUT_AUDIO, input_audio: { data: 'YQ==', format: 'wav' } }
				]
			}
		];
		expect(buildChatBody({ ...input, messages }).messages).toEqual(messages);
		const capabilities = await createCapabilitySnapshot(context, 'exact', {
			capabilities: { audio: false }
		});
		expect(() => buildChatBody({ ...input, messages, capabilities })).toThrow('audio');
	});
	it('unknown model modalities do not disable supported UI representations', () => {
		settingsStore.updateMultipleConfig({ apiProvider: 'openai-compatible' });
		expect(modelsStore.modelSupportsVision('unknown')).toBe(true);
		expect(modelsStore.modelSupportsAudio('unknown')).toBe(true);
		// input_video is a native llama representation, not implemented by generic Chat/Responses.
		expect(modelsStore.modelSupportsVideo('unknown')).toBe(false);
		settingsStore.updateMultipleConfig({ apiProvider: 'llama-server' });
		expect(modelsStore.modelSupportsVision('unknown')).toBe(true);
	});
});
