import { apiFetch } from '$lib/utils/api-fetch';
import { API_TOOLS } from '$lib/constants';
import { ToolResponseField } from '$lib/enums';
import type {
	ProviderConnectionContext,
	ToolExecutionResult,
	ServerBuiltinToolInfo
} from '$lib/types';

export class ToolsService {
	/**
	 * Fetch the list of built-in tools from the server.
	 *
	 * @returns Array of tool definitions in OpenAI-compatible format
	 */
	static async list(
		context: ProviderConnectionContext,
		signal?: AbortSignal
	): Promise<ServerBuiltinToolInfo[]> {
		return apiFetch<ServerBuiltinToolInfo[]>(API_TOOLS.LIST, {
			context,
			apiKey: context.apiKey,
			signal
		});
	}

	/**
	 * Execute a built-in tool on the server.
	 */
	static async executeTool(
		toolName: string,
		params: Record<string, unknown>,
		context: ProviderConnectionContext,
		signal?: AbortSignal
	): Promise<ToolExecutionResult> {
		const result = await apiFetch<Record<string, unknown>>(API_TOOLS.EXECUTE, {
			context,
			method: 'POST',
			body: JSON.stringify({ tool: toolName, params }),
			apiKey: context.apiKey,
			signal
		});

		if (ToolResponseField.ERROR in result) {
			return { content: String(result[ToolResponseField.ERROR]), isError: true };
		}

		if (ToolResponseField.PLAIN_TEXT in result) {
			return { content: String(result[ToolResponseField.PLAIN_TEXT]), isError: false };
		}

		return { content: JSON.stringify(result), isError: false };
	}
}
