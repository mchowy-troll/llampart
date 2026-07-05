import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { getApiProvider } from '$lib/services/providers';
import { MessageRole } from '$lib/enums';
import { describe, expect, it } from 'vitest';

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
	it('builds OpenAI-compatible chat URLs without duplicating /v1', () => {
		const provider = getApiProvider(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		const request = provider.buildChatCompletionRequest({
			...baseInput,
			serverBaseUrl: 'http://localhost:11434/v1'
		});

		expect(request.url).toBe('http://localhost:11434/v1/chat/completions');
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
		expect(body.chat_template_kwargs).toBeUndefined();
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

		expect(request.url).toBe('http://localhost:8080/v1/chat/completions');
		expect(body.top_k).toBe(40);
		expect(body.return_progress).toBe(true);
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(body.reasoning_control).toBe(true);
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
