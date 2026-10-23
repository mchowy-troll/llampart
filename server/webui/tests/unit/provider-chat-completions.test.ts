import { describe, expect, it } from 'vitest';
import { getApiProvider } from '$lib/services/providers';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import type { ProviderChatCompletionInput, ProviderProtocol } from '$lib/types/provider';
import type { ApiProviderId } from '$lib/constants/api-providers';

const matrix: [ApiProviderId, ProviderProtocol][] = [
	['llama-server', 'chat-completions'],
	['vllm', 'chat-completions'],
	['openai-compatible', 'chat-completions'],
	['vllm', 'responses'],
	['openai-compatible', 'responses']
];
const controlKeys = [
	'reasoning_effort',
	'reasoning',
	'reasoning_strength',
	'enable_thinking',
	'chat_template_kwargs',
	'thinking_budget',
	'thinking_budget_tokens',
	'reasoning_budget',
	'reasoning_control',
	'reasoning_format',
	'include_reasoning'
];

describe.each(matrix)('backend-owned reasoning %s/%s', (providerId, protocol) => {
	const provider = getApiProvider(providerId);
	const input: ProviderChatCompletionInput = {
		serverBaseUrl: 'http://synthetic.invalid',
		apiKey: 'synthetic',
		capabilities: {
			providerId,
			serverBaseUrl: 'http://synthetic.invalid',
			model: 'exact',
			protocol,
			sourceGeneration: 1,
			connectionIdentity: 'synthetic',
			features: {}
		},
		messages: [{ role: 'user', content: 'synthetic' }],
		options: { model: 'exact', stream: true, protocol }
	};
	const body = (custom?: string, extra: Partial<ProviderChatCompletionInput> = {}) =>
		JSON.parse(
			String(
				provider.buildChatCompletionRequest({
					...input,
					...extra,
					options: { ...input.options, ...extra.options, custom }
				}).init.body
			)
		);
	it('does not inject any generation controls, even from legacy runtime options', () => {
		const options = {
			...input.options,
			reasoning: { mode: 'off' },
			enableThinking: false,
			reasoningEffort: 'high',
			reasoning_effort: 'high',
			disableReasoningParsing: true
		};
		const request = body(undefined, { options });
		for (const key of controlKeys) expect(request).not.toHaveProperty(key);
		if (protocol === 'responses') expect(request.include).toEqual(['reasoning.encrypted_content']);
	});
	it('passes explicit protocol-correct effort without trusting a discovered value list', async () => {
		const capabilities = await createCapabilitySnapshot(
			{ providerId, serverBaseUrl: input.serverBaseUrl, apiKey: input.apiKey, sourceGeneration: 1 },
			'exact',
			{
				capabilities: {
					required_protocol: protocol,
					reasoning_effort: { supported: true, values: ['low'] }
				}
			}
		);
		const custom =
			protocol === 'responses'
				? { reasoning: { effort: 'future-level' } }
				: { reasoning_effort: 'future-level' };
		expect(body(JSON.stringify(custom), { capabilities })).toMatchObject(custom);
	});
	it.each([
		'{broken',
		'[]',
		'"text"',
		'{"reasoning_effort":5}',
		'{"chat_template_kwargs":null}',
		'{"chat_template_kwargs":{"enable_thinking":"false"}}',
		'{"thinking_budget":-1}',
		'{"thinking_budget_tokens":1.5}',
		'{"model":"override"}',
		'{"messages":[]}',
		'{"reasoning_effort":"low","chat_template_kwargs":{"reasoning_strength":"high"}}'
	])('rejects malformed/conflicting/protected JSON %s', (custom) => {
		expect(() => body(custom)).toThrow();
	});
	it('rejects the other protocol representation', () => {
		expect(() =>
			body(
				protocol === 'responses' ? '{"reasoning_effort":"low"}' : '{"reasoning":{"effort":"low"}}'
			)
		).toThrow();
	});
	it('preserves unrelated Custom JSON', () => {
		expect(body('{"vendor_flag":true}')).toHaveProperty('vendor_flag', true);
	});
	it('keeps request identity and stream headers provider-scoped', () => {
		const request = provider.buildChatCompletionRequest({
			...input,
			streamIdentity: 'synthetic-stream'
		});
		expect(request.url).toContain(`/api/${providerId}/`);
		expect(request.init.headers).toMatchObject({ Authorization: 'Bearer synthetic' });
		if (providerId === 'llama-server')
			expect(request.init.headers).toHaveProperty('X-Conversation-Id', 'synthetic-stream');
		else expect(request.init.headers).not.toHaveProperty('X-Conversation-Id');
	});
	it('rejects a capability snapshot owned by another model', async () => {
		const capabilities = await createCapabilitySnapshot(
			{ providerId, serverBaseUrl: input.serverBaseUrl, apiKey: '', sourceGeneration: 1 },
			'other'
		);
		expect(() => body(undefined, { capabilities })).toThrow(/belong/);
	});
});

describe.each(['llama-server', 'vllm', 'openai-compatible'])('reasoning reception %s', (id) => {
	const provider = getApiProvider(id);
	const keys =
		id === 'llama-server'
			? ['reasoning_content']
			: ['reasoning', 'reasoning_content', 'reasoningContent'];
	it.each(keys)('preserves %s in both SSE and JSON, including reasoning-only chunks', (key) => {
		const stream =
			provider.createStreamParser?.('chat-completions') ?? provider.parseChatCompletionStreamData;
		expect(
			stream(JSON.stringify({ choices: [{ index: 0, delta: { [key]: 'plan ' } }] }))
		).toMatchObject({ reasoningContent: 'plan ' });
		expect(
			stream(JSON.stringify({ choices: [{ index: 0, delta: { content: 'answer' } }] }))
		).toMatchObject({ content: 'answer' });
		expect(
			provider.parseChatCompletionResponse({
				choices: [{ index: 0, message: { role: 'assistant', content: 'answer', [key]: 'plan' } }]
			})
		).toMatchObject({ content: 'answer', reasoningContent: 'plan' });
	});
});
