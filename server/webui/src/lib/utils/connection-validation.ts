import {
	DEFAULT_API_PROVIDER_ID,
	isApiProviderId,
	type ApiProviderId
} from '$lib/constants/api-providers';
import {
	getApiProvider,
	buildProviderEndpointUrl,
	normalizeProviderBaseUrl
} from '$lib/services/providers';
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
	providerId?: string | null
): Promise<ConnectionValidationResult> {
	const provider = getApiProvider(normalizeApiProviderId(providerId));

	return provider.validateConnection({
		serverBaseUrl,
		apiKey
	});
}
