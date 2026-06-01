import type { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import type { ChatMessagePromptProgress, ChatMessageTimings } from './chat';
import type { OpenAIToolDefinition } from './mcp';
import type { DatabaseMessageExtra } from './database';
import type { ParameterSource, SyncableParameterType, SettingsFieldType } from '$lib/enums';
import type { Icon } from '@lucide/svelte';

export type SettingsConfigValue = string | number | boolean | undefined;

/**
 * Describes small visual variants for individual settings controls.
 * Keep field shape decisions here so render components do not grow key-specific exception lists.
 */
export type SettingsFieldLayout =
	| 'default'
	| 'compact-inline-number'
	| 'compact-peer-checkbox'
	| 'aligned-mcp-number'
	| 'sidebar-nested';

/**
 * Describes the layout used by a complete settings group.
 * New groups should opt into a named layout instead of being inferred from their field keys.
 */
export type SettingsFieldGroupLayout =
	| 'default'
	| 'two-column'
	| 'three-column'
	| 'sidebar'
	| 'message-display'
	| 'attachments-files';

/**
 * Places fields inside named multi-column group layouts.
 * Column ownership belongs to field metadata so renderers do not depend on field order.
 */
export type SettingsFieldColumn = 'left' | 'right';

/**
 * Groups related fields inside a named settings group layout.
 * Cluster ownership belongs to field metadata so renderers do not depend on field order.
 */
export type SettingsFieldCluster = 'sidebar-timestamp';

export interface SettingsFieldConfig {
	key: string;
	label: string;
	type: SettingsFieldType;
	isExperimental?: boolean;
	help?: string;
	layout?: SettingsFieldLayout;
	column?: SettingsFieldColumn;
	cluster?: SettingsFieldCluster;
	hideHelp?: boolean;
	options?: Array<{ value: string; label: string; icon?: typeof Icon }>;
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
}

export interface SettingsChatServiceOptions {
	stream?: boolean;
	// Model (required in ROUTER mode, optional in MODEL mode)
	model?: string;
	// System message to inject
	systemMessage?: string;
	// Disable reasoning parsing (use 'none' instead of 'auto')
	disableReasoningParsing?: boolean;
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
	custom?: string;
	timings_per_token?: boolean;
	// Callbacks
	onChunk?: (chunk: string) => void;
	onReasoningChunk?: (chunk: string) => void;
	onToolCallChunk?: (chunk: string) => void;
	onAttachments?: (extras: DatabaseMessageExtra[]) => void;
	onModel?: (model: string) => void;
	onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void;
	onComplete?: (
		response: string,
		reasoningContent?: string,
		timings?: ChatMessageTimings,
		toolCalls?: string
	) => void;
	onError?: (error: Error) => void;
}

export type SettingsConfigType = typeof SETTING_CONFIG_DEFAULT & {
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
