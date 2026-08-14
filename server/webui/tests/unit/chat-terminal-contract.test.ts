import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function streamResponse(raw: string): Response {
	return new Response(encoder.encode(raw), {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

function failingStreamResponse(error: Error): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(error);
			}
		}),
		{ status: 200, headers: { 'Content-Type': 'text/event-stream' } }
	);
}

function sendStreamingMessage(
	options: Parameters<typeof ChatService.sendMessage>[1],
	conversationId?: string,
	signal?: AbortSignal
) {
	return ChatService.sendMessage(
		[{ role: MessageRole.USER, content: 'hello' }],
		{ stream: true, ...options },
		conversationId,
		signal
	);
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe('ChatService terminal contract', () => {
	it('completes exactly once after a terminal stream event', async () => {
		globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(streamResponse('data: [DONE]\n\n'));
		const onComplete = vi.fn();
		const onError = vi.fn();

		await expect(sendStreamingMessage({ onComplete, onError })).resolves.toBeUndefined();

		expect(onComplete).toHaveBeenCalledTimes(1);
		expect(onError).not.toHaveBeenCalled();
	});

	it('reports EOF without a terminal event as one incomplete-stream error', async () => {
		const event = `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`;
		globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(streamResponse(event));
		const onChunk = vi.fn();
		const onComplete = vi.fn();
		const onError = vi.fn();

		await expect(sendStreamingMessage({ onChunk, onComplete, onError })).rejects.toMatchObject({
			name: 'IncompleteStreamError'
		});

		expect(onChunk).toHaveBeenCalledOnce();
		expect(onComplete).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledOnce();
	});

	it('reports a stream read failure exactly once', async () => {
		globalThis.fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(failingStreamResponse(new Error('connection reset')));
		const onComplete = vi.fn();
		const onError = vi.fn();

		await expect(sendStreamingMessage({ onComplete, onError })).rejects.toMatchObject({
			name: 'IncompleteStreamError'
		});

		expect(onComplete).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledOnce();
	});

	it('does not advance a checkpoint after malformed provider data', async () => {
		globalThis.fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(streamResponse('data: {not-json}\n\n'));
		const onStreamCheckpoint = vi.fn();
		const onError = vi.fn();

		await expect(sendStreamingMessage({ onStreamCheckpoint, onError })).rejects.toMatchObject({
			name: 'StreamProtocolError'
		});

		expect(onStreamCheckpoint).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledOnce();
	});

	it('does not replay a chunk when its local checkpoint fails', async () => {
		const event = `data: ${JSON.stringify({ choices: [{ delta: { content: 'once' } }] })}\n\n`;
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(streamResponse(event))
			.mockResolvedValueOnce(new Response(null, { status: 405 }));
		globalThis.fetch = fetchMock;
		const onChunk = vi.fn();
		const onError = vi.fn();

		await expect(
			sendStreamingMessage(
				{
					onChunk,
					onError,
					onStreamCheckpoint: vi.fn().mockRejectedValue(new Error('IndexedDB unavailable'))
				},
				'checkpoint-chat'
			)
		).rejects.toMatchObject({ name: 'StreamCheckpointError' });

		expect(onChunk).toHaveBeenCalledTimes(1);
		expect(onChunk).toHaveBeenCalledWith('once');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledOnce();
	});

	it('notifies an HTTP error exactly once', async () => {
		const onHttpError = vi.fn();
		globalThis.fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('failure', { status: 500 }));

		await expect(sendStreamingMessage({ onError: onHttpError })).rejects.toBeInstanceOf(Error);
		expect(onHttpError).toHaveBeenCalledOnce();
	});

	it('notifies a non-stream parse error exactly once', async () => {
		globalThis.fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('{invalid-json', { status: 200 }));

		const onParseError = vi.fn();
		await expect(
			ChatService.sendMessage([{ role: MessageRole.USER, content: 'hello' }], {
				stream: false,
				onError: onParseError
			})
		).rejects.toBeInstanceOf(Error);
		expect(onParseError).toHaveBeenCalledOnce();
	});

	it('does not emit a terminal callback for an aborted operation', async () => {
		const controller = new AbortController();
		controller.abort();
		globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue(streamResponse(''));
		const onComplete = vi.fn();
		const onError = vi.fn();

		await expect(
			sendStreamingMessage({ onComplete, onError }, undefined, controller.signal)
		).resolves.toBeUndefined();

		expect(onComplete).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});
});
