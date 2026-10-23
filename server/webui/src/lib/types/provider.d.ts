import type { ApiProviderId } from '$lib/constants/api-providers';
import type {
	ApiChatCompletionToolCall,
	ApiChatCompletionToolCallDelta,
	ApiChatMessageData
} from '$lib/types/api';
import type { ChatMessagePromptProgress, ChatMessageTimings } from '$lib/types/chat';
import type { SettingsChatServiceOptions } from '$lib/types/settings';

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
	supportsResumableStreams: boolean;
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
	supportsOpenAiToolCalls: boolean;
	supportsBuiltinToolsEndpoint: boolean;
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

export interface ProviderConnectionContext extends ProviderConnectionInput {
	readonly providerId: ApiProviderId;
	readonly serverBaseUrl: string;
	readonly apiKey: string;
	readonly protocol?: ProviderProtocol;
}

export interface ProviderRequestContext extends ProviderConnectionContext {
	readonly sourceGeneration: number;
}

export interface ProviderConnectionValidationResult {
	ok: boolean;
	provider: ApiProviderId;
	status?: number;
	errorMessage?: string;
}

export interface ProviderModelListInput {
	serverBaseUrl: string;
	apiKey: string;
}

export interface ProviderChatCompletionInput {
	serverBaseUrl: string;
	apiKey: string;
	messages: ApiChatMessageData[];
	options: SettingsChatServiceOptions;
	streamIdentity?: string;
	capabilities?: CapabilitySnapshot;
}

export interface ProviderChatCompletionFetchRequest {
	url: string;
	init: RequestInit;
}

export interface ProviderChatCompletionStreamEvent {
	reasoningItems?: Record<string, unknown>[];
	done?: boolean;
	content?: string;
	reasoningContent?: string;
	toolCalls?: ApiChatCompletionToolCallDelta[];
	model?: string;
	completionId?: string;
	timings?: ChatMessageTimings;
	promptProgress?: ChatMessagePromptProgress;
	usage?: ProviderUsage;
	finishReason?: string;
	refusal?: string;
	status?: 'completed' | 'incomplete' | 'failed' | 'cancelled';
}

export interface ProviderChatCompletionResponse {
	reasoningItems?: Record<string, unknown>[];
	content: string;
	reasoningContent?: string;
	toolCalls?: ApiChatCompletionToolCall[];
	model?: string;
	usage?: ProviderUsage;
	completionId?: string;
	finishReason?: string;
	refusal?: string;
	status?: 'completed' | 'incomplete' | 'failed' | 'cancelled';
}

export interface ProviderUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	reasoningTokens?: number;
	cachedTokens?: number;
	metrics?: ProviderMetric[];
	raw?: unknown;
}

export type ProviderProtocol = 'chat-completions' | 'responses';
export type CapabilityState = 'supported' | 'unsupported' | 'unknown';
export interface CapabilityValue {
	state: CapabilityState;
	source?: 'adapter' | 'connection' | 'model-metadata' | 'server-metadata' | 'request';
	values?: readonly unknown[];
	minimum?: number;
	maximum?: number;
}
export interface CapabilitySnapshot {
	/** Observable backend/model/template signature, distinct from source identity. */
	backendIdentity?: string;
	providerId: ApiProviderId;
	serverBaseUrl: string;
	sourceGeneration: number;
	model: string | null;
	connectionIdentity: string;
	protocol: ProviderProtocol;
	features: Readonly<Record<string, CapabilityValue>>;
}

/** Operation-owned selection, including an intentional absence of a wire model.
 * Capabilities are captured once for this model/source, never the later UI selection. */
export interface OperationModel {
	readonly conversationId: string | null;
	readonly model: string | null;
	readonly requestContext: ProviderRequestContext;
	readonly capabilities: Promise<CapabilitySnapshot | null>;
	readonly modelInfo: Promise<import('./message-model-info').MessageModelInfoSnapshot | null>;
}

export interface ProviderMetric {
	name: string;
	value?: number;
	unit: 'tokens' | 'ms' | 'tokens/s';
	source: 'backend' | 'browser';
	available: boolean;
}

/** Opaque stateless Responses reasoning items, bound to the exact source.
 * No API key or previous_response_id is persisted. */
export interface ProviderContinuation {
	providerId: ApiProviderId;
	protocol: 'responses';
	sourceFingerprint: string;
	model: string;
	reasoningItems: Record<string, unknown>[];
}
