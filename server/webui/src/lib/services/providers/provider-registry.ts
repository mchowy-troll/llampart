import {
	API_PROVIDER_IDS,
	DEFAULT_API_PROVIDER_ID,
	isApiProviderId,
	type ApiProviderId
} from '$lib/constants/api-providers';
import type { ProviderCapabilities } from '$lib/types/provider';

type ProviderCapabilitySettings = {
	disableOpenAiCompatibleTools?: unknown;
};
import { llamaServerProvider } from './llama-server.provider';
import { openAiCompatibleProvider } from './openai-compatible.provider';
import type { ApiProviderAdapter } from './provider.types';

export const API_PROVIDER_REGISTRY = {
	[API_PROVIDER_IDS.LLAMA_SERVER]: llamaServerProvider,
	[API_PROVIDER_IDS.OPENAI_COMPATIBLE]: openAiCompatibleProvider
} as const satisfies Record<ApiProviderId, ApiProviderAdapter>;

export function getApiProvider(providerId?: string | null): ApiProviderAdapter {
	const normalizedProviderId = isApiProviderId(providerId) ? providerId : DEFAULT_API_PROVIDER_ID;
	return API_PROVIDER_REGISTRY[normalizedProviderId];
}

export function getApiProviderCapabilities(
	providerId?: string | null,
	settings?: ProviderCapabilitySettings
): ProviderCapabilities {
	const provider = getApiProvider(providerId);

	if (
		provider.id === API_PROVIDER_IDS.OPENAI_COMPATIBLE &&
		settings?.disableOpenAiCompatibleTools === true
	) {
		return { ...provider.capabilities, supportsOpenAiToolCalls: false };
	}

	return provider.capabilities;
}
