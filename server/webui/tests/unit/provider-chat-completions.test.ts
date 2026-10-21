import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { getApiProvider } from '$lib/services/providers';
import { MessageRole } from '$lib/enums';
import type { SettingsChatServiceOptions } from '$lib/types/settings';
import { describe, expect, it } from 'vitest';
import { resolveReasoningCapabilities, resolveReasoning } from '$lib/services/providers/reasoning';
import type { CapabilitySnapshot } from '$lib/types/provider';
import type { ReasoningIntent } from '$lib/types/reasoning';
import { buildChatBody } from '$lib/services/providers/openai-chat.protocol';
import { buildResponsesBody } from '$lib/services/providers/openai-responses.protocol';

function snapshot(
	providerId: CapabilitySnapshot['providerId'],
	values?: string[],
	protocol: CapabilitySnapshot['protocol'] = 'chat-completions',
	metadata?: unknown
): CapabilitySnapshot {
	const caps: CapabilitySnapshot = {
		providerId,
		model: 'model-a',
		serverBaseUrl: 'http://localhost:8080',
		sourceGeneration: 1,
		connectionIdentity: 'source-a',
		protocol,
		features: {
			reasoning: { state: 'supported' },
			reasoning_effort: { state: 'supported', ...(values ? { values } : {}) }
		}
	};
	caps.reasoning = resolveReasoningCapabilities(caps, metadata);
	return caps;
}

const baseInput = {
	apiKey: 'secret-key',
	messages: [{ role: MessageRole.USER, content: 'hello' }],
	options: {
		model: 'gemma4:latest',
		stream: true,
		temperature: 0.7,
		top_p: 0.9,
		max_tokens: 128,
		top_k: 40,
		custom: JSON.stringify({ chat_template_kwargs: { enable_thinking: false } })
	}
};

