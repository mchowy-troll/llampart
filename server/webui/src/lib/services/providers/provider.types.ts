import type { ApiProviderId } from '$lib/constants/api-providers';
import type { ApiModelListResponse } from '$lib/types/api';
import type {
	ProviderCapabilities,
	ProviderConnectionInput,
	ProviderConnectionValidationResult,
	ProviderModelListInput
} from '$lib/types/provider';

/**
 * Provider metadata and owned runtime contract.
 *
 * API-specific logic belongs in provider adapters. New providers should build
 * their own payloads, validation and stream handling from llampart inputs
 * instead of inheriting llama-server behavior and deleting differences.
 */
export interface ApiProviderAdapter {
	id: ApiProviderId;
	label: string;
	description: string;
	capabilities: ProviderCapabilities;
	validateConnection(
		input: ProviderConnectionInput,
		fetchImpl?: typeof fetch
	): Promise<ProviderConnectionValidationResult>;
	listModels(
		input: ProviderModelListInput,
		fetchImpl?: typeof fetch
	): Promise<ApiModelListResponse>;
}
