import { getJsonHeaders, getAuthHeaders } from './api-headers';
import { config } from '$lib/stores/settings.svelte';
import { getApiProvider } from '$lib/services/providers';
import { fetchProviderEndpoint } from '$lib/services/providers/provider-transport';
import type { ProviderConnectionContext } from '$lib/types/provider';

/**
 * API Fetch Utilities
 *
 * Provides common fetch patterns used across services:
 * - Automatic JSON headers
 * - Error handling with proper error messages
 * - Base path resolution
 */

export interface ApiFetchOptions extends Omit<RequestInit, 'headers'> {
	context?: ProviderConnectionContext;
	/**
	 * Use auth-only headers (no Content-Type).
	 * Default: false (uses JSON headers with Content-Type: application/json)
	 */
	authOnly?: boolean;
	/**
	 * Explicit credential snapshot. When omitted, the current config is used.
	 */
	apiKey?: string;
	/**
	 * Additional headers to merge with default headers.
	 */
	headers?: Record<string, string>;
}

/**
 * Fetch JSON data from an API endpoint with standard headers and error handling.
 *
 * @param path - API path (will be prefixed with base path)
 * @param options - Fetch options with additional authOnly flag
 * @returns Parsed JSON response
 * @throws Error with formatted message on failure
 *
 * @example
 * ```typescript
 * // GET request
 * const models = await apiFetch<ApiModelListResponse>('/v1/models');
 *
 * // POST request
 * const result = await apiFetch<ApiResponse>('/models/load', {
 *   method: 'POST',
 *   body: JSON.stringify({ model: 'gpt-4' })
 * });
 * ```
 */
export function getApiBaseUrl(): string {
	if (String(config().apiProvider ?? 'llama-server') !== 'llama-server')
		throw new Error('The native MCP proxy requires llama-server');
	return `${window.location.origin}/__llampart/api/llama-server`;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
	const { authOnly = false, apiKey, context, headers: customHeaders, ...fetchOptions } = options;

	const baseHeaders = authOnly ? getAuthHeaders(apiKey) : getJsonHeaders(apiKey);
	const headers = { ...baseHeaders, ...customHeaders };

	const current = config();
	const source = context ?? {
		providerId: getApiProvider(String(current.apiProvider ?? '')).id,
		serverBaseUrl: String(current.serverBaseUrl ?? ''),
		apiKey: apiKey ?? String(current.apiKey ?? '')
	};
	const response = await fetchProviderEndpoint(source, path.startsWith('/') ? path : `/${path}`, {
		...fetchOptions,
		headers
	});

	if (!response.ok) {
		const errorMessage = await parseErrorMessage(response);
		throw new Error(
			source.apiKey ? errorMessage.split(source.apiKey).join('[redacted]') : errorMessage
		);
	}

	return response.json() as Promise<T>;
}

/**
 * Fetch with URL constructed from base URL and query parameters.
 *
 * @param basePath - Base API path
 * @param params - Query parameters to append
 * @param options - Fetch options
 * @returns Parsed JSON response
 *
 * @example
 * ```typescript
 * const props = await apiFetchWithParams<ApiProps>('./props', {
 *   model: 'gpt-4',
 *   autoload: 'false'
 * });
 * ```
 */
export async function apiFetchWithParams<T>(
	basePath: string,
	params: Record<string, string>,
	options: ApiFetchOptions = {}
): Promise<T> {
	const url = new URL(basePath.replace(/^\.\//, '/'), 'http://gateway.invalid');

	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, value);
		}
	}

	return apiFetch<T>(`${url.pathname}${url.search}`, options);
}

/**
 * POST JSON data to an API endpoint.
 *
 * @param path - API path
 * @param body - Request body (will be JSON stringified)
 * @param options - Additional fetch options
 * @returns Parsed JSON response
 */
export async function apiPost<T, B = unknown>(
	path: string,
	body: B,
	options: ApiFetchOptions = {}
): Promise<T> {
	return apiFetch<T>(path, {
		method: 'POST',
		body: JSON.stringify(body),
		...options
	});
}

/**
 * Parse error message from a failed response.
 * Tries to extract error message from JSON body, falls back to status text.
 */
async function parseErrorMessage(response: Response): Promise<string> {
	try {
		const errorData = await response.json();
		if (errorData?.error?.message) {
			return errorData.error.message;
		}
		if (errorData?.error && typeof errorData.error === 'string') {
			return errorData.error;
		}
		if (errorData?.message) {
			return errorData.message;
		}
	} catch {
		// JSON parsing failed, use status text
	}

	return `Request failed: ${response.status} ${response.statusText}`;
}
