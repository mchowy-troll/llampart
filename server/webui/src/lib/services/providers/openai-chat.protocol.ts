import { z } from 'zod';
import { serializeToolText } from '$lib/utils/tool-lifecycle';
import { applyProviderReasoning } from './reasoning';
import type {
	ProviderChatCompletionInput,
	ProviderChatCompletionResponse,
	ProviderChatCompletionStreamEvent,
	ProviderUsage
} from '$lib/types/provider';

const nonnegative = z.number().finite().nonnegative();
// A generation owns only choice 0; tool-call indices remain independent.
const choiceIndex = z.literal(0, { error: 'Chat Completions requires choice index 0' }).optional();
const tool = z.object({
	index: z.number().int().nonnegative().max(1024).optional(),
	id: z.string().optional(),
	type: z.literal('function').optional(),
	function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional()
});
const delta = z
	.object({
		role: z.string().optional(),
		content: z.string().nullable().optional(),
		reasoning: z.string().nullable().optional(),
		reasoning_content: z.string().nullable().optional(),
		reasoningContent: z.string().nullable().optional(),
		refusal: z.string().nullable().optional(),
		tool_calls: z.array(tool).optional()
	})
	.passthrough();
const chunk = z
	.object({
		id: z.string().optional(),
		model: z.string().optional(),
		choices: z
			.array(
				z.object({
					index: choiceIndex,
					delta,
					finish_reason: z.string().nullable().optional()
				})
			)
			.max(1, 'Chat Completions supports only one choice')
			.default([]),
		usage: z.unknown().optional()
	})
	.passthrough();
const response = z
	.object({
		id: z.string().optional(),
		model: z.string().optional(),
		choices: z
			.array(
				z.object({
					index: choiceIndex,
					message: delta,
					finish_reason: z.string().nullable().optional()
				})
			)
			.length(1, 'Chat Completions requires exactly one choice'),
		usage: z.unknown().optional()
	})
	.passthrough();

export function normalizeOpenAiUsage(source: unknown): ProviderUsage | undefined {
	if (source == null) return undefined;
	const usage = z
		.object({
			prompt_tokens: nonnegative.optional(),
			completion_tokens: nonnegative.optional(),
			total_tokens: nonnegative.optional(),
			input_tokens: nonnegative.optional(),
			output_tokens: nonnegative.optional(),
			promptTokens: nonnegative.optional(),
			completionTokens: nonnegative.optional(),
			totalTokens: nonnegative.optional(),
			completion_tokens_details: z
				.object({ reasoning_tokens: nonnegative.optional() })
				.passthrough()
				.nullable()
				.optional(),
			output_tokens_details: z
				.object({ reasoning_tokens: nonnegative.optional() })
				.passthrough()
				.nullable()
				.optional(),
			prompt_tokens_details: z
				.object({ cached_tokens: nonnegative.optional() })
				.passthrough()
				.nullable()
				.optional(),
			input_tokens_details: z
				.object({ cached_tokens: nonnegative.optional() })
				.passthrough()
				.nullable()
				.optional()
		})
		.passthrough()
		.parse(source);
	return {
		promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens,
		completionTokens: usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens,
		totalTokens: usage.total_tokens ?? usage.totalTokens,
		reasoningTokens:
			usage.completion_tokens_details?.reasoning_tokens ??
			usage.output_tokens_details?.reasoning_tokens,
		cachedTokens:
			usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens,
		raw: source
	};
}

export function parseChatStream(data: string): ProviderChatCompletionStreamEvent {
	if (data === '[DONE]') return { done: true };
	const parsed = chunk.parse(JSON.parse(data));
	if (!parsed.choices.length && parsed.usage == null)
		throw new Error('Empty Chat Completions event without usage');
	const choice = parsed.choices[0];
	return {
		content: choice?.delta.content ?? undefined,
		reasoningContent:
			choice?.delta.reasoning ??
			choice?.delta.reasoning_content ??
			choice?.delta.reasoningContent ??
			undefined,
		toolCalls: choice?.delta.tool_calls,
		refusal: choice?.delta.refusal ?? undefined,
		finishReason: choice?.finish_reason ?? undefined,
		model: parsed.model,
		completionId: parsed.id,
		usage: normalizeOpenAiUsage(parsed.usage)
	};
}

export function parseChatResponse(data: unknown): ProviderChatCompletionResponse {
	const parsed = response.parse(data);
	const choice = parsed.choices[0];
	return {
		content: choice.message.content ?? '',
		reasoningContent:
			choice.message.reasoning ??
			choice.message.reasoning_content ??
			choice.message.reasoningContent ??
			undefined,
		toolCalls: choice.message.tool_calls,
		refusal: choice.message.refusal ?? undefined,
		finishReason: choice.finish_reason ?? undefined,
		completionId: parsed.id,
		model: parsed.model,
		usage: normalizeOpenAiUsage(parsed.usage),
		status: 'completed'
	};
}

export const standardParameters = {
	temperature: z.number().finite().min(0).max(2),
	top_p: z.number().finite().min(0).max(1),
	presence_penalty: z.number().finite().min(-2).max(2),
	frequency_penalty: z.number().finite().min(-2).max(2),
	seed: z.number().int(),
	stop: z.union([z.string(), z.array(z.string()).max(4)]),
	max_tokens: z.number().int().positive(),
	max_completion_tokens: z.number().int().positive(),
	tool_choice: z.union([
		z.enum(['none', 'auto', 'required']),
		z.object({ type: z.literal('function'), function: z.object({ name: z.string().min(1) }) })
	]),
	parallel_tool_calls: z.boolean(),
	response_format: z.discriminatedUnion('type', [
		z.object({ type: z.literal('text') }),
		z.object({ type: z.literal('json_object') }),
		z.object({
			type: z.literal('json_schema'),
			json_schema: z.object({
				name: z.string().min(1),
				schema: z.record(z.string(), z.unknown()),
				description: z.string().optional(),
				strict: z.boolean().optional()
			})
		})
	]),
	logprobs: z.boolean(),
	top_logprobs: z.number().int().min(0).max(20)
};