describe('provider-owned chat completions', () => {
	it.each(['vllm', 'openai-compatible'] as const)(
		'rejects cross-protocol and cross-connection reasoning snapshots for %s',
		(providerId) => {
			const caps = snapshot(providerId, ['brief', 'deep']);
			const input = {
				...baseInput,
				serverBaseUrl: caps.serverBaseUrl,
				capabilities: caps,
				options: {
					model: 'model-a',
					reasoning: { mode: 'effort', value: 'brief' } as ReasoningIntent
				}
			};
			expect(() => buildResponsesBody(input, providerId)).toThrow(/protocol/);
			const responses = snapshot(providerId, ['brief', 'deep'], 'responses');
			expect(() => buildChatBody({ ...input, capabilities: responses }, providerId)).toThrow(
				/protocol/
			);
			for (const change of [
				{ connectionIdentity: 'other-connection' },
				{ sourceGeneration: 2 },
				{ protocol: 'responses' as const }
			]) {
				const contaminated = { ...caps, reasoning: { ...caps.reasoning!, ...change } };
				expect(() =>
					getApiProvider(providerId).buildChatCompletionRequest({
						...input,
						capabilities: contaminated
					})
				).toThrow(/snapshot/);
			}
			expect(() =>
				getApiProvider(providerId).buildChatCompletionRequest({
					...input,
					capabilities: responses,
					options: { model: 'model-a', custom: '{"reasoning_effort":"brief"}' }
				})
			).toThrow(/Responses requires/);
		}
	);
	it.each(['chat-completions', 'responses'] as const)(
		'vLLM confirmed independent toggle and effort never conflict in %s',
		(protocol) => {
			const caps = snapshot('vllm', ['brief', 'deep', 'none'], protocol);
			caps.features = {
				...caps.features,
				enable_thinking: { state: 'supported' },
				chat_template_kwargs: { state: 'supported' }
			};
			caps.reasoning = resolveReasoningCapabilities(caps);
			const make = (options: SettingsChatServiceOptions) =>
				JSON.parse(
					String(
						getApiProvider('vllm').buildChatCompletionRequest({
							...baseInput,
							serverBaseUrl: caps.serverBaseUrl,
							capabilities: caps,
							options: { model: 'model-a', ...options }
						}).init.body
					)
				);
			const effort = make({ reasoning: { mode: 'effort', value: 'deep' } });
			expect(effort.chat_template_kwargs).toEqual({ enable_thinking: true });
			expect(protocol === 'responses' ? effort.reasoning : effort.reasoning_effort).toEqual(
				protocol === 'responses' ? { effort: 'deep' } : 'deep'
			);
			const off = make({ reasoning: { mode: 'off' } });
			expect(off.chat_template_kwargs).toEqual({ enable_thinking: false });
			expect(off).not.toHaveProperty('reasoning_effort');
			expect(off).not.toHaveProperty('reasoning');
			expect(() =>
				make({
					reasoning: { mode: 'effort', value: 'deep' },
					custom: '{"chat_template_kwargs":{"enable_thinking":false}}'
				})
			).toThrow(/conflict/);
			expect(() =>
				make({
					reasoning: { mode: 'effort', value: 'deep' },
					chat_template_kwargs: { enable_thinking: false }
				})
			).toThrow(/Custom JSON/);
		}
	);
	it.each(['vllm', 'openai-compatible'] as const)(
		'only maps Off through explicitly declared none for %s',
		(providerId) => {
			for (const protocol of ['chat-completions', 'responses'] as const) {
				const caps = snapshot(providerId, ['none', 'minimal', 'high'], protocol);
				const body = JSON.parse(
					String(
						getApiProvider(providerId).buildChatCompletionRequest({
							...baseInput,
							serverBaseUrl: caps.serverBaseUrl,
							capabilities: caps,
							options: { model: 'model-a', reasoning: { mode: 'off' } }
						}).init.body
					)
				);
				if (protocol === 'responses') expect(body.reasoning).toEqual({ effort: 'none' });
				else expect(body.reasoning_effort).toBe('none');
				expect(body).not.toHaveProperty('chat_template_kwargs');
			}
		}
	);
	const llamaBody = (options: SettingsChatServiceOptions, capabilities?: CapabilitySnapshot) =>
		JSON.parse(
			String(
				getApiProvider('llama-server').buildChatCompletionRequest({
					...baseInput,
					serverBaseUrl: 'http://localhost:8080',
					options,
					capabilities
				}).init.body
			)
		);

	it.each(['llama-server', 'vllm', 'openai-compatible'] as const)(
		'uses the same resolved choices in real %s JSON requests',
		(providerId) => {
			for (const protocol of providerId === 'llama-server'
				? (['chat-completions'] as const)
				: (['chat-completions', 'responses'] as const)) {
				const capabilities = snapshot(
					providerId,
					['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'custom-level'],
					protocol
				);
				for (const intent of resolveReasoning(capabilities.reasoning!).choices) {
					const resolved = resolveReasoning(capabilities.reasoning!, intent);
					const request = getApiProvider(providerId).buildChatCompletionRequest({
						...baseInput,
						serverBaseUrl: capabilities.serverBaseUrl,
						capabilities,
						options: { model: 'model-a', reasoning: intent }
					});
					const body = JSON.parse(String(request.init.body));
					for (const [key, value] of Object.entries(resolved.parameters))
						expect(body[key]).toEqual(value);
					if (intent.mode === 'default')
						for (const key of ['reasoning', 'reasoning_effort', 'chat_template_kwargs'])
							expect(body).not.toHaveProperty(key);
					for (const key of ['thinking_budget_tokens', 'reasoning_budget'])
						expect(body).not.toHaveProperty(key);
					if (providerId !== 'llama-server')
						expect(body).not.toHaveProperty('chat_template_kwargs');
				}
			}
		}
	);
	it.each(['llama-server', 'vllm', 'openai-compatible'] as const)(
		'does not guess levels, Off or historical aliases for %s',
		(providerId) => {
			for (const values of [undefined, ['low', 'medium', 'xhigh']])
				for (const saved of ['high', 'max']) {
					const capabilities = snapshot(providerId, values);
					expect(() =>
						getApiProvider(providerId).buildChatCompletionRequest({
							...baseInput,
							serverBaseUrl: capabilities.serverBaseUrl,
							capabilities,
							options: {
								model: 'model-a',
								enableThinking: true,
								reasoningEffort: saved as SettingsChatServiceOptions['reasoningEffort']
							}
						})
					).toThrow(/unavailable/);
				}
		}
	);
	it('serializes native enable_thinking without an effort or budget', () => {
		const caps = snapshot('llama-server', undefined, 'chat-completions', {
			chat_template: '{% if enable_thinking %}think{% endif %}'
		});
		for (const mode of ['on', 'off'] as const)
			expect(
				llamaBody({ model: 'model-a', reasoning: { mode } }, caps).chat_template_kwargs
			).toEqual({ enable_thinking: mode === 'on' });
	});
	it('supports reasoning_strength on legacy servers and the canonical alias on caps-aware servers', () => {
		const metadata = {
			chat_template: `{% if reasoning_strength not in ['low', 'xhigh'] %}{{ raise_exception('unsupported') }}{% endif %}`
		};
		for (const modern of [false, true]) {
			const caps = snapshot('llama-server', ['low', 'xhigh'], 'chat-completions', {
				...metadata,
				...(modern ? { chat_template_caps: { supports_reasoning_effort: true } } : {})
			});
			expect(
				llamaBody({ model: 'model-a', reasoning: { mode: 'effort', value: 'xhigh' } }, caps)
					.chat_template_kwargs
			).toEqual({ [modern ? 'reasoning_effort' : 'reasoning_strength']: 'xhigh' });
		}
	});
	it('only exposes vLLM toggle when kwargs and enable_thinking are both declared', () => {
		const caps = snapshot('vllm');
		caps.features = {
			enable_thinking: { state: 'supported' },
			chat_template_kwargs: { state: 'supported' }
		};
		caps.reasoning = resolveReasoningCapabilities(caps);
		const body = JSON.parse(
			String(
				getApiProvider('vllm').buildChatCompletionRequest({
					...baseInput,
					serverBaseUrl: caps.serverBaseUrl,
					capabilities: caps,
					options: {
						model: 'model-a',
						reasoning: { mode: 'off' },
						custom: '{"chat_template_kwargs":{"date":"today"}}'
					}
				}).init.body
			)
		);
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false, date: 'today' });
		expect(body).not.toHaveProperty('reasoning_effort');
	});
	it.each(['llama-server', 'vllm', 'openai-compatible'] as const)(
		'retains conflict protection and rejects stale ownership for %s',
		(providerId) => {
			const caps = snapshot(providerId, ['high']);
			const options = {
				model: 'model-a',
				reasoning: { mode: 'effort', value: 'high' } as ReasoningIntent,
				custom: '{"reasoning_effort":"low"}'
			};
			expect(() =>
				getApiProvider(providerId).buildChatCompletionRequest({
					...baseInput,
					serverBaseUrl: caps.serverBaseUrl,
					capabilities: caps,
					options
				})
			).toThrow(/Reasoning control conflict/);
			expect(() =>
				getApiProvider(providerId).buildChatCompletionRequest({
					...baseInput,
					serverBaseUrl: caps.serverBaseUrl,
					capabilities: caps,
					options: { model: 'model-b' }
				})
			).toThrow(/provider\/model\/source/);
		}
	);
	it('keeps unrelated native kwargs and protects managed Default from custom controls', () => {
		const caps = snapshot('llama-server', ['high']);
		expect(
			llamaBody(
				{
					model: 'model-a',
					reasoning: { mode: 'effort', value: 'high' },
					custom: '{"chat_template_kwargs":{"date":"today"}}'
				},
				caps
			).chat_template_kwargs
		).toEqual({ date: 'today', reasoning_effort: 'high' });
		for (const key of [
			'reasoning_effort',
			'reasoning_strength',
			'enable_thinking',
			'thinking_budget',
			'thinking_budget_tokens'
		]) {
			expect(() =>
				llamaBody(
					{
						model: 'model-a',
						reasoning: { mode: 'default' },
						custom: JSON.stringify({ chat_template_kwargs: { [key]: 'high' } })
					},
					caps
				)
			).toThrow(/Reasoning control conflict/);
		}
	});
	it('builds OpenAI-compatible chat URLs without duplicating /v1', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		const request = provider.buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:11434/v1'
		});

		expect(request.url).toBe('/__llampart/api/openai-compatible/v1/chat/completions');
		expect(request.init.method).toBe('POST');
		expect(request.init.headers).toMatchObject({
			Authorization: 'Bearer secret-key',
			'Content-Type': 'application/json'
		});
	});

	it('keeps OpenAI-compatible chat payload owned and standard', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		const request = provider.buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:11434/v1'
		});
		const body = JSON.parse(String(request.init.body));

		expect(body).toMatchObject({
			model: 'gemma4:latest',
			stream: true,
			temperature: 0.7,
			top_p: 0.9,
			max_tokens: 128,
			messages: [{ role: MessageRole.USER, content: 'hello' }],
			stream_options: { include_usage: true }
		});
		expect(body.top_k).toBeUndefined();
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(body.reasoning_format).toBeUndefined();
		expect(body.return_progress).toBeUndefined();
	});

	it('includes usage stats request for OpenAI-compatible streaming', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		const request = provider.buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:11434/v1'
		});
		const body = JSON.parse(String(request.init.body));

		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
	});

	it('passes OpenAI-compatible tools and tool-call history when provided', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		const tools = [
			{
				type: 'function' as const,
				function: {
					name: 'lookup_weather',
					description: 'Look up weather',
					parameters: {
						type: 'object',
						properties: { city: { type: 'string' } },
						required: ['city']
					}
				}
			}
		];
		const toolCalls = [
			{
				id: 'call_1',
				type: 'function',
				function: { name: 'lookup_weather', arguments: '{"city":"Warsaw"}' }
			}
		];
		const request = provider.buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:11434/v1',
			messages: [
				{ role: MessageRole.USER, content: 'weather in Warsaw' },
				{ role: MessageRole.ASSISTANT, content: '', tool_calls: toolCalls },
				{ role: MessageRole.TOOL, content: 'sunny', tool_call_id: 'call_1' }
			],
			options: { ...baseInput.options, tools }
		});
		const body = JSON.parse(String(request.init.body));

		expect(body.tools).toEqual(tools);
		expect(body.messages[1].tool_calls).toEqual(toolCalls);
		expect(body.messages[2].tool_call_id).toBe('call_1');
	});

	it('keeps llama-server chat payload behavior provider-scoped', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.LLAMA_SERVER);
		const request = provider.buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:8080'
		});
		const body = JSON.parse(String(request.init.body));

		expect(request.url).toBe('/__llampart/api/llama-server/v1/chat/completions');
		expect(body.top_k).toBe(40);
		expect(body.return_progress).toBe(true);
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(body.reasoning_control).toBe(true);
	});

	it('rejects protected custom request keys before merging custom parameters', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.LLAMA_SERVER);

		expect(() =>
			provider.buildChatCompletionRequest({
				...baseInput,
				serverBaseUrl: 'http://localhost:8080',
				options: {
					...baseInput.options,
					custom: JSON.stringify({ stream: false, tools: [{ type: 'function' }] })
				}
			})
		).toThrow(/Custom parameters cannot override protected chat request keys: stream, tools/);
	});

	it('adds stream identity only to llama-server requests', () => {
		const llamaRequest = getApiProvider(API_PROVIDER_IDS.LLAMA_SERVER).buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:8080',
			streamIdentity: 'conversation=chat%2Fone&model=org%2Frepo%2Fmodel&request=one'
		});
		const openAiRequest = getApiProvider(
			API_PROVIDER_IDS.OPENAI_COMPATIBLE
		).buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:11434/v1',
			streamIdentity: 'must-not-be-used'
		});

		expect(llamaRequest.init.headers).toMatchObject({
			'X-Conversation-Id': 'conversation=chat%2Fone&model=org%2Frepo%2Fmodel&request=one'
		});
		expect(openAiRequest.init.headers).not.toHaveProperty('X-Conversation-Id');
	});

	it('parses provider stream chunks through provider adapters', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		const event = provider.parseChatCompletionStreamData(
			JSON.stringify({
				id: 'chatcmpl-1',
				model: 'gemma4:latest',
				choices: [{ delta: { content: 'hi' } }]
			})
		);

		expect(event).toMatchObject({
			completionId: 'chatcmpl-1',
			model: 'gemma4:latest',
			content: 'hi'
		});
		expect(provider.parseChatCompletionStreamData('[DONE]')).toEqual({ done: true });
	});

	it('parses OpenAI-compatible usage from stream chunks and full responses', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);

		expect(
			provider.parseChatCompletionStreamData(
				JSON.stringify({
					id: 'chatcmpl-usage',
					choices: [],
					usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
				})
			)
		).toMatchObject({
			completionId: 'chatcmpl-usage',
			usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 }
		});

		expect(
			provider.parseChatCompletionResponse({
				choices: [{ message: { content: 'answer' } }],
				usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 }
			})
		).toMatchObject({
			content: 'answer',
			usage: { promptTokens: 13, completionTokens: 5, totalTokens: 18 }
		});
	});

	it('parses OpenAI-compatible reasoning content variants from stream chunks', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);

		const reasoningContentEvent = provider.parseChatCompletionStreamData(
			JSON.stringify({
				id: 'chatcmpl-reasoning-content',
				choices: [{ delta: { reasoning_content: '**plan**' } }]
			})
		);
		const reasoningEvent = provider.parseChatCompletionStreamData(
			JSON.stringify({
				id: 'chatcmpl-reasoning',
				choices: [{ delta: { reasoning: '- step' } }]
			})
		);
		const camelReasoningEvent = provider.parseChatCompletionStreamData(
			JSON.stringify({
				id: 'chatcmpl-camel-reasoning',
				choices: [{ delta: { reasoningContent: '## heading' } }]
			})
		);

		expect(reasoningContentEvent?.reasoningContent).toBe('**plan**');
		expect(reasoningEvent?.reasoningContent).toBe('- step');
		expect(camelReasoningEvent?.reasoningContent).toBe('## heading');
	});

	it('parses OpenAI-compatible reasoning content variants from full responses', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);

		expect(
			provider.parseChatCompletionResponse({
				choices: [{ message: { content: 'answer', reasoning_content: '**plan**' } }]
			})
		).toMatchObject({ content: 'answer', reasoningContent: '**plan**' });
		expect(
			provider.parseChatCompletionResponse({
				choices: [{ message: { content: 'answer', reasoning: '- step' } }]
			})
		).toMatchObject({ content: 'answer', reasoningContent: '- step' });
		expect(
			provider.parseChatCompletionResponse({
				choices: [{ message: { content: 'answer', reasoningContent: '## heading' } }]
			})
		).toMatchObject({ content: 'answer', reasoningContent: '## heading' });
	});
});
