import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ContentPartType } from '$lib/enums';
import { getApiProvider } from '$lib/services/providers';
import {
	buildChatBody,
	parseChatStream,
	parseChatResponse
} from '$lib/services/providers/openai-chat.protocol';
import {
	buildResponsesBody,
	createResponsesStreamParser,
	parseResponsesResponse
} from '$lib/services/providers/openai-responses.protocol';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import { normalizeVllmUsage } from '$lib/services/providers/vllm.provider';
import { createSourceFingerprint } from '$lib/utils/resumable-stream-state';
import { SseByteParser } from '$lib/utils/sse-byte-parser';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { ChatService } from '$lib/services/chat.service';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';
import type { ProviderChatCompletionInput, ProviderRequestContext } from '$lib/types/provider';
import type { ApiChatMessageData } from '$lib/types/api';

const input: ProviderChatCompletionInput = {
	serverBaseUrl: 'https://example.test/proxy/v1',
	apiKey: 'secret',
	messages: [
		{ role: 'developer', content: 'rules' },
		{ role: 'user', content: 'hello' }
	],
	options: { model: 'org/exact-ID', stream: true }
};
const context: ProviderRequestContext = {
	providerId: 'openai-compatible',
	serverBaseUrl: input.serverBaseUrl,
	apiKey: input.apiKey,
	sourceGeneration: 1,
	protocol: 'responses'
};
const original = { ...settingsStore.config };
afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.updateMultipleConfig(original);
	modelsStore.clear();
	vi.unstubAllGlobals();
	ChatService.invalidateProviderRequestContexts();
});
const event = (
	parser: ReturnType<typeof createResponsesStreamParser>,
	type: string,
	data: Record<string, unknown> = {}
) => parser(JSON.stringify({ type, ...data }), type);
const finalResponse = (status = 'completed', output: unknown[] = []): Record<string, unknown> => ({
	status,
	id: 'resp-1',
	model: 'org/exact-ID',
	output,
	usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
});

describe('Chat Completions protocol', () => {
	it('maps standard parameters, developer, tools, schema and multimodal content without llama flags', async () => {
		const messages: ProviderChatCompletionInput['messages'] = [
			...input.messages,
			{
				role: 'user',
				content: [
					{
						type: ContentPartType.IMAGE_URL,
						image_url: { url: 'data:image/png;base64,YQ==', detail: 'low' }
					}
				]
			}
		];
		const body = buildChatBody({
			...input,
			capabilities: await createCapabilitySnapshot(context, input.options.model!, {
				capabilities: { reasoning_effort: { supported: true, values: ['low'] } }
			}),
			messages,
			options: {
				...input.options,
				max_completion_tokens: 123,
				seed: 0,
				stop: ['end'],
				response_format: { type: 'json_object' },
				tools: [{ type: 'function', function: { name: 'test', parameters: { type: 'object' } } }],
				tool_choice: 'required',
				parallel_tool_calls: false,
				custom: '{"return_progress":true,"top_k":40,"reasoning_effort":"low"}'
			}
		});
		expect(body).toMatchObject({
			max_completion_tokens: 123,
			seed: 0,
			stop: ['end'],
			reasoning_effort: 'low',
			parallel_tool_calls: false,
			tool_choice: 'required',
			response_format: { type: 'json_object' },
			messages
		});
		expect(body).toHaveProperty('return_progress', true);
		expect(body).toHaveProperty('top_k', 40);
	});
	it('handles role-only, usage-only, zero, nullable content, refusal and finish reason', () => {
		expect(
			parseChatStream('{"choices":[{"delta":{"role":"assistant","content":null}}]}').content
		).toBeUndefined();
		expect(
			parseChatStream(
				'{"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}'
			).usage
		).toMatchObject({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0 });
		expect(
			parseChatResponse({
				choices: [{ message: { content: null, refusal: 'No' }, finish_reason: 'content_filter' }]
			})
		).toMatchObject({ content: '', refusal: 'No', finishReason: 'content_filter' });
	});
	it.each([
		'{}',
		'<html>ok</html>',
		'{"error":{"message":"bad"}}',
		'{"choices":[]}',
		'{"choices":[{"delta":{"content":12}}]}'
	])('does not silently swallow malformed event %s', (data) =>
		expect(() => parseChatStream(data)).toThrow()
	);
	it.each(['messages', 'model', 'stream', 'tools', 'previous_response_id', 'store', 'background'])(
		'protects custom key %s',
		(key) =>
			expect(() =>
				buildChatBody({
					...input,
					options: { ...input.options, custom: JSON.stringify({ [key]: false }) }
				})
			).toThrow()
	);
	it('validates conflicting max-token variants and optional parameter types', () => {
		expect(() =>
			buildChatBody({
				...input,
				options: { ...input.options, max_tokens: 12, max_completion_tokens: 13 }
			})
		).toThrow('mutually exclusive');
		expect(() =>
			buildChatBody({ ...input, options: { ...input.options, custom: '{"seed":"bad"}' } })
		).toThrow();
	});
});

