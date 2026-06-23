import { API_MODELS } from '$lib/constants/api-endpoints';
import { API_PROVIDER_IDS, API_PROVIDER_LABELS } from '$lib/constants/api-providers';
import { OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
import { t } from '$lib/i18n';
import type { ApiModelListResponse } from '$lib/types/api';
import type {
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

function looksLikeOpenAiModelsResponse(data: unknown): data is ApiModelListResponse {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const record = data as Record<string, unknown>;

	return record.object === 'list' && Array.isArray(record.data);
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
	listModels: listOpenAiCompatibleModels
} satisfies ApiProviderAdapter;
