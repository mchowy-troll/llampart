/**
 * Unified exports for all utility functions
 * Import utilities from '$lib/utils' for cleaner imports
 *
 * For browser-only utilities (pdf-processing, audio-recording, svg-to-png,
 * webp-to-png, process-uploaded-files, convert-files-to-extra), use:
 * import { ... } from '$lib/utils/browser-only'
 */

// API utilities
export { getAuthHeaders, getJsonHeaders, sanitizeHeaders } from './api-headers';
export {
	apiFetch,
	apiFetchWithParams,
	apiPost,
	getApiBaseUrl,
	type ApiFetchOptions
} from './api-fetch';
export {
	validateConnectionSettings,
	normalizeServerBaseUrl,
	buildPropsUrl,
	type ConnectionValidationResult
} from './connection-validation';
// Attachment utilities
export { getAttachmentDisplayItems } from './attachment-display';
export {
	isTextFile,
	isImageFile,
	isPdfFile,
	isAudioFile,
	isPastedTextAttachment,
	isAttachmentOnlyMessage,
	isPastedTextOnlyAttachmentMessage
} from './attachment-type';

// Textarea utilities
export { default as autoResizeTextarea } from './autoresize-textarea';

// Branching utilities
export {
	filterByLeafNodeId,
	findMessageById,
	findLeafNode,
	findDescendantMessages,
	getMessageSiblings,
	getMessageDisplayList,
	hasMessageSiblings,
	getNextSibling,
	getPreviousSibling
} from './branching';

// Code
export { highlightCode, detectIncompleteCodeBlock, type IncompleteCodeBlock } from './code';

// Config helpers
export { setConfigValue, getConfigValue, configToParameterRecord } from './config-helpers';

// CORS Proxy
export { buildProxiedUrl, getProxiedUrlString, buildProxiedHeaders } from './cors-proxy';

// Conversation utilities
export { createMessageCountMap, getMessageCount } from './conversation-utils';
export {
	formatConversationTimestamp,
	formatConversationTimestampParts,
	type ConversationTimestampFormat,
	type ConversationTimestampParts
} from './conversation-timestamp';

// Clipboard utilities
export {
	copyToClipboard,
	copyCodeToClipboard,
	copyTableToClipboard,
	formatTableRowsAsTsv,
	formatMessageForClipboard,
	parseClipboardContent,
	hasClipboardAttachments
} from './clipboard';

// File preview utilities
export { getFileTypeLabel } from './file-preview';
export { getPreviewText, generateConversationTitle } from './text';

// File download utilities
export { downloadTextFile } from './download';

// File type utilities
export {
	getFileTypeCategory,
	getFileTypeCategoryByExtension,
	getFileTypeByExtension,
	isFileTypeSupported
} from './file-type';

// Formatting utilities
export {
	formatFileSize,
	formatParameters,
	formatNumber,
	formatJsonPretty,
	formatTime,
	formatPerformanceTime,
	formatAttachmentText
} from './formatters';

// IME utilities
export { isIMEComposing } from './is-ime-composing';

// LaTeX utilities
export { maskInlineLaTeX, preprocessLaTeX } from './latex-protection';

// Modality file validation utilities
export {
	isFileTypeSupportedByModel,
	filterFilesByModalities,
	generateModalityErrorMessage
} from './modality-file-validation';

// Model name utilities
export { normalizeModelName, isValidModelName } from './model-names';

// Portal utilities
export { portalToBody } from './portal-to-body';

// Precision utilities
export { normalizeFloatingPoint, normalizeNumber } from './precision';

// Syntax highlighting utilities
export { getLanguageFromFilename } from './syntax-highlight-language';

// Text file utilities
export { isTextFileByName, readFileAsText, isLikelyTextFile } from './text-files';

// Debounce utilities
export { debounce } from './debounce';

// Sanitization utilities
export { sanitizeKeyValuePairKey, sanitizeKeyValuePairValue } from './sanitize';

// MCP utilities
export {
	getMcpLogLevelIcon,
	getMcpLogLevelClass,
	isImageMimeType,
	parseResourcePath,
	getDisplayName,
	getResourceDisplayName,
	isCodeResource,
	isImageResource,
	getResourceIcon,
	getResourceTextContent,
	getResourceBlobContent,
	downloadResourceContent
} from './mcp';
export {
	detectMcpTransportFromUrl,
	parseMcpHeaders,
	parseMcpServerSettings,
	buildMcpServerConfig,
	buildMcpClientConfig
} from './mcp-config';

// URI Template utilities
export {
	extractTemplateVariables,
	expandTemplate,
	isTemplateComplete,
	normalizeResourceUri,
	type UriTemplateVariable
} from './uri-template';

// Data URL utilities
export { createBase64DataUrl } from './data-url';

// Header utilities
export { parseHeadersToArray, serializeHeaders } from './headers';

// Favicon utilities
export { getFaviconUrl } from './favicon';

// Agentic content utilities (structured section derivation)
export {
	deriveAgenticSections,
	parseToolResultWithImages,
	hasAgenticContent,
	type AgenticSection,
	type ToolResultLine
} from './agentic';

// Message content utilities
export { generateAssistantResponseFilename, getMessageResponseContent } from './message-content';

// Legacy migration utilities
export { runLegacyMigration, isMigrationNeeded } from './legacy-migration';

// Cache utilities
export { TTLCache, ReactiveTTLMap, type TTLCacheOptions } from './cache-ttl';

// Redaction utilities
export { redactValue } from './redact';

// Request inspection utilities
export {
	getRequestUrl,
	getRequestMethod,
	getRequestBody,
	summarizeRequestBody,
	formatDiagnosticErrorMessage,
	extractJsonRpcMethods,
	type RequestBodySummary
} from './request-helpers';

// Abort signal utilities
export {
	throwIfAborted,
	isAbortError,
	createLinkedController,
	createTimeoutSignal,
	withAbortSignal
} from './abort';
export { getReconnectDelay, sleepWithAbort, type SleepTimer } from './retry';

// Cryptography utilities

export { uuid } from './uuid';
export { createStreamIdentity, buildStreamRequestUrl } from './stream-identity';
export * from './chat-template-thinking-detector';
export * from './document-title';
export { isVideoFile } from './attachment-type';
