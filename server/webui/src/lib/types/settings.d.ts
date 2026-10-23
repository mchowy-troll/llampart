import type { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import type { ChatMessagePromptProgress, ChatMessageTimings } from './chat';
import type { OpenAIToolDefinition } from './mcp';
import type { DatabaseMessageExtra } from './database';
import type { ParameterSource, SyncableParameterType, SettingsFieldType } from '$lib/enums';
import type { Icon } from '@lucide/svelte';
import type {
	ProviderCapabilityKey,
	ProviderRequestContext,
	ProviderProtocol,
	ProviderChatCompletionStreamEvent
} from '$lib/types/provider';
import type { ApiProviderId } from '$lib/constants/api-providers';
import type { ApiChatCompletionToolCall } from './api';
import type { InterfaceLanguage } from '$lib/i18n/types';
import type { ConversationTimestampFormat } from '$lib/utils/conversation-timestamp';
import type { ColorMode } from '$lib/enums/ui';
import type { ResponsePreferenceKey } from '$lib/utils/response-preferences';

export interface ChatStreamCheckpoint {
	providerContinuation?: import('./provider').ProviderContinuation;
	content: string;
	reasoningContent: string;
	toolCalls: ApiChatCompletionToolCall[];
	timings?: ChatMessageTimings;
	bytesReceived: number;
}

export interface ChatStreamResumeSeed {
	content: string;
	reasoningContent: string;
	toolCalls: ApiChatCompletionToolCall[];
	timings?: ChatMessageTimings;
}

export type SettingsConfigValue = string | number | boolean | undefined;

/**
 * Describes small visual variants for individual settings controls.
 * Keep field shape decisions here so render components do not grow key-specific exception lists.
 */
export type SettingsFieldLayout = 'default' | 'compact-inline-number';

/**
 * Describes the layout used by a complete settings group.
 * New groups should opt into a named layout instead of being inferred from their field keys.
 */
export type SettingsFieldGroupLayout =
	| 'default'
	| 'two-column'
	| 'three-column'
	| 'sidebar'
	| 'attachments-files';

/**
 * Describes the direction used to fill fields inside a multi-column settings group.
 * Column fill preserves top-to-bottom ordering; row fill is useful when a short group should use horizontal space first.
 */
export type SettingsFieldGroupFillMode = 'column' | 'row';

/**
 * Groups related fields inside a named settings group layout.
 * Cluster ownership belongs to field metadata so renderers do not depend on field order.
 */
export type SettingsFieldCluster = 'sidebar-timestamp';

export interface SettingsFieldConfig {
	key: string;
	label: string;
	type: SettingsFieldType;
	/**
	 * 1-based position inside its settings group. Must be continuous per group.
	 */
	order: number;
	isExperimental?: boolean;
	help?: string;
	layout?: SettingsFieldLayout;
	cluster?: SettingsFieldCluster;
	hideHelp?: boolean;
	options?: Array<{ value: string; label: string; icon?: typeof Icon }>;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	requiredProviderCapabilities?: ProviderCapabilityKey[];
	visibleForProviders?: ApiProviderId[];
	visibleWhen?: (config: SettingsConfigType) => boolean;
}

export interface SettingsFieldGroup {
	id: string;
	title?: string;
	description?: string;
	fields: SettingsFieldConfig[];
	fullWidth?: boolean;
	halfWidth?: boolean;
	framed?: boolean;
	layout?: SettingsFieldGroupLayout;
	fillMode?: SettingsFieldGroupFillMode;
	subgroups?: { id: string; title: string; keys: string[] }[];
	requiredProviderCapabilities?: ProviderCapabilityKey[];
	visibleForProviders?: ApiProviderId[];
}

export interface SettingsChatServiceOptions {
	protocol?: ProviderProtocol;
	max_completion_tokens?: number;
	seed?: number;
	stop?: string | string[];
	tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
	parallel_tool_calls?: boolean;
	response_format?: Record<string, unknown>;
	min_tokens?: number;
	stop_token_ids?: number[];
	ignore_eos?: boolean;
	skip_special_tokens?: boolean;
	truncate_prompt_tokens?: number;
	structured_outputs?: Record<string, unknown>;
	chat_template_kwargs?: Record<string, unknown>;
	include_reasoning?: boolean;
	instructions?: string;
	onProviderResult?: (result: ProviderChatCompletionStreamEvent) => void;
	stream?: boolean;
	assistantMessageId?: string;
	providerRequestContext?: ProviderRequestContext;
	operationModel?: import('./provider').OperationModel;
	// Model (required in ROUTER mode, optional in MODEL mode)
	model?: string;
	// System message to inject
	systemMessage?: string;
	// Strip reasoning content from context before sending
	excludeReasoningFromContext?: boolean;
	tools?: OpenAIToolDefinition[];
	// Generation parameters
	temperature?: number;
	max_tokens?: number;
	// Sampling parameters
	dynatemp_range?: number;
	dynatemp_exponent?: number;
	top_k?: number;
	top_p?: number;
	min_p?: number;
	xtc_probability?: number;
	xtc_threshold?: number;
	typ_p?: number;
	// Penalty parameters
	repeat_last_n?: number;
	repeat_penalty?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	dry_multiplier?: number;
	dry_base?: number;
	dry_allowed_length?: number;
	dry_penalty_last_n?: number;
	// Sampler configuration
	samplers?: string | string[];
	backend_sampling?: boolean;
	// Custom parameters
	custom?: string | Record<string, unknown>;
	timings_per_token?: boolean;
	// Callbacks
	onChunk?: (chunk: string) => void;
	onReasoningChunk?: (chunk: string) => void;
	onToolCallChunk?: (chunk: string) => void;
	onAttachments?: (extras: DatabaseMessageExtra[]) => void;
	onModel?: (model: string) => void;
	onCompletionId?: (id: string) => void;
	onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void;
	onStreamCheckpoint?: (checkpoint: ChatStreamCheckpoint) => void | Promise<void>;
	resumeSeed?: ChatStreamResumeSeed;
	onComplete?: (
		response: string,
		reasoningContent?: string,
		timings?: ChatMessageTimings,
		toolCalls?: string,
		providerContinuation?: import('./provider').ProviderContinuation
	) => void;
	onError?: (error: Error) => void | Promise<void>;
}

type WidenSettingValue<T> = T extends boolean
	? boolean
	: T extends number
		? number
		: T extends string
			? string
			: T extends undefined
				? number | '' | undefined
				: never;

type DefaultSettingsConfig = {
	[K in keyof typeof SETTING_CONFIG_DEFAULT]: WidenSettingValue<(typeof SETTING_CONFIG_DEFAULT)[K]>;
};

export type KnownSettingsConfig = Omit<
	DefaultSettingsConfig,
	'apiProvider' | 'theme' | 'interfaceLanguage' | 'uiScale' | 'conversationTimestampFormat'
> & {
	apiProvider: ApiProviderId;
	theme: ColorMode;
	interfaceLanguage: InterfaceLanguage;
	uiScale: '90' | '100' | '110';
	conversationTimestampFormat: ConversationTimestampFormat;
};

export type SettingsConfigType = KnownSettingsConfig &
	Record<ResponsePreferenceKey, boolean> & {
		[key: string]: SettingsConfigValue;
	};

/**
 * Parameter synchronization types for server defaults and user overrides
 * Note: ParameterSource and SyncableParameterType enums are imported from '$lib/enums'
 */
export type ParameterValue = string | number | boolean;
export type ParameterRecord = Record<string, ParameterValue>;

export interface ParameterInfo {
	value: string | number | boolean;
	source: ParameterSource;
	serverDefault?: string | number | boolean;
	userOverride?: string | number | boolean;
}

export interface SyncableParameter {
	key: string;
	serverKey: string;
	type: SyncableParameterType;
	canSync: boolean;
}
