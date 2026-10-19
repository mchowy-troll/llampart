/**
 * agenticStore - Reactive State Store for Agentic Loop Orchestration
 *
 * Manages multi-turn agentic loop with MCP tools:
 * - LLM streaming with tool call detection
 * - Tool execution via mcpStore
 * - Session state management
 * - Turn limit enforcement
 *
 * Each agentic turn produces separate DB messages:
 * - One assistant message per LLM turn (with tool_calls if any)
 * - One tool result message per tool call execution
 *
 * **Architecture & Relationships:**
 * - **ChatService**: Stateless API layer (sendMessage, streaming)
 * - **mcpStore**: MCP connection management and tool execution
 * - **agenticStore** (this): Reactive state + business logic
 *
 * @see ChatService in services/chat.service.ts for API operations
 * @see mcpStore in stores/mcp.svelte.ts for MCP operations
 */

import { ChatService } from '$lib/services/chat.service';
import { getApiProviderCapabilities } from '$lib/services/providers';
import { config } from '$lib/stores/settings.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { permissionsStore } from '$lib/stores/permissions.svelte';
import { isAbortError } from '$lib/utils/abort';
import { projectToolHistory, toolExecutionDescription } from '$lib/utils/tool-lifecycle';
import { uuid } from '$lib/utils/uuid';
import { ToolExecutionUnavailableError } from '$lib/utils/tool-registry';
import { DEFAULT_AGENTIC_CONFIG, LLM_ERROR_BLOCK_START, LLM_ERROR_BLOCK_END } from '$lib/constants';
import {
	AttachmentType,
	MessageRole,
	ToolCallType,
	ToolSource,
	ToolPermissionDecision
} from '$lib/enums';
import type {
	AgenticFlowParams,
	AgenticFlowResult,
	AgenticSession,
	AgenticConfig,
	SettingsConfigType,
	McpServerOverride,
	ToolEntry,
	ToolExecutionScope
} from '$lib/types';
import { SvelteMap } from 'svelte/reactivity';
import type {
	AgenticMessage,
	AgenticToolCallList,
	AgenticFlowCallbacks,
	AgenticFlowOptions
} from '$lib/types/agentic';
import type {
	AgenticTerminalReason,
	AgenticMessageIdentity,
	ToolExecutionStatus
} from '$lib/types/agentic';
import type { ApiChatCompletionToolCall, ApiChatMessageData } from '$lib/types/api';
import type {
	ChatMessagePromptProgress,
	ChatMessageTimings,
	ChatMessageAgenticTimings,
	ChatMessageToolCallTiming,
	ChatMessageAgenticTurnStats
} from '$lib/types/chat';
import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types/database';
import { extractToolResultImages } from '$lib/utils/tool-result-images';

function createDefaultSession(): AgenticSession {
	return {
		isRunning: false,
		currentTurn: 0,
		totalToolCalls: 0,
		lastError: null,
		streamingToolCall: null,
		terminalReason: null
	};
}

function toAgenticMessages(messages: ApiChatMessageData[]): AgenticMessage[] {
	return messages.map((message) => {
		if (
			message.role === MessageRole.ASSISTANT &&
			message.tool_calls &&
			message.tool_calls.length > 0
		) {
			return {
				role: MessageRole.ASSISTANT,
				providerContinuation: message.providerContinuation,
				content: message.content,
				tool_calls: message.tool_calls.map((call, index) => ({
					id: call.id ?? `call_${index}`,
					type: (call.type as ToolCallType.FUNCTION) ?? ToolCallType.FUNCTION,
					function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' }
				}))
			} satisfies AgenticMessage;
		}
		if (message.role === MessageRole.TOOL && message.tool_call_id) {
			return {
				role: MessageRole.TOOL,
				tool_call_id: message.tool_call_id,
				content: message.content
			} satisfies AgenticMessage;
		}
		return {
			role: message.role as MessageRole.SYSTEM | MessageRole.USER,
			content: message.content
		} satisfies AgenticMessage;
	});
}