export function customParameters(input: ProviderChatCompletionInput): Record<string, unknown> {
	const raw = input.options.custom;
	if (!raw) return {};
	const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error('Custom parameters must be a JSON object');
	const custom = parsed as Record<string, unknown>;
	for (const key of [
		'messages',
		'input',
		'model',
		'stream',
		'tools',
		'store',
		'previous_response_id',
		'background',
		'stream_options',
		'__proto__',
		'constructor',
		'prototype'
	])
		if (Object.hasOwn(custom, key))
			throw new Error(`Custom parameters cannot override protected chat request keys: ${key}`);
	return custom;
}

export function buildChatBody(
	input: ProviderChatCompletionInput,
	providerId: 'vllm' | 'openai-compatible' = input.capabilities?.providerId === 'vllm'
		? 'vllm'
		: 'openai-compatible',
	serializeReasoning = true
): Record<string, unknown> {
	const { options } = input;
	const custom = customParameters(input);
	for (const key of Object.keys(custom))
		if (input.capabilities?.features[key]?.state === 'unsupported')
			throw new Error(`Custom parameter is not supported by this backend/model: ${key}`);
	const body: Record<string, unknown> = {
		...custom,
		model: options.model,
		messages: input.messages.map((message) => ({
			role: message.role,
			content: message.role === 'tool' ? serializeToolText(message.content) : message.content,
			tool_calls: message.tool_calls,
			tool_call_id: message.tool_call_id,
			...(!options.excludeReasoningFromContext && message.reasoning_content
				? { reasoning_content: message.reasoning_content }
				: {})
		})),
		stream: Boolean(options.stream)
	};
	// Presence matters: explicit undefined must not become an omitted/default n.
	// Custom JSON takes precedence over direct request options, as for other parameters.
	if (Object.hasOwn(custom, 'n') || Object.hasOwn(options, 'n')) {
		if (input.capabilities?.features.n?.state === 'unsupported')
			throw new Error('Parameter is not supported by this backend/model: n');
		const n = Object.hasOwn(custom, 'n')
			? custom.n
			: (options as unknown as Record<string, unknown>).n;
		if (n !== null && n !== 1)
			throw new Error(
				'Chat Completions supports only one choice: n must be 1 or null (or omitted)'
			);
		if (n === 1) body.n = 1;
		else delete body.n;
	}
	if (!options.model) throw new Error('This provider requires an exact model ID');
	for (const message of input.messages) {
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			const modality =
				part.type === 'image_url'
					? 'vision'
					: part.type === 'input_audio'
						? 'audio'
						: part.type === 'input_video'
							? 'video'
							: undefined;
			if (modality && input.capabilities?.features[modality]?.state === 'unsupported')
				throw new Error(`This backend/model explicitly does not support ${modality} input`);
			if (part.type === 'input_video')
				throw new Error('This protocol does not support the native input_video representation');
		}
	}
	if (options.stream && input.capabilities?.features.streamUsage?.state !== 'unsupported')
		body.stream_options = { include_usage: true };
	if (options.tools?.length && input.capabilities?.features.tools?.state !== 'unsupported')
		body.tools = options.tools;
	for (const [name, schema] of Object.entries(standardParameters)) {
		let value = Object.hasOwn(custom, name)
			? custom[name]
			: ((options as unknown as Record<string, unknown>)[name] ?? body[name]);
		if (
			name === 'max_tokens' &&
			typeof value === 'number' &&
			value <= 0 &&
			!Object.hasOwn(custom, name)
		)
			value = undefined;
		const capability = input.capabilities?.features[name];
		if (value !== undefined && capability?.state !== 'unsupported') {
			const validated = schema.parse(value);
			if (capability?.values && !capability.values.includes(validated))
				throw new Error(`Value is not supported by this model: ${name}`);
			if (
				typeof validated === 'number' &&
				((capability?.minimum !== undefined && validated < capability.minimum) ||
					(capability?.maximum !== undefined && validated > capability.maximum))
			)
				throw new Error(`Value is outside this model's range: ${name}`);
			body[name] = validated;
		}
	}
	if (
		input.capabilities?.features.max_tokens?.state === 'unsupported' &&
		input.capabilities?.features.max_completion_tokens?.state === 'supported' &&
		body.max_completion_tokens === undefined &&
		options.max_tokens !== undefined &&
		options.max_tokens > 0
	)
		body.max_completion_tokens = standardParameters.max_completion_tokens.parse(options.max_tokens);
	if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined)
		throw new Error('max_tokens and max_completion_tokens are mutually exclusive');
	if (!body.tools) {
		if (custom.tool_choice !== undefined || custom.parallel_tool_calls !== undefined)
			throw new Error('Custom tool parameters require enabled tools');
		delete body.tool_choice;
		delete body.parallel_tool_calls;
	}
	if (serializeReasoning)
		applyProviderReasoning(
			{ ...input, options: { ...input.options, protocol: 'chat-completions' } },
			providerId,
			body,
			custom
		);
	return body;
}
