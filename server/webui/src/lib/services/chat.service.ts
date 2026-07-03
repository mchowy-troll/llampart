import { t } from '$lib/i18n';
import { getApiBaseUrl } from '$lib/utils';
import { getApiProvider } from '$lib/services/providers';
import type { ApiProviderAdapter } from '$lib/services/providers/provider.types';
import { formatAttachmentText } from '$lib/utils/formatters';
import { isAbortError } from '$lib/utils/abort';
import {
	ATTACHMENT_LABEL_PDF_FILE,
	ATTACHMENT_LABEL_MCP_PROMPT,
	ATTACHMENT_LABEL_MCP_RESOURCE,
	LEGACY_AGENTIC_REGEX
} from '$lib/constants';
import { AttachmentType, ContentPartType, MessageRole, UrlProtocol } from '$lib/enums';
import type { ApiChatMessageContentPart, ApiChatCompletionToolCall } from '$lib/types/api';
import type { DatabaseMessageExtraMcpPrompt, DatabaseMessageExtraMcpResource } from '$lib/types';
import { modelsStore } from '$lib/stores/models.svelte';
import { config } from '$lib/stores/settings.svelte';

export class ChatService {
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
		const currentConfig = config();
		const provider = getApiProvider(String(currentConfig.apiProvider ?? ''));
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

		const providerRequest = provider.buildChatCompletionRequest({
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? ''),
			messages: normalizedMessages,
			options: effectiveOptions
		});

		try {
			const response = await fetch(providerRequest.url, {
				...providerRequest.init,
				signal
			});

			if (!response.ok) {
				const error = await ChatService.parseErrorResponse(response);

				if (onError) {
					onError(error);
				}

				throw error;
			}

			if (stream) {
				await ChatService.handleStreamResponse(
					provider,
					response,
					onChunk,
					onComplete,
					onError,
					onReasoningChunk,
					onToolCallChunk,
					onModel,
					onCompletionId,
					onTimings,
					conversationId,
					signal
				);

				return;
			} else {
				return ChatService.handleNonStreamResponse(
					provider,
					response,
					onComplete,
					onError,
					onToolCallChunk,
					onModel
				);
			}
		} catch (error) {
			if (isAbortError(error)) {
				return;
			}

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

			if (onError) {
				onError(userFriendlyError);
			}

			throw userFriendlyError;
		}
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
	static async areAllSlotsIdle(model?: string | null, signal?: AbortSignal): Promise<boolean> {
		try {
			const url = model
				? `${getApiBaseUrl()}/slots?model=${encodeURIComponent(model)}`
				: `${getApiBaseUrl()}/slots`;
			const res = await fetch(url, { signal });
			if (!res.ok) return true;

			const slots: { is_processing: boolean }[] = await res.json();
			return slots.every((s) => !s.is_processing);
		} catch {
			return true;
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
		model?: string | null,
		excludeReasoning?: boolean,
		signal?: AbortSignal
	): Promise<void> {
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
			const currentConfig = config();
			const provider = getApiProvider(String(currentConfig.apiProvider ?? ''));
			if (!provider.capabilities.supportsPreEncode) return;

			await fetch(`${getApiBaseUrl()}/v1/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(String(currentConfig.apiKey ?? '').trim()
						? { Authorization: `Bearer ${String(currentConfig.apiKey ?? '').trim()}` }
						: {})
				},
				body: JSON.stringify(requestBody),
				signal
			});
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

	/**
	 * Handles streaming response from the chat completion API
	 * @param response - The Response object from the fetch request
	 * @param onChunk - Optional callback invoked for each content chunk received
	 * @param onComplete - Optional callback invoked when the stream is complete with full response
	 * @param onError - Optional callback invoked if an error occurs during streaming
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
		) => void,
		onError?: (error: Error) => void,
		onReasoningChunk?: (chunk: string) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void,
		onCompletionId?: (id: string) => void,
		onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void,
		conversationId?: string,
		abortSignal?: AbortSignal
	): Promise<void> {
		const reader = response.body?.getReader();

		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let aggregatedContent = '';
		let fullReasoningContent = '';
		let aggregatedToolCalls: ApiChatCompletionToolCall[] = [];
		let lastTimings: ChatMessageTimings | undefined;
		let streamFinished = false;
		let modelEmitted = false;
		let idEmitted = false;
		let toolCallIndexOffset = 0;
		let hasOpenToolCallBatch = false;

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

		try {
			let chunk = '';
			while (true) {
				if (abortSignal?.aborted) break;

				const { done, value } = await reader.read();
				if (done) break;

				if (abortSignal?.aborted) break;

				chunk += decoder.decode(value, { stream: true });
				const lines = chunk.split('\n');
				chunk = lines.pop() || '';

				for (const line of lines) {
					if (abortSignal?.aborted) break;

					if (line.startsWith(UrlProtocol.DATA)) {
						const data = line.slice(6);

						try {
							const event = provider.parseChatCompletionStreamData(data);
							if (!event) continue;

							if (event.done) {
								streamFinished = true;
								continue;
							}

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
							}

							if (event.content) {
								finalizeOpenToolCallBatch();
								aggregatedContent += event.content;
								if (!abortSignal?.aborted) {
									onChunk?.(event.content);
								}
							}

							if (event.reasoningContent) {
								finalizeOpenToolCallBatch();
								fullReasoningContent += event.reasoningContent;
								if (!abortSignal?.aborted) {
									onReasoningChunk?.(event.reasoningContent);
								}
							}

							processToolCallDelta(event.toolCalls);
						} catch (e) {
							console.error('Error parsing provider stream chunk:', e);
						}
					}
				}

				if (abortSignal?.aborted) break;
			}

			if (abortSignal?.aborted) return;

			if (streamFinished) {
				finalizeOpenToolCallBatch();

				const finalToolCalls =
					aggregatedToolCalls.length > 0 ? JSON.stringify(aggregatedToolCalls) : undefined;

				onComplete?.(
					aggregatedContent,
					fullReasoningContent || undefined,
					lastTimings,
					finalToolCalls
				);
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error('Stream error');

			onError?.(err);

			throw err;
		} finally {
			reader.releaseLock();
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
		onError?: (error: Error) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void
	): Promise<string> {
		try {
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

			onComplete?.(content, reasoningContent, undefined, serializedToolCalls);

			return content;
		} catch (error) {
			const err = error instanceof Error ? error : new Error('Parse error');

			onError?.(err);

			throw err;
		}
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
