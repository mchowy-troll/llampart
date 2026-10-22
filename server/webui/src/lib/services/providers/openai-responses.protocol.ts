import { z } from 'zod';
import { serializeToolText } from '$lib/utils/tool-lifecycle';
import type {
	ProviderChatCompletionInput,
	ProviderChatCompletionResponse,
	ProviderChatCompletionStreamEvent
} from '$lib/types/provider';
import {
	buildChatBody,
	customParameters,
	normalizeOpenAiUsage,
	standardParameters
} from './openai-chat.protocol';
import { applyProviderReasoning } from './reasoning';

const object = (value: unknown): Record<string, unknown> =>
	z.record(z.string(), z.unknown()).parse(value);
const string = (value: unknown): string => z.string().parse(value);

export function buildResponsesBody(
	input: ProviderChatCompletionInput,
	providerId: 'vllm' | 'openai-compatible' = input.capabilities?.providerId === 'vllm'
		? 'vllm'
		: 'openai-compatible'
): Record<string, unknown> {
	const custom = customParameters(input);
	// Responses has no n, even when Chat accepts 1/null. Reject before shared
	// validation/normalization and before the extension-copy loop can reintroduce it.
	if (Object.hasOwn(custom, 'n') || Object.hasOwn(input.options, 'n'))
		throw new Error('Responses API does not support n; remove the parameter');
	// Unlike Chat Completions, standard Responses has no penalty parameters.
	// Neutral UI defaults are harmless; explicit Custom JSON remains intentional.
	const penalties: Record<string, unknown> = {};
	for (const name of ['presence_penalty', 'frequency_penalty'] as const) {
		const explicit = Object.hasOwn(custom, name);
		const value = explicit ? custom[name] : input.options[name];
		if (value === undefined && !explicit) continue;
		if (input.capabilities?.features[name]?.state === 'supported') {
			penalties[name] = value;
		} else if (explicit || value !== 0) {
			throw new Error(
				`Responses API does not support ${name}; this backend must explicitly declare support for the extension. Remove the Custom JSON parameter or reset the setting to 0.`
			);
		}
	}
	const chat = buildChatBody(
		{ ...input, options: { ...input.options, protocol: 'responses' } },
		providerId,
		false
	);
	for (const name of Object.keys(penalties)) penalties[name] = chat[name];
	const items: Record<string, unknown>[] = [];
	for (const message of input.messages) {
		const continuation = message.providerContinuation;
		if (
			continuation &&
			input.capabilities &&
			input.capabilities.protocol === 'responses' &&
			continuation.protocol === 'responses' &&
			continuation.providerId === input.capabilities.providerId &&
			continuation.sourceFingerprint === input.capabilities.connectionIdentity &&
			continuation.model === input.options.model
		) {
			items.push(...continuation.reasoningItems.map((item) => ({ ...item })));
		}
		if (message.role === 'tool') {
			if (!message.tool_call_id) throw new Error('Function output requires a call ID');
			items.push({
				type: 'function_call_output',
				call_id: message.tool_call_id,
				output: serializeToolText(message.content)
			});
			continue;
		}
		if (message.content && (typeof message.content === 'string' || message.content.length)) {
			const content =
				typeof message.content === 'string'
					? message.content
					: message.content.map((part) => {
							if (part.type === 'text')
								return {
									type: message.role === 'assistant' ? 'output_text' : 'input_text',
									text: part.text
								};
							if (part.type === 'image_url' && part.image_url)
								return {
									type: 'input_image',
									image_url: part.image_url.url,
									detail: part.image_url.detail
								};
							throw new Error('This content part is not supported by the Responses protocol');
						});
			items.push({ role: message.role, content });
		}
		for (const call of message.tool_calls ?? []) {
			if (!call.id || !call.function?.name)
				throw new Error('Function call history requires ID and name');
			items.push({
				type: 'function_call',
				call_id: call.id,
				name: call.function.name,
				arguments: call.function.arguments ?? ''
			});
		}
	}
	const body: Record<string, unknown> = {
		model: chat.model,
		input: items,
		store: false,
		stream: chat.stream,
		include: ['reasoning.encrypted_content'],
		...penalties
	};
	if (input.options.instructions !== undefined) body.instructions = input.options.instructions;
	if (custom.instructions !== undefined) body.instructions = z.string().parse(custom.instructions);
	for (const name of ['temperature', 'top_p', 'parallel_tool_calls', 'top_logprobs'])
		if (chat[name] !== undefined) body[name] = chat[name];
	if (chat.max_completion_tokens ?? chat.max_tokens)
		body.max_output_tokens = chat.max_completion_tokens ?? chat.max_tokens;
	if (custom.max_output_tokens !== undefined) {
		if (body.max_output_tokens !== undefined)
			throw new Error('Response token-limit variants are mutually exclusive');
		body.max_output_tokens = z.number().int().positive().parse(custom.max_output_tokens);
	}
	if (custom.reasoning !== undefined) {
		body.reasoning = z
			.object({
				effort: z.string().min(1).optional(),
				summary: z.enum(['auto', 'concise', 'detailed']).nullable().optional()
			})
			.strict()
			.parse(custom.reasoning);
	}
	if (chat.tools)
		body.tools = input.options.tools?.map((tool) => ({ type: 'function', ...tool.function }));
	if (chat.tool_choice)
		body.tool_choice =
			typeof chat.tool_choice === 'string'
				? chat.tool_choice
				: { type: 'function', name: object(object(chat.tool_choice).function).name };
	if (chat.response_format) {
		const format = object(chat.response_format);
		body.text = {
			format:
				format.type === 'json_schema'
					? { type: 'json_schema', ...object(format.json_schema) }
					: format
		};
	}
	if (custom.text !== undefined) {
		if (body.text) throw new Error('Response text format variants are mutually exclusive');
		body.text = z
			.object({
				verbosity: z.enum(['low', 'medium', 'high']).optional(),
				format: z
					.discriminatedUnion('type', [
						z.object({ type: z.literal('text') }),
						z.object({ type: z.literal('json_object') }),
						z.object({
							type: z.literal('json_schema'),
							name: z.string().min(1),
							schema: z.record(z.string(), z.unknown()),
							strict: z.boolean().optional()
						})
					])
					.optional()
			})
			.strict()
			.parse(custom.text);
	}
	// Backend extensions stay flat. Standard Chat-only fields need an explicit error,
	// not silent loss during translation to Responses.
	for (const [key, value] of Object.entries(custom)) {
		if (providerId === 'vllm' && (key === 'stop' || key === 'seed')) {
			// buildChatBody already checks unsupported, values and numeric ranges.
			// Reuse its validated value and schemas (Zod 4 int is a safe integer),
			// rejecting even explicitly supplied undefined instead of silently omitting it.
			// Only Custom JSON opts in; do not introduce Settings defaults here.
			body[key] = standardParameters[key].parse(chat[key]);
			continue;
		}
		if (['stop', 'logprobs', 'seed'].includes(key))
			throw new Error(`Custom parameter is not supported by Responses serialization: ${key}`);
		if (
			![
				'temperature',
				'top_p',
				'top_logprobs',
				'presence_penalty',
				'frequency_penalty',
				'max_tokens',
				'max_completion_tokens',
				'max_output_tokens',
				'reasoning_effort',
				'reasoning',
				'tool_choice',
				'parallel_tool_calls',
				'response_format',
				'text'
			].includes(key)
		)
			body[key] = value;
	}
	if (chat.chat_template_kwargs) body.chat_template_kwargs = chat.chat_template_kwargs;
	applyProviderReasoning(
		{ ...input, options: { ...input.options, protocol: 'responses' } },
		providerId,
		body,
		custom
	);
	return body;
}

