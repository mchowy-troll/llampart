import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerRole } from '$lib/enums';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { PropsService } from '$lib/services/props.service';
import { ChatService } from '$lib/services/chat.service';
import { DatabaseService } from '$lib/services/database.service';
import { chatStore, type GenerationModel } from '$lib/stores/chat.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import {
	legacyReasoningIntent,
	resolveReasoning,
	resolveReasoningCapabilities,
	validateDeclaredReasoningLevels
} from '$lib/services/providers/reasoning';
import type { ProviderRequestContext } from '$lib/types/provider';
import type { ReasoningIntent } from '$lib/types/reasoning';

const effortTemplate = `{% if reasoning_effort not in ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] %}{{ raise_exception('unsupported') }}{% endif %}{{ reasoning_effort }}`;
const toggleTemplate = '{% if enable_thinking is defined and enable_thinking %}<think>{% endif %}';
const props = (chat_template: string, chat_template_caps?: Record<string, unknown>) =>
	({
		chat_template,
		chat_template_caps,
		default_generation_settings: { params: {} }
	}) as ApiLlamaCppServerProps;
const original = { ...settingsStore.config };
const context: ProviderRequestContext = {
	providerId: 'llama-server',
	serverBaseUrl: 'http://source-a.test',
	apiKey: '',
	sourceGeneration: 1
};
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

