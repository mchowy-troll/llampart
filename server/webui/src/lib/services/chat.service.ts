import { t } from '$lib/i18n';
import { getApiProvider } from '$lib/services/providers';
import type { ApiProviderAdapter } from '$lib/services/providers/provider.types';
import type { ProviderRequestContext, ProviderUsage } from '$lib/types/provider';
import { formatAttachmentText } from '$lib/utils/formatters';
import { isAbortError } from '$lib/utils/abort';
import {
	ATTACHMENT_LABEL_PDF_FILE,
	ATTACHMENT_LABEL_MCP_PROMPT,
	ATTACHMENT_LABEL_MCP_RESOURCE,
	LEGACY_AGENTIC_REGEX
} from '$lib/constants';
import { AttachmentType, ContentPartType, MessageRole } from '$lib/enums';
import type { ApiChatMessageContentPart, ApiChatCompletionToolCall } from '$lib/types/api';
import type { DatabaseMessageExtraMcpPrompt, DatabaseMessageExtraMcpResource } from '$lib/types';
import { modelsStore } from '$lib/stores/models.svelte';
import { config } from '$lib/stores/settings.svelte';
import { API_STREAM } from '$lib/constants/api-endpoints';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { buildProviderEndpointUrl } from '$lib/services/providers/provider-url';
import { createStreamIdentity, buildStreamRequestUrl } from '$lib/utils/stream-identity';
import { SseByteParser } from '$lib/utils/sse-byte-parser';
import {
	getResumableStreamState,
	loadResumableStreamStates,
	removeResumableStreamState,
	saveResumableStreamState,
	createSourceFingerprint,
	RESUMABLE_STREAM_STATE_TTL_MS,
	type ResumableStreamState
} from '$lib/utils/resumable-stream-state';
import type { ChatStreamResumeSeed, SettingsChatServiceOptions } from '$lib/types/settings';
import { getReconnectDelay, sleepWithAbort } from '$lib/utils/retry';

interface FrozenStreamRequest {
	provider: ApiProviderAdapter;
	context: ProviderRequestContext;
}

class IncompleteStreamError extends Error {
	name = 'IncompleteStreamError';
}

class StreamProtocolError extends Error {
	name = 'StreamProtocolError';
}

class StreamCheckpointError extends Error {
	name = 'StreamCheckpointError';
}

export class ChatService {
	private static frozenStreamRequests = new Map<string, FrozenStreamRequest>();
	private static sourceGeneration = 0;
	private static readonly optionalStreamEndpointStatuses = new Set([404, 405, 501]);
	/**
	 * Generates a short conversation title with a small auxiliary LLM request.
	 * This does not use the conversation system prompt and keeps thinking disabled when supported.
	 */
	static async generateTitle(
		message: ApiChatMessageData,
		model?: string | null,
		signal?: AbortSignal
	): Promise<string> {
		let titleResponse = '';

		try {
			await ChatService.sendMessage(
				[message],
				{
					model: model || undefined,
					stream: true,
					max_tokens: 64,
					custom: JSON.stringify({ chat_template_kwargs: { enable_thinking: false } }),
					onChunk: (chunk: string) => {
						titleResponse += chunk;
					}
				},
				undefined,
				signal
			);
		} catch (error) {
			console.warn('[ChatService] Failed to generate conversation title:', error);
			return '';
		}

		return titleResponse;
	}

	/**
	 *
	 *
	 * Messaging
	 *
	 *
	 */

