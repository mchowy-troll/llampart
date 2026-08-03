import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';
import { MessageRole } from '$lib/enums';
import type { ResumableStreamState } from '$lib/utils/resumable-stream-state';

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

function streamResponse(raw: string): Response {
	return new Response(encoder.encode(raw), {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe('ChatService resumable streams', () => {
	it('reconnects from parsed UTF-8 bytes and falls back once when replay is unsupported', async () => {
		const firstEvent = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ż' } }] })}\r\n\r\n`;
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(streamResponse(firstEvent))
			.mockResolvedValueOnce(new Response(null, { status: 405 }));
		globalThis.fetch = fetchMock;
		let completed = '';

		await ChatService.sendMessage(
			[{ role: MessageRole.USER, content: 'hello' }],
			{
				stream: true,
				model: 'org/repo/model',
				onComplete: (content) => {
					completed = content;
				}
			},
			'chat/one'
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const originalHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
		const streamIdentity = originalHeaders.get('X-Conversation-Id');
		expect(streamIdentity).toBeTruthy();
		const replayRequest = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
		expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
		expect(replayRequest.pathname).toBe('/v1/stream');
		expect(replayRequest.searchParams.get('conv_id')).toBe(streamIdentity);
		expect(replayRequest.searchParams.get('from')).toBe(String(encoder.encode(firstEvent).length));
		expect(completed).toBe('ż');
	});

	it('looks up a persisted stream and attaches replay to seeded content', async () => {
		const state: ResumableStreamState = {
			conversationId: 'chat-1',
			streamIdentity: 'conversation=chat-1&model=org%2Frepo%2Fmodel&request=req-1',
			model: 'org/repo/model',
			bytesReceived: 91,
			updatedAt: 1
		};
		const replay =
			`data: ${JSON.stringify({ choices: [{ delta: { content: ' new' } }] })}\n\n` +
			'data: [DONE]\n\n';
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('{}', { status: 200 }))
			.mockResolvedValueOnce(streamResponse(replay));
		globalThis.fetch = fetchMock;
		let completed = '';

		const resumed = await ChatService.resumeStream(state, {
			resumeSeed: { content: 'prior', reasoningContent: 'plan', toolCalls: [] },
			onComplete: (content) => {
				completed = content;
			}
		});

		expect(resumed).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			conversation_ids: [state.streamIdentity]
		});
		const replayRequest = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost');
		expect(replayRequest.searchParams.get('conv_id')).toBe(state.streamIdentity);
		expect(replayRequest.searchParams.get('from')).toBe('91');
		expect(completed).toBe('prior new');
	});

	it.each([404, 405, 501])(
		'treats lookup status %s as an optional endpoint fallback',
		async (status) => {
			const state: ResumableStreamState = {
				conversationId: 'chat-fallback',
				streamIdentity: 'stream-fallback',
				model: 'frozen-model',
				bytesReceived: 10,
				updatedAt: 1
			};
			const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
			globalThis.fetch = fetchMock;

			await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}
	);
});