describe('one provider-aware reasoning contract', () => {
	it('does not publish a late reasoning snapshot or declaration across a connection switch', async () => {
		const gate = deferred<ApiLlamaCppServerProps | null>();
		vi.spyOn(modelsStore, 'fetchModelProps').mockImplementation(async () => gate.promise);
		const sourceA = ChatService.createProviderRequestContext();
		const pending = modelsStore.refreshCapabilities(sourceA, 'same-model');
		settingsStore.updateConfig('serverBaseUrl', 'http://source-b.test');
		modelsStore.clear();
		serverStore.role = ServerRole.ROUTER;
		vi.mocked(modelsStore.fetchModelProps).mockResolvedValue(
			props(
				`{% if reasoning_effort not in ['brief', 'deep'] %}{{ raise_exception('bad') }}{% endif %}`
			)
		);
		const sourceB = ChatService.createProviderRequestContext();
		const snapshotB = await modelsStore.refreshCapabilities(sourceB, 'same-model');
		gate.resolve(props(effortTemplate));
		expect(await pending).toBeNull();
		expect(modelsStore.capabilitySnapshot).toBe(snapshotB);
		expect(snapshotB?.reasoning?.effort.values).toEqual(['brief', 'deep']);
		expect(snapshotB?.serverBaseUrl).toBe('http://source-b.test');
		expect(Object.isFrozen(snapshotB?.reasoning)).toBe(true);
		expect(Object.isFrozen(snapshotB?.reasoning?.effort.values)).toBe(true);
	});
	it('reads the real alias/default-filter + tuple guard shape without high aliases', async () => {
		// Observed verbatim grammar in llama-server b11554-966baae76 /props.
		const template = `{%- if enable_thinking is undefined or enable_thinking is true %}
		{%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}
		{%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}
		{{- raise_exception('Unexpected reasoning effort ' ~ reasoning_effort) }}
		{%- endif %}{%- endif %}`;
		const caps = (
			await createCapabilitySnapshot(
				context,
				null,
				props(template, { supports_reasoning_effort: true })
			)
		).reasoning!;
		expect(caps.effort).toMatchObject({ values: ['xhigh', 'medium', 'low'], source: 'template' });
		for (const value of ['xhigh', 'medium', 'low'])
			expect(resolveReasoning(caps, { mode: 'effort', value }).parameters).toEqual({
				chat_template_kwargs: { enable_thinking: true, reasoning_effort: value }
			});
		expect(resolveReasoning(caps, { mode: 'effort', value: 'high' }).available).toBe(false);
		expect(resolveReasoning(caps, { mode: 'off' }).parameters).toEqual({
			chat_template_kwargs: { enable_thinking: false }
		});
	});
	it('reads a literal set through a unique alias but rejects dynamic/reassigned/ambiguous guards', async () => {
		const guard = `{% if effort not in allowed %}{{ raise_exception('bad') }}{% endif %}`;
		const prefix = `{% set allowed = ['brief', 'deep'] %}{% set effort = reasoning_strength | default('brief') %}`;
		expect(
			(await createCapabilitySnapshot(context, 'a', props(prefix + guard))).reasoning!.effort.values
		).toEqual(['brief', 'deep']);
		expect(
			(
				await createCapabilitySnapshot(
					context,
					'a',
					props(
						`{% set reasoning_effort = reasoning_effort | default('brief') %}{% if reasoning_effort not in ['brief', 'deep'] %}{{ raise_exception('bad') }}{% endif %}`
					)
				)
			).reasoning!.effort.values
		).toEqual(['brief', 'deep']);
		for (const template of [
			`{% set allowed = dynamic %}{% set effort = reasoning_effort %}${guard}`,
			`${prefix}{% set effort = other %}${guard}`,
			`${prefix}${guard}{% if effort not in ['other'] %}{{ raise_exception('bad') }}{% endif %}`,
			`{% if reasoning_effort not in ['brief', dynamic] %}{{ raise_exception('bad') }}{% endif %}`,
			`{% macro unused() %}${prefix}${guard}{% endmacro %}`,
			`{% if unrelated %}${prefix}${guard}{% endif %}`,
			`{% if reasoning_effort not in ['brief'] %}{{ raise_exception('bad') if condition else '' }}{% endif %}`,
			`{% set effort = reasoning_effort %}${guard}{% set allowed = ['brief', 'deep'] %}`
		])
			expect(
				(await createCapabilitySnapshot(context, 'a', props(template))).reasoning!.effort.values
			).toBeUndefined();
	});
	it('scopes explicit user declarations to connection/model/protocol/template/build, below metadata', async () => {
		const metadata = props('unrecognized template', { supports_reasoning_effort: true });
		const owner = await createCapabilitySnapshot(context, 'a', metadata);
		const base = resolveReasoningCapabilities(owner, metadata);
		const declarations = JSON.stringify({ [base.declarationKey!]: ['brief', 'deep'] });
		const declared = resolveReasoningCapabilities(owner, metadata, declarations);
		expect(declared.effort).toMatchObject({ values: ['brief', 'deep'], source: 'user' });
		for (const altered of [
			{ ...owner, model: 'b' },
			{ ...owner, connectionIdentity: 'other-key' },
			{ ...owner, serverBaseUrl: 'http://b.test' },
			{ ...owner, protocol: 'responses' as const }
		])
			expect(
				resolveReasoningCapabilities(altered, metadata, declarations).effort.values
			).toBeUndefined();
		for (const altered of [
			{ ...metadata, chat_template: 'changed' },
			{ ...metadata, build_info: 'new-build' }
		])
			expect(
				resolveReasoningCapabilities(owner, altered, declarations).effort.values
			).toBeUndefined();
		expect(
			resolveReasoningCapabilities(
				owner,
				props('', { supports_reasoning_effort: true, reasoning_effort_values: ['exact'] }),
				declarations
			).effort
		).toMatchObject({ values: ['exact'], source: 'metadata' });
		for (const invalid of [[], ['same', 'same'], ['space value'], [''], ['x'.repeat(65)]])
			expect(() => validateDeclaredReasoningLevels(invalid)).toThrow();
	});
	it('trusts metadata, keeps every declared value distinct and retains ownership', async () => {
		const snapshot = await createCapabilitySnapshot(context, 'a', {
			capabilities: {
				reasoning_effort: {
					supported: true,
					values: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'custom-level']
				}
			}
		});
		const caps = snapshot.reasoning!;
		expect(caps).toMatchObject({
			providerId: 'llama-server',
			model: 'a',
			serverBaseUrl: 'http://source-a.test',
			sourceGeneration: 1,
			availability: 'supported',
			control: 'effort',
			protocol: 'chat-completions'
		});
		for (const value of caps.effort.values!) {
			const resolved = resolveReasoning(caps, { mode: 'effort', value });
			expect(resolved.selected).toEqual({ mode: 'effort', value });
			expect(resolved.parameters).toEqual({ chat_template_kwargs: { reasoning_effort: value } });
		}
	});
	it.each(['llama-server', 'vllm', 'openai-compatible'] as const)(
		'preserves supported/unsupported/unknown and Default for %s',
		async (providerId) => {
			for (const declaration of [undefined, true, false]) {
				const snapshot = await createCapabilitySnapshot(
					{ ...context, providerId },
					'a',
					declaration === undefined
						? {}
						: { capabilities: { reasoning: declaration, reasoning_effort: declaration } }
				);
				expect(snapshot.reasoning!.availability).toBe(
					declaration === undefined ? 'unknown' : declaration ? 'supported' : 'unsupported'
				);
				expect(snapshot.reasoning!.effort.values).toBeUndefined();
				const resolved = resolveReasoning(snapshot.reasoning!, { mode: 'effort', value: 'high' });
				expect(resolved.selected).toEqual({ mode: 'effort', value: 'high' });
				expect(resolved.available).toBe(false);
				expect(resolved.parameters).toEqual({});
				expect(resolved.choices).toEqual([{ mode: 'default' }]);
			}
		}
	);
	it('accepts native caps without guessing levels and does not infer Off', async () => {
		const caps = (
			await createCapabilitySnapshot(context, 'a', props('', { supports_reasoning_effort: true }))
		).reasoning!;
		expect(caps).toMatchObject({
			availability: 'supported',
			control: 'effort',
			effort: { state: 'supported' }
		});
		expect(resolveReasoning(caps).choices).toEqual([{ mode: 'default' }]);
		expect(resolveReasoning(caps).parameters).toEqual({});
	});
	it('only uses documented, bounded legacy constructs and never infers unsupported from absence', async () => {
		const legacy = (await createCapabilitySnapshot(context, 'a', props(effortTemplate))).reasoning!;
		expect(legacy.effort.values).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
		for (const template of [
			`{# ${effortTemplate} #}`,
			`{% raw %}${effortTemplate}{% endraw %}`,
			`{{ "example: reasoning_effort high low" }}`,
			`{{ raise_exception('Supported: low medium high') }}`,
			`{% if "reasoning_effort not in ['low']" %}example{% endif %}`,
			`{% set levels = ['low', 'medium', 'high'] %}`,
			'Qwen DeepSeek GPT GGUF',
			`{% if reasoning_effort in ['low', dynamic] %}example{% endif %}`
		]) {
			const caps = (await createCapabilitySnapshot(context, 'a', props(template))).reasoning!;
			expect(caps.availability).toBe('unknown');
			expect(caps.effort.values).toBeUndefined();
		}
		const denied = (
			await createCapabilitySnapshot(
				context,
				'a',
				props(effortTemplate, { supports_reasoning_effort: false })
			)
		).reasoning!;
		expect(denied.effort.state).toBe('unsupported');
		expect(denied.effort.values).toBeUndefined();
	});
	it('keeps native toggle independent from effort and token budgets', async () => {
		const caps = (await createCapabilitySnapshot(context, 'a', props(toggleTemplate))).reasoning!;
		expect(caps.control).toBe('toggle');
		expect(resolveReasoning(caps, { mode: 'off' }).parameters).toEqual({
			chat_template_kwargs: { enable_thinking: false }
		});
		expect(resolveReasoning(caps, { mode: 'on' }).parameters).toEqual({
			chat_template_kwargs: { enable_thinking: true }
		});
		expect(resolveReasoning(caps).parameters).toEqual({});
	});
	it('reads historical preferences without mutation or high/xhigh/max aliases', async () => {
		const caps = (
			await createCapabilitySnapshot(context, 'a', {
				capabilities: { reasoning_effort: { supported: true, values: ['low', 'medium', 'xhigh'] } }
			})
		).reasoning!;
		for (const value of ['low', 'medium', 'high', 'max']) {
			const historical = { thinkingEnabled: true, reasoningEffort: value };
			const intent = legacyReasoningIntent(historical.thinkingEnabled, historical.reasoningEffort);
			const result = resolveReasoning(caps, intent);
			expect(result.selected).toEqual(intent);
			expect(result.available).toBe(['low', 'medium'].includes(value));
			expect(historical.reasoningEffort).toBe(value);
		}
		conversationsStore.activeConversation = {
			id: 'historical',
			thinkingEnabled: true,
			reasoningEffort: 'max'
		} as DatabaseConversation;
		expect(conversationsStore.getReasoningIntent()).toEqual({ mode: 'effort', value: 'max' });
		expect(conversationsStore.activeConversation).not.toHaveProperty('reasoning');
		conversationsStore.activeConversation = null;
	});
});

