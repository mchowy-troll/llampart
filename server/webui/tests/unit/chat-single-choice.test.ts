import { describe, expect, it } from 'vitest';
import { getApiProvider } from '$lib/services/providers';
import type { ProviderChatCompletionInput, ProviderProtocol } from '$lib/types/provider';

const invalid = [2, 0, -1, 1.5, '1', true, [], {}, NaN, Infinity, undefined];
const invalidJson = ['2', '"1"', 'true', '[]', '{}', '1e999'];

describe.each(['openai-compatible', 'vllm'] as const)('AUD-005 %s single choice', (providerId) => {
	const provider = getApiProvider(providerId);
	function input(
		custom?: string | Record<string, unknown>,
		protocol: ProviderProtocol = 'chat-completions'
	): ProviderChatCompletionInput {
		return {
			serverBaseUrl: 'http://synthetic.invalid',
			apiKey: '',
			messages: [{ role: 'user', content: 'Hello' }],
			options: { model: 'model-a', stream: true, custom },
			capabilities: {
				providerId,
				protocol,
				model: 'model-a',
				serverBaseUrl: 'http://synthetic.invalid',
				sourceGeneration: 0,
				connectionIdentity: 'synthetic',
				features: {}
			}
		};
	}
	const body = (value: ProviderChatCompletionInput) =>
		JSON.parse(String(provider.buildChatCompletionRequest(value).init.body));

	it('does not add n by default, and normalizes null without mutating Custom JSON', () => {
		expect(body(input())).not.toHaveProperty('n');
		for (const custom of [{}, '{}', { n: null }, '{"n":null}']) {
			const value = input(custom);
			const before = structuredClone(value);
			expect(body(value)).not.toHaveProperty('n');
			expect(value).toEqual(before);
		}
		for (const custom of [{ n: 1 }, '{"n":1}']) expect(body(input(custom))).toHaveProperty('n', 1);
	});

	it.each(invalid.map((n) => [n]))('rejects explicit object n=%s', (n) => {
		expect(() => body(input({ n }))).toThrow(/n must be 1 or null/);
	});
	it.each(invalidJson)('rejects textual JSON n=%s', (n) => {
		expect(() => body(input(`{"n":${n}}`))).toThrow(/n must be 1 or null/);
	});
	it('guards runtime direct options too, with intentional Custom precedence', () => {
		for (const n of [2, undefined]) {
			const value = input();
			Object.assign(value.options, { n });
			expect(() => body(value)).toThrow(/n must be 1 or null/);
		}
		for (const n of [1, null]) {
			const value = input();
			Object.assign(value.options, { n });
			if (n === 1) expect(body(value)).toHaveProperty('n', 1);
			else expect(body(value)).not.toHaveProperty('n');
		}
		const value = input({ n: undefined });
		Object.assign(value.options, { n: 1 });
		expect(() => body(value)).toThrow(/n must be 1 or null/);
		value.options.custom = { n: null };
		Object.assign(value.options, { n: 2 });
		expect(body(value)).not.toHaveProperty('n');
	});
	it('retains explicit unsupported capability protection, including null', () => {
		for (const n of [1, null]) {
			const value = input({ n });
			value.capabilities!.features = { n: { state: 'unsupported' } };
			expect(() => body(value)).toThrow(/not supported by this backend\/model: n/);
			value.options.custom = {};
			Object.assign(value.options, { n });
			expect(() => body(value)).toThrow(/not supported by this backend\/model: n/);
		}
	});

	it('keeps Responses unchanged without n, including flat extensions', () => {
		const custom = { temperature: 0.5, custom_extension: { value: true } };
		const value = input(custom, 'responses');
		const expected = {
			model: 'model-a',
			input: [{ role: 'user', content: 'Hello' }],
			store: false,
			stream: true,
			include: ['reasoning.encrypted_content'],
			...custom
		};
		expect(body(value)).toEqual(expected);
	});
	it.each([1, null, 2, undefined])('rejects explicit object or direct Responses n=%s', (n) => {
		const value = input({ n, custom_extension: true }, 'responses');
		expect(() => body(value)).toThrow(/Responses API does not support n/);
		value.options.custom = {};
		Object.assign(value.options, { n });
		expect(() => body(value)).toThrow(/Responses API does not support n/);
	});
	it.each(['1', 'null', '2'])('rejects textual Responses n=%s', (n) => {
		expect(() => body(input(`{"n":${n},"custom_extension":true}`, 'responses'))).toThrow(
			/Responses API does not support n/
		);
	});

	const parse = (delta: Record<string, unknown>, index: Record<string, unknown> = { index: 0 }) =>
		provider.parseChatCompletionStreamData(JSON.stringify({ choices: [{ ...index, delta }] }));
	it.each([{}, { index: 0 }])('preserves all non-stream fields with choice %j', (index) => {
		const tool_calls = [0, 1].map((i) => ({
			id: `call-${i}`,
			type: 'function',
			function: { name: 'lookup', arguments: '{"x":1}' }
		}));
		for (const key of ['reasoning', 'reasoning_content', 'reasoningContent']) {
			expect(
				provider.parseChatCompletionResponse({
					id: 'completion-a',
					model: 'model-a',
					choices: [
						{
							...index,
							message: { content: 'answer', [key]: 'plan', refusal: 'No', tool_calls },
							finish_reason: 'tool_calls'
						}
					],
					usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
				})
			).toMatchObject({
				content: 'answer',
				reasoningContent: 'plan',
				refusal: 'No',
				toolCalls: tool_calls,
				finishReason: 'tool_calls',
				model: 'model-a',
				completionId: 'completion-a',
				status: 'completed',
				usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 }
			});
		}
	});
	it.each([[1], [-1], [0.5], [null], ['0'], [0, 1], [0, 0], []].map((indices) => ({ indices })))(
		'rejects invalid choices in both parsers: $indices',
		({ indices }) => {
			const choices = indices.map((index) => ({
				index,
				delta: { content: 'A', reasoning: 'R' },
				message: { content: 'A' }
			}));
			expect(() => provider.parseChatCompletionResponse({ choices })).toThrow();
			expect(() => provider.parseChatCompletionStreamData(JSON.stringify({ choices }))).toThrow();
		}
	);
	it('preserves role/content/null/reasoning/refusal and independent parallel tool indices', () => {
		expect(parse({ role: 'assistant' }, {})).toMatchObject({ content: undefined });
		expect(parse({ content: 'partial' })).toMatchObject({ content: 'partial' });
		expect(parse({ content: null })).toMatchObject({ content: undefined });
		for (const key of ['reasoning', 'reasoning_content', 'reasoningContent'])
			expect(parse({ [key]: 'plan' })).toMatchObject({ reasoningContent: 'plan' });
		expect(parse({ refusal: 'No' })).toMatchObject({ refusal: 'No' });
		const tool_calls = [0, 1].map((index) => ({
			index,
			id: `call-${index}`,
			type: 'function',
			function: { name: 'lookup', arguments: '{' }
		}));
		expect(parse({ tool_calls })).toMatchObject({ toolCalls: tool_calls });
		expect(parse({ tool_calls: [{ index: 1, function: { arguments: '}' } }] })).toMatchObject({
			toolCalls: [{ index: 1, function: { arguments: '}' } }]
		});
	});
	it.each([{ index: -1 }, { index: 1.5 }, { type: 'other' }, { function: { arguments: {} } }])(
		'rejects malformed tool call %j in stream and non-stream',
		(call) => {
			expect(() => parse({ tool_calls: [call] })).toThrow();
			expect(() =>
				provider.parseChatCompletionResponse({
					choices: [{ index: 0, message: { tool_calls: [call] } }]
				})
			).toThrow();
		}
	);
	it('allows valid usage-only with absent/empty choices, but not empty or invalid usage frames', () => {
		for (const choices of [undefined, []])
			expect(
				provider.parseChatCompletionStreamData(
					JSON.stringify({ choices, usage: { completion_tokens: 1 } })
				)
			).toMatchObject({ usage: { completionTokens: 1 } });
		for (const data of [
			{},
			{ choices: [] },
			{ choices: [], usage: null },
			{ usage: { completion_tokens: -1 } }
		])
			expect(() => provider.parseChatCompletionStreamData(JSON.stringify(data))).toThrow();
		expect(provider.parseChatCompletionStreamData('[DONE]')).toEqual({ done: true });
	});
	it('validates every frame, including after an initial missing index, without shared operation state', () => {
		const first = provider.createStreamParser!('chat-completions');
		const second = provider.createStreamParser!('chat-completions');
		expect(first('{"choices":[{"delta":{"content":"A"}}]}')).toMatchObject({ content: 'A' });
		expect(() => first('{"choices":[{"index":1,"delta":{"reasoning":"B"}}]}')).toThrow();
		expect(second('{"choices":[{"index":0,"delta":{"content":"C"}}]}')).toMatchObject({
			content: 'C'
		});
		expect(second('[DONE]')).toEqual({ done: true });
		// Terminal failure belongs to ChatService, which stops consuming on the first error.
	});
});
