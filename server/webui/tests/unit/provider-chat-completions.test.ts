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
			messages: [{ role: MessageRole.USER, content: 'hello' }]
		});
		expect(body.top_k).toBeUndefined();
		expect(body.chat_template_kwargs).toBeUndefined();
		expect(body.reasoning_format).toBeUndefined();
		expect(body.return_progress).toBeUndefined();
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
});
