import type { MessageRole } from '$lib/enums';
import { ToolCallType } from '$lib/enums';
import type {
	ApiChatCompletionRequest,
	ApiChatCompletionToolCall,
	ApiChatMessageContentPart,
	ApiChatMessageData
} from './api';
import type { ChatMessageTimings, ChatMessagePromptProgress } from './chat';
import type { ChatStreamCheckpoint } from './settings';
import type { DatabaseMessage, DatabaseMessageExtra, McpServerOverride } from './database';
import type { ProviderRequestContext } from './provider';

export type ToolExecutionStatus =
	| 'not_started'
	| 'denied'
	| 'started'
	| 'completed'
	| 'error'
	| 'interrupted_unknown';

export type AgenticTerminalReason = 'completed' | 'limit' | 'stopped' | 'error';

export interface ToolCallExecution {
	toolCallId: string;
	status: ToolExecutionStatus;
	resultMessageId?: string;
	error?: string;
}

/** Stored on the assistant, never in the actual tool output. No startup recovery. */
export interface AgenticTurnState {
	operationId: string;
	calls: ToolCallExecution[];
	terminalReason?: AgenticTerminalReason;
}

export interface AgenticMessageIdentity {
	conversationId: string;
	operationId: string;
	assistantMessageId: string;
}

export interface AgenticToolOutcome {
	status: ToolExecutionStatus;
	error?: string;
	result?: { content: string; extras?: DatabaseMessageExtra[] };
}

/**
 * Agentic orchestration configuration.
 */
export interface AgenticConfig {
	enabled: boolean;
	maxTurns: number;
	maxToolPreviewLines: number;
}

/**
 * Tool call payload for agentic messages.
 */
export type AgenticToolCallPayload = {
	id: string;
	type: ToolCallType.FUNCTION;
	function: {
		name: string;
		arguments: string;
	};
};

/**
 * Agentic message types for different roles.
 */
export type AgenticMessage =
	| {
			role: MessageRole.SYSTEM | MessageRole.USER;
			content: string | ApiChatMessageContentPart[];
	  }
	| {
			role: MessageRole.ASSISTANT;
			content?: string | ApiChatMessageContentPart[];
			reasoning_content?: string;
			providerContinuation?: import('./provider').ProviderContinuation;
			tool_calls?: AgenticToolCallPayload[];
	  }
	| {
			role: MessageRole.TOOL;
			tool_call_id: string;
			content: string | ApiChatMessageContentPart[];
	  };

export type AgenticAssistantMessage = Extract<AgenticMessage, { role: MessageRole.ASSISTANT }>;
export type AgenticToolCallList = NonNullable<AgenticAssistantMessage['tool_calls']>;

export type AgenticChatCompletionRequest = Omit<ApiChatCompletionRequest, 'messages'> & {
	messages: AgenticMessage[];
	stream: true;
	tools?: ApiChatCompletionRequest['tools'];
};

/**
 * Per-conversation agentic session state.
 * Enables parallel agentic flows across multiple chats.
 */
export interface AgenticSession {
	isRunning: boolean;
	currentTurn: number;
	totalToolCalls: number;
	lastError: Error | null;
	streamingToolCall: { name: string; arguments: string } | null;
	terminalReason: AgenticTerminalReason | null;
}

/**
 * Callbacks for agentic flow execution.
 *
 * The agentic loop creates separate DB messages for each turn:
 * - assistant messages (one per LLM turn, with tool_calls if any)
 * - tool result messages (one per tool call execution)
 *
 * The first assistant message is created by the caller before starting the flow.
 * Subsequent messages are created via createToolResultMessage / createAssistantMessage.
 */
export interface AgenticFlowCallbacks {
	/** Bind the first placeholder only once the agent has accepted this operation. */
	onFlowStart?: (identity: AgenticMessageIdentity) => Promise<void>;
	/** Content chunk for the current assistant message */
	onChunk?: (chunk: string) => void;
	/** Reasoning content chunk for the current assistant message */
	onReasoningChunk?: (chunk: string) => void;
	/** Tool calls being streamed (partial, accumulating) for the current turn */
	onToolCallsStreaming?: (toolCalls: ApiChatCompletionToolCall[]) => void;
	/** Attachments extracted from tool results */
	onAttachments?: (messageId: string, extras: DatabaseMessageExtra[]) => void;
	/** Model name detected from response */
	onModel?: (model: string) => void;
	/** Current assistant turn's streaming is complete - save to DB */
	onAssistantTurnComplete?: (
		identity: AgenticMessageIdentity,
		content: string,
		reasoningContent: string | undefined,
		timings: ChatMessageTimings | undefined,
		toolCalls: ApiChatCompletionToolCall[] | undefined,
		providerContinuation?: import('./provider').ProviderContinuation
	) => Promise<void>;
	/** Atomic lifecycle transition; only confirmed results create tool messages. */
	onToolCallState?: (
		identity: AgenticMessageIdentity,
		toolCallId: string,
		outcome: AgenticToolOutcome
	) => Promise<DatabaseMessage | undefined>;
	/** Create a new assistant message for the next agentic turn */
	createAssistantMessage?: () => Promise<DatabaseMessage>;
	/** Entire agentic flow is complete */
	onFlowComplete?: (outcome: {
		identity: AgenticMessageIdentity;
		reason: AgenticTerminalReason;
		timings?: ChatMessageTimings;
	}) => void | Promise<void>;
	/** Error during flow */
	onError?: (error: Error) => void | Promise<void>;
	/** Timing updates during streaming */
	onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void;
	/** An agentic turn (LLM + tool execution) completed - intermediate timing update */
	onTurnComplete?: (intermediateTimings: ChatMessageTimings) => void;
	/** Persist the current assistant turn before its replay offset advances. */
	onStreamCheckpoint?: (checkpoint: ChatStreamCheckpoint) => void | Promise<void>;
}

/**
 * Options for agentic flow execution
 */
export interface AgenticFlowOptions {
	stream?: boolean;
	model?: string;
	assistantMessageId?: string;
	operationId?: string;
	providerRequestContext?: ProviderRequestContext;
	operationModel?: import('./provider').OperationModel;
	temperature?: number;
	max_tokens?: number;
	onStreamCheckpoint?: (checkpoint: ChatStreamCheckpoint) => void | Promise<void>;
	[key: string]: unknown;
}

/**
 * Parameters for starting an agentic flow
 */
export interface AgenticFlowParams {
	conversationId: string;
	messages: (ApiChatMessageData | (DatabaseMessage & { extra?: DatabaseMessageExtra[] }))[];
	options?: AgenticFlowOptions;
	callbacks: AgenticFlowCallbacks;
	signal?: AbortSignal;
	perChatOverrides?: McpServerOverride[];
}

/**
 * Result of an agentic flow execution
 */
export interface AgenticFlowResult {
	handled: boolean;
	error?: Error;
}
