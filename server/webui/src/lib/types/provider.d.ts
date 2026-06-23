import type { ApiProviderId } from '$lib/constants/api-providers';

/**
 * Capability ownership for provider-specific behavior.
 *
 * These flags describe what a provider can do. They are not a list of
 * differences from llama-server; every provider owns its own capabilities.
 */
export interface ProviderCapabilities {
	supportsServerProps: boolean;
	supportsServerDefaultsSync: boolean;
	supportsModelList: boolean;
	supportsModelLoadUnload: boolean;
	supportsModelProps: boolean;
	supportsPreEncode: boolean;
	supportsPromptProgress: boolean;
	supportsLlamaTimings: boolean;
	supportsStreamUsage: boolean;
	requiresModelInChatRequest: boolean;
	supportsTemperature: boolean;
	supportsTopP: boolean;
	supportsMaxTokens: boolean;
	supportsPresencePenalty: boolean;
	supportsFrequencyPenalty: boolean;
	supportsTopK: boolean;
	supportsMinP: boolean;
	supportsTypicalP: boolean;
	supportsDynamicTemperature: boolean;
	supportsXtc: boolean;
	supportsDryPenalty: boolean;
	supportsRepeatPenalty: boolean;
	supportsSamplerOrder: boolean;
	supportsBackendSampling: boolean;
	supportsLlamaReasoningControls: boolean;
	supportsOpenAiToolCalls: boolean;
	supportsVisionInput: boolean | 'unknown';
	supportsCustomJsonPayload: boolean;
}

export type ProviderCapabilityKey = keyof ProviderCapabilities;

export interface ProviderModel {
	id: string;
	name: string;
	provider: ApiProviderId;
	source: ApiProviderId;
	created?: number;
	ownedBy?: string;
	contextSize?: number;
	capabilities?: string[];
	raw?: unknown;
}

export interface ProviderConnectionInput {
	serverBaseUrl: string;
	apiKey: string;
}

export interface ProviderConnectionValidationResult {
	ok: boolean;
	provider: ApiProviderId;
	status?: number;
	errorMessage?: string;
}

export interface ProviderUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	raw?: unknown;
}
