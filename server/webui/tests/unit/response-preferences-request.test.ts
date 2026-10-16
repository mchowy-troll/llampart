import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';
import { settingsStore } from '$lib/stores/settings.svelte';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions
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
	it.each([
		{ enabled: false, manual: '' },
		{ enabled: false, manual: 'Manual system prompt' },
		{ enabled: true, manual: '' },
		{ enabled: true, manual: 'Manual system prompt' }
	])(
		'matches pre-encode and chat system messages (enabled=$enabled, manual=$manual)',
		async ({ enabled, manual }) => {
			settingsStore.config = {
				...SETTING_CONFIG_DEFAULT,
				...Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, enabled]))
			};
			const history: ApiChatMessageData[] = [
				...(manual ? [{ role: 'system' as const, content: manual }] : []),
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
				[CHART_INSTRUCTIONS, preferences, manual].filter(Boolean).join('\n\n')
			);
			expect(String(cachedSystem.content).split(CHART_INSTRUCTIONS)).toHaveLength(2);
			for (const { instruction } of RESPONSE_PREFERENCES) {
				expect(String(cachedSystem.content).split(instruction)).toHaveLength(enabled ? 2 : 1);
			}
			expect(bodies[1]).toMatchObject({ stream: false, n_predict: 0, model: 'test' });
			expect(vi.mocked(fetch).mock.calls[1][1]?.signal).toBe(controller.signal);
			// Reusing an already composed request must not duplicate either instruction block.
			await ChatService.preEncode(bodies[0].messages, context, 'test', true);
			expect(bodies[2].messages.find(({ role }) => role === 'system')).toEqual(chatSystem);
			expect(history).toEqual(before);
		}
	);

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

	it('uses committed preferences in pre-encode, never the unsaved settings draft', async () => {
		settingsStore.config = { ...SETTING_CONFIG_DEFAULT };
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, all);
		await ChatService.preEncode(
			[{ role: 'user', content: 'Context' }],
			ChatService.createProviderRequestContext()
		);
		expect(bodies[0].messages[0].content).toBe(CHART_INSTRUCTIONS);
		settingsStore.cancelPreview(session);
	});

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
				CHART_INSTRUCTIONS + '\n\n' + buildResponsePreferenceInstructions(all) + '\n\nManual prompt'
			);
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
			expect(bodies[2].messages[0].content).toBe(CHART_INSTRUCTIONS + '\n\nManual prompt');
			expect(history).toEqual(before);
		}
	);
	it('does not inject preferences or charts into auxiliary title generation', async () => {
		await ChatService.generateTitle({ role: 'user', content: 'Generate a title' }, 'test');
		expect(bodies).toHaveLength(1);
		expect(bodies[0].messages).toEqual([{ role: 'user', content: 'Generate a title' }]);
	});
	it('does not use an unsaved or cancelled draft and freezes request text before fetching', async () => {
		settingsStore.config = { ...SETTING_CONFIG_DEFAULT };
		const session = settingsStore.beginPreview();
		settingsStore.updatePreview(session, all);
		await ChatService.sendMessage(
			[{ role: 'user', content: 'Hi' }],
			{ stream: true },
			'conversation'
		);
		expect(bodies[0].messages[0].content).toBe(CHART_INSTRUCTIONS);
		settingsStore.cancelPreview(session);
		await ChatService.sendMessage(
			[{ role: 'user', content: 'Hi' }],
			{ stream: true },
			'conversation'
		);
		expect(bodies[1].messages).toEqual(bodies[0].messages);
	});
});
