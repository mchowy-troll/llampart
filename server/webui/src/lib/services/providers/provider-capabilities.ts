import type {
	CapabilitySnapshot,
	CapabilityValue,
	ProviderConnectionContext,
	ProviderProtocol,
	ProviderRequestContext,
	ProviderCapabilityKey
} from '$lib/types/provider';
import { normalizeGatewaySource } from './provider-transport';
import { createSourceFingerprint } from '$lib/utils/resumable-stream-state';
import { resolveReasoningCapabilities } from './reasoning';

export function connectionProtocol(
	providerId: string,
	metadata: Record<string, unknown> = {}
): ProviderProtocol {
	if (providerId === 'llama-server') return 'chat-completions';
	const caps = metadata.capabilities;
	if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return 'chat-completions';
	const declaration = caps as Record<string, unknown>;
	const protocols = declaration.protocols;
	if (Array.isArray(protocols)) {
		if (protocols.includes('chat-completions')) return 'chat-completions';
		if (protocols.length === 1 && protocols[0] === 'responses') return 'responses';
	}
	if (declaration.chat_completions === true) return 'chat-completions';
	if (
		declaration.required_protocol === 'responses' ||
		(declaration.chat_completions === false && declaration.responses === true)
	)
		return 'responses';
	return 'chat-completions';
}

export const CAPABILITY_FEATURES: Partial<Record<ProviderCapabilityKey, string>> = {
	supportsTemperature: 'temperature',
	supportsTopP: 'top_p',
	supportsMaxTokens: 'max_tokens',
	supportsTopK: 'top_k',
	supportsMinP: 'min_p',
	supportsRepeatPenalty: 'repetition_penalty',
	supportsOpenAiToolCalls: 'tools',
	supportsVisionInput: 'vision'
};

export async function createCapabilitySnapshot(
	context: ProviderRequestContext,
	model: string | null,
	metadata?: unknown
): Promise<CapabilitySnapshot> {
	const features: Record<string, CapabilityValue> = {};
	for (const name of [
		'tools',
		'vision',
		'audio',
		'video',
		'reasoning',
		'reasoning_effort',
		'enable_thinking',
		'structured_outputs',
		'response_format',
		'temperature',
		'top_p',
		'presence_penalty',
		'frequency_penalty',
		'max_tokens',
		'max_completion_tokens',
		'parallel_tool_calls',
		'streamUsage',
		'continuous_usage_stats',
		'top_k',
		'min_p',
		'repetition_penalty',
		'min_tokens',
		'stop_token_ids',
		'ignore_eos',
		'skip_special_tokens',
		'truncate_prompt_tokens',
		'chat_template_kwargs',
		'include_reasoning',
		'perRequestMetrics'
	])
		features[name] = { state: 'unknown' };
	for (const name of ['serverProps', 'builtinTools', 'preEncode', 'resumableStreams'])
		features[name] = {
			state: context.providerId === 'llama-server' ? 'supported' : 'unsupported',
			source: 'adapter'
		};
	const raw = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
	const protocol = connectionProtocol(context.providerId, raw);
	features.protocol = { state: 'supported', source: 'adapter', values: [protocol] };
	const capabilities = raw.capabilities;
	if (Array.isArray(capabilities)) {
		for (const name of capabilities)
			if (typeof name === 'string' && name in features)
				features[name] = { state: 'supported', source: 'model-metadata' };
	} else if (capabilities && typeof capabilities === 'object') {
		for (const [name, value] of Object.entries(capabilities)) {
			if (name in features && typeof value === 'boolean')
				features[name] = { state: value ? 'supported' : 'unsupported', source: 'model-metadata' };
			else if (name in features && value && typeof value === 'object') {
				const evidence = value as Record<string, unknown>;
				if (typeof evidence.supported === 'boolean')
					features[name] = {
						state: evidence.supported ? 'supported' : 'unsupported',
						source: 'model-metadata',
						...(Array.isArray(evidence.values) ? { values: [...evidence.values] } : {}),
						...(typeof evidence.minimum === 'number' && Number.isFinite(evidence.minimum)
							? { minimum: evidence.minimum }
							: {}),
						...(typeof evidence.maximum === 'number' && Number.isFinite(evidence.maximum)
							? { maximum: evidence.maximum }
							: {})
					};
			}
		}
	}
	// Architecture metadata alone must not override an explicitly text-only runtime.
	if (
		context.providerId === 'vllm' &&
		(raw.language_model_only === true ||
			(capabilities &&
				typeof capabilities === 'object' &&
				!Array.isArray(capabilities) &&
				(capabilities as Record<string, unknown>).language_model_only === true))
	)
		for (const name of ['vision', 'audio', 'video'])
			features[name] = { state: 'unsupported', source: 'server-metadata' };
	const snapshot: CapabilitySnapshot = {
		providerId: context.providerId,
		serverBaseUrl: normalizeGatewaySource(context.providerId, context.serverBaseUrl).baseUrl,
		sourceGeneration: context.sourceGeneration,
		connectionIdentity: await createSourceFingerprint({ ...context, protocol }),
		model,
		protocol,
		features
	};
	snapshot.reasoning = resolveReasoningCapabilities(snapshot, metadata);
	return snapshot;
}

export function sameConnection(
	left: ProviderConnectionContext,
	right: ProviderConnectionContext
): boolean {
	return (
		left.providerId === right.providerId &&
		left.serverBaseUrl === right.serverBaseUrl &&
		left.apiKey === right.apiKey &&
		(left.protocol ?? 'chat-completions') === (right.protocol ?? 'chat-completions')
	);
}
