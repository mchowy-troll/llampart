import { apiFetchWithParams } from '$lib/utils/api-fetch';
import { buildProviderEndpointUrl } from '$lib/services/providers';
import type { ProviderConnectionContext } from '$lib/types/provider';

export class PropsService {
	/**
	 *
	 *
	 * Fetching
	 *
	 *
	 */

	/**
	 * Fetches global server properties from the `/props` endpoint.
	 * In MODEL mode, returns modalities for the single loaded model.
	 * In ROUTER mode, returns server-wide settings without model-specific modalities.
	 *
	 * @param autoload - If false, prevents automatic model loading (default: false)
	 * @returns Server properties including default generation settings and capabilities
	 * @throws {Error} If the request fails or returns invalid data
	 */
	static async fetch(
		context: ProviderConnectionContext,
		autoload = false
	): Promise<ApiLlamaCppServerProps> {
		const params: Record<string, string> = {};
		if (!autoload) {
			params.autoload = 'false';
		}

		return apiFetchWithParams<ApiLlamaCppServerProps>(
			buildProviderEndpointUrl(context.serverBaseUrl, '/props'),
			params,
			{ authOnly: true, apiKey: context.apiKey }
		);
	}

	/**
	 * Fetches server properties for a specific model (ROUTER mode only).
	 * Required in ROUTER mode because global `/props` does not include per-model modalities.
	 *
	 * @param modelId - The model ID to fetch properties for
	 * @param autoload - If false, prevents automatic model loading (default: false)
	 * @returns Server properties specific to the requested model
	 * @throws {Error} If the request fails, model not found, or model not loaded
	 */
	static async fetchForModel(
		context: ProviderConnectionContext,
		modelId: string,
		autoload = false,
		signal?: AbortSignal
	): Promise<ApiLlamaCppServerProps> {
		const params: Record<string, string> = { model: modelId };
		if (!autoload) {
			params.autoload = 'false';
		}

		return apiFetchWithParams<ApiLlamaCppServerProps>(
			buildProviderEndpointUrl(context.serverBaseUrl, '/props'),
			params,
			{ authOnly: true, apiKey: context.apiKey, signal }
		);
	}
}