describe('capability snapshots and insecure-LAN fingerprint', () => {
	it('does not infer reasoning or vision from a model name or model list', async () => {
		const snapshot = await createCapabilitySnapshot(context, 'gpt-reasoning-vision');
		expect(snapshot.features.reasoning.state).toBe('unknown');
		expect(snapshot.features.vision.state).toBe('unknown');
		expect(snapshot.features.serverProps.state).toBe('unsupported');
		expect(snapshot.protocol).toBe('chat-completions');
		expect(JSON.stringify(snapshot)).not.toContain('secret');
	});
	it('uses explicit per-model metadata, including values/ranges, and filters only confirmed unsupported flags', async () => {
		const capabilities = await createCapabilitySnapshot(context, input.options.model!, {
			capabilities: {
				tools: false,
				max_tokens: false,
				max_completion_tokens: true,
				reasoning_effort: { supported: true, values: ['low'] }
			}
		});
		const body = buildChatBody({
			...input,
			capabilities,
			options: {
				...input.options,
				max_tokens: 20,
				tools: [{ type: 'function', function: { name: 'test', parameters: {} } }],
				custom: '{"reasoning_effort":"low"}'
			}
		});
		expect(body).toHaveProperty('max_completion_tokens', 20);
		expect(body).not.toHaveProperty('tools');
		expect(body).not.toHaveProperty('max_tokens');
		expect(
			buildChatBody({
				...input,
				capabilities,
				options: { ...input.options, custom: '{"reasoning_effort":"high"}' }
			})
		).toHaveProperty('reasoning_effort', 'high');
	});
	it('computes exact SHA-256 without crypto.subtle and preserves shipped llama source identity', async () => {
		vi.stubGlobal('crypto', undefined);
		const llama = {
			...context,
			providerId: 'llama-server' as const,
			protocol: 'chat-completions' as const,
			serverBaseUrl: 'http://192.168.1.6:8080/'
		};
		const expected = createHash('sha256')
			.update(JSON.stringify(['llama-server', 'http://192.168.1.6:8080', 'secret']))
			.digest('hex');
		expect(await createSourceFingerprint(llama)).toBe(`sha256:${expected}`);
		expect(await createSourceFingerprint(context)).not.toBe(
			await createSourceFingerprint({ ...context, apiKey: 'other' })
		);
		expect(await createSourceFingerprint(context)).not.toBe(
			await createSourceFingerprint({ ...context, protocol: 'chat-completions' })
		);
	});
	it('prevents a deferred capability refresh publishing after a connection switch', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'openai-compatible',
			serverBaseUrl: input.serverBaseUrl,
			apiKey: input.apiKey
		});
		const current = ChatService.createProviderRequestContext();
		const pending = modelsStore.refreshCapabilities(current, 'model-a');
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'https://other.test', apiKey: 'other' });
		expect(await pending).toBeNull();
		expect(modelsStore.capabilitySnapshot).toBeNull();
	});
});

