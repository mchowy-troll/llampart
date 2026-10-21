import { API_CHAT, API_MODELS } from '$lib/constants/api-endpoints';
import { API_PROVIDER_IDS, API_PROVIDER_LABELS } from '$lib/constants/api-providers';
import { LLAMA_SERVER_PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
import { applyProviderReasoning } from './reasoning';
import { serializeToolText } from '$lib/utils/tool-lifecycle';
import { ReasoningFormat } from '$lib/enums';
import { t } from '$lib/i18n';
import type {
	ApiChatCompletionRequest,
	ApiChatCompletionResponse,
	ApiChatCompletionStreamChunk,
	ApiModelListResponse
} from '$lib/types/api';
import type {
	ProviderChatCompletionFetchRequest,
	ProviderChatCompletionInput,
	ProviderChatCompletionResponse,
	ProviderChatCompletionStreamEvent,
	ProviderConnectionInput,
	ProviderConnectionValidationResult,
	ProviderModelListInput
} from '$lib/types/provider';
import { isAbsoluteHttpUrl, normalizeProviderBaseUrl } from './provider-url';
import { buildGatewayRequest, fetchProviderEndpoint } from './provider-transport';
import type { ApiProviderAdapter } from './provider.types';

const PROTECTED_CHAT_REQUEST_KEYS = new Set([
	'messages',
	'stream',
	'tools',
	'model',
	'return_progress',
	'reasoning_format',
	'n_predict',
	'max_tokens'
]);

function buildHeaders(apiKey: string): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/json'
	};

	if (apiKey.trim()) {
		headers.Authorization = `Bearer ${apiKey.trim()}`;
	}

	return headers;
}

function buildJsonHeaders(apiKey: string): Record<string, string> {
	return {
		...buildHeaders(apiKey),
		'Content-Type': 'application/json'
	};
}

function looksLikeLlamaServerProps(data: unknown): boolean {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const record = data as Record<string, unknown>;

	return 'default_generation_settings' in record && 'build_info' in record;
}

function looksLikeModelListResponse(data: unknown): data is ApiModelListResponse {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const record = data as Record<string, unknown>;

	return record.object === 'list' && Array.isArray(record.data);
}

function extractModelName(data: unknown): string | undefined {
	const asRecord = (value: unknown): Record<string, unknown> | undefined => {
		return typeof value === 'object' && value !== null
			? (value as Record<string, unknown>)
			: undefined;
	};

	const getTrimmedString = (value: unknown): string | undefined => {
		return typeof value === 'string' && value.trim() ? value.trim() : undefined;
	};

	const root = asRecord(data);
	if (!root) return undefined;

	const rootModel = getTrimmedString(root.model);
	if (rootModel) return rootModel;

	const firstChoice = Array.isArray(root.choices) ? asRecord(root.choices[0]) : undefined;
	if (!firstChoice) return undefined;

	const deltaModel = getTrimmedString(asRecord(firstChoice.delta)?.model);
	if (deltaModel) return deltaModel;

	const messageModel = getTrimmedString(asRecord(firstChoice.message)?.model);
	if (messageModel) return messageModel;

	return undefined;
}

async function readModelListResponse(response: Response): Promise<ApiModelListResponse> {
	if (!response.ok) {
		throw new Error(`${t('server.connectionFailed')} (${response.status})`);
	}

	const contentType = response.headers.get('content-type') || '';
	if (!contentType.toLowerCase().includes('application/json')) {
		throw new Error(t('server.invalidPropsJsonResponse'));
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new Error(t('server.serverReturnedInvalidJson'));
	}

	if (!looksLikeModelListResponse(data)) {
		throw new Error(t('server.invalidPropsResponse'));
	}

	return data;
}

