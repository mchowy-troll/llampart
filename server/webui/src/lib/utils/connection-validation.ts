import {
	API_PROVIDER_IDS,
	DEFAULT_API_PROVIDER_ID,
	isApiProviderId,
	type ApiProviderId
} from '$lib/constants/api-providers';
import {
	getApiProvider,
	buildProviderEndpointUrl,
	normalizeProviderBaseUrl
} from '$lib/services/providers';
import { t } from '$lib/i18n';
import type { ProviderConnectionValidationResult } from '$lib/types/provider';

export type ConnectionValidationResult = ProviderConnectionValidationResult;

export function normalizeServerBaseUrl(value: string): string {
	return normalizeProviderBaseUrl(value);
}

export function buildPropsUrl(serverBaseUrl: string): string {
	return buildProviderEndpointUrl(serverBaseUrl, '/props');
}

function normalizeApiProviderId(providerId?: string | null): ApiProviderId {
	return isApiProviderId(providerId) ? providerId : DEFAULT_API_PROVIDER_ID;
}

export async function validateConnectionSettings(
	serverBaseUrl: string,
	apiKey: string,
	providerId?: string | null,
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<ConnectionValidationResult> {
	const normalizedProviderId = normalizeApiProviderId(providerId);

	if (normalizedProviderId === API_PROVIDER_IDS.OPENAI_COMPATIBLE && serverBaseUrl.trim() === '') {
		return {
			ok: false,
			provider: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
			errorMessage: t('settings.openAiCompatibleServerAddressRequired')
		};
	}

	const provider = getApiProvider(normalizedProviderId);

	return provider.validateConnection(
		{
			serverBaseUrl,
			apiKey
		},
		fetchImpl
	);
}
