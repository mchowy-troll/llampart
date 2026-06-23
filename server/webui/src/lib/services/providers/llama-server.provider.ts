import { API_MODELS } from '$lib/constants/api-endpoints';
import { API_PROVIDER_IDS, API_PROVIDER_LABELS } from '$lib/constants/api-providers';
import { LLAMA_SERVER_PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
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
		const response = await fetchImpl(buildProviderEndpointUrl(normalizedServerBaseUrl, '/props'), {
			headers: buildHeaders(input.apiKey)
		});

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

	const response = await fetchImpl(
		buildProviderEndpointUrl(normalizedServerBaseUrl, API_MODELS.LIST),
		{
			headers: buildHeaders(input.apiKey)
		}
	);

	return readModelListResponse(response);
}

export const llamaServerProvider = {
	id: API_PROVIDER_IDS.LLAMA_SERVER,
	label: API_PROVIDER_LABELS[API_PROVIDER_IDS.LLAMA_SERVER],
	description: 'Local llama-server API used by the current llampart runtime.',
	capabilities: LLAMA_SERVER_PROVIDER_CAPABILITIES,
	validateConnection: validateLlamaServerConnection,
	listModels: listLlamaServerModels
} satisfies ApiProviderAdapter;