describe('stateless Responses protocol', () => {
	it('maps instructions, messages, image, tool calls/results, schema and no stateful fallbacks', async () => {
		const body = buildResponsesBody({
			...input,
			capabilities: await createCapabilitySnapshot(context, input.options.model!, {
				capabilities: {
					required_protocol: 'responses',
					reasoning_effort: { supported: true, values: ['low'] }
				}
			}),
			messages: [
				...input.messages,
				{
					role: 'assistant',
					content: '',
					tool_calls: [
						{ id: 'call-1', type: 'function', function: { name: 'test', arguments: '{}' } }
					]
				},
				{ role: 'tool', content: 'result', tool_call_id: 'call-1' }
			],
			options: {
				...input.options,
				instructions: 'specific',
				max_tokens: 32,
				custom: '{"reasoning":{"effort":"low"}}',
				tools: [{ type: 'function', function: { name: 'test', parameters: { type: 'object' } } }],
				tool_choice: { type: 'function', function: { name: 'test' } },
				response_format: {
					type: 'json_schema',
					json_schema: { name: 'result', schema: { type: 'object' }, strict: true }
				}
			}
		});
		expect(body).toMatchObject({
			store: false,
			instructions: 'specific',
			max_output_tokens: 32,
			include: ['reasoning.encrypted_content'],
			tools: [{ type: 'function', name: 'test' }],
			tool_choice: { type: 'function', name: 'test' },
			text: { format: { type: 'json_schema', name: 'result', strict: true } }
		});
		expect(body.input).toContainEqual({
			type: 'function_call_output',
			call_id: 'call-1',
			output: 'result'
		});
		expect(body).not.toHaveProperty('previous_response_id');
		expect(body).not.toHaveProperty('messages');
	});
	it('replays encrypted reasoning only on exact source, credential, protocol and model binding', async () => {
		const capabilities = await createCapabilitySnapshot(context, input.options.model!, {
			capabilities: { required_protocol: 'responses' }
		});
		const reasoningItems = [
			{ type: 'reasoning', id: 'rs-1', summary: [], encrypted_content: 'opaque' }
		];
		const continuation = {
			providerId: context.providerId,
			protocol: 'responses' as const,
			sourceFingerprint: capabilities.connectionIdentity,
			model: input.options.model!,
			reasoningItems
		};
		const messages = [
			{ role: 'assistant' as const, content: 'prior', providerContinuation: continuation }
		];
		expect(
			(buildResponsesBody({ ...input, messages, capabilities }).input as unknown[])[0]
		).toEqual(reasoningItems[0]);
		const other = await createCapabilitySnapshot(
			{ ...context, apiKey: 'other' },
			input.options.model!,
			{ capabilities: { required_protocol: 'responses' } }
		);
		expect(
			buildResponsesBody({ ...input, messages, capabilities: other }).input
		).not.toContainEqual(reasoningItems[0]);
		expect(buildChatBody({ ...input, messages })).not.toHaveProperty('providerContinuation');
	});
	it('preserves event type and exact byte offsets across every UTF-8 and CRLF split', () => {
		const bytes = new TextEncoder().encode(
			'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"ż🦙"}\r\n\r\n'
		);
		for (let split = 1; split < bytes.length; split++) {
			const parser = new SseByteParser();
			const records = [
				...parser.push(bytes.slice(0, split)),
				...parser.push(bytes.slice(split)),
				...parser.finish()
			];
			expect(records.at(-1)).toMatchObject({
				eventType: 'response.output_text.delta',
				bytesParsed: bytes.length
			});
		}
	});
	it('handles two interleaved function calls independently with exact IDs and arguments', () => {
		const parser = createResponsesStreamParser();
		for (const i of [0, 1])
			expect(
				event(parser, 'response.output_item.added', {
					output_index: i,
					item: { type: 'function_call', call_id: `call-${i}`, name: `tool-${i}`, arguments: '' }
				})?.toolCalls?.[0].index
			).toBe(i);
		for (const i of [1, 0])
			event(parser, 'response.function_call_arguments.delta', { output_index: i, delta: '{}' });
		for (const i of [0, 1])
			event(parser, 'response.function_call_arguments.done', { output_index: i, arguments: '{}' });
		const terminal = event(parser, 'response.completed', {
			response: finalResponse(
				'completed',
				[0, 1].map((i) => ({
					type: 'function_call',
					call_id: `call-${i}`,
					name: `tool-${i}`,
					arguments: '{}'
				}))
			)
		});
		expect(terminal).toMatchObject({
			done: true,
			status: 'completed',
			completionId: 'resp-1',
			usage: { promptTokens: 0, completionTokens: 0 }
		});
		expect(() => event(parser, 'response.output_text.delta', { delta: 'late' })).toThrow(
			'after terminal'
		);
	});
	it.each(['completed', 'incomplete', 'failed', 'cancelled'])(
		'keeps terminal %s distinct',
		(status) => {
			expect(
				event(createResponsesStreamParser(), `response.${status}`, {
					response: finalResponse(status)
				})
			).toMatchObject({ done: true, status });
		}
	);
	it('preserves refusal, summary, opaque reasoning and function output in JSON results', () => {
		expect(
			parseResponsesResponse(
				finalResponse('completed', [
					{
						type: 'reasoning',
						summary: [{ type: 'summary_text', text: 'plan' }],
						encrypted_content: 'opaque'
					},
					{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }
				])
			)
		).toMatchObject({
			content: '',
			refusal: 'No',
			reasoningContent: 'plan',
			reasoningItems: [{ encrypted_content: 'opaque' }]
		});
	});
	it('rejects unknown/malformed events, mismatched event type, argument and final output corruption', () => {
		expect(() => event(createResponsesStreamParser(), 'unknown')).toThrow('Unknown');
		expect(() =>
			event(createResponsesStreamParser(), 'response.function_call_arguments.delta', {
				output_index: 3,
				delta: 'x'
			})
		).toThrow('without');
		expect(() =>
			createResponsesStreamParser()(
				'{"type":"response.output_text.delta","delta":"a"}',
				'response.completed'
			)
		).toThrow('mismatch');
		const parser = createResponsesStreamParser();
		event(parser, 'response.output_text.delta', { delta: 'a' });
		expect(() =>
			event(parser, 'response.completed', { response: finalResponse('completed') })
		).toThrow('does not match');
	});
});

