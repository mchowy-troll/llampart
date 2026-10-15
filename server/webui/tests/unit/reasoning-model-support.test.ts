import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasoningEffort, ServerRole } from '$lib/enums';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { PropsService } from '$lib/services/props.service';
import { ChatService } from '$lib/services/chat.service';
import { DatabaseService } from '$lib/services/database.service';
import { chatStore } from '$lib/stores/chat.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import {
	detectReasoningControl,
	effectiveLlamaReasoningEffort
} from '$lib/utils/chat-template-thinking-detector';

const effortTemplate = `{% set reasoning_effort = reasoning_effort | default('medium') %}{{ 'Reasoning: ' + reasoning_effort }}`;
const toggleTemplate = '{% if enable_thinking is defined and enable_thinking %}<think>{% endif %}';
const props = (chat_template: string) =>
	({ chat_template, default_generation_settings: { params: {} } }) as ApiLlamaCppServerProps;
const original = { ...settingsStore.config };

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.config = { ...original };
	modelsStore.resetAllModelState();
	serverStore.clear();
});

describe('template reasoning control detection', () => {
	it.each([
		[effortTemplate, 'effort'],
		[toggleTemplate, 'toggle'],
		[`${toggleTemplate}{% if reasoning_effort == 'high' %}high{% endif %}`, 'effort'],
		[`${toggleTemplate}{% if reasoning_effort is defined %}unused{% endif %}`, 'toggle'],
		[`${toggleTemplate}{% if reasoning_effort %}boolean only{% endif %}`, 'toggle'],
		['plain Qwen DeepSeek GPT GLM template', 'none'],
		[null, 'none'],
		[undefined, 'none'],
		['{% if thinking_budget > 0 %}think{% endif %}', 'none'],
		['{# example: reasoning_effort == "high", enable_thinking #}{{ message.content }}', 'none'],
		['reasoning_effort enable_thinking {{ "reasoning_effort" }}', 'none'],
		['{{ "Historical example: {{ reasoning_effort }}" }}', 'none'],
		['{% raw %}{% if enable_thinking %}example{% endif %}{% endraw %}', 'none'],
		['{% set reasoning_effort = "medium" %}', 'none'],
		['{% if enable_thinking is defined %}unused{% endif %}', 'none'],
		['{{ reasoning_effort is defined }} {{ enable_thinking is defined }}', 'none'],
		['{{ message.reasoning_effort }} {{ message["enable_thinking"] }}', 'none']
	])('detects %s as %s', (template, expected) => {
		expect(detectReasoningControl(template)).toBe(expected);
	});
	it.each([
		['max', ReasoningEffort.HIGH],
		['low', ReasoningEffort.LOW],
		['medium', ReasoningEffort.MEDIUM],
		['high', ReasoningEffort.HIGH],
		['off', ReasoningEffort.MEDIUM],
		[undefined, ReasoningEffort.MEDIUM]
	])('interprets historical effort %s without mutating storage', (saved, expected) => {
		expect(effectiveLlamaReasoningEffort(saved)).toBe(expected);
	});
});

