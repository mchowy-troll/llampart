import { API_CHAT, API_MODELS } from '$lib/constants/api-endpoints';
import { API_PROVIDER_IDS, API_PROVIDER_LABELS } from '$lib/constants/api-providers';
import { OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
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
import {
	buildProviderEndpointUrl,
	isAbsoluteHttpUrl,
	normalizeProviderBaseUrl
} from './provider-url';
import type { ApiProviderAdapter } from './provider.types';

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

function looksLikeOpenAiModelsResponse(data: unknown): data is ApiModelListResponse {
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

async function readOpenAiModelsResponse(response: Response): Promise<ApiModelListResponse> {
	if (!response.ok) {
		throw new Error(`${t('server.connectionFailed')} (${response.status})`);
	}

	const contentType = response.headers.get('content-type') || '';
	if (!contentType.toLowerCase().includes('application/json')) {
		throw new Error(t('server.invalidOpenAiModelsJsonResponse'));
	}

	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new Error(t('server.serverReturnedInvalidJson'));
	}

	if (!looksLikeOpenAiModelsResponse(data)) {
		throw new Error(t('server.invalidOpenAiModelsResponse'));
	}

	return data;
}

function buildOpenAiCompatibleChatBody(
	input: ProviderChatCompletionInput
): ApiChatCompletionRequest {
	const { options } = input;
	const requestBody: ApiChatCompletionRequest = {
		messages: input.messages.map((msg) => ({
			role: msg.role,
			content: msg.content,
			tool_call_id: msg.tool_call_id
		})),
		stream: options.stream
	};

	if (options.model) requestBody.model = options.model;
	if (options.temperature !== undefined) requestBody.temperature = options.temperature;
	if (options.top_p !== undefined) requestBody.top_p = options.top_p;
	if (options.presence_penalty !== undefined) {
		requestBody.presence_penalty = options.presence_penalty;
	}
	if (options.frequency_penalty !== undefined) {
		requestBody.frequency_penalty = options.frequency_penalty;
	}
	if (options.max_tokens !== undefined && options.max_tokens !== null && options.max_tokens !== 0) {
		requestBody.max_tokens = options.max_tokens;
	}

	return requestBody;
}

function buildOpenAiCompatibleChatCompletionRequest(
	input: ProviderChatCompletionInput
): ProviderChatCompletionFetchRequest {
	const normalizedServerBaseUrl = normalizeProviderBaseUrl(input.serverBaseUrl, {
		stripOpenAiV1: true
	});

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		throw new Error(t('server.addressMustStartWithHttp'));
	}

	return {
		url: buildProviderEndpointUrl(normalizedServerBaseUrl, API_CHAT.COMPLETIONS),
		init: {
			method: 'POST',
			headers: buildJsonHeaders(input.apiKey),
			body: JSON.stringify(buildOpenAiCompatibleChatBody(input))
		}
	};
}

function parseOpenAiCompatibleChatCompletionStreamData(
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
		completionId: parsed.id
	};
}

function parseOpenAiCompatibleChatCompletionResponse(
	data: unknown
): ProviderChatCompletionResponse {
	const parsed = data as ApiChatCompletionResponse;
	const choice = parsed.choices?.[0];

	return {
		content: choice?.message?.content || '',
		reasoningContent: choice?.message?.reasoning_content,
		toolCalls: choice?.message?.tool_calls,
		model: extractModelName(data)
	};
}

async function validateOpenAiCompatibleConnection(
	input: ProviderConnectionInput,
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<ProviderConnectionValidationResult> {
	const normalizedServerBaseUrl = normalizeProviderBaseUrl(input.serverBaseUrl, {
		stripOpenAiV1: true
	});

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		return {
			ok: false,
			provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
			errorMessage: t('server.addressMustStartWithHttp')
		};
	}

	try {
		const response = await fetchImpl(
			buildProviderEndpointUrl(normalizedServerBaseUrl, API_MODELS.LIST),
			{
				headers: buildHeaders(input.apiKey)
			}
		);

		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				status: response.status,
				errorMessage: t('server.invalidApiKeyCheckTryAgain')
			};
		}

		if (!response.ok) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				status: response.status,
				errorMessage: `${t('server.connectionFailed')} (${response.status})`
			};
		}

		const contentType = response.headers.get('content-type') || '';
		if (!contentType.toLowerCase().includes('application/json')) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				status: response.status,
				errorMessage: t('server.invalidOpenAiModelsJsonResponse')
			};
		}

		let data: unknown;
		try {
			data = await response.json();
		} catch {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				status: response.status,
				errorMessage: t('server.serverReturnedInvalidJson')
			};
		}

		if (!looksLikeOpenAiModelsResponse(data)) {
			return {
				ok: false,
				provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				status: response.status,
				errorMessage: t('server.invalidOpenAiModelsResponse')
			};
		}

		return { ok: true, provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE, status: response.status };
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes('fetch')) {
				return {
					ok: false,
					provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
					errorMessage: t('server.cannotConnectCheckAddressRunning')
				};
			}

			return {
				ok: false,
				provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				errorMessage: error.message
			};
		}

		return {
			ok: false,
			provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
			errorMessage: t('server.connectionErrorTryAgain')
		};
	}
}

async function listOpenAiCompatibleModels(
	input: ProviderModelListInput,
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<ApiModelListResponse> {
	const normalizedServerBaseUrl = normalizeProviderBaseUrl(input.serverBaseUrl, {
		stripOpenAiV1: true
	});

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		throw new Error(t('server.addressMustStartWithHttp'));
	}

	const response = await fetchImpl(
		buildProviderEndpointUrl(normalizedServerBaseUrl, API_MODELS.LIST),
		{
			headers: buildHeaders(input.apiKey)
		}
	);

	return readOpenAiModelsResponse(response);
}

export const openAiCompatibleProvider = {
	id: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
	label: API_PROVIDER_LABELS[API_PROVIDER_IDS.OPENAI_COMPATIBLE],
	description: 'OpenAI-compatible Chat Completions API provider.',
	capabilities: OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES,
	validateConnection: validateOpenAiCompatibleConnection,
	listModels: listOpenAiCompatibleModels,
	buildChatCompletionRequest: buildOpenAiCompatibleChatCompletionRequest,
	parseChatCompletionStreamData: parseOpenAiCompatibleChatCompletionStreamData,
	parseChatCompletionResponse: parseOpenAiCompatibleChatCompletionResponse
} satisfies ApiProviderAdapter;
