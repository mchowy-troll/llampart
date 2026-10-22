import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ChatService } from '$lib/services/chat.service';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { ToolSource } from '$lib/enums';
import type { SettingsChatServiceOptions } from '$lib/types/settings';

const originalSettings = { ...settingsStore.config };
const nativeFetch = globalThis.fetch;
const messages = [{ role: 'user' as const, content: 'Hello' }];
const frame = (delta: Record<string, unknown>, index: number | undefined = 0) => ({
	choices: [{ index, delta }]
});
const sse = (frames: unknown[]) =>
	frames.map((data) => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n';
const tool = (index = 0, args = '{"city":') => ({
	index,
	id: `call-${index}`,
	type: 'function',
	function: { name: 'lookup', arguments: args }
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	settingsStore.updateMultipleConfig(originalSettings);
	modelsStore.clear();
	ChatService.invalidateProviderRequestContexts();
});

describe.each(['openai-compatible', 'vllm'] as const)(
	'AUD-005 %s ChatService/HTTP',
	(providerId) => {
		beforeEach(() => {
			settingsStore.updateMultipleConfig({
				apiProvider: providerId,
				serverBaseUrl: 'http://synthetic.invalid',
				apiKey: ''
			});
			vi.spyOn(modelsStore, 'refreshCapabilities').mockImplementation((context, model) =>
				createCapabilitySnapshot(context, model ?? null, {
					capabilities: { required_protocol: 'chat-completions' }
				})
			);
			vi.spyOn(console, 'error').mockImplementation(() => undefined);
		});
		function callbacks() {
			return {
				onChunk: vi.fn(),
				onReasoningChunk: vi.fn(),
				onToolCallChunk: vi.fn(),
				onProviderResult: vi.fn(),
				onStreamCheckpoint: vi.fn(),
				onComplete: vi.fn(),
				onError: vi.fn()
			};
		}
		function transport(data: string, stream = true) {
			const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
				async () =>
					new Response(data, {
						headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' }
					})
			);
			vi.stubGlobal('fetch', fetch);
			return fetch;
		}
		const send = (options: SettingsChatServiceOptions) =>
			ChatService.sendMessage(messages, { model: 'model-a', stream: true, ...options });

		it.each([true, false])('rejects n:2 before any generation HTTP (stream=%s)', async (stream) => {
			const fetch = transport('');
			for (const custom of ['{"n":2}', { n: 2 }, { n: undefined }]) {
				const cb = callbacks();
				await expect(send({ ...cb, stream, custom })).rejects.toThrow(/n must be 1 or null/);
				expect(cb.onError).toHaveBeenCalledOnce();
				expect(cb.onComplete).not.toHaveBeenCalled();
				expect(cb.onProviderResult).not.toHaveBeenCalled();
			}
			expect(fetch).not.toHaveBeenCalled();
		});
		it('rejects every explicit Responses n before HTTP, including null and 1', async () => {
			vi.mocked(modelsStore.refreshCapabilities).mockImplementation((context, model) =>
				createCapabilitySnapshot(context, model ?? null, {
					capabilities: { required_protocol: 'responses' }
				})
			);
			const fetch = transport('');
			for (const n of [1, null, 2, undefined, true, '1', [], {}, NaN, Infinity]) {
				const cb = callbacks();
				await expect(send({ ...cb, custom: { n } })).rejects.toThrow(
					/Responses API does not support n/
				);
				expect(cb.onError).toHaveBeenCalledOnce();
				expect(cb.onComplete).not.toHaveBeenCalled();
			}
			expect(fetch).not.toHaveBeenCalled();
		});
		it.each(['content', 'reasoning', 'reasoning_content', 'tool_calls'])(
			'fails terminally on index switch after valid %s, ignoring following DONE',
			async (key) => {
				const first = key === 'tool_calls' ? [tool()] : 'A';
				const second = key === 'tool_calls' ? [{ index: 0, function: { arguments: '"B"}' } }] : 'B';
				const fetch = transport(sse([frame({ [key]: first }), frame({ [key]: second }, 1)]));
				const cb = callbacks();
				await expect(send(cb)).rejects.toMatchObject({
					name: 'StreamProtocolError',
					cause: expect.any(Error)
				});
				expect(cb.onError).toHaveBeenCalledExactlyOnceWith(
					expect.objectContaining({ name: 'StreamProtocolError' })
				);
				expect(cb.onComplete).not.toHaveBeenCalled();
				expect(cb.onProviderResult).toHaveBeenCalledOnce();
				expect(cb.onStreamCheckpoint).toHaveBeenCalledOnce();
				if (key === 'tool_calls') {
					expect(cb.onToolCallChunk).toHaveBeenCalledOnce();
					expect(JSON.parse(cb.onToolCallChunk.mock.calls[0][0])).toEqual([
						{
							id: 'call-0',
							type: 'function',
							function: { name: 'lookup', arguments: '{"city":' }
						}
					]);
				} else if (key === 'content') expect(cb.onChunk).toHaveBeenCalledExactlyOnceWith('A');
				else expect(cb.onReasoningChunk).toHaveBeenCalledExactlyOnceWith('A');
				expect(fetch).toHaveBeenCalledOnce();
			}
		);
		it.each([0, 1])(
			'rejects two choices atomically (second index=%s), even with usage and DONE',
			async (index) => {
				const fetch = transport(
					sse([
						{
							choices: [
								frame({ content: 'A', tool_calls: [tool()] }).choices[0],
								frame({ content: 'B' }, index).choices[0]
							],
							usage: { completion_tokens: 1 }
						}
					])
				);
				const cb = callbacks();
				await expect(send(cb)).rejects.toMatchObject({ name: 'StreamProtocolError' });
				expect(cb.onError).toHaveBeenCalledOnce();
				for (const callback of [
					cb.onComplete,
					cb.onChunk,
					cb.onToolCallChunk,
					cb.onProviderResult,
					cb.onStreamCheckpoint
				])
					expect(callback).not.toHaveBeenCalled();
				expect(fetch).toHaveBeenCalledOnce();
			}
		);
		it('completes valid interleaved parallel tools, reasoning, content, usage and DONE once', async () => {
			const fetch = transport(
				sse([
					{ choices: [{ delta: { role: 'assistant', content: null } }] },
					frame({ reasoning: 'plan ' }),
					frame({ reasoning_content: 'more' }),
					frame({ content: 'Hello' }),
					frame({ tool_calls: [tool(0), tool(1)] }),
					frame({ tool_calls: [{ index: 1, function: { arguments: '"Paris"}' } }] }),
					frame({ tool_calls: [{ index: 0, function: { arguments: '"Warsaw"}' } }] }),
					{ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
					{ choices: [], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }
				])
			);
			const cb = callbacks();
			await expect(send(cb)).resolves.toBeUndefined();
			expect(cb.onComplete).toHaveBeenCalledOnce();
			expect(cb.onError).not.toHaveBeenCalled();
			expect(cb.onComplete.mock.calls[0].slice(0, 2)).toEqual(['Hello', 'plan more']);
			expect(cb.onComplete.mock.calls[0][2]).toMatchObject({
				provider: { finishReason: 'tool_calls', usage: { promptTokens: 2, completionTokens: 3 } }
			});
			expect(JSON.parse(cb.onComplete.mock.calls[0][3])).toEqual([
				{
					id: 'call-0',
					type: 'function',
					function: { name: 'lookup', arguments: '{"city":"Warsaw"}' }
				},
				{
					id: 'call-1',
					type: 'function',
					function: { name: 'lookup', arguments: '{"city":"Paris"}' }
				}
			]);
			expect(fetch).toHaveBeenCalledOnce();
			expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).not.toHaveProperty('n');
		});
		it('isolates a failed operation from a later successful operation', async () => {
			const fetch = transport(sse([frame({ content: 'bad' }, 1)]));
			const failed = callbacks();
			await expect(send(failed)).rejects.toMatchObject({ name: 'StreamProtocolError' });
			fetch.mockResolvedValueOnce(new Response(sse([frame({ content: 'OK' })])));
			const success = callbacks();
			await send(success);
			expect(success.onComplete).toHaveBeenCalledOnce();
			expect(success.onComplete.mock.calls[0][0]).toBe('OK');
			expect(success.onError).not.toHaveBeenCalled();
			expect(failed.onError).toHaveBeenCalledOnce();
			expect(failed.onComplete).not.toHaveBeenCalled();
			expect(fetch).toHaveBeenCalledTimes(2);
		});
		it.each([[0, 1], [0, 0], [1]].map((indices) => ({ indices })))(
			'rejects non-stream indices $indices before callbacks/finalization',
			async ({ indices }) => {
				const fetch = transport(
					JSON.stringify({
						choices: indices.map((index) => ({
							index,
							message: { content: 'answer', tool_calls: [tool(0, '{}')] }
						}))
					}),
					false
				);
				const cb = callbacks();
				await expect(send({ ...cb, stream: false })).rejects.toBeInstanceOf(Error);
				expect(cb.onError).toHaveBeenCalledOnce();
				expect(cb.onComplete).not.toHaveBeenCalled();
				expect(cb.onToolCallChunk).not.toHaveBeenCalled();
				expect(cb.onProviderResult).not.toHaveBeenCalled();
				expect(fetch).toHaveBeenCalledOnce();
			}
		);
		it('preserves the original failure if async onError itself rejects (no detached Promise)', async () => {
			transport(sse([frame({ content: 'bad' }, 1)]));
			const onError = vi.fn().mockRejectedValue(new Error('callback failed'));
			await expect(send({ onError })).rejects.toMatchObject({ name: 'StreamProtocolError' });
			expect(onError).toHaveBeenCalledOnce();
		});

		it.each(['switched index', 'multiple choices', 'n:2'])(
			'ends the real agentic flow on %s without execution or follow-up',
			async (scenario) => {
				vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
					enabled: true,
					maxTurns: 4,
					maxToolPreviewLines: 10
				});
				vi.spyOn(toolsStore, 'getEnabledToolEntriesForLLM').mockReturnValue([
					{
						key: 'builtin:lookup',
						apiName: 'lookup',
						source: ToolSource.BUILTIN,
						registryGeneration: 1,
						definition: { type: 'function', function: { name: 'lookup', parameters: {} } }
					}
				]);
				vi.spyOn(mcpStore, 'hasEnabledServers').mockReturnValue(false);
				const executeTool = vi.spyOn(toolsStore, 'executeTool');
				const first = frame({ tool_calls: [tool(0, '{}')] });
				const second = frame({ tool_calls: [tool(0, '{}')] }, 1);
				const fetch = transport(
					sse([
						first,
						scenario === 'multiple choices'
							? { choices: [...first.choices, ...second.choices] }
							: second
					])
				);
				const conversationId = `aud005-${providerId}-${scenario}`;
				const onError = vi.fn(),
					onFlowComplete = vi.fn(),
					onToolCallState = vi.fn(),
					onAssistantTurnComplete = vi.fn();
				try {
					const result = await agenticStore.runAgenticFlow({
						conversationId,
						messages,
						options: {
							model: 'model-a',
							assistantMessageId: 'assistant-a',
							operationId: 'aud005',
							...(scenario === 'n:2' ? { custom: '{"n":2}' } : {})
						},
						callbacks: {
							onFlowStart: vi.fn(),
							onAssistantTurnComplete,
							onToolCallState,
							onFlowComplete,
							onError
						}
					});
					expect(result.error).toMatchObject({
						name: scenario === 'n:2' ? 'Error' : 'StreamProtocolError'
					});
					expect(onError).toHaveBeenCalledExactlyOnceWith(result.error);
					expect(onFlowComplete).toHaveBeenCalledOnce();
					expect(onFlowComplete.mock.calls[0][0]).toMatchObject({ reason: 'error' });
					// This lifecycle callback persists partial/error turns too; it is not
					// ChatService.onComplete. The terminal outcome must remain an error.
					expect(onAssistantTurnComplete).toHaveBeenCalledOnce();
					expect(onAssistantTurnComplete.mock.calls[0][1]).toContain('Upstream LLM error:');
					expect(onAssistantTurnComplete.mock.calls[0][4]).toEqual(
						scenario === 'n:2'
							? undefined
							: [
									{
										id: 'call-0',
										type: 'function',
										function: { name: 'lookup', arguments: '{}' }
									}
								]
					);
					expect(onToolCallState).not.toHaveBeenCalled();
					expect(executeTool).not.toHaveBeenCalled();
					expect(fetch).toHaveBeenCalledTimes(scenario === 'n:2' ? 0 : 1);
					expect(agenticStore.getSession(conversationId)).toMatchObject({
						isRunning: false,
						terminalReason: 'error'
					});
				} finally {
					agenticStore.clearSession(conversationId);
				}
			}
		);

		it('exercises real loopback HTTP with a synthetic backend, not live model inference', async () => {
			const received: unknown[] = [];
			const upstream = createServer(async (req, res) => {
				let body = '';
				for await (const chunk of req) body += chunk;
				received.push({ path: req.url, body: JSON.parse(body) });
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.end(
					sse([
						frame({ tool_calls: [tool()] }),
						frame({ tool_calls: [{ index: 0, function: { arguments: '"wrong"}' } }] }, 1)
					])
				);
			});
			upstream.listen(0, '127.0.0.1');
			await once(upstream, 'listening');
			try {
				const address = upstream.address();
				if (!address || typeof address === 'string')
					throw new Error('Missing synthetic HTTP address');
				const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
					expect(String(url)).toBe(`/__llampart/api/${providerId}/v1/chat/completions`);
					return nativeFetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, init);
				});
				vi.stubGlobal('fetch', fetch);
				const blocked = callbacks();
				await expect(send({ ...blocked, custom: '{"n":2}' })).rejects.toThrow(/n must be/);
				expect(received).toHaveLength(0);
				expect(fetch).not.toHaveBeenCalled();
				const cb = callbacks();
				await expect(send({ ...cb, custom: '{"n":null}' })).rejects.toMatchObject({
					name: 'StreamProtocolError'
				});
				expect(cb.onComplete).not.toHaveBeenCalled();
				expect(cb.onError).toHaveBeenCalledOnce();
				expect(fetch).toHaveBeenCalledOnce();
				expect(received).toHaveLength(1);
				expect(received[0]).toMatchObject({
					path: '/v1/chat/completions',
					body: { model: 'model-a', stream: true, messages }
				});
				expect((received[0] as { body: unknown }).body).not.toHaveProperty('n');
			} finally {
				await new Promise<void>((resolve, reject) =>
					upstream.close((error) => (error ? reject(error) : resolve()))
				);
			}
		});
	}
);