function buildLlamaServerChatBody(input: ProviderChatCompletionInput): ApiChatCompletionRequest {
	const { options } = input;
	const {
		stream,
		tools,
		temperature,
		max_tokens,
		dynatemp_range,
		dynatemp_exponent,
		top_k,
		top_p,
		min_p,
		xtc_probability,
		xtc_threshold,
		typ_p,
		repeat_last_n,
		repeat_penalty,
		presence_penalty,
		frequency_penalty,
		dry_multiplier,
		dry_base,
		dry_allowed_length,
		dry_penalty_last_n,
		samplers,
		backend_sampling,
		custom,
		timings_per_token,
		disableReasoningParsing,
		excludeReasoningFromContext
	} = options;

	const requestBody: ApiChatCompletionRequest = {
		messages: input.messages.map((msg) => {
			const mapped: ApiChatCompletionRequest['messages'][0] = {
				role: msg.role,
				content: msg.role === 'tool' ? serializeToolText(msg.content) : msg.content,
				tool_calls: msg.tool_calls,
				tool_call_id: msg.tool_call_id
			};

			if (!excludeReasoningFromContext && msg.reasoning_content) {
				mapped.reasoning_content = msg.reasoning_content;
			}

			return mapped;
		}),
		stream,
		return_progress: stream ? true : undefined,
		tools: tools && tools.length > 0 ? tools : undefined
	};

	if (options.model) requestBody.model = options.model;

	requestBody.reasoning_format = disableReasoningParsing
		? ReasoningFormat.NONE
		: ReasoningFormat.AUTO;

	requestBody.reasoning_control = true;

	if (temperature !== undefined) requestBody.temperature = temperature;
	if (max_tokens !== undefined) {
		requestBody.max_tokens = max_tokens !== null && max_tokens !== 0 ? max_tokens : -1;
	}

	if (dynatemp_range !== undefined) requestBody.dynatemp_range = dynatemp_range;
	if (dynatemp_exponent !== undefined) requestBody.dynatemp_exponent = dynatemp_exponent;
	if (top_k !== undefined) requestBody.top_k = top_k;
	if (top_p !== undefined) requestBody.top_p = top_p;
	if (min_p !== undefined) requestBody.min_p = min_p;
	if (xtc_probability !== undefined) requestBody.xtc_probability = xtc_probability;
	if (xtc_threshold !== undefined) requestBody.xtc_threshold = xtc_threshold;
	if (typ_p !== undefined) requestBody.typ_p = typ_p;
	if (repeat_last_n !== undefined) requestBody.repeat_last_n = repeat_last_n;
	if (repeat_penalty !== undefined) requestBody.repeat_penalty = repeat_penalty;
	if (presence_penalty !== undefined) requestBody.presence_penalty = presence_penalty;
	if (frequency_penalty !== undefined) requestBody.frequency_penalty = frequency_penalty;
	if (dry_multiplier !== undefined) requestBody.dry_multiplier = dry_multiplier;
	if (dry_base !== undefined) requestBody.dry_base = dry_base;
	if (dry_allowed_length !== undefined) requestBody.dry_allowed_length = dry_allowed_length;
	if (dry_penalty_last_n !== undefined) requestBody.dry_penalty_last_n = dry_penalty_last_n;

	if (samplers !== undefined) {
		requestBody.samplers =
			typeof samplers === 'string'
				? samplers.split(';').filter((sampler) => sampler.trim())
				: samplers;
	}

	if (backend_sampling !== undefined) requestBody.backend_sampling = backend_sampling;
	if (timings_per_token !== undefined) requestBody.timings_per_token = timings_per_token;

	let explicitCustom: Record<string, unknown> = {};
	if (custom) {
		let customParams: unknown;
		try {
			customParams = typeof custom === 'string' ? JSON.parse(custom) : custom;
		} catch {
			throw new Error('Custom parameters must be valid JSON');
		}

		if (customParams !== null) {
			if (typeof customParams !== 'object' || Array.isArray(customParams)) {
				throw new Error('Custom parameters must be a JSON object');
			}
			const collisions = Object.keys(customParams).filter((key) =>
				PROTECTED_CHAT_REQUEST_KEYS.has(key)
			);
			if (collisions.length > 0) {
				throw new Error(
					`Custom parameters cannot override protected chat request keys: ${collisions.join(', ')}`
				);
			}
			explicitCustom = customParams as Record<string, unknown>;
			Object.assign(requestBody, customParams);
		}
	}
	applyProviderReasoning(
		input,
		'llama-server',
		requestBody as unknown as Record<string, unknown>,
		explicitCustom
	);

	return requestBody;
}

function buildLlamaServerChatCompletionRequest(
	input: ProviderChatCompletionInput
): ProviderChatCompletionFetchRequest {
	const normalizedServerBaseUrl = normalizeProviderBaseUrl(input.serverBaseUrl);

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		throw new Error(t('server.addressMustStartWithHttp'));
	}

	return buildGatewayRequest(
		API_PROVIDER_IDS.LLAMA_SERVER,
		input.serverBaseUrl,
		API_CHAT.COMPLETIONS,
		input.apiKey,
		{
			method: 'POST',
			headers: {
				...buildJsonHeaders(input.apiKey),
				...(input.streamIdentity ? { 'X-Conversation-Id': input.streamIdentity } : {})
			},
			body: JSON.stringify(buildLlamaServerChatBody(input))
		}
	);
}

