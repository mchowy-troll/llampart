import { z } from 'zod';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { VLLM_PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
import type {
	ProviderChatCompletionInput,
	ProviderMetric,
	ProviderUsage,
	ProviderConnectionContext
} from '$lib/types/provider';
import { customParameters } from './openai-chat.protocol';
import { createOpenAiProvider } from './openai-provider';
import { fetchProviderEndpoint } from './provider-transport';

const extensions = {
	top_k: z.number().int().min(-1),
	min_p: z.number().finite().min(0).max(1),
	repetition_penalty: z.number().finite().positive(),
	min_tokens: z.number().int().nonnegative(),
	stop_token_ids: z.array(z.number().int().nonnegative()),
	ignore_eos: z.boolean(),
	skip_special_tokens: z.boolean(),
	truncate_prompt_tokens: z.number().int().min(-1),
	structured_outputs: z
		.object({
			json: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
			regex: z.string().min(1).optional(),
			choice: z.array(z.string()).min(1).optional(),
			grammar: z.string().min(1).optional(),
			json_object: z.boolean().optional(),
			structural_tag: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
			whitespace_pattern: z.string().optional(),
			disable_any_whitespace: z.boolean().optional(),
			disable_additional_properties: z.boolean().optional(),
			disable_fallback: z.boolean().optional()
		})
		.strict(),
	chat_template_kwargs: z.record(z.string(), z.unknown()),
	include_reasoning: z.boolean(),
	include_stop_str_in_output: z.boolean(),
	spaces_between_special_tokens: z.boolean(),
	allowed_token_ids: z.array(z.number().int().nonnegative()),
	bad_words: z.array(z.string()),
	length_penalty: z.number().finite(),
	prompt_logprobs: z.number().int().min(-1)
};

export function mapVllmRequest(
	input: ProviderChatCompletionInput,
	body: Record<string, unknown>
): Record<string, unknown> {
	const custom = customParameters(input);
	// This vLLM extension is Chat-only and remains system-owned.
	if (
		body.stream &&
		(input.capabilities?.protocol ?? 'chat-completions') === 'chat-completions' &&
		input.capabilities?.features.streamUsage?.state !== 'unsupported' &&
		input.capabilities?.features.continuous_usage_stats?.state !== 'unsupported'
	)
		body.stream_options = { include_usage: true, continuous_usage_stats: true };
	for (const name of [
		'extra_body',
		'return_progress',
		'reasoning_format',
		'n_predict',
		'samplers',
		'backend_sampling',
		'dry_multiplier',
		'xtc_probability'
	])
		if (name in custom) throw new Error(`Unsupported vLLM parameter: ${name}`);
	for (const [name, schema] of Object.entries(extensions)) {
		const options = input.options as unknown as Record<string, unknown>;
		const value = Object.hasOwn(custom, name)
			? custom[name]
			: (options[name] ?? (name === 'repetition_penalty' ? options.repeat_penalty : undefined));
		if (name in custom && input.capabilities?.features[name]?.state === 'unsupported')
			throw new Error(`Custom vLLM parameter is not supported: ${name}`);
		if (value !== undefined && input.capabilities?.features[name]?.state !== 'unsupported')
			body[name] = schema.parse(value);
	}
	if (
		body.structured_outputs &&
		(body.response_format || (body.text as Record<string, unknown> | undefined)?.format)
	)
		throw new Error('Choose response_format or structured_outputs, not both');
	if (body.structured_outputs) {
		const constraints = body.structured_outputs as Record<string, unknown>;
		if (
			['json', 'regex', 'choice', 'grammar', 'structural_tag', 'json_object'].filter(
				(key) => constraints[key] !== undefined && constraints[key] !== false
			).length > 1
		)
			throw new Error('Structured output constraints are mutually exclusive');
	}
	return body;
}

const metricFields = {
	time_to_first_token_ms: ['timeToFirstToken', 'ms'],
	generation_time_ms: ['generationTime', 'ms'],
	queue_time_ms: ['queueTime', 'ms'],
	mean_itl_ms: ['interTokenLatency', 'ms'],
	tokens_per_second: ['tokensPerSecond', 'tokens/s']
} as const;

export function normalizeVllmUsage(
	data: unknown,
	usage?: ProviderUsage
): ProviderUsage | undefined {
	let root = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
	if (root.response && typeof root.response === 'object')
		root = root.response as Record<string, unknown>;
	const raw =
		root.metrics && typeof root.metrics === 'object'
			? (root.metrics as Record<string, unknown>)
			: {};
	const metrics: ProviderMetric[] = Object.entries(metricFields).map(([field, [name, unit]]) => {
		const value = raw[field];
		return {
			name,
			unit,
			source: 'backend',
			available: typeof value === 'number' && Number.isFinite(value) && value >= 0,
			...(typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { value } : {})
		};
	});
	return usage || root.metrics ? { ...usage, metrics } : undefined;
}

/** Server-wide Prometheus telemetry is intentionally not mapped to a chat result. */
export async function readVllmTelemetry(
	context: ProviderConnectionContext,
	signal?: AbortSignal
): Promise<string> {
	if (context.providerId !== API_PROVIDER_IDS.VLLM) throw new Error('Telemetry requires vLLM');
	const response = await fetchProviderEndpoint(context, '/metrics', {
		signal,
		headers: { Accept: 'text/plain' }
	});
	if (!response.ok) throw new Error(`vLLM telemetry unavailable (${response.status})`);
	return response.text();
}

export const vllmProvider = createOpenAiProvider(
	API_PROVIDER_IDS.VLLM,
	VLLM_PROVIDER_CAPABILITIES,
	{ mapRequest: mapVllmRequest, mapUsage: normalizeVllmUsage }
);