describe('model/source and operation ownership', () => {
	beforeEach(() => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'llama-server',
			serverBaseUrl: context.serverBaseUrl,
			apiKey: ''
		});
		modelsStore.resetAllModelState();
		serverStore.clear();
	});
	it('uses current single-model props even with an explicit selected model', () => {
		serverStore.role = ServerRole.MODEL;
		serverStore.props = props(toggleTemplate);
		modelsStore.selectedModelName = 'a';
		expect(modelsStore.getReasoningCapabilities()).toMatchObject({
			availability: 'supported',
			control: 'toggle'
		});
	});
	it('uses model-specific router props and never carries A levels to B or another source', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props(effortTemplate);
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		vi.spyOn(PropsService, 'fetchForModel').mockImplementation(async (_, model) =>
			props(model === 'a' ? effortTemplate : toggleTemplate)
		);
		modelsStore.selectedModelName = 'a';
		expect(modelsStore.getReasoningCapabilities().availability).toBe('unknown');
		await modelsStore.fetchModelProps('a');
		expect(modelsStore.getReasoningCapabilities().effort.values).toContain('max');
		modelsStore.selectedModelName = 'b';
		expect(modelsStore.getReasoningCapabilities().effort.values).toBeUndefined();
		await modelsStore.fetchModelProps('b');
		expect(modelsStore.getReasoningCapabilities().control).toBe('toggle');
		expect(modelsStore.getReasoningCapabilities('a').control).toBe('effort');
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://source-b.test' });
		expect(modelsStore.getReasoningCapabilities('a').availability).toBe('unknown');
		expect(modelsStore.getReasoningCapabilities('b').availability).toBe('unknown');
	});
	it('late props for A or a previous source cannot replace selected B', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props('router');
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		const slow = deferred<ApiLlamaCppServerProps>();
		vi.spyOn(PropsService, 'fetchForModel').mockImplementation(async (request, model) =>
			request.serverBaseUrl === context.serverBaseUrl && model === 'a'
				? slow.promise
				: props(toggleTemplate)
		);
		modelsStore.selectedModelName = 'a';
		const pending = modelsStore.fetchModelProps('a');
		modelsStore.selectedModelName = 'b';
		await modelsStore.fetchModelProps('b');
		slow.resolve(props(effortTemplate));
		await pending;
		expect(modelsStore.getReasoningCapabilities().control).toBe('toggle');
		settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://source-b.test' });
		expect(modelsStore.getReasoningCapabilities().availability).toBe('unknown');
	});
	it('does not reuse cleared requests after returning to the same source', async () => {
		serverStore.role = ServerRole.ROUTER;
		serverStore.props = props('router');
		vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
		const slow = deferred<ApiLlamaCppServerProps>();
		vi.spyOn(PropsService, 'fetchForModel')
			.mockReturnValueOnce(slow.promise)
			.mockResolvedValue(props(toggleTemplate));
		const pending = modelsStore.fetchModelProps('same');
		modelsStore.clear();
		await modelsStore.fetchModelProps('same');
		slow.resolve(props(effortTemplate));
		await pending;
		expect(modelsStore.getReasoningCapabilities('same').control).toBe('toggle');
	});
	it.each([false, true])(
		'binds generation to A before awaiting props (source switch=%s)',
		async (switchSource) => {
			serverStore.role = ServerRole.ROUTER;
			serverStore.props = props('router');
			modelsStore.selectedModelName = 'a';
			vi.spyOn(modelsStore, 'isModelLoaded').mockReturnValue(true);
			const slow = deferred<ApiLlamaCppServerProps>();
			vi.spyOn(PropsService, 'fetchForModel').mockReturnValue(slow.promise);
			vi.spyOn(conversationsStore, 'getReasoningIntent').mockReturnValue({
				mode: 'effort',
				value: 'max'
			});
			vi.spyOn(agenticStore, 'getConfig').mockReturnValue({ enabled: false } as ReturnType<
				typeof agenticStore.getConfig
			>);
			vi.spyOn(DatabaseService, 'updateMessage').mockResolvedValue(undefined);
			const send = vi.spyOn(ChatService, 'sendMessage').mockResolvedValue(undefined);
			const stream = chatStore as unknown as {
				captureGenerationModel(): GenerationModel;
				streamChatCompletion(
					messages: DatabaseMessage[],
					assistant: DatabaseMessage,
					onComplete: undefined,
					onError: undefined,
					binding: GenerationModel
				): Promise<void>;
			};
			const pending = stream.streamChatCompletion(
				[],
				{
					id: 'assistant',
					convId: 'test'
				} as DatabaseMessage,
				undefined,
				undefined,
				stream.captureGenerationModel()
			);
			modelsStore.selectedModelName = 'b';
			if (switchSource)
				settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://other-source.test' });
			slow.resolve(props(effortTemplate));
			await pending;
			if (switchSource) expect(send).not.toHaveBeenCalled();
			else {
				const options = send.mock.calls[0][1]!;
				expect(options).toMatchObject({
					model: 'a',
					operationModel: { reasoning: { mode: 'effort', value: 'max' } }
				});
				const snapshot = await options.operationModel!.capabilities;
				expect(snapshot!.model).toBe('a');
				expect(
					resolveReasoning(
						snapshot!.reasoning!,
						options.operationModel!.reasoning as ReasoningIntent
					).parameters
				).toEqual({ chat_template_kwargs: { reasoning_effort: 'max' } });
			}
		}
	);
});