export function parseResponsesResponse(data: unknown): ProviderChatCompletionResponse {
	const parsed = object(data);
	const status = z
		.enum(['completed', 'incomplete', 'failed', 'cancelled', 'in_progress', 'queued'])
		.parse(parsed.status);
	if (status === 'in_progress' || status === 'queued')
		throw new Error('Unexpected nonterminal Responses result');
	const output = z.array(z.unknown()).parse(parsed.output ?? []);
	let content = '';
	let reasoningContent = '';
	let refusal = '';
	const reasoningItems: Record<string, unknown>[] = [];
	const toolCalls: NonNullable<ProviderChatCompletionResponse['toolCalls']> = [];
	for (const raw of output) {
		const item = object(raw);
		if (item.type === 'message') {
			for (const rawPart of z.array(z.unknown()).parse(item.content)) {
				const part = object(rawPart);
				if (part.type === 'output_text') content += string(part.text);
				else if (part.type === 'refusal') refusal += string(part.refusal);
				else throw new Error('Unsupported Responses message content');
			}
		} else if (item.type === 'reasoning') {
			reasoningItems.push(item);
			for (const rawPart of z.array(z.unknown()).parse(item.content ?? item.summary ?? []))
				reasoningContent += string(object(rawPart).text);
		} else if (item.type === 'function_call') {
			if (toolCalls.some((call) => call.id === item.call_id))
				throw new Error('Duplicate Responses call ID');
			toolCalls.push({
				id: string(item.call_id),
				type: 'function',
				function: { name: string(item.name), arguments: string(item.arguments) }
			});
		} else throw new Error('Unsupported Responses output item');
	}
	return {
		reasoningItems,
		content,
		reasoningContent: reasoningContent || undefined,
		refusal: refusal || undefined,
		toolCalls: toolCalls.length ? toolCalls : undefined,
		model: parsed.model === undefined ? undefined : string(parsed.model),
		completionId: parsed.id === undefined ? undefined : string(parsed.id),
		usage: normalizeOpenAiUsage(parsed.usage),
		status,
		finishReason:
			status === 'incomplete'
				? String(object(parsed.incomplete_details ?? {}).reason ?? 'incomplete')
				: status
	};
}