class AgenticStore {
	private _sessions = new SvelteMap<string, AgenticSession>();
	private _pendingPermissions = $state<
		Record<string, { toolName: string; serverLabel: string } | null>
	>({});
	private _permissionResolvers = new Map<string, (decision: ToolPermissionDecision) => void>();
	private flowControllers = new Map<string, AbortController>();

	get isReady(): boolean {
		return true;
	}
	get isAnyRunning(): boolean {
		for (const session of this._sessions.values()) {
			if (session.isRunning) return true;
		}
		return false;
	}

	getSession(conversationId: string): AgenticSession {
		let session = this._sessions.get(conversationId);
		if (!session) {
			session = createDefaultSession();
			this._sessions.set(conversationId, session);
		}
		return session;
	}

	private updateSession(conversationId: string, update: Partial<AgenticSession>): void {
		const session = this.getSession(conversationId);
		this._sessions.set(conversationId, { ...session, ...update });
	}

	clearSession(conversationId: string): void {
		this.flowControllers.get(conversationId)?.abort();
		this.flowControllers.delete(conversationId);
		this._sessions.delete(conversationId);
		this.setPendingPermission(conversationId, null);
	}

	abortActiveSourceOperations(): void {
		for (const controller of this.flowControllers.values()) controller.abort();
		this.flowControllers.clear();
		for (const [conversationId, resolver] of this._permissionResolvers) {
			this._permissionResolvers.delete(conversationId);
			resolver(ToolPermissionDecision.DENY);
		}
	}

	getActiveSessions(): Array<{ conversationId: string; session: AgenticSession }> {
		const active: Array<{ conversationId: string; session: AgenticSession }> = [];
		for (const [conversationId, session] of this._sessions.entries()) {
			if (session.isRunning) active.push({ conversationId, session });
		}
		return active;
	}

	isRunning(conversationId: string): boolean {
		return this.getSession(conversationId).isRunning;
	}

	currentTurn(conversationId: string): number {
		return this.getSession(conversationId).currentTurn;
	}

	totalToolCalls(conversationId: string): number {
		return this.getSession(conversationId).totalToolCalls;
	}

	lastError(conversationId: string): Error | null {
		return this.getSession(conversationId).lastError;
	}

	streamingToolCall(conversationId: string): { name: string; arguments: string } | null {
		return this.getSession(conversationId).streamingToolCall;
	}

	private setPendingPermission(
		conversationId: string,
		request: { toolName: string; serverLabel: string } | null
	): void {
		this._pendingPermissions = { ...this._pendingPermissions, [conversationId]: request };
	}

	pendingPermissionRequest(
		conversationId: string
	): { toolName: string; serverLabel: string } | null {
		return this._pendingPermissions[conversationId] ?? null;
	}

	resolvePermission(conversationId: string, decision: ToolPermissionDecision): void {
		const resolver = this._permissionResolvers.get(conversationId);

		if (!resolver) return;

		this._permissionResolvers.delete(conversationId);
		resolver(decision);
	}

	clearError(conversationId: string): void {
		this.updateSession(conversationId, { lastError: null });
	}

	getConfig(settings: SettingsConfigType, perChatOverrides?: McpServerOverride[]): AgenticConfig {
		const supportsToolCalling = getApiProviderCapabilities(
			String(settings.apiProvider ?? '')
		).supportsOpenAiToolCalls;
		const maxTurns = Number(settings.agenticMaxTurns) || DEFAULT_AGENTIC_CONFIG.maxTurns;
		const maxToolPreviewLines =
			Number(settings.agenticMaxToolPreviewLines) || DEFAULT_AGENTIC_CONFIG.maxToolPreviewLines;
		const hasTools =
			supportsToolCalling &&
			(mcpStore.hasEnabledServers(perChatOverrides) || toolsStore.builtinTools.length > 0);
		return {
			enabled: supportsToolCalling && hasTools && DEFAULT_AGENTIC_CONFIG.enabled,
			maxTurns,
			maxToolPreviewLines
		};
	}