describe('vLLM extensions and honest metrics', () => {
	it('maps supported extensions flat, never under extra_body, while retaining exact model ID', () => {
		const request = getApiProvider('vllm').buildChatCompletionRequest({
			...input,
			options: {
				...input.options,
				top_k: 0,
				min_p: 0.1,
				repeat_penalty: 1.2,
				min_tokens: 2,
				stop_token_ids: [0, 42],
				ignore_eos: false,
				skip_special_tokens: true,
				truncate_prompt_tokens: 2048,
				include_reasoning: true,
				custom:
					'{"chat_template_kwargs":{"enable_thinking":false},"structured_outputs":{"regex":"[a-z]+"}}'
			}
		});
		expect(request.url).toBe('/__llampart/api/vllm/v1/chat/completions');
		const body = JSON.parse(String(request.init.body));
		expect(body).toMatchObject({
			model: 'org/exact-ID',
			repetition_penalty: 1.2,
			top_k: 0,
			min_tokens: 2,
			structured_outputs: { regex: '[a-z]+' },
			chat_template_kwargs: { enable_thinking: false }
		});
		for (const field of ['extra_body', 'repeat_penalty', 'samplers', 'return_progress'])
			expect(body).not.toHaveProperty(field);
	});
	it('rejects invalid extension types, nested extra_body and conflicting structured outputs', () => {
		for (const custom of [
			'{"extra_body":{}}',
			'{"ignore_eos":"yes"}',
			'{"structured_outputs":{"regex":"a","json":{}}}',
			'{"structured_outputs":{"regex":"a"},"response_format":{"type":"json_object"}}'
		])
			expect(() =>
				getApiProvider('vllm').buildChatCompletionRequest({
					...input,
					options: { ...input.options, custom }
				})
			).toThrow();
	});
	it('retains zero values and missing metrics as unavailable, never Prometheus chat estimates', () => {
		const usage = normalizeVllmUsage(
			{ metrics: { time_to_first_token_ms: 0, tokens_per_second: 0 } },
			{ promptTokens: 0, completionTokens: 0 }
		);
		expect(usage?.metrics).toContainEqual({
			name: 'timeToFirstToken',
			value: 0,
			unit: 'ms',
			source: 'backend',
			available: true
		});
		expect(usage?.metrics).toContainEqual({
			name: 'generationTime',
			unit: 'ms',
			source: 'backend',
			available: false
		});
		expect(
			normalizeVllmUsage({ metrics: { queue_time_ms: -1 } })?.metrics?.find(
				(metric) => metric.name === 'queueTime'
			)?.available
		).toBe(false);
	});
	it('uses per-request metrics from Responses terminal event, not stream chunk wall time', () => {
		const parser = getApiProvider('vllm').createStreamParser!('responses');
		const result = parser(
			JSON.stringify({
				type: 'response.completed',
				response: { ...finalResponse(), metrics: { generation_time_ms: 100 } }
			})
		);
		expect(result?.usage?.metrics).toContainEqual({
			name: 'generationTime',
			value: 100,
			unit: 'ms',
			source: 'backend',
			available: true
		});
	});
});

