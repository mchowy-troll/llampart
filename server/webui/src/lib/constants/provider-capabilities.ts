import type { ProviderCapabilities } from '$lib/types/provider';
import { API_PROVIDER_IDS, type ApiProviderId } from './api-providers';

/**
 * llama-server provider capabilities as an independently-owned provider.
 * These values intentionally preserve the current 1.1.0 behavior baseline.
 */
export const LLAMA_SERVER_PROVIDER_CAPABILITIES = {
	supportsServerProps: true,
	supportsServerDefaultsSync: true,
	supportsModelList: true,
	supportsModelLoadUnload: true,
	supportsModelProps: true,
	supportsPreEncode: true,
	supportsPromptProgress: true,
	supportsLlamaTimings: true,
	supportsStreamUsage: false,
	requiresModelInChatRequest: false,
	supportsTemperature: true,
	supportsTopP: true,
	supportsMaxTokens: true,
	supportsPresencePenalty: true,
	supportsFrequencyPenalty: true,
	supportsTopK: true,
	supportsMinP: true,
	supportsTypicalP: true,
	supportsDynamicTemperature: true,
	supportsXtc: true,
	supportsDryPenalty: true,
	supportsRepeatPenalty: true,
	supportsSamplerOrder: true,
	supportsBackendSampling: true,
	supportsLlamaReasoningControls: true,
	supportsOpenAiToolCalls: true,
	supportsVisionInput: 'unknown',
	supportsCustomJsonPayload: true
} as const satisfies ProviderCapabilities;

/**
 * OpenAI-compatible provider capabilities for the first MVP track.
 * The provider owns its capabilities directly; it does not inherit from
 * llama-server and then remove unsupported fields.
 */
export const OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES = {
	supportsServerProps: false,
	supportsServerDefaultsSync: false,
	supportsModelList: true,
	supportsModelLoadUnload: false,
	supportsModelProps: false,
	supportsPreEncode: false,
	supportsPromptProgress: false,
	supportsLlamaTimings: false,
	supportsStreamUsage: true,
	requiresModelInChatRequest: true,
	supportsTemperature: true,
	supportsTopP: true,
	supportsMaxTokens: true,
	supportsPresencePenalty: true,
	supportsFrequencyPenalty: true,
	supportsTopK: false,
	supportsMinP: false,
	supportsTypicalP: false,
	supportsDynamicTemperature: false,
	supportsXtc: false,
	supportsDryPenalty: false,
	supportsRepeatPenalty: false,
	supportsSamplerOrder: false,
	supportsBackendSampling: false,
	supportsLlamaReasoningControls: false,
	supportsOpenAiToolCalls: true,
	supportsVisionInput: 'unknown',
	supportsCustomJsonPayload: false
} as const satisfies ProviderCapabilities;

export const PROVIDER_CAPABILITIES = {
	[API_PROVIDER_IDS.LLAMA_SERVER]: LLAMA_SERVER_PROVIDER_CAPABILITIES,
	[API_PROVIDER_IDS.OPENAI_COMPATIBLE]: OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES
} as const satisfies Record<ApiProviderId, ProviderCapabilities>;