	/**
	 * Sends a chat completion request to the llama.cpp server.
	 * Supports both streaming and non-streaming responses with comprehensive parameter configuration.
	 * Automatically converts database messages with attachments to the appropriate API format.
	 *
	 * @param messages - Array of chat messages to send to the API (supports both ApiChatMessageData and DatabaseMessage with attachments)
	 * @param options - Configuration options for the chat completion request. See `SettingsChatServiceOptions` type for details.
	 * @returns {Promise<string | void>} that resolves to the complete response string (non-streaming) or void (streaming)
	 * @throws {Error} if the request fails or is aborted
	 */
	static async sendMessage(
		messages: ApiChatMessageData[] | (DatabaseMessage & { extra?: DatabaseMessageExtra[] })[],
		options: SettingsChatServiceOptions = {},
		conversationId?: string,
		signal?: AbortSignal
	): Promise<string | void> {
		const requestContext =
			options.providerRequestContext ?? ChatService.createProviderRequestContext();
		if (!ChatService.isProviderRequestContextCurrent(requestContext)) return;
		const provider = getApiProvider(requestContext.providerId);
		const selectedProviderModel =
			(modelsStore.selectedModelName || modelsStore.selectedModelId || '').trim() || undefined;
		const effectiveOptions: SettingsChatServiceOptions =
			provider.capabilities.requiresModelInChatRequest && !options.model && selectedProviderModel
				? { ...options, model: selectedProviderModel }
				: options;

		const {
			stream,
			onChunk,
			onComplete,
			onError,
			onReasoningChunk,
			onToolCallChunk,
			onModel,
			onCompletionId,
			onTimings
		} = effectiveOptions;

		const normalizedMessages: ApiChatMessageData[] = messages
			.map((msg) => {
				if ('id' in msg && 'convId' in msg && 'timestamp' in msg) {
					const dbMsg = msg as DatabaseMessage & { extra?: DatabaseMessageExtra[] };

					return ChatService.convertDbMessageToApiChatMessageData(dbMsg);
				} else {
					return msg as ApiChatMessageData;
				}
			})
			.filter((msg) => {
				// Filter out empty system messages
				if (msg.role === MessageRole.SYSTEM) {
					const content = typeof msg.content === 'string' ? msg.content : '';

					return content.trim().length > 0;
				}

				return true;
			});

		// Filter out image attachments if the model doesn't support vision
		if (effectiveOptions.model && !modelsStore.modelSupportsVision(effectiveOptions.model)) {
			normalizedMessages.forEach((msg) => {
				if (Array.isArray(msg.content)) {
					msg.content = msg.content.filter((part: ApiChatMessageContentPart) => {
						if (part.type === ContentPartType.IMAGE_URL) {
							console.info(
								`[ChatService] Skipping image attachment in message history (model "${effectiveOptions.model}" does not support vision)`
							);

							return false;
						}

						return true;
					});
					// If only text remains and it's a single part, simplify to string
					if (msg.content.length === 1 && msg.content[0].type === ContentPartType.TEXT) {
						msg.content = msg.content[0].text;
					}
				}
			});
		}

		const frozenServerBaseUrl = requestContext.serverBaseUrl;
		const frozenApiKey = requestContext.apiKey;
		let resumableState: ResumableStreamState | null = null;
		if (
			stream &&
			conversationId &&
			effectiveOptions.assistantMessageId &&
			provider.id === API_PROVIDER_IDS.LLAMA_SERVER &&
			provider.capabilities.supportsResumableStreams
		) {
			const sourceFingerprint = await createSourceFingerprint(requestContext);
			if (!ChatService.isProviderRequestContextCurrent(requestContext)) return;
			resumableState = {
				schemaVersion: 2,
				conversationId,
				assistantMessageId: effectiveOptions.assistantMessageId,
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				sourceFingerprint,
				streamIdentity: createStreamIdentity(conversationId, effectiveOptions.model ?? null),
				model: effectiveOptions.model ?? null,
				bytesReceived: 0,
				updatedAt: Date.now()
			} satisfies ResumableStreamState;
		}

		if (resumableState) {
			saveResumableStreamState(resumableState);
			ChatService.frozenStreamRequests.set(resumableState.streamIdentity, {
				provider,
				context: requestContext
			});
		}

		const providerRequest = provider.buildChatCompletionRequest({
			serverBaseUrl: frozenServerBaseUrl,
			apiKey: frozenApiKey,
			messages: normalizedMessages,
			options: effectiveOptions,
			streamIdentity: resumableState?.streamIdentity
		});

		const requestStartedAt = ChatService.getMonotonicNow();

		try {
			const response = await fetch(providerRequest.url, {
				...providerRequest.init,
				signal
			});

			if (!response.ok) {
				if (resumableState) ChatService.clearResumableState(resumableState);
				const error = await ChatService.parseErrorResponse(response);

				throw error;
			}

			if (stream) {
				await ChatService.handleStreamResponse(
					provider,
					response,
					onChunk,
					onComplete,
					onReasoningChunk,
					onToolCallChunk,
					onModel,
					onCompletionId,
					onTimings,
					conversationId,
					signal,
					resumableState,
					effectiveOptions.onStreamCheckpoint,
					effectiveOptions.resumeSeed
				);

				return;
			} else {
				return await ChatService.handleNonStreamResponse(
					provider,
					response,
					onComplete,
					onToolCallChunk,
					onModel,
					requestStartedAt
				);
			}
		} catch (error) {
			if (isAbortError(error)) {
				return;
			}
			if (resumableState) ChatService.clearResumableState(resumableState);

			let userFriendlyError: Error;

			if (error instanceof Error) {
				if (error.name === 'TypeError' && error.message.includes('fetch')) {
					userFriendlyError = new Error(t('server.unableToConnectCheckRunning'));
					userFriendlyError.name = 'NetworkError';
				} else if (error.message.includes('ECONNREFUSED')) {
					userFriendlyError = new Error(t('server.connectionRefusedMaybeOffline'));
					userFriendlyError.name = 'NetworkError';
				} else if (error.message.includes('ETIMEDOUT')) {
					userFriendlyError = new Error(t('server.requestTimedOutTooLong'));
					userFriendlyError.name = 'TimeoutError';
				} else {
					userFriendlyError = error;
				}
			} else {
				userFriendlyError = new Error('Unknown error occurred while sending message');
			}

			console.error('Error in sendMessage:', error);

			try {
				await onError?.(userFriendlyError);
			} catch (callbackError) {
				console.error('Error in chat error callback:', callbackError);
			}

			throw userFriendlyError;
		}
	}