describe('model thinking support ownership', () => {
	beforeEach(() => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://source-a.test',
			apiKey: ''
		});
		modelsStore.resetAllModelState();
		serverStore.clear();
	});

	it('uses server props in single-model mode even when a model is selected', () => {
		serverStore.role = ServerRole.MODEL;
		serverStore.props = {
			chat_template: '{% if enable_thinking %}think{% endif %}',
			default_generation_settings: { n_ctx: 8192, params: {} }
		} as ApiLlamaCppServerProps;
		modelsStore.selectedModelId = 'single-model';
		modelsStore.selectedModelName = 'single-model';

		expect(modelsStore.supportsThinking).toBe(true);
		expect(modelsStore.getReasoningControl()).toBe('toggle');
		expect(modelsStore.checkModelSupportsThinking('single-model')).toBe(true);
		expect(modelsStore.thinkingSupportDetails.supported).toBe(true);
	});

	it('uses cached model-specific props in router mode', () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = {
			chat_template: 'plain router default',
			default_generation_settings: { n_ctx: 8192, params: {} }
		} as ApiLlamaCppServerProps;
		modelsStore.selectedModelId = 'thinking-model';
		modelsStore.selectedModelName = 'thinking-model';
		const internals = modelsStore as unknown as {
			modelPropsCache: Map<string, ApiLlamaCppServerProps>;
			getSourceModelKey: (context: unknown, modelId: string) => string;
			currentRequestContext: () => unknown;
		};
		internals.modelPropsCache.set(
			internals.getSourceModelKey(internals.currentRequestContext(), 'thinking-model'),
			{
				chat_template: '{% if enable_thinking %}think{% endif %}',
				default_generation_settings: { n_ctx: 16384, params: {} }
			} as ApiLlamaCppServerProps
		);

		expect(modelsStore.supportsThinking).toBe(true);
		expect(modelsStore.thinkingSupportDetails.supported).toBe(true);
	});

	it('updates router decisions per model, not from the router default or model name', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props(effortTemplate);
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		vi.spyOn(PropsService, 'fetchForModel').mockImplementation(async (_, model) =>
			props(model === 'a' ? effortTemplate : model === 'b' ? toggleTemplate : 'no controls')
		);
		for (const [model, expected] of [
			['a', 'effort'],
			['b', 'toggle'],
			['Qwen-thinking', 'none']
		] as const) {
			modelsStore.selectedModelName = model;
			expect(modelsStore.getReasoningControl()).toBe('none');
			await modelsStore.fetchModelProps(model);
			expect(modelsStore.getReasoningControl()).toBe(expected);
		}
	});

	it('late model A props cannot replace the decision for selected B', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props('router');
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		const slow = deferred<ApiLlamaCppServerProps>();
		vi.spyOn(PropsService, 'fetchForModel').mockImplementation(async (_, model) =>
			model === 'a' ? slow.promise : props(toggleTemplate)
		);
		modelsStore.selectedModelName = 'a';
		const pending = modelsStore.fetchModelProps('a');
		modelsStore.selectedModelName = 'b';
		await modelsStore.fetchModelProps('b');
		const version = modelsStore.propsCacheVersion;
		slow.resolve(props(effortTemplate));
		await pending;
		expect(modelsStore.propsCacheVersion).toBeGreaterThan(version);
		expect(modelsStore.getReasoningControl()).toBe('toggle');
		expect(modelsStore.getReasoningControl('a')).toBe('effort');
	});

	it('ignores late model props from another source, including the same model ID', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props('router');
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		const slow = deferred<ApiLlamaCppServerProps>();
		vi.spyOn(PropsService, 'fetchForModel').mockImplementation(async (context) =>
			context.serverBaseUrl === 'http://source-a.test' ? slow.promise : props(toggleTemplate)
		);
		modelsStore.selectedModelName = 'same';
		const pending = modelsStore.fetchModelProps('same');
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://source-b.test' });
		expect(modelsStore.getReasoningControl()).toBe('none');
		await modelsStore.fetchModelProps('same');
		slow.resolve(props(effortTemplate));
		await pending;
		expect(modelsStore.getReasoningControl()).toBe('toggle');
	});

	it('hides single-model control immediately after changing source and rejects late props', async () => {
		vi.spyOn(PropsService, 'fetch').mockResolvedValue(props(effortTemplate));
		await serverStore.fetch();
		expect(modelsStore.getReasoningControl()).toBe('effort');
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://source-b.test' });
		expect(modelsStore.getReasoningControl()).toBe('none');
		serverStore.clear();
		const slow = deferred<ApiLlamaCppServerProps>();
		vi.mocked(PropsService.fetch).mockReturnValue(slow.promise);
		const pending = serverStore.fetch();
		settingsStore.updateMultipleConfig({ apiKey: 'different' });
		slow.resolve(props(toggleTemplate));
		await pending;
		expect(modelsStore.getReasoningControl()).toBe('none');
	});

	it('does not reuse a pending props request after clearing and returning to the same source', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props('router');
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		const slow = deferred<ApiLlamaCppServerProps>();
		vi.spyOn(PropsService, 'fetchForModel')
			.mockReturnValueOnce(slow.promise)
			.mockResolvedValue(props(toggleTemplate));
		const old = modelsStore.fetchModelProps('same');
		modelsStore.clear();
		await modelsStore.fetchModelProps('same');
		slow.resolve(props(effortTemplate));
		await old;
		expect(modelsStore.getReasoningControl('same')).toBe('toggle');
	});

	it.each([false, true])(
		'binds generation to model A before awaiting props (source switch=%s)',
		async (switchSource) => {
			serverStore.role = ServerRole.ROUTER;
			serverStore.props = props('router default');
			modelsStore.selectedModelName = 'a';
			vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
			const slow = deferred<ApiLlamaCppServerProps>();
			vi.spyOn(PropsService, 'fetchForModel').mockReturnValue(slow.promise);
			vi.spyOn(conversationsStore, 'getThinkingEnabled').mockReturnValue(false);
			vi.spyOn(conversationsStore, 'getReasoningEffort').mockReturnValue(ReasoningEffort.MAX);
			vi.spyOn(agenticStore, 'getConfig').mockReturnValue({ enabled: false } as ReturnType<
				typeof agenticStore.getConfig
			>);
			vi.spyOn(DatabaseService, 'updateMessage').mockResolvedValue(undefined);
			const send = vi.spyOn(ChatService, 'sendMessage').mockResolvedValue(undefined);
			const stream = chatStore as unknown as {
				streamChatCompletion: (
					messages: DatabaseMessage[],
					assistant: DatabaseMessage
				) => Promise<void>;
			};
			const pending = stream.streamChatCompletion([], {
				id: 'assistant',
				convId: 'test'
			} as DatabaseMessage);
			modelsStore.selectedModelName = 'b';
			if (switchSource)
				settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://other-source.test' });
			slow.resolve(props(effortTemplate));
			await pending;
			if (switchSource) expect(send).not.toHaveBeenCalled();
			else
				expect(send).toHaveBeenCalledWith(
					[],
					expect.objectContaining({
						model: 'a',
						llamaReasoningControl: 'effort',
						reasoningEffort: 'max',
						enableThinking: false,
						providerRequestContext: expect.objectContaining({
							serverBaseUrl: 'http://source-a.test'
						})
					}),
					'test',
					expect.any(AbortSignal)
				);
		}
	);
});
