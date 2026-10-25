import { describe, expect, it } from 'vitest';
import { llamaServerProvider as provider } from '$lib/services/providers/llama-server.provider';
import { LlamaServerBackendError } from '$lib/services/providers/llama-server-response';

const parse = provider.parseChatCompletionStreamData;

describe('llama-server response validation (AUD-004)', () => {
	it.each([
		'{"choices":[{"delta":{}}]}',
		'{"choices":[{"delta":{"role":"assistant"}}]}',
		'{"choices":[{"delta":{},"finish_reason":"stop"}]}',
		'{"choices":[{"delta":{"content":""},"finish_reason":null}]}',
		'{"choices":[{"delta":{"content":"ok","extension":{"anything":true}},"logprobs":{"content":[]}}],"created":1,"system_fingerprint":"synthetic","__verbose":{"stop":false}}'
	])('keeps valid empty, role-only, terminal and extended chunks: %s', (data) => {
		expect(() => parse(data)).not.toThrow();
	});
	it('preserves content, reasoning, model and completion ID', () => {
		expect(
			parse(
				'{"id":"chat-1","model":"synthetic","choices":[{"delta":{"reasoning_content":"plan"}}]}'
			)
		).toMatchObject({
			reasoningContent: 'plan',
			completionId: 'chat-1',
			model: 'synthetic'
		});
		expect(parse('{"choices":[{"delta":{"model":"routed","content":"żółć"}}]}')).toMatchObject({
			content: 'żółć',
			model: 'routed'
		});
	});
	it('allows fragmented function names and arguments without requiring a complete call', () => {
		expect(
			parse(
				'{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"look","arguments":"{\\"q\\":"}}]}}]}'
			)
		).toMatchObject({
			toolCalls: [
				{ index: 0, id: 'call-1', type: 'function', function: { name: 'look', arguments: '{"q":' } }
			]
		});
		expect(
			parse('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}')
		).toMatchObject({
			toolCalls: [{ index: 0, function: { arguments: '1}' } }]
		});
	});
	it.each([
		'{"timings":{"prompt_n":20,"predicted_n":4,"predicted_ms":5,"draft_n":8,"draft_n_accepted":4}}',
		'{"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":4,"total_tokens":24},"timings":{"predicted_n":4}}',
		'{"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}'
	])('keeps identified auxiliary records, including without choices: %s', (data) => {
		expect(() => parse(data)).not.toThrow();
	});
	it('does not lose timings or prompt progress', () => {
		expect(
			parse(
				'{"timings":{"prompt_n":20,"extension":true},"prompt_progress":{"total":20,"cache":2,"processed":10,"time_ms":3}}'
			)
		).toMatchObject({
			timings: { prompt_n: 20, extension: true },
			promptProgress: { total: 20, cache: 2, processed: 10, time_ms: 3 }
		});
	});
	it.each([
		'null',
		'[]',
		'{}',
		'{"id":"metadata-only","model":"synthetic"}',
		'{"choices":[]}',
		'{"choices":{}}',
		'{"choices":[null]}',
		'{"choices":[{}]}',
		'{"choices":[{"delta":null}]}',
		'{"choices":[{"delta":{"content":42}}]}',
		'{"choices":[{"delta":{"reasoning_content":{}}}]}',
		'{"choices":[{"delta":{"model":false}}]}',
		'{"choices":[{"delta":{},"message":false}]}',
		'{"choices":[{"delta":{},"finish_reason":42}]}',
		'{"choices":[{"delta":{},"index":"0"}]}',
		'{"choices":[{"delta":{},"model":12}]}',
		'{"choices":[{"delta":{"tool_calls":{}}}]}',
		'{"choices":[{"delta":{"tool_calls":[null]}}]}',
		'{"choices":[{"delta":{"tool_calls":[{"index":-1}]}}]}',
		'{"choices":[{"delta":{"tool_calls":[{"id":3}]}}]}',
		'{"choices":[{"delta":{"tool_calls":[{"type":"unknown"}]}}]}',
		'{"choices":[{"delta":{"tool_calls":[{"function":[]}]}}]}',
		'{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":{}}}]}}]}',
		'{"choices":[{"delta":{}}],"id":42}',
		'{"choices":[{"delta":{}}],"model":{}}',
		'{"timings":[]}',
		'{"timings":{}}',
		'{"timings":{"predicted_n":"4"}}',
		'{"prompt_progress":{"total":"20","cache":2,"processed":10,"time_ms":3}}',
		'{"prompt_progress":null}',
		'{"usage":[]}',
		'{"usage":{}}',
		'{"choices":[],"usage":null}',
		'{"error":null}',
		'{"error":{}}'
	])('rejects unidentified or malformed structures: %s', (data) => {
		expect(() => parse(data)).toThrow();
	});
	it('rejects malformed JSON separately from an error envelope', () => {
		expect(() => parse('{broken')).toThrow(SyntaxError);
	});
	it('gives an error envelope precedence over apparently valid choices', () => {
		expect(() =>
			parse(
				'{"error":{"code":500,"message":"failure","type":"server_error"},"choices":[{"delta":{"content":"must not publish"}}]}'
			)
		).toThrow(LlamaServerBackendError);
	});
	it('exposes only safe diagnostics, never the raw backend message or envelope', () => {
		let error: unknown;
		try {
			parse(
				'{"error":{"code":500,"type":"server_error","message":"Authorization: Bearer synthetic-secret","api_key":"another-secret"}}'
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(LlamaServerBackendError);
		expect(error).toMatchObject({ code: 500, backendType: 'server_error' });
		expect(String(error)).toBe(
			'LlamaServerBackendError: llama-server reported an error (server_error, code 500)'
		);
		expect(JSON.stringify(error)).not.toMatch(/secret|Authorization/);
	});
	it('does not echo an unrecognized free-form error type', () => {
		expect(() => parse('{"error":{"message":"failure","type":"credential-echo"}}')).toThrow(
			'llama-server reported an error (backend_error)'
		);
	});
	it.each([
		{
			choices: [{ message: { role: 'assistant', content: 'answer', reasoning_content: 'plan' } }],
			model: 'synthetic'
		},
		{
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }
						]
					}
				}
			]
		},
		{ choices: [{ message: { content: '' } }] }
	])('accepts proper non-stream completions: %j', (data) => {
		expect(() => provider.parseChatCompletionResponse(data)).not.toThrow();
	});
	it.each([
		null,
		{},
		{ choices: [] },
		{ choices: {} },
		{ choices: [{ message: null }] },
		{ choices: [{ message: { content: [] } }] },
		{ choices: [{ message: { tool_calls: 'bad' } }] }
	])('rejects malformed non-stream completions: %j', (data) => {
		expect(() => provider.parseChatCompletionResponse(data)).toThrow();
	});
	it('rejects an HTTP-200-style non-stream error envelope', () => {
		expect(() =>
			provider.parseChatCompletionResponse({
				error: { code: 400, type: 'invalid_request_error', message: 'failure' }
			})
		).toThrow(LlamaServerBackendError);
	});
});