	static createProviderRequestContext(): ProviderRequestContext {
		const currentConfig = config();
		return Object.freeze({
			providerId: getApiProvider(String(currentConfig.apiProvider ?? '')).id,
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? ''),
			sourceGeneration: ChatService.sourceGeneration
		});
	}

	static invalidateProviderRequestContexts(): void {
		ChatService.sourceGeneration += 1;
	}

	static isProviderRequestContextCurrent(context: ProviderRequestContext): boolean {
		if (context.sourceGeneration !== ChatService.sourceGeneration) return false;
		const currentConfig = config();
		return (
			context.providerId === getApiProvider(String(currentConfig.apiProvider ?? '')).id &&
			context.serverBaseUrl === String(currentConfig.serverBaseUrl ?? '') &&
			context.apiKey === String(currentConfig.apiKey ?? '')
		);
	}

	/**
	 * Checks whether all server slots are currently idle (not processing any requests).
	 * Queries the /slots endpoint (requires --slots flag on the server).
	 * Returns true if all slots are idle, false if any is processing.
	 * If the endpoint is unavailable or errors out, returns true (best-effort fallback).
	 *
	 * @param signal - Optional AbortSignal to cancel the request if needed
	 * @param model - Optional model name to check slots for (required in ROUTER mode)
	 * @returns {Promise<boolean>} Promise that resolves to true if all slots are idle, false if any is processing
	 */
	static async areAllSlotsIdle(
		context: ProviderRequestContext,
		model?: string | null,
		signal?: AbortSignal
	): Promise<boolean> {
		if (!ChatService.isProviderRequestContextCurrent(context)) return false;
		try {
			const url = model
				? `${buildProviderEndpointUrl(context.serverBaseUrl, '/slots')}?model=${encodeURIComponent(model)}`
				: buildProviderEndpointUrl(context.serverBaseUrl, '/slots');
			const res = await fetch(url, {
				headers: ChatService.buildStreamHeaders(context.apiKey, false),
				signal
			});
			if (!res.ok || !ChatService.isProviderRequestContextCurrent(context)) return false;

			const slots: { is_processing: boolean }[] = await res.json();
			return ChatService.isProviderRequestContextCurrent(context)
				? slots.every((s) => !s.is_processing)
				: false;
		} catch {
			return false;
		}
	}

	/**
	 * Sends a fire-and-forget request to pre-encode the conversation in the server's KV cache.
	 * After a response completes, this re-submits the full conversation
	 * using n_predict=0 and stream=false so the server processes the prompt without generating tokens.
	 * This warms the cache for the next turn, making it faster.
	 *
	 * When excludeReasoningFromContext is true, reasoning content is stripped from the messages
	 * to match what sendMessage would send on the next turn (avoiding cache misses).
	 * When false, reasoning_content is preserved so the cached prompt matches the next request.
	 *
	 * @param messages - The full conversation including the latest assistant response
	 * @param model - Optional model name (required in ROUTER mode)
	 * @param excludeReasoning - Whether to strip reasoning content (should match excludeReasoningFromContext setting)
	 * @param signal - Optional AbortSignal to cancel the pre-encode request
	 */
	static async preEncode(
		messages: ApiChatMessageData[] | (DatabaseMessage & { extra?: DatabaseMessageExtra[] })[],
		context: ProviderRequestContext,
		model?: string | null,
		excludeReasoning?: boolean,
		signal?: AbortSignal
	): Promise<void> {
		if (!ChatService.isProviderRequestContextCurrent(context)) return;
		const normalizedMessages: ApiChatMessageData[] = messages
			.map((msg) => {
				if ('id' in msg && 'convId' in msg && 'timestamp' in msg) {
					return ChatService.convertDbMessageToApiChatMessageData(
						msg as DatabaseMessage & { extra?: DatabaseMessageExtra[] }
					);
				}

				return msg as ApiChatMessageData;
			})
			.filter((msg) => {
				if (msg.role === MessageRole.SYSTEM) {
					const content = typeof msg.content === 'string' ? msg.content : '';

					return content.trim().length > 0;
				}

				return true;
			});

		const requestBody: Record<string, unknown> = {
			messages: normalizedMessages.map((msg: ApiChatMessageData) => {
				const mapped: Record<string, unknown> = {
					role: msg.role,
					content: excludeReasoning ? ChatService.stripReasoningContent(msg.content) : msg.content,
					tool_calls: msg.tool_calls,
					tool_call_id: msg.tool_call_id
				};

				if (!excludeReasoning && msg.reasoning_content) {
					mapped.reasoning_content = msg.reasoning_content;
				}

				return mapped;
			}),
			stream: false,
			n_predict: 0
		};

		if (model) {
			requestBody.model = model;
		}

		try {
			const provider = getApiProvider(context.providerId);
			if (!provider.capabilities.supportsPreEncode) return;
			if (!ChatService.isProviderRequestContextCurrent(context)) return;

			const response = await fetch(
				buildProviderEndpointUrl(context.serverBaseUrl, '/v1/chat/completions'),
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(context.apiKey.trim() ? { Authorization: `Bearer ${context.apiKey.trim()}` } : {})
					},
					body: JSON.stringify(requestBody),
					signal
				}
			);
			if (!response.ok) throw await ChatService.parseErrorResponse(response);
		} catch (error) {
			if (!isAbortError(error)) {
				console.warn('[ChatService] Pre-encode request failed:', error);
			}
		}
	}

	/**
	 *
	 *
	 * Streaming
	 *
	 *
	 */

	private static getMonotonicNow(): number {
		return typeof performance !== 'undefined' && typeof performance.now === 'function'
			? performance.now()
			: Date.now();
	}

	private static buildProviderUsageTimings(
		usage: ProviderUsage | undefined,
		startedAtMs: number,
		completedAtMs: number
	): ChatMessageTimings | undefined {
		if (!usage?.completionTokens || usage.completionTokens <= 0) return undefined;

		const elapsedMs = Math.max(1, Math.round(completedAtMs - startedAtMs));

		return {
			prompt_n: usage.promptTokens,
			predicted_n: usage.completionTokens,
			predicted_ms: elapsedMs
		};
	}

	static getResumableState(conversationId: string): ResumableStreamState | null {
		return getResumableStreamState(conversationId);
	}

	static discardResumableStream(conversationId: string): void {
		const state = getResumableStreamState(conversationId);
		if (state) ChatService.clearResumableState(state);
	}

	static async canResumeStream(state: ResumableStreamState): Promise<boolean> {
		const context = ChatService.createProviderRequestContext();
		const valid = await ChatService.isResumableStateForContext(state, context);
		if (!valid) ChatService.clearResumableState(state);
		return valid;
	}

	private static async isResumableStateForContext(
		state: ResumableStreamState,
		context: ProviderRequestContext
	): Promise<boolean> {
		const age = Date.now() - state.updatedAt;
		return (
			state.schemaVersion === 2 &&
			state.providerId === API_PROVIDER_IDS.LLAMA_SERVER &&
			context.providerId === state.providerId &&
			age >= 0 &&
			age <= RESUMABLE_STREAM_STATE_TTL_MS &&
			(await createSourceFingerprint(context)) === state.sourceFingerprint &&
			ChatService.isProviderRequestContextCurrent(context)
		);
	}

	static async stopResumableStream(conversationId: string): Promise<void> {
		const state = getResumableStreamState(conversationId);
		if (!state) return;

		const frozen = ChatService.frozenStreamRequests.get(state.streamIdentity);
		const context = frozen?.context ?? ChatService.createProviderRequestContext();
		if ((await createSourceFingerprint(context)) !== state.sourceFingerprint) {
			ChatService.clearResumableState(state);
			return;
		}
		const url = buildStreamRequestUrl(
			buildProviderEndpointUrl(context.serverBaseUrl, API_STREAM.BASE),
			state.streamIdentity
		);

		try {
			await fetch(url, {
				method: 'DELETE',
				headers: ChatService.buildStreamHeaders(context.apiKey, false)
			});
		} catch (error) {
			console.warn('[ChatService] Failed to stop resumable stream:', error);
		} finally {
			ChatService.clearResumableState(state);
		}
	}

	static async resumeStream(
		state: ResumableStreamState,
		options: SettingsChatServiceOptions,
		signal?: AbortSignal
	): Promise<boolean> {
		const context = ChatService.createProviderRequestContext();
		if (!(await ChatService.isResumableStateForContext(state, context))) {
			ChatService.clearResumableState(state);
			return false;
		}
		const provider = getApiProvider(state.providerId);
		const serverBaseUrl = context.serverBaseUrl;
		const apiKey = context.apiKey;
		let lookupResponse: Response;
		let lookupAttempt = 0;
		do {
			if (!ChatService.isProviderRequestContextCurrent(context)) {
				ChatService.clearResumableState(state);
				return false;
			}
			lookupResponse = await fetch(buildProviderEndpointUrl(serverBaseUrl, API_STREAM.LOOKUP), {
				method: 'POST',
				headers: ChatService.buildStreamHeaders(apiKey, true),
				body: JSON.stringify({ conversation_ids: [state.streamIdentity] }),
				signal
			});

			if (lookupResponse.status === 503) {
				await ChatService.waitForReconnect(lookupAttempt++, signal);
			}
		} while (lookupResponse.status === 503 && !signal?.aborted);
		if (signal?.aborted) return false;

		if (ChatService.optionalStreamEndpointStatuses.has(lookupResponse.status)) {
			ChatService.clearResumableState(state);
			return false;
		}
		if (!lookupResponse.ok) throw await ChatService.parseErrorResponse(lookupResponse);

		const response = await ChatService.fetchResumedStream(state, serverBaseUrl, apiKey, signal);
		if (ChatService.optionalStreamEndpointStatuses.has(response.status)) {
			ChatService.clearResumableState(state);
			return false;
		}
		if (!response.ok) throw await ChatService.parseErrorResponse(response);

		ChatService.frozenStreamRequests.set(state.streamIdentity, {
			provider,
			context
		});
		if (state.model) options.onModel?.(state.model);

		try {
			await ChatService.handleStreamResponse(
				provider,
				response,
				options.onChunk,
				options.onComplete,
				options.onReasoningChunk,
				options.onToolCallChunk,
				options.onModel,
				options.onCompletionId,
				options.onTimings,
				state.conversationId,
				signal,
				state,
				options.onStreamCheckpoint,
				options.resumeSeed
			);
		} catch (error) {
			if (!isAbortError(error)) {
				const normalizedError = error instanceof Error ? error : new Error('Stream resume failed');

				try {
					await options.onError?.(normalizedError);
				} catch (callbackError) {
					console.error('Error in chat error callback:', callbackError);
				}
			}

			throw error;
		}

		return true;
	}

	private static buildStreamHeaders(apiKey: string, json: boolean): Record<string, string> {
		return {
			Accept: json ? 'application/json' : 'text/event-stream',
			...(json ? { 'Content-Type': 'application/json' } : {}),
			...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
		};
	}

	private static fetchResumedStream(
		state: ResumableStreamState,
		serverBaseUrl: string,
		apiKey: string,
		signal?: AbortSignal
	): Promise<Response> {
		return fetch(
			buildStreamRequestUrl(
				buildProviderEndpointUrl(serverBaseUrl, API_STREAM.BASE),
				state.streamIdentity,
				state.bytesReceived
			),
			{
				method: 'GET',
				headers: ChatService.buildStreamHeaders(apiKey, false),
				signal
			}
		);
	}

	private static clearResumableState(state: ResumableStreamState): void {
		removeResumableStreamState(state.conversationId);
		ChatService.frozenStreamRequests.delete(state.streamIdentity);
	}

	static discardAllResumableStreams(): void {
		for (const state of loadResumableStreamStates()) {
			removeResumableStreamState(state.conversationId);
		}
		ChatService.frozenStreamRequests.clear();
	}

	private static async waitForReconnect(attempt: number, signal?: AbortSignal): Promise<void> {
		await sleepWithAbort(getReconnectDelay(attempt), signal);
	}

	/**
	 * Handles streaming response from the chat completion API
	 * @param response - The Response object from the fetch request
	 * @param onChunk - Optional callback invoked for each content chunk received
	 * @param onComplete - Optional callback invoked when the stream is complete with full response
	 * @param onReasoningChunk - Optional callback invoked for each reasoning content chunk
	 * @param conversationId - Optional conversation ID for per-conversation state tracking
	 * @returns {Promise<void>} Promise that resolves when streaming is complete
	 * @throws {Error} if the stream cannot be read or parsed
	 */
	private static async handleStreamResponse(
		provider: ApiProviderAdapter,
		response: Response,
		onChunk?: (chunk: string) => void,
		onComplete?: (
			response: string,
			reasoningContent?: string,
			timings?: ChatMessageTimings,
			toolCalls?: string
		) => void | Promise<void>,
		onReasoningChunk?: (chunk: string) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void,
		onCompletionId?: (id: string) => void,
		onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void,
		conversationId?: string,
		abortSignal?: AbortSignal,
		resumableState?: ResumableStreamState | null,
		onStreamCheckpoint?: SettingsChatServiceOptions['onStreamCheckpoint'],
		resumeSeed?: ChatStreamResumeSeed
	): Promise<void> {
		let aggregatedContent = resumeSeed?.content ?? '';
		let fullReasoningContent = resumeSeed?.reasoningContent ?? '';
		let aggregatedToolCalls: ApiChatCompletionToolCall[] = (resumeSeed?.toolCalls ?? []).map(
			(call) => ({ ...call, function: call.function ? { ...call.function } : undefined })
		);
		let lastTimings: ChatMessageTimings | undefined = resumeSeed?.timings;
		const streamStartedAt = ChatService.getMonotonicNow();
		let streamFinished = false;
		let modelEmitted = false;
		let idEmitted = false;
		let toolCallIndexOffset = 0;
		let hasOpenToolCallBatch = false;
		let reconnectAttempt = 0;

		const finalizeOpenToolCallBatch = () => {
			if (!hasOpenToolCallBatch) {
				return;
			}

			toolCallIndexOffset = aggregatedToolCalls.length;
			hasOpenToolCallBatch = false;
		};

		const processToolCallDelta = (toolCalls?: ApiChatCompletionToolCallDelta[]) => {
			if (!toolCalls || toolCalls.length === 0) {
				return;
			}

			aggregatedToolCalls = ChatService.mergeToolCallDeltas(
				aggregatedToolCalls,
				toolCalls,
				toolCallIndexOffset
			);

			if (aggregatedToolCalls.length === 0) {
				return;
			}

			hasOpenToolCallBatch = true;

			const serializedToolCalls = JSON.stringify(aggregatedToolCalls);

			if (!serializedToolCalls) {
				return;
			}

			if (!abortSignal?.aborted) {
				onToolCallChunk?.(serializedToolCalls);
			}
		};

		let activeResponse = response;

		while (!abortSignal?.aborted) {
			const reader = activeResponse.body?.getReader();
			if (!reader) throw new Error('No response body');
			const parser = new SseByteParser();
			const baseOffset = resumableState?.bytesReceived ?? 0;
			const processRecords = async (records: ReturnType<SseByteParser['push']>) => {
				for (const record of records) {
					if (abortSignal?.aborted) return;

					if (record.data !== null) {
						let event;
						try {
							event = provider.parseChatCompletionStreamData(record.data);
						} catch (error) {
							throw new StreamProtocolError('Failed to parse provider stream data', {
								cause: error
							});
						}

						if (event?.done) streamFinished = true;
						else if (event) {
							if (event.model && !modelEmitted) {
								modelEmitted = true;
								onModel?.(event.model);
							}
							if (event.completionId && !idEmitted) {
								idEmitted = true;
								onCompletionId?.(event.completionId);
							}
							if (event.promptProgress) {
								ChatService.notifyTimings(undefined, event.promptProgress, onTimings);
							}
							if (event.timings) {
								ChatService.notifyTimings(event.timings, event.promptProgress, onTimings);
								lastTimings = event.timings;
							} else if (event.usage) {
								const usageTimings = ChatService.buildProviderUsageTimings(
									event.usage,
									streamStartedAt,
									ChatService.getMonotonicNow()
								);
								if (usageTimings) {
									ChatService.notifyTimings(usageTimings, event.promptProgress, onTimings);
									lastTimings = usageTimings;
								}
							}
							if (event.content) {
								finalizeOpenToolCallBatch();
								aggregatedContent += event.content;
								onChunk?.(event.content);
							}
							if (event.reasoningContent) {
								finalizeOpenToolCallBatch();
								fullReasoningContent += event.reasoningContent;
								onReasoningChunk?.(event.reasoningContent);
							}
							processToolCallDelta(event.toolCalls);
						}
					}

					const bytesReceived = baseOffset + record.bytesParsed;
					try {
						await onStreamCheckpoint?.({
							content: aggregatedContent,
							reasoningContent: fullReasoningContent,
							toolCalls: aggregatedToolCalls,
							timings: lastTimings,
							bytesReceived
						});
					} catch (error) {
						throw new StreamCheckpointError('Failed to persist stream checkpoint', {
							cause: error
						});
					}
					if (resumableState) {
						resumableState = {
							...resumableState,
							bytesReceived,
							updatedAt: Date.now()
						};
						saveResumableStreamState(resumableState);
					}
				}
			};

			let transportError: unknown;
			try {
				while (!abortSignal?.aborted) {
					let result: ReadableStreamReadResult<Uint8Array>;
					try {
						result = await reader.read();
					} catch (error) {
						transportError = error;
						break;
					}

					const { done, value } = result;
					if (done) {
						await processRecords(parser.finish());
						break;
					}

					await processRecords(parser.push(value));
				}
			} finally {
				reader.releaseLock();
			}

			if (abortSignal?.aborted) return;
			if (transportError) {
				console.warn('[ChatService] Stream disconnected; attempting resume:', transportError);
			}
			if (streamFinished) {
				finalizeOpenToolCallBatch();
				const finalToolCalls =
					aggregatedToolCalls.length > 0 ? JSON.stringify(aggregatedToolCalls) : undefined;
				if (resumableState) ChatService.clearResumableState(resumableState);
				await onComplete?.(
					aggregatedContent,
					fullReasoningContent || undefined,
					lastTimings,
					finalToolCalls
				);
				return;
			}
			if (!resumableState) {
				throw new IncompleteStreamError('Stream ended before a terminal event', {
					cause: transportError
				});
			}

			const frozen = ChatService.frozenStreamRequests.get(resumableState.streamIdentity);
			if (!frozen) throw new Error('Missing frozen stream request');
			await ChatService.waitForReconnect(reconnectAttempt++, abortSignal);
			if (abortSignal?.aborted) return;

			try {
				activeResponse = await ChatService.fetchResumedStream(
					resumableState,
					frozen.context.serverBaseUrl,
					frozen.context.apiKey,
					abortSignal
				);
			} catch (error) {
				if (abortSignal?.aborted) return;
				console.warn('[ChatService] Resume request failed; retrying:', error);
				continue;
			}

			if (ChatService.optionalStreamEndpointStatuses.has(activeResponse.status)) {
				ChatService.clearResumableState(resumableState);
				const finalToolCalls =
					aggregatedToolCalls.length > 0 ? JSON.stringify(aggregatedToolCalls) : undefined;
				await onComplete?.(
					aggregatedContent,
					fullReasoningContent || undefined,
					lastTimings,
					finalToolCalls
				);
				return;
			}
			if (!activeResponse.ok) throw await ChatService.parseErrorResponse(activeResponse);
			reconnectAttempt = 0;
		}
	}

	/**
	 * Handles non-streaming response from the chat completion API.
	 * Parses the JSON response and extracts the generated content.
	 *
	 * @param response - The fetch Response object containing the JSON data
	 * @param onComplete - Optional callback invoked when response is successfully parsed
	 * @param onError - Optional callback invoked if an error occurs during parsing
	 * @returns {Promise<string>} Promise that resolves to the generated content string
	 * @throws {Error} if the response cannot be parsed or is malformed
	 */
	private static async handleNonStreamResponse(
		provider: ApiProviderAdapter,
		response: Response,
		onComplete?: (
			response: string,
			reasoningContent?: string,
			timings?: ChatMessageTimings,
			toolCalls?: string
		) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void,
		requestStartedAt?: number
	): Promise<string> {
		const responseText = await response.text();

		if (!responseText.trim()) {
			const noResponseError = new Error('No response received from server. Please try again.');

			throw noResponseError;
		}

		const data = JSON.parse(responseText);
		const parsedResponse = provider.parseChatCompletionResponse(data);

		if (parsedResponse.model) {
			onModel?.(parsedResponse.model);
		}

		const content = parsedResponse.content;
		const reasoningContent = parsedResponse.reasoningContent;
		const toolCalls = parsedResponse.toolCalls;

		let serializedToolCalls: string | undefined;

		if (toolCalls && toolCalls.length > 0) {
			const mergedToolCalls = ChatService.mergeToolCallDeltas([], toolCalls);

			if (mergedToolCalls.length > 0) {
				serializedToolCalls = JSON.stringify(mergedToolCalls);
				if (serializedToolCalls) {
					onToolCallChunk?.(serializedToolCalls);
				}
			}
		}

		if (!content.trim() && !serializedToolCalls) {
			const noResponseError = new Error('No response received from server. Please try again.');

			throw noResponseError;
		}

		const timings = ChatService.buildProviderUsageTimings(
			parsedResponse.usage,
			requestStartedAt ?? ChatService.getMonotonicNow(),
			ChatService.getMonotonicNow()
		);

		onComplete?.(content, reasoningContent, timings, serializedToolCalls);

		return content;
	}

	/**
	 * Merges tool call deltas into an existing array of tool calls.
	 * Handles both existing and new tool calls, updating existing ones and adding new ones.
	 *
	 * @param existing - The existing array of tool calls to merge into
	 * @param deltas - The array of tool call deltas to merge
	 * @param indexOffset - Optional offset to apply to the index of new tool calls
	 * @returns {ApiChatCompletionToolCall[]} The merged array of tool calls
	 */
	private static mergeToolCallDeltas(
		existing: ApiChatCompletionToolCall[],
		deltas: ApiChatCompletionToolCallDelta[],
		indexOffset = 0
	): ApiChatCompletionToolCall[] {
		const result = existing.map((call) => ({
			...call,
			function: call.function ? { ...call.function } : undefined
		}));

		for (const delta of deltas) {
			const index =
				typeof delta.index === 'number' && delta.index >= 0
					? delta.index + indexOffset
					: result.length;

			while (result.length <= index) {
				result.push({ function: undefined });
			}

			const target = result[index]!;

			if (delta.id) {
				target.id = delta.id;
			}

			if (delta.type) {
				target.type = delta.type;
			}

			if (delta.function) {
				const fn = target.function ? { ...target.function } : {};

				if (delta.function.name) {
					fn.name = delta.function.name;
				}

				if (delta.function.arguments) {
					fn.arguments = (fn.arguments ?? '') + delta.function.arguments;
				}

				target.function = fn;
			}
		}

		return result;
	}

	/**
	 *
	 *
	 * Conversion
	 *
	 *
	 */

	/**
	 * Converts a database message with attachments to API chat message format.
	 * Processes various attachment types (images, text files, PDFs) and formats them
	 * as content parts suitable for the chat completion API.
	 *
	 * @param message - Database message object with optional extra attachments
	 * @param message.content - The text content of the message
	 * @param message.role - The role of the message sender (user, assistant, system)
	 * @param message.extra - Optional array of message attachments (images, files, etc.)
	 * @returns {ApiChatMessageData} object formatted for the chat completion API
	 * @static
	 */
	static convertDbMessageToApiChatMessageData(
		message: DatabaseMessage & { extra?: DatabaseMessageExtra[] }
	): ApiChatMessageData {
		// Handle tool result messages (role: 'tool')
		if (message.role === MessageRole.TOOL && message.toolCallId) {
			return {
				role: MessageRole.TOOL,
				content: message.content,
				tool_call_id: message.toolCallId
			};
		}

		// Parse tool calls for assistant messages
		let toolCalls: ApiChatCompletionToolCall[] | undefined;
		if (message.toolCalls) {
			try {
				toolCalls = JSON.parse(message.toolCalls);
			} catch {
				// Ignore parse errors for malformed tool calls
			}
		}

		if (!message.extra || message.extra.length === 0) {
			const result: ApiChatMessageData = {
				role: message.role as MessageRole,
				content: message.content
			};

			if (message.reasoningContent) {
				result.reasoning_content = message.reasoningContent;
			}

			if (toolCalls && toolCalls.length > 0) {
				result.tool_calls = toolCalls;
			}

			return result;
		}

		const contentParts: ApiChatMessageContentPart[] = [];

		if (message.content) {
			contentParts.push({
				type: ContentPartType.TEXT,
				text: message.content
			});
		}

		// Include images from all messages
		const imageFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraImageFile =>
				extra.type === AttachmentType.IMAGE
		);

		for (const image of imageFiles) {
			contentParts.push({
				type: ContentPartType.IMAGE_URL,
				image_url: { url: image.base64Url }
			});
		}

		const textFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraTextFile =>
				extra.type === AttachmentType.TEXT
		);

		for (const textFile of textFiles) {
			contentParts.push({
				type: ContentPartType.TEXT,
				text: formatAttachmentText('File', textFile.name, textFile.content)
			});
		}

		// Handle legacy 'context' type from old webui (pasted content)
		const legacyContextFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraLegacyContext =>
				extra.type === AttachmentType.LEGACY_CONTEXT
		);

		for (const legacyContextFile of legacyContextFiles) {
			contentParts.push({
				type: ContentPartType.TEXT,
				text: formatAttachmentText('File', legacyContextFile.name, legacyContextFile.content)
			});
		}

		const audioFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraAudioFile =>
				extra.type === AttachmentType.AUDIO
		);

		for (const audio of audioFiles) {
			contentParts.push({
				type: ContentPartType.INPUT_AUDIO,
				input_audio: {
					data: audio.base64Data,
					format: audio.mimeType.includes('wav') ? 'wav' : 'mp3'
				}
			});
		}

		const videoFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraVideoFile =>
				extra.type === AttachmentType.VIDEO
		);

		for (const video of videoFiles) {
			contentParts.push({
				type: ContentPartType.INPUT_VIDEO,
				input_video: {
					data: video.base64Data,
					format: video.mimeType.includes('mp4')
						? 'mp4'
						: video.mimeType.includes('ogg')
							? 'ogg'
							: 'auto'
				}
			});
		}

		const pdfFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraPdfFile =>
				extra.type === AttachmentType.PDF
		);

		for (const pdfFile of pdfFiles) {
			if (pdfFile.processedAsImages && pdfFile.images) {
				for (let i = 0; i < pdfFile.images.length; i++) {
					contentParts.push({
						type: ContentPartType.IMAGE_URL,
						image_url: { url: pdfFile.images[i] }
					});
				}
			} else {
				contentParts.push({
					type: ContentPartType.TEXT,
					text: formatAttachmentText(ATTACHMENT_LABEL_PDF_FILE, pdfFile.name, pdfFile.content)
				});
			}
		}

		const mcpPrompts = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraMcpPrompt =>
				extra.type === AttachmentType.MCP_PROMPT
		);

		for (const mcpPrompt of mcpPrompts) {
			contentParts.push({
				type: ContentPartType.TEXT,
				text: formatAttachmentText(
					ATTACHMENT_LABEL_MCP_PROMPT,
					mcpPrompt.name,
					mcpPrompt.content,
					mcpPrompt.serverName
				)
			});
		}

		const mcpResources = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraMcpResource =>
				extra.type === AttachmentType.MCP_RESOURCE
		);

		for (const mcpResource of mcpResources) {
			contentParts.push({
				type: ContentPartType.TEXT,
				text: formatAttachmentText(
					ATTACHMENT_LABEL_MCP_RESOURCE,
					mcpResource.name,
					mcpResource.content,
					mcpResource.serverName
				)
			});
		}

		const result: ApiChatMessageData = {
			role: message.role as MessageRole,
			content: contentParts
		};
		if (message.reasoningContent) {
			result.reasoning_content = message.reasoningContent;
		}
		if (toolCalls && toolCalls.length > 0) {
			result.tool_calls = toolCalls;
		}
		return result;
	}

	/**
	 *
	 *
	 * Utilities
	 *
	 *
	 */

	/**
	 * Strips legacy inline reasoning content tags from message content.
	 * Handles both plain string content and multipart content arrays.
	 */
	private static stripReasoningContent(
		content: string | ApiChatMessageContentPart[]
	): string | ApiChatMessageContentPart[] {
		const stripFromString = (text: string): string =>
			text.replace(LEGACY_AGENTIC_REGEX.REASONING_BLOCK, '').trim();

		if (typeof content === 'string') {
			return stripFromString(content);
		}

		return content.map((part) => {
			if (part.type === ContentPartType.TEXT && part.text) {
				return { ...part, text: stripFromString(part.text) };
			}
			return part;
		});
	}

	/**
	 * Parses error response and creates appropriate error with context information
	 * @param response - HTTP response object
	 * @returns Promise<Error> - Parsed error with context info if available
	 */
	private static async parseErrorResponse(
		response: Response
	): Promise<Error & { contextInfo?: { n_prompt_tokens: number; n_ctx: number } }> {
		try {
			const errorText = await response.text();
			const errorData: ApiErrorResponse = JSON.parse(errorText);

			const message = errorData.error?.message || 'Unknown server error';
			const error = new Error(message) as Error & {
				contextInfo?: { n_prompt_tokens: number; n_ctx: number };
			};
			error.name = response.status === 400 ? 'ServerError' : 'HttpError';

			if (errorData.error && 'n_prompt_tokens' in errorData.error && 'n_ctx' in errorData.error) {
				error.contextInfo = {
					n_prompt_tokens: errorData.error.n_prompt_tokens,
					n_ctx: errorData.error.n_ctx
				};
			}

			return error;
		} catch {
			const fallback = new Error(
				`Server error (${response.status}): ${response.statusText}`
			) as Error & {
				contextInfo?: { n_prompt_tokens: number; n_ctx: number };
			};
			fallback.name = 'HttpError';

			return fallback;
		}
	}

	/**
	 * Calls the onTimings callback with timing data from streaming response.
	 *
	 * @param timings - Timing information from the Chat Completions API response
	 * @param promptProgress - Prompt processing progress data
	 * @param onTimingsCallback - Callback function to invoke with timing data
	 * @private
	 */
	private static notifyTimings(
		timings: ChatMessageTimings | undefined,
		promptProgress: ChatMessagePromptProgress | undefined,
		onTimingsCallback:
			| ((timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void)
			| undefined
	): void {
		if (!onTimingsCallback || (!timings && !promptProgress)) return;

		onTimingsCallback(timings, promptProgress);
	}
}
