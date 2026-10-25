import '../fixtures/verified-backend';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, ToolSource } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { LlamaServerBackendError } from '$lib/services/providers/llama-server-response';
import { settingsStore } from '$lib/stores/settings.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import {
	loadResumableStreamStates,
	saveResumableStreamState,
	createSourceFingerprint,
	type ResumableStreamState
} from '$lib/utils/resumable-stream-state';

const encoder = new TextEncoder();
const originalConfig = { ...settingsStore.config };
const values = new Map<string, string>();
const text = 'data: {"choices":[{"delta":{"content":"zażółć🙂"}}]}\r\n\r\n';
const errorRecord =
	'data: {"error":{"code":500,"message":"AUDIT backend error","type":"server_error"}}\n\n';
const legacyError =
	'error: {"code":400,"message":"context exhausted","type":"invalid_request_error"}\r\n\r\n';
const done = 'data: [DONE]\n\n';

function response(raw: string, bytewise = false) {
	const bytes = encoder.encode(raw);
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				if (bytewise) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
				else controller.enqueue(bytes);
				controller.close();
			}
		}),
		{ headers: { 'Content-Type': 'text/event-stream' } }
	);
}
function send(options: Parameters<typeof ChatService.sendMessage>[1] = {}, signal?: AbortSignal) {
	return ChatService.sendMessage(
		[{ role: MessageRole.USER, content: 'synthetic' }],
		{
			stream: true,
			model: 'synthetic-model',
			assistantMessageId: 'synthetic-assistant',
			...options
		},
		'aud-004',
		signal
	);
}
beforeEach(() => {
	settingsStore.config = { ...originalConfig, apiProvider: 'llama-server' };
	values.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	agenticStore.clearSession('aud-004');
	ChatService.discardResumableStream('aud-004');
	settingsStore.config = originalConfig;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('real ChatService llama-server terminal semantics (AUD-004)', () => {
	it.each([
		['error then DONE', errorRecord + done, [], 'LlamaServerBackendError'],
		[
			'error envelope with SSE event marker',
			'event: error\n' + errorRecord + done,
			[],
			'LlamaServerBackendError'
		],
		[
			'partial then error then DONE',
			text + errorRecord + done,
			['zażółć🙂'],
			'LlamaServerBackendError'
		],
		[
			'partial then error without DONE',
			text + errorRecord,
			['zażółć🙂'],
			'LlamaServerBackendError'
		],
		[
			'partial then historical error',
			text + legacyError + done,
			['zażółć🙂'],
			'LlamaServerBackendError'
		],
		['unknown JSON', 'data: {"unexpected":true}\n\n' + done, [], 'StreamProtocolError'],
		['malformed JSON', 'data: {bad-json}\n\n' + done, [], 'StreamProtocolError'],
		['malformed historical error', 'error: {bad-json}\n\n' + done, [], 'StreamProtocolError']
	])(
		'%s rejects once without completion, bad checkpoint, reconnect or follow-up',
		async (_name, raw, chunks, errorName) => {
			const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(raw as string, true));
			vi.stubGlobal('fetch', fetchMock);
			const onComplete = vi.fn();
			const onError = vi.fn();
			const onChunk = vi.fn();
			const onStreamCheckpoint = vi.fn();
			const failure = await send({ onComplete, onError, onChunk, onStreamCheckpoint }).catch(
				(error) => error
			);
			expect(failure).toBeInstanceOf(Error);
			expect(failure.name).toBe(errorName);
			expect(onComplete).not.toHaveBeenCalled();
			expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
			expect(onChunk.mock.calls.map(([chunk]) => chunk)).toEqual(chunks);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(onStreamCheckpoint.mock.calls.map(([checkpoint]) => checkpoint.bytesReceived)).toEqual(
				chunks.length ? [encoder.encode(text).length] : []
			);
			expect(loadResumableStreamStates()).toEqual([]);
			if (errorName === 'StreamProtocolError') expect(failure.cause).toBeInstanceOf(Error);
			else expect(failure).toBeInstanceOf(LlamaServerBackendError);
		}
	);
	it('keeps aggregation, metadata, statistics and sequential byte checkpoints across one-byte HTTP chunks', async () => {
		const records = [
			'data: {"id":"chat-1","model":"synthetic-model","choices":[{"delta":{"role":"assistant","content":null}}]}\r\n\r\n',
			'data: {"prompt_progress":{"total":20,"cache":0,"processed":10,"time_ms":3}}\n\n',
			'data: {"choices":[{"delta":{"reasoning_content":"plan"}}]}\n\n',
			text,
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"look","arguments":"{\\"q\\":"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
			'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
			'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":4,"total_tokens":24},"timings":{"prompt_n":20,"predicted_n":4}}\n\n',
			done
		];
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>().mockResolvedValue(response(records.join(''), true))
		);
		const onComplete = vi.fn(),
			onError = vi.fn(),
			onReasoningChunk = vi.fn(),
			onModel = vi.fn(),
			onCompletionId = vi.fn(),
			onTimings = vi.fn();
		const checkpoints: number[] = [];
		await expect(
			send({
				onComplete,
				onError,
				onReasoningChunk,
				onModel,
				onCompletionId,
				onTimings,
				onStreamCheckpoint: async (checkpoint) => {
					await Promise.resolve();
					checkpoints.push(checkpoint.bytesReceived);
				}
			})
		).resolves.toBeUndefined();
		expect(onComplete).toHaveBeenCalledOnce();
		expect(onComplete.mock.calls[0].slice(0, 3)).toEqual([
			'zażółć🙂',
			'plan',
			{ prompt_n: 20, predicted_n: 4 }
		]);
		expect(JSON.parse(onComplete.mock.calls[0][3])).toEqual([
			{ id: 'call-1', type: 'function', function: { name: 'look', arguments: '{"q":1}' } }
		]);
		expect(onError).not.toHaveBeenCalled();
		expect(onReasoningChunk).toHaveBeenCalledExactlyOnceWith('plan');
		expect(onModel).toHaveBeenCalledExactlyOnceWith('synthetic-model');
		expect(onCompletionId).toHaveBeenCalledExactlyOnceWith('chat-1');
		expect(onTimings).toHaveBeenCalledWith(undefined, {
			total: 20,
			cache: 0,
			processed: 10,
			time_ms: 3
		});
		expect(checkpoints).toEqual(
			records.map((_record, index) => encoder.encode(records.slice(0, index + 1).join('')).length)
		);
		expect(loadResumableStreamStates()).toEqual([]);
	});
	it('accepts only DONE, and retries a failure as a distinct new operation', async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(response(errorRecord + done))
			.mockResolvedValueOnce(response(done));
		vi.stubGlobal('fetch', fetchMock);
		const onComplete = vi.fn(),
			onError = vi.fn();
		await expect(send({ onComplete, onError })).rejects.toBeInstanceOf(LlamaServerBackendError);
		await expect(send({ onComplete, onError })).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledOnce();
		expect(onComplete).toHaveBeenCalledExactlyOnceWith(
			'',
			undefined,
			undefined,
			undefined,
			undefined
		);
		const identities = fetchMock.mock.calls.map(([, init]) =>
			new Headers(init?.headers).get('X-Conversation-Id')
		);
		expect(identities[0]).toBeTruthy();
		expect(identities[1]).not.toBe(identities[0]);
	});
	it('does not convert tool deltas followed by an error into a completed tool turn', async () => {
		const tool =
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call","type":"function","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\n';
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(tool + errorRecord + done));
		vi.stubGlobal('fetch', fetchMock);
		const continueTools = vi.fn();
		const onToolCallChunk = vi.fn();
		await expect(send({ onComplete: continueTools, onToolCallChunk })).rejects.toBeInstanceOf(
			LlamaServerBackendError
		);
		expect(onToolCallChunk).toHaveBeenCalledOnce();
		expect(continueTools).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
	});
	it('aborts after a valid chunk without terminal callbacks or committing the following error', async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>().mockResolvedValue(response(text + errorRecord + done))
		);
		const onComplete = vi.fn(),
			onError = vi.fn();
		await expect(
			send({ onComplete, onError, onChunk: () => controller.abort() }, controller.signal)
		).resolves.toBeUndefined();
		expect(onComplete).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
	it('ends the real agentic orchestration as error without executing a streamed tool or sending another request', async () => {
		vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
			enabled: true,
			maxTurns: 3,
			maxToolPreviewLines: 10
		});
		vi.spyOn(toolsStore, 'hasBuiltinToolsForContext').mockReturnValue(true);
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
		const tool =
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\n';
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(tool + errorRecord + done));
		vi.stubGlobal('fetch', fetchMock);
		const onError = vi.fn(),
			onFlowComplete = vi.fn(),
			onToolCallState = vi.fn();
		const result = await agenticStore.runAgenticFlow({
			conversationId: 'aud-004',
			messages: [{ role: MessageRole.USER, content: 'synthetic' }],
			options: {
				model: 'synthetic-model',
				assistantMessageId: 'synthetic-assistant',
				operationId: 'aud-004-op'
			},
			callbacks: {
				onFlowStart: vi.fn(),
				onAssistantTurnComplete: vi.fn(),
				onToolCallState,
				onFlowComplete,
				onError
			}
		});
		expect(result.error).toBeInstanceOf(LlamaServerBackendError);
		expect(onError).toHaveBeenCalledExactlyOnceWith(result.error);
		expect(onFlowComplete).toHaveBeenCalledOnce();
		expect(onFlowComplete.mock.calls[0][0]).toMatchObject({ reason: 'error' });
		expect(onToolCallState).not.toHaveBeenCalled();
		expect(executeTool).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(agenticStore.getSession('aud-004')).toMatchObject({
			isRunning: false,
			terminalReason: 'error'
		});
	});
	it('fails a replayed backend error terminally and clears resumable state without another reconnect', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'aud-004',
			assistantMessageId: 'synthetic-assistant',
			providerId: 'llama-server',
			sourceFingerprint: await createSourceFingerprint(ChatService.createProviderRequestContext()),
			streamIdentity: 'synthetic-replay',
			model: 'synthetic-model',
			bytesReceived: 45,
			updatedAt: Date.now()
		};
		saveResumableStreamState(state);
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('{}'))
			.mockResolvedValueOnce(response(errorRecord + done));
		vi.stubGlobal('fetch', fetchMock);
		const onComplete = vi.fn(),
			onError = vi.fn(),
			onStreamCheckpoint = vi.fn();
		await expect(
			ChatService.resumeStream(state, { onComplete, onError, onStreamCheckpoint })
		).rejects.toBeInstanceOf(LlamaServerBackendError);
		expect(onComplete).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledOnce();
		expect(onStreamCheckpoint).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(loadResumableStreamStates()).toEqual([]);
	});
	it.each([
		[
			'success',
			'{"model":"synthetic-model","choices":[{"message":{"content":"answer","reasoning_content":"plan"}}]}'
		],
		['backend error', '{"error":{"message":"failure","code":500,"type":"server_error"}}'],
		['unknown object', '{"unexpected":true}']
	])('handles non-stream HTTP 200 %s without false completion', async (kind, body) => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } }))
		);
		const onComplete = vi.fn(),
			onError = vi.fn();
		const result = send({ stream: false, onComplete, onError });
		if (kind === 'success') {
			await expect(result).resolves.toBe('answer');
			expect(onComplete).toHaveBeenCalledOnce();
			expect(onError).not.toHaveBeenCalled();
		} else {
			await expect(result).rejects.toBeInstanceOf(
				kind === 'backend error' ? LlamaServerBackendError : Error
			);
			expect(onError).toHaveBeenCalledOnce();
			expect(onComplete).not.toHaveBeenCalled();
		}
	});
});
