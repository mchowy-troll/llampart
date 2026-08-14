import type { ToolSource } from '$lib/enums';
import type { OpenAIToolDefinition } from './mcp';

export interface ToolEntry {
	source: ToolSource;
	/** API-visible function name. It is executable only when unique across exact identities. */
	apiName: string;
	/** For MCP tools, the server display name (used for UI grouping) */
	serverName?: string;
	/** For MCP tools, the server ID (used for stable selection and permission keys) */
	serverId?: string;
	/** Stable selection and permission identity: builtin:name or mcp-<serverId>:name */
	key: string;
	/** Source generation of a built-in definition. */
	sourceGeneration?: number;
	/** ToolsStore registry generation in which this exact entry was offered. */
	registryGeneration: number;
	/** MCP registry generation in which this exact server tool was offered. */
	mcpGeneration?: number;
	definition: OpenAIToolDefinition;
}

export interface ToolGroup {
	source: ToolSource;
	label: string;
	/** For MCP groups, the server ID */
	serverId?: string;
	tools: ToolEntry[];
}

export interface ServerBuiltinToolInfo {
	name: string;
	description?: string;
	definition: OpenAIToolDefinition;
}
