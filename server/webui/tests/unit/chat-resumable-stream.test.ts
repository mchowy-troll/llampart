import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';
import { MessageRole } from '$lib/enums';
import type { ResumableStreamState } from '$lib/utils/resumable-stream-state';
import { createSourceFingerprint } from '$lib/utils/resumable-stream-state';
import { RESUMABLE_STREAM_STATE_TTL_MS } from '$lib/utils/resumable-stream-state';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { settingsStore } from '$lib/stores/settings.svelte';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { DatabaseService } from '$lib/services/database.service';

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;
const originalConfig = { ...settingsStore.config };

function streamResponse(raw: string): Response {
	return new Response(encoder.encode(raw), {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	settingsStore.config = { ...originalConfig };
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
				assistantMessageId: 'assistant-one',
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
		const sourceFingerprint = await createSourceFingerprint({
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
			apiKey: String(settingsStore.config.apiKey ?? '')
		});
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-1',
			assistantMessageId: 'assistant-1',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint,
			streamIdentity: 'conversation=chat-1&model=org%2Frepo%2Fmodel&request=req-1',
			model: 'org/repo/model',
			bytesReceived: 91,
			updatedAt: Date.now()
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
			const sourceFingerprint = await createSourceFingerprint({
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
				apiKey: String(settingsStore.config.apiKey ?? '')
			});
			const state: ResumableStreamState = {
				schemaVersion: 2,
				conversationId: 'chat-fallback',
				assistantMessageId: 'assistant-fallback',
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				sourceFingerprint,
				streamIdentity: 'stream-fallback',
				model: 'frozen-model',
				bytesReceived: 10,
				updatedAt: Date.now()
			};
			const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
			globalThis.fetch = fetchMock;

			await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}
	);

	it('rejects a source mismatch before issuing a lookup request', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-source-a',
			assistantMessageId: 'assistant-source-a',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: await createSourceFingerprint({
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: 'https://a.example.test',
				apiKey: 'secret-a'
			}),
			streamIdentity: 'stream-source-a',
			model: null,
			bytesReceived: 0,
			updatedAt: Date.now()
		};
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.example.test',
			apiKey: 'secret-b'
		});
		const fetchMock = vi.fn<typeof fetch>();
		globalThis.fetch = fetchMock;

		await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects an expired state before issuing a lookup request', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-expired',
			assistantMessageId: 'assistant-expired',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: await createSourceFingerprint({
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: String(settingsStore.config.serverBaseUrl ?? ''),
				apiKey: String(settingsStore.config.apiKey ?? '')
			}),
			streamIdentity: 'stream-expired',
			model: null,
			bytesReceived: 0,
			updatedAt: Date.now() - RESUMABLE_STREAM_STATE_TTL_MS - 1
		};
		const fetchMock = vi.fn<typeof fetch>();
		globalThis.fetch = fetchMock;

		await expect(ChatService.resumeStream(state, {})).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a missing exact assistant message without resuming or mutating another message', async () => {
		const state: ResumableStreamState = {
			schemaVersion: 2,
			conversationId: 'chat-exact',
			assistantMessageId: 'missing-assistant',
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			sourceFingerprint: 'sha256:test',
			streamIdentity: 'stream-exact',
			model: null,
			bytesReceived: 0,
			updatedAt: Date.now()
		};
		const otherAssistant = {
			id: 'other-assistant',
			convId: state.conversationId,
			role: MessageRole.ASSISTANT,
			content: 'must remain unchanged'
		} as DatabaseMessage;
		vi.spyOn(ChatService, 'getResumableState').mockReturnValue(state);
		vi.spyOn(ChatService, 'canResumeStream').mockResolvedValue(true);
		const discard = vi.spyOn(ChatService, 'discardResumableStream').mockImplementation(() => {});
		const resume = vi.spyOn(ChatService, 'resumeStream');
		vi.spyOn(conversationsStore, 'getConversationMessages').mockResolvedValue([otherAssistant]);
		const update = vi.spyOn(DatabaseService, 'updateMessage');

		await chatStore.resumeStreamForChat(state.conversationId);

		expect(discard).toHaveBeenCalledWith(state.conversationId);
		expect(resume).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(otherAssistant.content).toBe('must remain unchanged');
	});
});