describe.each([
	['llama-server', 'chat-completions'],
	['openai-compatible', 'chat-completions'],
	['vllm', 'chat-completions'],
	['openai-compatible', 'responses'],
	['vllm', 'responses']
] as const)('%s/%s history projection integration', (providerId, protocol) => {
	const call = {
		id: 'call',
		type: 'function' as const,
		function: { name: 'test', arguments: '{}' }
	};
	const prepare = () => {
		settingsStore.updateMultipleConfig({
			apiProvider: providerId,
			serverBaseUrl: 'http://localhost:8000',
			apiKey: ''
		});
		const refresh = vi
			.spyOn(modelsStore, 'refreshCapabilities')
			.mockImplementation((ctx, model) =>
				createCapabilitySnapshot(
					ctx,
					model ?? null,
					protocol === 'responses' ? { capabilities: { required_protocol: 'responses' } } : {}
				)
			);
		return {
			refresh,
			options: {
				model: 'exact',
				stream: false,
				providerRequestContext: ChatService.createProviderRequestContext()
			}
		};
	};

	it.each(['duplicate results', 'duplicate calls', 'incomplete call with actual result'])(
		'rejects %s before fetch without changing history',
		async (kind) => {
			const { refresh, options } = prepare();
			const history: ApiChatMessageData[] = [
				{
					role: 'assistant',
					content: 'text',
					tool_calls:
						kind === 'duplicate calls'
							? [call, structuredClone(call)]
							: kind === 'incomplete call with actual result'
								? [{ ...call, function: { ...call.function, arguments: '{' } }]
								: [call]
				},
				{ role: 'tool', tool_call_id: call.id, content: 'ACTUAL' },
				...(kind === 'duplicate results'
					? [{ role: 'tool' as const, tool_call_id: call.id, content: 'SECOND' }]
					: [])
			];
			const before = structuredClone(history),
				fetch = vi.fn(),
				complete = vi.fn();
			vi.stubGlobal('fetch', fetch);
			await expect(
				ChatService.sendMessage(history, { ...options, onComplete: complete })
			).rejects.toThrow(
				kind === 'incomplete call with actual result'
					? /matching/
					: /Ambiguous tool history: duplicate/
			);
			expect(fetch).not.toHaveBeenCalled();
			expect(refresh).not.toHaveBeenCalled();
			expect(complete).not.toHaveBeenCalled();
			expect(history).toEqual(before);
			if (providerId === 'llama-server') {
				await expect(
					ChatService.preEncode(history, options.providerRequestContext, 'exact')
				).rejects.toThrow();
				expect(fetch).not.toHaveBeenCalled();
			}
		}
	);

	it.each(['two actual results', 'incomplete stopped call', 'historical missing result'])(
		'serializes %s without retry or mutating history',
		async (kind) => {
			const { options } = prepare();
			const history: ApiChatMessageData[] =
				kind === 'two actual results'
					? [
							{ role: 'assistant', content: 'text', tool_calls: [call, { ...call, id: 'second' }] },
							{ role: 'tool', tool_call_id: 'second', content: '' },
							{ role: 'tool', tool_call_id: call.id, content: 'ACTUAL' }
						]
					: [
							{
								role: 'assistant',
								content: 'partial',
								tool_calls: [
									kind === 'incomplete stopped call'
										? { ...call, function: { ...call.function, arguments: '{' } }
										: call
								]
							}
						];
			const before = structuredClone(history);
			const fetch = vi
				.fn()
				.mockResolvedValue(
					new Response(
						JSON.stringify(
							protocol === 'responses'
								? finalResponse('completed', [
										{ type: 'message', content: [{ type: 'output_text', text: 'next' }] }
									])
								: { choices: [{ message: { content: 'next' } }] }
						),
						{ headers: { 'Content-Type': 'application/json' } }
					)
				);
			vi.stubGlobal('fetch', fetch);
			await ChatService.sendMessage(history, options);
			expect(fetch).toHaveBeenCalledTimes(1);
			const body = JSON.parse(fetch.mock.calls[0][1].body);
			const calls =
				protocol === 'responses'
					? body.input
							.filter((item: { type: string }) => item.type === 'function_call')
							.map((item: { call_id: string }) => item.call_id)
					: body.messages.flatMap((item: { tool_calls?: { id: string }[] }) =>
							(item.tool_calls ?? []).map((call) => call.id)
						);
			expect(calls).toEqual(
				kind === 'two actual results'
					? ['call', 'second']
					: kind === 'incomplete stopped call'
						? []
						: ['call']
			);
			const outputs =
				protocol === 'responses'
					? body.input
							.filter((item: { type: string }) => item.type === 'function_call_output')
							.map((item: { call_id: string; output: string }) => ({
								id: item.call_id,
								content: item.output
							}))
					: body.messages
							.filter((item: { role: string }) => item.role === 'tool')
							.map((item: { tool_call_id: string; content: string }) => ({
								id: item.tool_call_id,
								content: item.content
							}));
			if (kind === 'two actual results')
				expect(outputs).toEqual([
					{ id: 'call', content: 'ACTUAL' },
					{ id: 'second', content: '' }
				]);
			else if (kind === 'incomplete stopped call') expect(outputs).toEqual([]);
			else {
				expect(outputs).toHaveLength(1);
				expect(outputs[0].content).toContain('unknown');
			}
			if (protocol === 'responses') expect(body.store).toBe(false);
			expect(history).toEqual(before);
		}
	);
});

