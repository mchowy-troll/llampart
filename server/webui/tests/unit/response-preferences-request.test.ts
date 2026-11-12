import '../fixtures/verified-backend';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';
import { settingsStore } from '$lib/stores/settings.svelte';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { CHART_INSTRUCTIONS as CHART_ONLY } from '$lib/markdown/chart-instructions';
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';
import { TABLE_INSTRUCTIONS } from '$lib/markdown/table-instructions';
const CHART_INSTRUCTIONS = CHART_ONLY + '\n\n' + MERMAID_INSTRUCTIONS + '\n\n' + TABLE_INSTRUCTIONS;
const envelope = (text: string) =>
	`<llampart-chat-instructions>\n${text}\n</llampart-chat-instructions>`;
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions,
	withChatInstructions
} from '$lib/utils/response-preferences';
import type { ApiChatMessageData } from '$lib/types/api';
import { MessageType } from '$lib/enums';

const original = { ...settingsStore.config };
const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));
let bodies: { messages: ApiChatMessageData[] }[];

beforeEach(() => {
	bodies = [];
	settingsStore.config = { ...SETTING_CONFIG_DEFAULT, ...all };
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url, init) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
		})
	);
});
afterEach(() => {
	settingsStore.cancelPreview();
	settingsStore.config = { ...original };
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('response preferences through ChatService requests', () => {
	it('matches pre-encode and chat instructions without duplicating an already composed request', async () => {
		const manual = 'Manual system prompt';
		const history: ApiChatMessageData[] = [
			{ role: 'system', content: manual },
			{ role: 'user', content: 'Conversation context' }
		];
		const before = structuredClone(history);
		const context = ChatService.createProviderRequestContext();
		await ChatService.sendMessage(history, { stream: true, model: 'test' }, 'conversation');
		const controller = new AbortController();
		await ChatService.preEncode(history, context, 'test', true, controller.signal);
		const chatSystem = bodies[0].messages.find(({ role }) => role === 'system')!;
		const cachedSystem = bodies[1].messages.find(({ role }) => role === 'system')!;
		const preferences = buildResponsePreferenceInstructions(settingsStore.config);
		expect(cachedSystem).toEqual(chatSystem);
		expect(cachedSystem.content).toBe(
			[envelope([CHART_INSTRUCTIONS, preferences].join('\n\n')), manual].join('\n\n')
		);
		expect(bodies[1]).toMatchObject({ stream: false, n_predict: 0, model: 'test' });
		expect(vi.mocked(fetch).mock.calls[1][1]?.signal).toBe(controller.signal);
		// Only the in-memory composer's output has trusted application ownership.
		await ChatService.preEncode(
			withChatInstructions(history, settingsStore.config),
			context,
			'test',
			true
		);
		expect(bodies[2].messages.find(({ role }) => role === 'system')).toEqual(chatSystem);
		expect(history).toEqual(before);
	});
	it('preserves a serialized composer envelope re-entered as a manual system prompt', async () => {
		const manual = JSON.parse(
			JSON.stringify(withChatInstructions([{ role: 'system', content: 'Manual ending' }], all))
		) as ApiChatMessageData[];
		const before = structuredClone(manual);
		settingsStore.updateMultipleConfig({
			chartsEnabled: false,
			diagramsEnabled: false,
			...Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, false]))
		});
		const context = ChatService.createProviderRequestContext();
		await ChatService.sendMessage(manual, { stream: true, model: 'test' }, 'conversation');
		await ChatService.preEncode(manual, context, 'test', true);
		for (const body of bodies)
			expect(body.messages[0]).toEqual({
				...manual[0],
				content: envelope(TABLE_INSTRUCTIONS) + '\n\n' + manual[0].content
			});
		expect(manual).toEqual(before);
	});

	it.each([false, true])(
		'preserves database history and pre-encode reasoning control (exclude=%s)',
		async (excludeReasoning) => {
			const history: DatabaseMessage[] = [
				{
					id: 'system',
					convId: 'conversation',
					type: MessageType.SYSTEM,
					timestamp: 1,
					role: 'system',
					content: 'Manual system prompt',
					parent: null,
					children: ['assistant']
				},
				{
					id: 'assistant',
					convId: 'conversation',
					type: MessageType.TEXT,
					timestamp: 2,
					role: 'assistant',
					content: 'Answer',
					reasoningContent: 'Internal reasoning',
					parent: 'system',
					children: []
				}
			];
			const before = structuredClone(history);
			const context = ChatService.createProviderRequestContext();
			await ChatService.sendMessage(
				history,
				{ stream: true, model: 'test', excludeReasoningFromContext: excludeReasoning },
				'conversation'
			);
			await ChatService.preEncode(history, context, 'test', excludeReasoning);
			expect(bodies[1].messages.find(({ role }) => role === 'system')).toEqual(
				bodies[0].messages.find(({ role }) => role === 'system')
			);
			expect(bodies[1].messages.find(({ role }) => role === 'assistant')?.reasoning_content).toBe(
				excludeReasoning ? undefined : 'Internal reasoning'
			);
			expect(history).toEqual(before);
		}
	);

	it('still handles an aborted pre-encode without reporting an error', async () => {
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const controller = new AbortController();
		controller.abort();
		vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
		await expect(
			ChatService.preEncode(
				[{ role: 'user', content: 'Context' }],
				ChatService.createProviderRequestContext(),
				'test',
				true,
				controller.signal
			)
		).resolves.toBeUndefined();
		expect(warning).not.toHaveBeenCalled();
		expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
	});

	it.each(['llama-server', 'openai-compatible', 'vllm'])(
		'uses committed preferences for existing conversations and tool continuations with %s',
		async (apiProvider) => {
			settingsStore.config = {
				...settingsStore.config,
				apiProvider,
				serverBaseUrl: 'http://localhost:8080'
			};
			const history: ApiChatMessageData[] = [
				{ role: 'system', content: 'Manual prompt' },
				{ role: 'user', content: 'Earlier question' },
				{ role: 'assistant', content: 'Earlier answer' },
				{ role: 'user', content: 'Compare 12 and 18' }
			];
			const before = structuredClone(history);
			await ChatService.sendMessage(
				history,
				{ stream: true, model: 'test' },
				'existing-conversation'
			);
			expect(bodies[0].messages[0].content).toBe(
				envelope(CHART_INSTRUCTIONS + '\n\n' + buildResponsePreferenceInstructions(all)) +
					'\n\nManual prompt'
			);
			expect(bodies[0].messages.slice(1)).toEqual(history.slice(1));
			expect(history).toEqual(before);
			const continuation: ApiChatMessageData[] = [
				...history,
				{
					role: 'assistant',
					content: '',
					tool_calls: [
						{ id: 'call1', type: 'function', function: { name: 'lookup', arguments: '{}' } }
					]
				},
				{ role: 'tool', tool_call_id: 'call1', content: '12, 18' }
			];
			const continuationBefore = structuredClone(continuation);
			await ChatService.sendMessage(
				continuation,
				{ stream: true, model: 'test' },
				'existing-conversation'
			);
			expect(bodies[1].messages[0]).toEqual(bodies[0].messages[0]);
			expect(bodies[1].messages.slice(1)).toEqual(continuation.slice(1));
			expect(continuation).toEqual(continuationBefore);
			settingsStore.config = {
				...settingsStore.config,
				...Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, false]))
			};
			await ChatService.sendMessage(
				history,
				{ stream: true, model: 'test' },
				'existing-conversation'
			);
			expect(bodies[2].messages[0].content).toBe(
				envelope(CHART_INSTRUCTIONS) + '\n\nManual prompt'
			);
			expect(history).toEqual(before);
		}
	);
	it('does not inject preferences or charts into auxiliary title generation', async () => {
		await ChatService.generateTitle({ role: 'user', content: 'Generate a title' }, 'test');
		expect(bodies).toHaveLength(1);
		expect(bodies[0].messages).toEqual([{ role: 'user', content: 'Generate a title' }]);
	});
	it('ignores unsaved and cancelled preferences in chat and pre-encode', async () => {
		settingsStore.config = { ...SETTING_CONFIG_DEFAULT };
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, all);
		await ChatService.sendMessage(
			[{ role: 'user', content: 'Hi' }],
			{ stream: true },
			'conversation'
		);
		expect(bodies[0].messages[0].content).toBe(envelope(CHART_INSTRUCTIONS));
		await ChatService.preEncode(
			[{ role: 'user', content: 'Hi' }],
			ChatService.createProviderRequestContext()
		);
		expect(bodies[1].messages).toEqual(bodies[0].messages);
		settingsStore.cancelPreview(session);
		await ChatService.sendMessage(
			[{ role: 'user', content: 'Hi' }],
			{ stream: true },
			'conversation'
		);
		expect(bodies[2].messages).toEqual(bodies[0].messages);
	});

	it('does not include API keys in message bodies or expose them in request errors and logs', async () => {
		const secret = 'private-settings-key';
		settingsStore.config = { ...settingsStore.config, apiKey: secret };
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const history: ApiChatMessageData[] = [{ role: 'user', content: 'Hi' }];
		await ChatService.sendMessage(history, { stream: true }, 'conversation');
		expect(JSON.stringify(bodies)).not.toContain(secret);
		vi.mocked(fetch).mockRejectedValueOnce(new Error(`Rejected key: ${secret}`));
		const onError = vi.fn();
		await expect(
			ChatService.sendMessage(history, { stream: true, onError }, 'conversation')
		).rejects.toThrow('Rejected key: [redacted]');
		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0].message).not.toContain(secret);
		expect(error).toHaveBeenCalled();
		expect(JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain(
			secret
		);
	});
});