function parseLlamaServerChatCompletionStreamData(
	data: string
): ProviderChatCompletionStreamEvent | null {
	if (data === '[DONE]') {
		return { done: true };
	}

	const parsed: ApiChatCompletionStreamChunk = JSON.parse(data);
	const choice = parsed.choices?.[0];

	return {
		content: choice?.delta?.content,
		reasoningContent: choice?.delta?.reasoning_content,
		toolCalls: choice?.delta?.tool_calls,
		model: extractModelName(parsed),
		completionId: parsed.id,
		timings: parsed.timings,
		promptProgress: parsed.prompt_progress
	};
}

function parseLlamaServerChatCompletionResponse(data: unknown): ProviderChatCompletionResponse {
	const parsed = data as ApiChatCompletionResponse;
	const choice = parsed.choices?.[0];

	return {
		content: choice?.message?.content || '',
		reasoningContent: choice?.message?.reasoning_content,
		toolCalls: choice?.message?.tool_calls,
		model: extractModelName(data)
	};
}

async function validateLlamaServerConnection(
	input: ProviderConnectionInput,
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProviderConnectionValidationResult> {
	const normalizedServerBaseUrl = normalizeProviderBaseUrl(input.serverBaseUrl);

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		return {
			ok: false,
			provider: API_PROVIDER_IDS.LLAMA_SERVER,
			errorMessage: t('server.addressMustStartWithHttp')
		};
	}

	try {
		const response = await fetchProviderEndpoint(
			{ ...input, providerId: API_PROVIDER_IDS.LLAMA_SERVER },
			'/props',
			{
				headers: buildHeaders(input.apiKey)
			},
			fetchImpl
		);

		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.LLAMA_SERVER,
				status: response.status,
				errorMessage: t('server.invalidApiKeyCheckTryAgain')
			};
		}

		if (!response.ok) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.LLAMA_SERVER,
				status: response.status,
				errorMessage: `${t('server.connectionFailed')} (${response.status})`
			};
		}

		const contentType = response.headers.get('content-type') || '';
		if (!contentType.toLowerCase().includes('application/json')) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.LLAMA_SERVER,
				status: response.status,
				errorMessage: t('server.invalidPropsJsonResponse')
			};
		}

		let data: unknown;
		try {
			data = await response.json();
		} catch {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.LLAMA_SERVER,
				status: response.status,
				errorMessage: t('server.serverReturnedInvalidJson')
			};
		}

		if (!looksLikeLlamaServerProps(data)) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.LLAMA_SERVER,
				status: response.status,
				errorMessage: t('server.invalidPropsResponse')
			};
		}

		return { ok: true, provider: API_PROVIDER_IDS.LLAMA_SERVER, status: response.status };
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes('fetch')) {
				return {
					ok: false,
					provider: API_PROVIDER_IDS.LLAMA_SERVER,
					errorMessage: t('server.cannotConnectCheckAddressRunning')
				};
			}

			return {
				ok: false,
				provider: API_PROVIDER_IDS.LLAMA_SERVER,
				errorMessage: error.message
			};
		}

		return {
			ok: false,
			provider: API_PROVIDER_IDS.LLAMA_SERVER,
			errorMessage: t('server.connectionErrorTryAgain')
		};
	}
}

async function listLlamaServerModels(
	input: ProviderModelListInput,
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<ApiModelListResponse> {
	const normalizedServerBaseUrl = normalizeProviderBaseUrl(input.serverBaseUrl);

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		throw new Error(t('server.addressMustStartWithHttp'));
	}

	const response = await fetchProviderEndpoint(
		{ ...input, providerId: API_PROVIDER_IDS.LLAMA_SERVER },
		API_MODELS.LIST,
		{
			headers: buildHeaders(input.apiKey)
		},
		fetchImpl
	);

	return readModelListResponse(response);
}

export const llamaServerProvider = {
	id: API_PROVIDER_IDS.LLAMA_SERVER,
	label: API_PROVIDER_LABELS[API_PROVIDER_IDS.LLAMA_SERVER],
	description: 'Local llama-server API used by the current llampart runtime.',
	capabilities: LLAMA_SERVER_PROVIDER_CAPABILITIES,
	validateConnection: validateLlamaServerConnection,
	listModels: listLlamaServerModels,
	buildChatCompletionRequest: buildLlamaServerChatCompletionRequest,
	parseChatCompletionStreamData: parseLlamaServerChatCompletionStreamData,
	parseChatCompletionResponse: parseLlamaServerChatCompletionResponse
} satisfies ApiProviderAdapter;
