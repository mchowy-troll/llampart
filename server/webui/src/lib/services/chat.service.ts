import { t } from '$lib/i18n';
import {
	captureChatInstructionSettings,
	withChatInstructions
} from '$lib/utils/response-preferences';
import { VllmLiveStatistics } from '$lib/utils/vllm-live-statistics';
import { getApiProvider } from '$lib/services/providers';
import type { ApiProviderAdapter } from '$lib/services/providers/provider.types';
import type { OperationModel, ProviderRequestContext, ProviderUsage } from '$lib/types/provider';
import { formatAttachmentText } from '$lib/utils/formatters';
import { isAbortError, withAbortSignal } from '$lib/utils/abort';
import { projectToolHistory } from '$lib/utils/tool-lifecycle';
import { toolResultContentParts } from '$lib/utils/tool-result-images';
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
import { serverStore } from '$lib/stores/server.svelte';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import { API_STREAM } from '$lib/constants/api-endpoints';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { fetchProviderEndpoint } from '$lib/services/providers/provider-transport';
import { connectionProtocol } from '$lib/services/providers/provider-capabilities';
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
import { LlamaServerBackendError } from '$lib/services/providers/llama-server-response';
import type { MessageModelInfoSnapshot } from '$lib/types/message-model-info';
import { formVisibleText, type FormProposal } from '$lib/forms/form-protocol';
import { formBytes, validateFormSpec } from '$lib/services/interactive-forms';
import type { InteractiveFormSpec } from '$lib/types/interactive-forms';

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
	private static isFormOperationCurrent(
		operation: OperationModel,
		signal: AbortSignal,
		isCurrent: () => boolean
	): boolean {
		return (
			!signal.aborted &&
			operation.chatInstructions?.interactiveFormsEnabled === true &&
			operation.interactiveFormsEpoch === settingsStore.interactiveFormsEpoch &&
			config().interactiveFormsEnabled === true &&
			ChatService.isProviderRequestContextCurrent(operation.requestContext) &&
			isCurrent()
		);
	}

	/** Auxiliary, tool-free request only after the model's explicit format decision.
	 * Uses the existing provider/permissions/terminal-event transport, not a second client.
	 */
	static async generateInteractiveForm(
		proposal: FormProposal,
		operation: OperationModel,
		signal: AbortSignal,
		isCurrent: () => boolean,
		inference?: Pick<SettingsChatServiceOptions, 'onTimings' | 'onProviderResult'>
	): Promise<InteractiveFormSpec | undefined> {
		const current = () => ChatService.isFormOperationCurrent(operation, signal, isCurrent);
		if (!current()) return;
		const questions = proposal.questions.trim();
		if (!questions || questions.length > 12000 || signal.aborted) return;
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(abort, 90000);
		let raw = '';
		let complete = false;
		let finishReason = '';
		try {
			const { buildFormCatalogInstructions, formCatalog } = await import('$lib/forms/form-catalog');
			if (!current()) return;
			await ChatService.sendMessage(
				[
					{ role: 'system', content: buildFormCatalogInstructions() },
					{ role: 'user', content: questions }
				],
				{
					operationModel: Object.freeze({ ...operation, conversationId: null }),
					stream: true,
					temperature: 0,
					max_tokens: 4000,
					// Native llama-server supports these request-local options. Other
					// adapters keep plain text JSON; no tool/structured-output assumption.
					...(operation.requestContext.providerId === API_PROVIDER_IDS.LLAMA_SERVER
						? {
								timings_per_token: true,
								custom: {
									response_format: { type: 'json_object' },
									chat_template_kwargs: { enable_thinking: false }
								}
							}
						: {}),
					onChunk: (chunk) => {
						raw += chunk;
						if (formBytes(raw) > 32768 || !current()) controller.abort();
					},
					onProviderResult: (event) => {
						inference?.onProviderResult?.(event);
						if (event.finishReason) finishReason = event.finishReason;
						if (!current() || event.toolCalls?.length || event.refusal) controller.abort();
					},
					onTimings: inference?.onTimings,
					onComplete: () => {
						complete = true;
					}
				},
				undefined,
				controller.signal
			);
			if (
				!complete ||
				controller.signal.aborted ||
				!current() ||
				!['stop', 'end_turn', 'completed'].includes(finishReason)
			)
				return;
			const spec = validateFormSpec(raw);
			return formCatalog.validate(spec).success ? spec : undefined;
		} catch (error) {
			if (!isAbortError(error))
				console.warn('[ChatService] Form unavailable; retaining text fallback');
			return;
		} finally {
			clearTimeout(timeout);
			signal.removeEventListener('abort', abort);
		}
	}

	private static frozenStreamRequests = new Map<string, FrozenStreamRequest>();
	private static sourceGeneration = 0;
	private static readonly optionalStreamEndpointStatuses = new Set([404, 405, 501]);

	/** Resolve once at the owner's synchronous entry, preserving provider-specific priorities. */
	static captureOperationModel(
		context: ProviderRequestContext,
		modelOverride?: string | null,
		conversationModel?: string | null,
		selection?: { conversationId: string | null }
	): OperationModel {
		const model = ChatService.resolveEffectiveModel(context, modelOverride, conversationModel);
		let verifiedInfo: MessageModelInfoSnapshot | null = null;
		const capabilities = modelsStore.refreshCapabilities(context, model, true, (info) => {
			verifiedInfo = info;
		});
		const modelInfo = capabilities.then(() => verifiedInfo);
		// Discovery can finish while the operation still awaits persistence/permission.
		void capabilities.catch(() => undefined);
		void modelInfo.catch(() => undefined);
		return Object.freeze({
			interactiveFormsEpoch: settingsStore.interactiveFormsEpoch,
			chatInstructions: captureChatInstructionSettings(config()),
			model,
			requestContext: context,
			capabilities,
			modelInfo,
			conversationId: selection?.conversationId ?? null
		});
	}

	/** Same wire identity for the composer, discovery and synchronous operation capture. */
	static resolveEffectiveModel(
		context: ProviderRequestContext,
		modelOverride?: string | null,
		conversationModel?: string | null
	): string | null {
		let model = modelOverride || null;
		if (!model) {
			if (context.providerId === API_PROVIDER_IDS.LLAMA_SERVER && serverStore.isRouterMode) {
				model = modelsStore.selectedModelName || conversationModel || null;
			} else if (getApiProvider(context.providerId).capabilities.requiresModelInChatRequest) {
				model = (modelsStore.selectedModelName || modelsStore.selectedModelId || '').trim() || null;
			}
		}
		return model;
	}

	/**
	 * Generates a short conversation title with an auxiliary LLM request.
	 * This does not use the conversation system prompt; backend generation defaults are preserved.
	 */
	static async generateTitle(
		message: ApiChatMessageData,
		model?: string | null,
		signal?: AbortSignal,
		requestBinding?: Pick<SettingsChatServiceOptions, 'providerRequestContext' | 'operationModel'>
	): Promise<string> {
		let titleResponse = '';

		try {
			const context =
				requestBinding?.operationModel?.requestContext ??
				requestBinding?.providerRequestContext ??
				ChatService.createProviderRequestContext();
			const operation =
				requestBinding?.operationModel ?? ChatService.captureOperationModel(context, model);
			await ChatService.sendMessage(
				[message],
				{
					model: model || undefined,
					providerRequestContext: context,
					operationModel: Object.freeze({ ...operation, conversationId: null }),
					stream: true,
					// Backend defaults may enable thinking. A tiny output budget can be
					// exhausted entirely by reasoning before any title is produced.
					// Only accept a successfully completed response, never a partial stream.
					onComplete: (content?: string) => {
						titleResponse = content ?? '';
					}
				},
				undefined,
				signal
			);
		} catch (error) {
			console.warn('[ChatService] Failed to generate conversation title:', error);
			return '';
		}

		return signal?.aborted ? '' : titleResponse;
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
			options.operationModel?.requestContext ??
			options.providerRequestContext ??
			ChatService.createProviderRequestContext();
		if (!ChatService.isProviderRequestContextCurrent(requestContext)) return;
		const provider = getApiProvider(requestContext.providerId);
		let effectiveOptions: SettingsChatServiceOptions = {
			...options,
			protocol: requestContext.protocol ?? 'chat-completions'
		};

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

		let normalizedMessages: ApiChatMessageData[] = messages
			.map((msg) => {
				if ('id' in msg && 'convId' in msg && 'timestamp' in msg) {
					const dbMsg = msg as DatabaseMessage & { extra?: DatabaseMessageExtra[] };

					return ChatService.convertDbMessageToApiChatMessageData(dbMsg);
				} else {
					return { ...msg } as ApiChatMessageData;
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

		normalizedMessages = projectToolHistory(normalizedMessages);
		// config() is committed state, never the Settings draft/appearance overlay.
		// Auxiliary requests (including title generation) have no conversationId.
		const operationModel =
			options.operationModel ??
			ChatService.captureOperationModel(requestContext, options.model, undefined, {
				conversationId: conversationId ?? null
			});
		if (conversationId)
			normalizedMessages = withChatInstructions(
				normalizedMessages,
				operationModel.chatInstructions ?? captureChatInstructionSettings(config())
			);
		if (operationModel.conversationId && operationModel.conversationId !== conversationId)
			throw new Error('Request belongs to a different conversation');
		effectiveOptions = {
			...effectiveOptions,
			operationModel,
			model: operationModel.model ?? undefined
		};

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

		try {
			const capabilities = await withAbortSignal(operationModel.capabilities, signal);
			if (!ChatService.isProviderRequestContextCurrent(requestContext) || signal?.aborted) return;
			effectiveOptions = {
				...effectiveOptions,
				protocol: capabilities?.protocol ?? 'chat-completions'
			};
			if (resumableState) {
				saveResumableStreamState(resumableState);
				ChatService.frozenStreamRequests.set(resumableState.streamIdentity, {
					provider,
					context: requestContext
				});
			}
			const requestStartedAt = ChatService.getMonotonicNow();
			ChatService.validateImageInput(normalizedMessages, capabilities);
			const providerRequest = provider.buildChatCompletionRequest({
				serverBaseUrl: frozenServerBaseUrl,
				apiKey: frozenApiKey,
				messages: normalizedMessages,
				options: effectiveOptions,
				streamIdentity: resumableState?.streamIdentity,
				capabilities: capabilities ?? undefined
			});

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
					effectiveOptions.resumeSeed,
					effectiveOptions.protocol,
					effectiveOptions.onProviderResult,
					capabilities
						? {
								providerId: capabilities.providerId,
								sourceFingerprint: capabilities.connectionIdentity,
								model: effectiveOptions.model ?? ''
							}
						: undefined
				);

				return;
			} else {
				return await ChatService.handleNonStreamResponse(
					provider,
					response,
					onComplete,
					onToolCallChunk,
					onModel,
					requestStartedAt,
					effectiveOptions.protocol,
					effectiveOptions.onProviderResult,
					capabilities
						? {
								providerId: capabilities.providerId,
								sourceFingerprint: capabilities.connectionIdentity,
								model: effectiveOptions.model ?? ''
							}
						: undefined
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

			if (frozenApiKey)
				userFriendlyError.message = userFriendlyError.message
					.split(frozenApiKey)
					.join('[redacted]');
			console.error('Error in sendMessage:', userFriendlyError.name, userFriendlyError.message);

			try {
				await onError?.(userFriendlyError);
			} catch (callbackError) {
				console.error('Error in chat error callback:', callbackError);
			}

			throw userFriendlyError;
		}
	}

	/** Unknown is not evidence of support, but retains the existing serializer policy.
	 * Never silently remove an actual image from the selected request path. */
	private static validateImageInput(
		messages: ApiChatMessageData[],
		capabilities: import('$lib/types/provider').CapabilitySnapshot | null
	): void {
		if (
			capabilities?.features.vision?.state === 'unsupported' &&
			messages.some(
				(message) =>
					Array.isArray(message.content) &&
					message.content.some(
						(part: ApiChatMessageContentPart) => part.type === ContentPartType.IMAGE_URL
					)
			)
		)
			throw new Error('This backend/model explicitly does not support vision input');
		if (
			messages.some(
				(message) =>
					message.role === MessageRole.TOOL &&
					Array.isArray(message.content) &&
					message.content.some(
						(part: ApiChatMessageContentPart) => part.type === ContentPartType.IMAGE_URL
					)
			)
		)
			throw new Error(
				'Tool result images are saved in the conversation, but this backend has no confirmed multimodal tool-output support. The model request was not sent.'
			);
	}

	static createProviderRequestContext(): ProviderRequestContext {
		const currentConfig = config();
		return Object.freeze({
			providerId: getApiProvider(String(currentConfig.apiProvider ?? '')).id,
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? ''),
			protocol: connectionProtocol(String(currentConfig.apiProvider ?? ''), currentConfig),
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
			context.apiKey === String(currentConfig.apiKey ?? '') &&
			(context.protocol ?? 'chat-completions') ===
				connectionProtocol(context.providerId, currentConfig)
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
			const url = model ? `/slots?model=${encodeURIComponent(model)}` : '/slots';
			const res = await fetchProviderEndpoint(context, url, {
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
		signal?: AbortSignal,
		operationModel?: OperationModel
	): Promise<void> {
		const requestContext = operationModel?.requestContext ?? context;
		if (!ChatService.isProviderRequestContextCurrent(requestContext)) return;
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

		const requestMessages = withChatInstructions(
			projectToolHistory(normalizedMessages),
			operationModel?.chatInstructions ?? captureChatInstructionSettings(config())
		);
		const requestModel = operationModel ? operationModel.model : model;
		const requestBody: Record<string, unknown> = {
			messages: requestMessages.map((msg: ApiChatMessageData) => {
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

		if (requestModel) {
			requestBody.model = requestModel;
		}

		try {
			const provider = getApiProvider(requestContext.providerId);
			if (!provider.capabilities.supportsPreEncode) return;
			const capabilities = await (operationModel?.capabilities ??
				modelsStore.refreshCapabilities(requestContext, requestModel ?? null));
			if (!ChatService.isProviderRequestContextCurrent(requestContext)) return;
			ChatService.validateImageInput(requestMessages, capabilities);

			const response = await fetchProviderEndpoint(requestContext, '/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(requestContext.apiKey.trim()
						? { Authorization: `Bearer ${requestContext.apiKey.trim()}` }
						: {})
				},
				body: JSON.stringify(requestBody),
				signal
			});
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
		if (!usage) return undefined;

		const elapsedMs = Math.max(1, Math.round(completedAtMs - startedAtMs));

		return {
			prompt_n: usage.promptTokens,
			predicted_n: usage.completionTokens,
			predicted_ms: usage.metrics?.find(
				(metric) => metric.name === 'generationTime' && metric.available
			)?.value,
			predicted_per_second: usage.metrics?.find(
				(metric) => metric.name === 'tokensPerSecond' && metric.available
			)?.value,
			predicted_per_token_ms: usage.metrics?.find(
				(metric) => metric.name === 'interTokenLatency' && metric.available
			)?.value,
			provider: {
				usage,
				metrics: [
					...(usage.metrics ?? []),
					{ name: 'elapsedTime', value: elapsedMs, unit: 'ms', source: 'browser', available: true }
				]
			}
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
		const url = buildStreamRequestUrl(API_STREAM.BASE, state.streamIdentity);

		try {
			await fetchProviderEndpoint(context, url, {
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
			lookupResponse = await fetchProviderEndpoint(context, API_STREAM.LOOKUP, {
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
				if (error instanceof LlamaServerBackendError) ChatService.clearResumableState(state);
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
		return fetchProviderEndpoint(
			{ providerId: API_PROVIDER_IDS.LLAMA_SERVER, serverBaseUrl, apiKey },
			buildStreamRequestUrl(API_STREAM.BASE, state.streamIdentity, state.bytesReceived),
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
			toolCalls?: string,
			providerContinuation?: import('$lib/types/provider').ProviderContinuation
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
		resumeSeed?: ChatStreamResumeSeed,
		protocol?: import('$lib/types/provider').ProviderProtocol,
		onProviderResult?: SettingsChatServiceOptions['onProviderResult'],
		continuationSource?: Pick<
			import('$lib/types/provider').ProviderContinuation,
			'providerId' | 'sourceFingerprint' | 'model'
		>
	): Promise<void> {
		let aggregatedContent = resumeSeed?.content ?? '';
		const parseStream =
			provider.createStreamParser?.(protocol) ?? provider.parseChatCompletionStreamData;
		let providerContinuation: import('$lib/types/provider').ProviderContinuation | undefined;
		let fullReasoningContent = resumeSeed?.reasoningContent ?? '';
		let aggregatedToolCalls: ApiChatCompletionToolCall[] = (resumeSeed?.toolCalls ?? []).map(
			(call) => ({ ...call, function: call.function ? { ...call.function } : undefined })
		);
		let lastTimings: ChatMessageTimings | undefined = resumeSeed?.timings;
		const streamStartedAt = ChatService.getMonotonicNow();
		const liveStatistics =
			provider.id === API_PROVIDER_IDS.VLLM && protocol !== 'responses'
				? new VllmLiveStatistics()
				: undefined;
		let streamFinished = false;
		let modelEmitted = false;
		let idEmitted = false;
		let toolCallIndexOffset = 0;
		let hasOpenToolCallBatch = false;
		let reconnectAttempt = 0;

		const finalizeOpenToolCallBatch = () => {
			if (provider.id !== API_PROVIDER_IDS.LLAMA_SERVER) return;
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
				toolCallIndexOffset,
				provider.id !== API_PROVIDER_IDS.LLAMA_SERVER
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
			const parser = new SseByteParser(provider.id === API_PROVIDER_IDS.LLAMA_SERVER);
			const baseOffset = resumableState?.bytesReceived ?? 0;
			const processRecords = async (records: ReturnType<SseByteParser['push']>) => {
				for (const record of records) {
					if (abortSignal?.aborted) return;

					if (record.data !== null) {
						let event;
						try {
							if (streamFinished && !(protocol === 'responses' && record.data === '[DONE]'))
								throw new Error('Event after terminal outcome');
							event = parseStream(record.data, record.eventType);
						} catch (error) {
							if (error instanceof LlamaServerBackendError) throw error;
							throw new StreamProtocolError('Failed to parse provider stream data', {
								cause: error
							});
						}

						if (event) {
							const observedAt = ChatService.getMonotonicNow();
							const liveRate = liveStatistics?.observe(event, observedAt);
							if (event.reasoningItems && continuationSource)
								providerContinuation = {
									...continuationSource,
									protocol: 'responses',
									reasoningItems: event.reasoningItems
								};
							onProviderResult?.(event);
							if (event.status && event.status !== 'completed') {
								const error = new Error(
									`Provider response ${event.status}: ${event.finishReason ?? event.status}`
								);
								error.name = 'ProviderOutcomeError';
								throw error;
							}
							if (event.done) streamFinished = true;
							if (
								provider.id !== API_PROVIDER_IDS.LLAMA_SERVER &&
								(event.finishReason || event.refusal || event.status || event.completionId)
							)
								lastTimings = {
									...lastTimings,
									provider: {
										...lastTimings?.provider,
										finishReason: event.finishReason ?? lastTimings?.provider?.finishReason,
										refusal: (lastTimings?.provider?.refusal ?? '') + (event.refusal ?? ''),
										status: event.status ?? lastTimings?.provider?.status,
										completionId: event.completionId ?? lastTimings?.provider?.completionId
									}
								};
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
									observedAt
								);
								if (usageTimings) {
									if (
										liveRate &&
										!event.usage.metrics?.some(
											(metric) =>
												metric.name === 'tokensPerSecond' &&
												metric.source === 'backend' &&
												metric.available
										)
									)
										usageTimings.provider?.metrics?.push(liveRate);
									ChatService.notifyTimings(usageTimings, event.promptProgress, onTimings);
									lastTimings = {
										...usageTimings,
										provider: { ...lastTimings?.provider, ...usageTimings.provider }
									};
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
							providerContinuation,
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
				await reader.cancel().catch(() => {});
				reader.releaseLock();
			}

			if (abortSignal?.aborted) return;
			if (transportError) {
				console.warn('[ChatService] Stream disconnected; attempting resume:', transportError);
			}
			if (streamFinished) {
				if (provider.id !== API_PROVIDER_IDS.LLAMA_SERVER) {
					for (const call of aggregatedToolCalls) {
						if (
							!call?.id ||
							call.type !== 'function' ||
							!call.function?.name ||
							typeof call.function.arguments !== 'string'
						)
							throw new StreamProtocolError('Incomplete terminal function call');
						try {
							JSON.parse(call.function.arguments);
						} catch {
							throw new StreamProtocolError('Invalid terminal function arguments');
						}
					}
				}
				finalizeOpenToolCallBatch();
				const finalToolCalls =
					aggregatedToolCalls.length > 0 ? JSON.stringify(aggregatedToolCalls) : undefined;
				if (resumableState) ChatService.clearResumableState(resumableState);
				await onComplete?.(
					aggregatedContent,
					fullReasoningContent || undefined,
					lastTimings,
					finalToolCalls,
					providerContinuation
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
				throw new IncompleteStreamError('Stream ended before a terminal event', {
					cause: transportError
				});
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
			toolCalls?: string,
			providerContinuation?: import('$lib/types/provider').ProviderContinuation
		) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void,
		requestStartedAt?: number,
		protocol?: import('$lib/types/provider').ProviderProtocol,
		onProviderResult?: SettingsChatServiceOptions['onProviderResult'],
		continuationSource?: Pick<
			import('$lib/types/provider').ProviderContinuation,
			'providerId' | 'sourceFingerprint' | 'model'
		>
	): Promise<string> {
		const responseText = await response.text();

		if (!responseText.trim()) {
			const noResponseError = new Error('No response received from server. Please try again.');

			throw noResponseError;
		}

		const data = JSON.parse(responseText);
		const parsedResponse =
			provider.parseResponse?.(data, protocol) ?? provider.parseChatCompletionResponse(data);
		onProviderResult?.(parsedResponse);
		if (parsedResponse.status && parsedResponse.status !== 'completed') {
			const error = new Error(
				`Provider response ${parsedResponse.status}: ${parsedResponse.finishReason ?? parsedResponse.status}`
			);
			error.name = 'ProviderOutcomeError';
			throw error;
		}

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

		if (!content.trim() && !serializedToolCalls && !parsedResponse.refusal) {
			const noResponseError = new Error('No response received from server. Please try again.');

			throw noResponseError;
		}

		const timings = ChatService.buildProviderUsageTimings(
			parsedResponse.usage,
			requestStartedAt ?? ChatService.getMonotonicNow(),
			ChatService.getMonotonicNow()
		);

		await onComplete?.(
			content,
			reasoningContent,
			provider.id === API_PROVIDER_IDS.LLAMA_SERVER
				? timings
				: {
						...timings,
						provider: {
							...timings?.provider,
							finishReason: parsedResponse.finishReason,
							refusal: parsedResponse.refusal,
							status: parsedResponse.status,
							completionId: parsedResponse.completionId
						}
					},
			serializedToolCalls,
			parsedResponse.reasoningItems && continuationSource
				? {
						...continuationSource,
						protocol: 'responses',
						reasoningItems: parsedResponse.reasoningItems
					}
				: undefined
		);

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
		indexOffset = 0,
		mergeNameFragments = false
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
				if (mergeNameFragments && target.id && target.id !== delta.id)
					throw new StreamProtocolError('Tool call ID changed within the same index');
				target.id = delta.id;
			}

			if (delta.type) {
				target.type = delta.type;
			}

			if (delta.function) {
				const fn = target.function ? { ...target.function } : {};

				if (delta.function.name) {
					fn.name = mergeNameFragments
						? (fn.name ?? '') + delta.function.name
						: delta.function.name;
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
		const visibleContent =
			message.role === MessageRole.ASSISTANT
				? formVisibleText(message.content, true) ||
					(message.content
						? t(
								message.interactiveForm
									? 'interactiveForms.invalid'
									: 'interactiveForms.proposalFailed'
							)
						: '')
				: message.content;
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
				agentic: message.agentic,
				providerContinuation: message.providerContinuation,
				role: message.role as MessageRole,
				content: visibleContent,
				...(message.role === MessageRole.TOOL && message.toolCallId
					? { tool_call_id: message.toolCallId }
					: {})
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

		// Include images from all messages
		const imageFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraImageFile =>
				extra.type === AttachmentType.IMAGE
		);

		if (message.role === MessageRole.TOOL && imageFiles.length) {
			contentParts.push(...toolResultContentParts(message.content, imageFiles));
		} else {
			if (visibleContent) contentParts.push({ type: ContentPartType.TEXT, text: visibleContent });
			for (const image of imageFiles)
				contentParts.push({ type: ContentPartType.IMAGE_URL, image_url: { url: image.base64Url } });
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
			agentic: message.agentic,
			providerContinuation: message.providerContinuation,
			role: message.role as MessageRole,
			content: contentParts,
			...(message.role === MessageRole.TOOL && message.toolCallId
				? { tool_call_id: message.toolCallId }
				: {})
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