/** One parser per request: output indices and call IDs never leak across streams. */
export function createResponsesStreamParser(): (
	data: string,
	eventType?: string
) => ProviderChatCompletionStreamEvent | null {
	const calls = new Map<
		number,
		{ index: number; id: string; name: string; arguments: string; itemId?: string }
	>();
	let terminal = false;
	let content = '';
	let reasoning = '';
	let refusal = '';
	const reconcile = (outputIndex: number, raw: unknown) => {
		const item = object(raw);
		const id = string(item.call_id);
		const name = string(item.name);
		const args = string(item.arguments);
		const call = calls.get(outputIndex);
		if (call) {
			if (
				call.id !== id ||
				call.name !== name ||
				!args.startsWith(call.arguments) ||
				(call.itemId && item.id !== call.itemId)
			)
				throw new Error('Responses terminal function does not match deltas');
			const suffix = args.slice(call.arguments.length);
			call.arguments = args;
			return suffix ? { index: call.index, function: { arguments: suffix } } : undefined;
		}
		if ([...calls.values()].some((entry) => entry.id === id))
			throw new Error('Duplicate Responses call ID');
		const entry = { index: calls.size, id, name, arguments: args };
		calls.set(outputIndex, entry);
		return {
			index: entry.index,
			id,
			type: 'function' as const,
			function: { name, arguments: args }
		};
	};
	return (data, eventType) => {
		if (data === '[DONE]' && terminal) return null;
		if (terminal) throw new Error('Responses event after terminal outcome');
		const event = object(JSON.parse(data));
		const type = string(event.type);
		if (eventType && eventType !== type) throw new Error('Responses SSE event/type mismatch');
		const outputIndex = () => z.number().int().nonnegative().parse(event.output_index);
		const validateItemId = (call: { itemId?: string }) => {
			if (event.item_id !== undefined && call.itemId && string(event.item_id) !== call.itemId)
				throw new Error('Responses function item ID mismatch');
		};
		if (
			[
				'response.completed',
				'response.failed',
				'response.incomplete',
				'response.cancelled'
			].includes(type)
		) {
			terminal = true;
			const parsed = parseResponsesResponse(event.response);
			if (`response.${parsed.status}` !== type)
				throw new Error('Responses terminal status mismatch');
			if (!parsed.content.startsWith(content) || !(parsed.refusal ?? '').startsWith(refusal))
				throw new Error('Responses terminal output does not match deltas');
			const output = z.array(z.unknown()).parse(object(event.response).output ?? []);
			for (const [index, call] of calls) {
				const final = object(output[index] ?? {});
				if (final.type !== 'function_call' || final.call_id !== call.id)
					throw new Error('Responses terminal function does not match deltas');
			}
			const toolCalls = output.flatMap((raw, index) => {
				if (object(raw).type !== 'function_call') return [];
				const delta = reconcile(index, raw);
				return delta ? [delta] : [];
			});
			return {
				toolCalls: toolCalls.length ? toolCalls : undefined,
				content: parsed.content.slice(content.length) || undefined,
				refusal: (parsed.refusal ?? '').slice(refusal.length) || undefined,
				reasoningContent: (parsed.reasoningContent ?? '').startsWith(reasoning)
					? parsed.reasoningContent?.slice(reasoning.length) || undefined
					: undefined,
				reasoningItems: parsed.reasoningItems,
				done: true,
				status: parsed.status,
				usage: parsed.usage,
				model: parsed.model,
				completionId: parsed.completionId,
				finishReason: parsed.finishReason
			};
		}
		if (type === 'error') throw new Error('Responses backend error');
		if (type === 'response.output_text.delta') {
			const delta = string(event.delta);
			content += delta;
			return { content: delta };
		}
		if (type === 'response.refusal.delta') {
			const delta = string(event.delta);
			refusal += delta;
			return { refusal: delta };
		}
		if (
			type === 'response.reasoning_summary_text.delta' ||
			type === 'response.reasoning_text.delta'
		) {
			const delta = string(event.delta);
			reasoning += delta;
			return { reasoningContent: delta };
		}
		if (type === 'response.output_item.added') {
			const item = object(event.item);
			if (item.type === 'function_call') {
				const index = outputIndex();
				if (calls.has(index)) throw new Error('Duplicate Responses function index');
				if ([...calls.values()].some((call) => call.id === item.call_id))
					throw new Error('Duplicate Responses call ID');
				const call = {
					index: calls.size,
					id: string(item.call_id),
					name: string(item.name),
					arguments: string(item.arguments ?? ''),
					itemId: item.id === undefined ? undefined : string(item.id)
				};
				calls.set(index, call);
				return {
					toolCalls: [
						{
							index: call.index,
							id: call.id,
							type: 'function',
							function: { name: call.name, arguments: call.arguments }
						}
					]
				};
			}
			if (!['message', 'reasoning'].includes(String(item.type)))
				throw new Error('Unsupported Responses item');
			return null;
		}
		if (type === 'response.function_call_arguments.delta') {
			const call = calls.get(outputIndex());
			if (!call) throw new Error('Function delta without an output item');
			validateItemId(call);
			const delta = string(event.delta);
			call.arguments += delta;
			return { toolCalls: [{ index: call.index, function: { arguments: delta } }] };
		}
		if (type === 'response.function_call_arguments.done') {
			const call = calls.get(outputIndex());
			if (!call || !string(event.arguments).startsWith(call.arguments))
				throw new Error('Function arguments do not match deltas');
			validateItemId(call);
			const suffix = string(event.arguments).slice(call.arguments.length);
			call.arguments = string(event.arguments);
			return suffix
				? { toolCalls: [{ index: call.index, function: { arguments: suffix } }] }
				: null;
		}
		if (type === 'response.output_item.done' && object(event.item).type === 'function_call') {
			const delta = reconcile(outputIndex(), event.item);
			return delta ? { toolCalls: [delta] } : null;
		}
		if (type === 'response.created' || type === 'response.in_progress') {
			const response = object(event.response);
			return {
				completionId: string(response.id),
				model: response.model === undefined ? undefined : string(response.model)
			};
		}
		if (
			[
				'response.output_text.done',
				'response.refusal.done',
				'response.output_item.done',
				'response.content_part.added',
				'response.content_part.done',
				'response.reasoning_summary_part.added',
				'response.reasoning_summary_part.done',
				'response.reasoning_summary_text.done',
				'response.reasoning_text.done',
				'response.output_text.annotation.added'
			].includes(type)
		)
			return null;
		throw new Error('Unknown Responses stream event');
	};
}