describe('stream integration and compatibility', () => {
	it('aggregates interleaved Chat tool deltas without resetting indices on content', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'openai-compatible',
			serverBaseUrl: 'http://localhost:8000',
			apiKey: ''
		});
		const data =
			[
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: 'a',
										type: 'function',
										function: { name: 'test', arguments: '{' }
									}
								]
							}
						}
					]
				},
				{ choices: [{ delta: { content: 'thinking' } }] },
				{
					choices: [
						{
							delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] },
							finish_reason: 'tool_calls'
						}
					]
				}
			]
				.map((item) => `data: ${JSON.stringify(item)}\n\n`)
				.join('') + 'data: [DONE]\n\n';
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(data, { headers: { 'content-type': 'text/event-stream' } }))
		);
		const complete = vi.fn();
		await ChatService.sendMessage(input.messages, {
			model: 'exact',
			stream: true,
			onComplete: complete
		});
		expect(JSON.parse(complete.mock.calls[0][3])).toEqual([
			{ id: 'a', type: 'function', function: { name: 'test', arguments: '{}' } }
		]);
	});
	it('reports failed Responses exactly once without successful completion', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'openai-compatible',
			serverBaseUrl: 'http://localhost:8000',
			apiKey: ''
		});
		vi.spyOn(modelsStore, 'refreshCapabilities').mockImplementation((ctx, model) =>
			createCapabilitySnapshot(ctx, model ?? null, {
				capabilities: { required_protocol: 'responses' }
			})
		);
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					new Response(
						`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: finalResponse('failed') })}\n\n`
					)
				)
		);
		const complete = vi.fn();
		const error = vi.fn();
		const expectedLog = [
			'Error in sendMessage:',
			'ProviderOutcomeError',
			'Provider response failed: failed'
		];
		const originalError = console.error;
		const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => {
			if (args.length !== expectedLog.length || args.some((arg, i) => arg !== expectedLog[i]))
				originalError(...args);
		});
		await expect(
			ChatService.sendMessage(input.messages, {
				model: 'exact',
				stream: true,
				onComplete: complete,
				onError: error
			})
		).rejects.toMatchObject({
			name: 'ProviderOutcomeError',
			message: 'Provider response failed: failed'
		});
		expect(errorLog).toHaveBeenCalledExactlyOnceWith(...expectedLog);
		expect(complete).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'ProviderOutcomeError',
				message: 'Provider response failed: failed'
			})
		);
	});
	it('exports V2 without connection-bound continuation/telemetry and still reads V1', () => {
		const continuation = {
			providerId: context.providerId,
			protocol: 'responses' as const,
			sourceFingerprint: 'sha256:' + 'a'.repeat(64),
			model: 'exact',
			reasoningItems: [{ type: 'reasoning', encrypted_content: 'opaque' }]
		};
		const exported = createConversationExportEnvelope(
			[
				{
					conv: { id: 'c', name: 'c', currNode: null, lastModified: 1 },
					messages: [
						{
							id: 'm',
							convId: 'c',
							role: 'assistant',
							type: 'text',
							content: 'text',
							timestamp: 1,
							parent: null,
							children: [],
							toolCalls: '',
							providerContinuation: continuation,
							timings: { predicted_n: 0, provider: { usage: { completionTokens: 0 } } }
						}
					]
				}
			],
			'1.9.0'
		);
		expect(exported.formatVersion).toBe(2);
		expect(JSON.stringify(exported)).not.toContain('opaque');
		expect(JSON.stringify(exported)).not.toContain('provider');
		expect(parseConversationImport(exported)[0].messages[0].content).toBe('text');
		expect(parseConversationImport({ ...exported, formatVersion: 1 })[0].messages[0].content).toBe(
			'text'
		);
	});
});