	private parseToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
		if (typeof args === 'object') return args;
		const trimmed = args.trim();
		if (trimmed === '') return {};
		return JSON.parse(trimmed) as Record<string, unknown>;
	}

	private async requestPermission(
		conversationId: string,
		entry: ToolEntry,
		signal?: AbortSignal
	): Promise<ToolPermissionDecision> {
		const permissionKey = entry.key;
		const toolName = entry.apiName;
		const serverLabel =
			entry.serverName ??
			(entry.source === ToolSource.BUILTIN ? toolsStore.getToolServerLabel(toolName) : '');

		if (permissionKey && permissionsStore.hasTool(permissionKey)) {
			return ToolPermissionDecision.ONCE;
		}

		this.setPendingPermission(conversationId, { toolName, serverLabel });

		return new Promise<ToolPermissionDecision>((resolve) => {
			const finish = (decision: ToolPermissionDecision) => {
				this.setPendingPermission(conversationId, null);

				if (decision === ToolPermissionDecision.ALWAYS && permissionKey) {
					permissionsStore.allowTool(permissionKey);
				} else if (decision === ToolPermissionDecision.ALWAYS_SERVER) {
					permissionsStore.allowTools(toolsStore.getServerPermissionKeys(entry));
				}

				resolve(decision);
			};

			if (signal?.aborted) {
				finish(ToolPermissionDecision.DENY);
				return;
			}

			this._permissionResolvers.set(conversationId, finish);

			signal?.addEventListener(
				'abort',
				() => {
					const resolver = this._permissionResolvers.get(conversationId);

					if (!resolver) return;

					this._permissionResolvers.delete(conversationId);
					resolver(ToolPermissionDecision.DENY);
				},
				{ once: true }
			);
		});
	}

	async runAgenticFlow(params: AgenticFlowParams): Promise<AgenticFlowResult> {
		const { conversationId, messages, options = {}, callbacks, signal, perChatOverrides } = params;
		const overridesSnapshot = perChatOverrides?.map((override) => ({ ...override }));
		const toolExecutionScope = mcpStore.createToolExecutionScope(overridesSnapshot);
		const requestContext =
			options.operationModel?.requestContext ??
			options.providerRequestContext ??
			ChatService.createProviderRequestContext();
		const operationModel =
			options.operationModel ?? ChatService.captureOperationModel(requestContext, options.model);
		const flowController = new AbortController();
		this.flowControllers.get(conversationId)?.abort();
		this.flowControllers.set(conversationId, flowController);
		const flowSignal = signal
			? AbortSignal.any([signal, flowController.signal])
			: flowController.signal;
		const notHandled = (): AgenticFlowResult => {
			if (this.flowControllers.get(conversationId) === flowController) {
				this.flowControllers.delete(conversationId);
			}
			return { handled: false };
		};

		this.setPendingPermission(conversationId, null);
		this._permissionResolvers.delete(conversationId);

		if (
			getApiProviderCapabilities(requestContext.providerId).supportsBuiltinToolsEndpoint &&
			!toolsStore.hasBuiltinToolsForContext(requestContext) &&
			!toolsStore.loading
		) {
			await toolsStore.fetchBuiltinTools(requestContext);
		}
		if (flowSignal.aborted || !ChatService.isProviderRequestContextCurrent(requestContext)) {
			return notHandled();
		}

		const agenticConfig = this.getConfig(config(), overridesSnapshot);
		if (!agenticConfig.enabled) return notHandled();

		const hasMcpServers = mcpStore.hasEnabledServers(overridesSnapshot);
		let hasMcpConnection = false;
		if (hasMcpServers) {
			hasMcpConnection = await mcpStore.ensureInitialized(overridesSnapshot);
			if (flowSignal.aborted || !ChatService.isProviderRequestContextCurrent(requestContext)) {
				return notHandled();
			}
			if (!hasMcpConnection) {
				console.log('[AgenticStore] MCP not initialized');
			}
		}

		const toolEntries = toolsStore.getEnabledToolEntriesForLLM(requestContext, toolExecutionScope);
		if (toolEntries.length === 0) {
			console.log('[AgenticStore] No tools available, falling back to standard chat');
			return notHandled();
		}
		const tools = toolEntries.map((entry) => entry.definition);

		console.log(`[AgenticStore] Starting agentic flow with ${tools.length} tools`);

		const normalizedMessages: ApiChatMessageData[] = messages
			.map((msg) => {
				if ('id' in msg && 'convId' in msg && 'timestamp' in msg)
					return ChatService.convertDbMessageToApiChatMessageData(
						msg as DatabaseMessage & { extra?: DatabaseMessageExtra[] }
					);
				return msg as ApiChatMessageData;
			})
			.filter((msg) => {
				if (msg.role === MessageRole.SYSTEM) {
					const content = typeof msg.content === 'string' ? msg.content : '';
					return content.trim().length > 0;
				}
				return true;
			});

		this.updateSession(conversationId, {
			isRunning: true,
			currentTurn: 0,
			totalToolCalls: 0,
			lastError: null,
			terminalReason: null
		});
		if (hasMcpConnection) mcpStore.acquireConnection();

		try {
			await this.executeAgenticLoop({
				conversationId,
				messages: normalizedMessages,
				options: { ...options, model: operationModel.model ?? undefined, operationModel },
				tools,
				toolEntries,
				toolExecutionScope,
				requestContext,
				agenticConfig,
				callbacks,
				signal: flowSignal
			});
			return { handled: true };
		} catch (error) {
			const normalizedError = error instanceof Error ? error : new Error(String(error));
			this.updateSession(conversationId, { lastError: normalizedError });
			await callbacks.onError?.(normalizedError);
			return { handled: true, error: normalizedError };
		} finally {
			if (this.flowControllers.get(conversationId) === flowController) {
				this.flowControllers.delete(conversationId);
			}
			this.updateSession(conversationId, { isRunning: false });
			if (hasMcpConnection)
				await mcpStore
					.releaseConnection()
					.catch((err: unknown) =>
						console.warn('[AgenticStore] Failed to release MCP connection:', err)
					);
		}
	}

	private async executeAgenticLoop(params: {
		conversationId: string;
		messages: ApiChatMessageData[];
		options: AgenticFlowOptions;
		tools: ReturnType<typeof mcpStore.getToolDefinitionsForLLM>;
		toolEntries: ToolEntry[];
		toolExecutionScope: ToolExecutionScope;
		requestContext: NonNullable<AgenticFlowOptions['providerRequestContext']>;
		agenticConfig: AgenticConfig;
		callbacks: AgenticFlowCallbacks;
		signal?: AbortSignal;
	}): Promise<void> {
		const {
			conversationId,
			messages,
			options,
			tools,
			toolEntries,
			toolExecutionScope,
			requestContext,
			agenticConfig,
			callbacks,
			signal
		} = params;
		const entriesByApiName = new Map(toolEntries.map((entry) => [entry.apiName, entry]));
		const {
			onChunk,
			onReasoningChunk,
			onToolCallsStreaming,
			onModel,
			onAssistantTurnComplete,
			onToolCallState,
			createAssistantMessage,
			onFlowComplete,
			onTimings,
			onTurnComplete,
			onStreamCheckpoint
		} = callbacks;

		const sessionMessages: AgenticMessage[] = toAgenticMessages(projectToolHistory(messages));
		let capturedTimings: ChatMessageTimings | undefined;
		let totalToolCallCount = 0;

		const agenticTimings: ChatMessageAgenticTimings = {
			turns: 0,
			toolCallsCount: 0,
			toolsMs: 0,
			toolCalls: [],
			perTurn: [],
			llm: { predicted_n: 0, predicted_ms: 0, prompt_n: 0, prompt_ms: 0 }
		};
		const maxTurns = agenticConfig.maxTurns;

		let assistantMessageId = options.assistantMessageId;
		const operationId = options.operationId ?? uuid();
		const identity = (): AgenticMessageIdentity => ({
			conversationId,
			operationId,
			assistantMessageId: assistantMessageId ?? ''
		});
		let reason: AgenticTerminalReason = 'completed';
		const pending = new SvelteMap<string, ToolExecutionStatus>();
		if (
			!assistantMessageId ||
			!callbacks.onFlowStart ||
			!onAssistantTurnComplete ||
			!onToolCallState ||
			!onFlowComplete
		) {
			throw new Error('Agentic execution requires owned durable lifecycle callbacks');
		}

		try {
			await callbacks.onFlowStart?.(identity());
			for (let turn = 0; turn < maxTurns; turn++) {
				this.updateSession(conversationId, { currentTurn: turn + 1 });
				agenticTimings.turns = turn + 1;

				if (signal?.aborted) {
					reason = 'stopped';
					return;
				}

				// For turns > 0, create a new assistant message via callback
				if (turn > 0 && createAssistantMessage) {
					assistantMessageId = (await createAssistantMessage()).id;
				}
				pending.clear();

				let turnContent = '';
				let turnReasoningContent = '';
				let turnToolCalls: ApiChatCompletionToolCall[] = [];
				let acceptingStreamCallbacks = true;
				let lastStreamingToolCallName = '';
				let lastStreamingToolCallArgsLength = 0;
				let turnTimings: ChatMessageTimings | undefined;
				let turnContinuation: import('$lib/types/provider').ProviderContinuation | undefined;

				const turnStats: ChatMessageAgenticTurnStats = {
					turn: turn + 1,
					llm: { predicted_n: 0, predicted_ms: 0, prompt_n: 0, prompt_ms: 0 },
					toolCalls: [],
					toolsMs: 0
				};

				try {
					await ChatService.sendMessage(
						sessionMessages as ApiChatMessageData[],
						{
							...options,
							providerRequestContext: requestContext,
							assistantMessageId,
							stream: true,
							tools: tools.length > 0 ? tools : undefined,
							onChunk: (chunk: string) => {
								if (!acceptingStreamCallbacks) return;
								turnContent += chunk;
								onChunk?.(chunk);
							},
							onReasoningChunk: (chunk: string) => {
								if (!acceptingStreamCallbacks) return;
								turnReasoningContent += chunk;
								onReasoningChunk?.(chunk);
							},
							onToolCallChunk: (serialized: string) => {
								if (!acceptingStreamCallbacks) return;
								try {
									turnToolCalls = JSON.parse(serialized) as ApiChatCompletionToolCall[];
									onToolCallsStreaming?.(turnToolCalls);

									if (turnToolCalls.length > 0 && turnToolCalls[0]?.function) {
										const name = turnToolCalls[0].function.name || '';
										const args = turnToolCalls[0].function.arguments || '';
										const argsLengthBucket = Math.floor(args.length / 100);
										if (
											name !== lastStreamingToolCallName ||
											argsLengthBucket !== lastStreamingToolCallArgsLength
										) {
											lastStreamingToolCallName = name;
											lastStreamingToolCallArgsLength = argsLengthBucket;
											this.updateSession(conversationId, {
												streamingToolCall: { name, arguments: args }
											});
										}
									}
								} catch {
									/* Ignore parse errors during streaming */
								}
							},
							onModel: (model) => {
								if (acceptingStreamCallbacks) onModel?.(model);
							},
							onTimings: (timings?: ChatMessageTimings, progress?: ChatMessagePromptProgress) => {
								if (!acceptingStreamCallbacks) return;
								onTimings?.(timings, progress);
								if (timings) {
									capturedTimings = timings;
									turnTimings = timings;
								}
							},
							onStreamCheckpoint: async (checkpoint) => {
								if (!acceptingStreamCallbacks) return;
								turnContinuation = checkpoint.providerContinuation;
								await onStreamCheckpoint?.(checkpoint);
							},
							onComplete: (_content, _reasoning, _timings, _tools, continuation) => {
								if (!acceptingStreamCallbacks) return;
								turnContinuation = continuation;
							},
							onError: (error: Error) => {
								if (!acceptingStreamCallbacks) return;
								throw error;
							}
						},
						conversationId,
						signal
					);
					acceptingStreamCallbacks = false;
					if (signal?.aborted) {
						await onAssistantTurnComplete?.(
							identity(),
							turnContent,
							turnReasoningContent || undefined,
							turnTimings,
							turnToolCalls.length ? this.normalizeToolCalls(turnToolCalls) : undefined,
							turnContinuation
						);
						reason = 'stopped';
						return;
					}

					this.updateSession(conversationId, { streamingToolCall: null });

					if (turnTimings) {
						agenticTimings.llm.predicted_n += turnTimings.predicted_n || 0;
						agenticTimings.llm.predicted_ms += turnTimings.predicted_ms || 0;
						agenticTimings.llm.prompt_n += turnTimings.prompt_n || 0;
						agenticTimings.llm.prompt_ms += turnTimings.prompt_ms || 0;
						turnStats.llm.predicted_n = turnTimings.predicted_n || 0;
						turnStats.llm.predicted_ms = turnTimings.predicted_ms || 0;
						turnStats.llm.prompt_n = turnTimings.prompt_n || 0;
						turnStats.llm.prompt_ms = turnTimings.prompt_ms || 0;
					}
				} catch (error) {
					acceptingStreamCallbacks = false;
					if (signal?.aborted) {
						// Save whatever we have for this turn before exiting
						await onAssistantTurnComplete?.(
							identity(),
							turnContent,
							turnReasoningContent || undefined,
							this.buildFinalTimings(capturedTimings, agenticTimings),
							turnToolCalls.length ? this.normalizeToolCalls(turnToolCalls) : undefined,
							turnContinuation
						);
						reason = 'stopped';
						return;
					}
					const normalizedError = error instanceof Error ? error : new Error('LLM stream error');
					// Save error as content in the current turn
					onChunk?.(`${LLM_ERROR_BLOCK_START}${normalizedError.message}${LLM_ERROR_BLOCK_END}`);
					await onAssistantTurnComplete?.(
						identity(),
						turnContent +
							`${LLM_ERROR_BLOCK_START}${normalizedError.message}${LLM_ERROR_BLOCK_END}`,
						turnReasoningContent || undefined,
						this.buildFinalTimings(capturedTimings, agenticTimings),
						turnToolCalls.length ? this.normalizeToolCalls(turnToolCalls) : undefined,
						turnContinuation
					);
					throw normalizedError;
				}

				// No tool calls = final turn, save and complete
				if (turnToolCalls.length === 0) {
					agenticTimings.perTurn!.push(turnStats);

					const finalTimings = this.buildFinalTimings(capturedTimings, agenticTimings);

					await onAssistantTurnComplete?.(
						identity(),
						turnContent,
						turnReasoningContent || undefined,
						finalTimings,
						undefined,
						turnContinuation
					);

					if (finalTimings) onTurnComplete?.(finalTimings);

					return;
				}

				// Normalize and save assistant turn with tool calls
				const normalizedCalls = this.normalizeToolCalls(turnToolCalls);
				if (normalizedCalls.length === 0) {
					await onAssistantTurnComplete?.(
						identity(),
						turnContent,
						turnReasoningContent || undefined,
						this.buildFinalTimings(capturedTimings, agenticTimings),
						undefined,
						turnContinuation
					);
					return;
				}

				totalToolCallCount += normalizedCalls.length;
				this.updateSession(conversationId, { totalToolCalls: totalToolCallCount });

				// Save the assistant message with its tool calls
				await onAssistantTurnComplete?.(
					identity(),
					turnContent,
					turnReasoningContent || undefined,
					turnTimings,
					normalizedCalls,
					turnContinuation
				);
				for (const call of normalizedCalls) pending.set(call.id, 'not_started');

				// Add assistant message to session history
				sessionMessages.push({
					role: MessageRole.ASSISTANT,
					content: turnContent || undefined,
					reasoning_content: turnReasoningContent || undefined,
					providerContinuation: turnContinuation,
					tool_calls: normalizedCalls
				});

				// Execute each tool call and create result messages
				for (const toolCall of normalizedCalls) {
					if (signal?.aborted) {
						reason = 'stopped';
						return;
					}

					const toolStartTime = performance.now();
					const toolName = toolCall.function.name;
					const toolEntry = entriesByApiName.get(toolName);
					if (!toolEntry) {
						await onToolCallState(identity(), toolCall.id, {
							status: 'error',
							error: `Tool unavailable in conversation scope: ${toolName}`
						});
						pending.set(toolCall.id, 'error');
						throw new Error(`Tool unavailable in conversation scope: ${toolName}`);
					}
					const permission = await this.requestPermission(conversationId, toolEntry, signal);

					await new Promise((resolve) => setTimeout(resolve, 0));

					if (signal?.aborted) {
						reason = 'stopped';
						return;
					}

					let result: string;
					let toolSuccess = true;
					let status: ToolExecutionStatus;
					let confirmed = false;
					let executionError: string | undefined;

					if (permission === ToolPermissionDecision.DENY) {
						status = 'denied';
						result = toolExecutionDescription({ toolCallId: toolCall.id, status });
						toolSuccess = false;
					} else {
						try {
							const args = this.parseToolArguments(toolCall.function.arguments);
							toolsStore.validateToolExecution(toolEntry, requestContext, toolExecutionScope);
							await onToolCallState?.(identity(), toolCall.id, { status: 'started' });
							pending.set(toolCall.id, 'started');
							if (signal?.aborted) {
								reason = 'stopped';
								return;
							}
							const executionResult = await toolsStore.executeTool(
								toolEntry,
								args,
								requestContext,
								signal,
								toolExecutionScope
							);
							result = executionResult.content;
							confirmed = true;
							status = executionResult.isError ? 'error' : 'completed';
							if (executionResult.isError) toolSuccess = false;
						} catch (error) {
							if (
								pending.get(toolCall.id) === 'started' &&
								!(error instanceof ToolExecutionUnavailableError)
							) {
								await onToolCallState?.(identity(), toolCall.id, {
									status: 'interrupted_unknown',
									error: error instanceof Error ? error.message : String(error)
								});
								pending.set(toolCall.id, 'interrupted_unknown');
								if (signal?.aborted || isAbortError(error)) {
									reason = 'stopped';
									return;
								}
								// A rejected transport is not a confirmed tool failure. Never
								// ask the model to continue/retry an uncertain external effect.
								throw error;
							}
							status = 'error';
							executionError = error instanceof Error ? error.message : String(error);
							result = toolExecutionDescription({
								toolCallId: toolCall.id,
								status,
								error: executionError
							});
							toolSuccess = false;
						}
					}

					const toolDurationMs = performance.now() - toolStartTime;
					const toolTiming: ChatMessageToolCallTiming = {
						name: toolCall.function.name,
						duration_ms: Math.round(toolDurationMs),
						success: toolSuccess
					};

					agenticTimings.toolCalls!.push(toolTiming);
					agenticTimings.toolCallsCount++;
					agenticTimings.toolsMs += Math.round(toolDurationMs);
					turnStats.toolCalls.push(toolTiming);
					turnStats.toolsMs += Math.round(toolDurationMs);

					const { cleanedResult, attachments } = extractToolResultImages(result);

					// Create the tool result message in the DB
					let toolResultMessage: DatabaseMessage | undefined;
					if (onToolCallState) {
						toolResultMessage = await onToolCallState(identity(), toolCall.id, {
							status,
							error: executionError,
							result: confirmed
								? {
										content: cleanedResult,
										extras: attachments.length > 0 ? attachments : undefined
									}
								: undefined
						});
					}
					pending.set(toolCall.id, status);

					if (signal?.aborted) {
						reason = 'stopped';
						return;
					}

					if (confirmed && attachments.length > 0) {
						const savedImages =
							toolResultMessage?.extra?.filter((extra) => extra.type === AttachmentType.IMAGE) ??
							[];
						const remaining = savedImages.map((image) => image.base64Url);
						const hasAllImages = attachments.every((attachment) => {
							const index = remaining.indexOf(attachment.base64Url);
							if (index < 0) return false;
							remaining.splice(index, 1);
							return true;
						});
						if (
							!toolResultMessage ||
							toolResultMessage.role !== MessageRole.TOOL ||
							toolResultMessage.toolCallId !== toolCall.id ||
							!hasAllImages
						)
							throw new Error(
								'Tool result images require a canonical saved tool record containing every image; the next model request was not sent.'
							);
					}

					if (toolResultMessage) {
						sessionMessages.push(
							ChatService.convertDbMessageToApiChatMessageData(toolResultMessage) as AgenticMessage
						);
					} else {
						sessionMessages.push({
							role: MessageRole.TOOL,
							tool_call_id: toolCall.id,
							content: cleanedResult
						});
					}
				}

				if (turnStats.toolCalls.length > 0) {
					agenticTimings.perTurn!.push(turnStats);

					const intermediateTimings = this.buildFinalTimings(capturedTimings, agenticTimings);
					if (intermediateTimings) onTurnComplete?.(intermediateTimings);
				}
			}

			reason = signal?.aborted ? 'stopped' : 'limit';
		} catch (error) {
			reason = signal?.aborted ? 'stopped' : 'error';
			throw error;
		} finally {
			for (const [callId, status] of pending) {
				if (status === 'started')
					await onToolCallState?.(identity(), callId, { status: 'interrupted_unknown' });
			}
			this.updateSession(conversationId, { terminalReason: reason, streamingToolCall: null });
			await onFlowComplete?.({
				identity: identity(),
				reason,
				timings: this.buildFinalTimings(capturedTimings, agenticTimings)
			});
		}
	}

	private buildFinalTimings(
		capturedTimings: ChatMessageTimings | undefined,
		agenticTimings: ChatMessageAgenticTimings
	): ChatMessageTimings | undefined {
		if (agenticTimings.toolCallsCount === 0) return capturedTimings;
		return {
			...capturedTimings,
			agentic: agenticTimings
		};
	}

	private normalizeToolCalls(toolCalls: ApiChatCompletionToolCall[]): AgenticToolCallList {
		if (!toolCalls) return [];
		return toolCalls.map((call, index) => ({
			id: call?.id ?? `tool_${index}`,
			type: (call?.type as ToolCallType.FUNCTION) ?? ToolCallType.FUNCTION,
			function: { name: call?.function?.name ?? '', arguments: call?.function?.arguments ?? '' }
		}));
	}
}

export const agenticStore = new AgenticStore();

export function agenticIsRunning(conversationId: string) {
	return agenticStore.isRunning(conversationId);
}

export function agenticCurrentTurn(conversationId: string) {
	return agenticStore.currentTurn(conversationId);
}

export function agenticTotalToolCalls(conversationId: string) {
	return agenticStore.totalToolCalls(conversationId);
}

export function agenticLastError(conversationId: string) {
	return agenticStore.lastError(conversationId);
}

export function agenticStreamingToolCall(conversationId: string) {
	return agenticStore.streamingToolCall(conversationId);
}

export function agenticIsAnyRunning() {
	return agenticStore.isAnyRunning;
}

export function agenticPendingPermissionRequest(conversationId: string) {
	return agenticStore.pendingPermissionRequest(conversationId);
}

export function agenticResolvePermission(conversationId: string, decision: ToolPermissionDecision) {
	agenticStore.resolvePermission(conversationId, decision);
}
