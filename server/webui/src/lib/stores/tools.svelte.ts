import type {
	OpenAIToolDefinition,
	ProviderRequestContext,
	ToolEntry,
	ToolExecutionResult,
	ToolGroup
} from '$lib/types';
import { ToolsService } from '$lib/services/tools.service';
import { getApiProvider, getApiProviderCapabilities } from '$lib/services/providers';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { HealthCheckStatus, JsonSchemaType, ToolCallType, ToolSource } from '$lib/enums';
import { config } from '$lib/stores/settings.svelte';
import {
	DISABLED_TOOL_KEYS_LOCALSTORAGE_KEY,
	DISABLED_TOOLS_LOCALSTORAGE_KEY,
	TOOL_GROUP_LABELS,
	TOOL_SERVER_LABELS
} from '$lib/constants';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { resolveToolName } from '$lib/utils/tool-registry';

/** Stable selection identity for a tool, shared by disabled tools and permission lookups. */
function toolKey(source: ToolSource, name: string, serverId?: string): string {
	switch (source) {
		case ToolSource.MCP:
			return serverId ? `mcp-${serverId}:${name}` : `mcp:${name}`;
		default:
			return `builtin:${name}`;
	}
}

function mcpDefinition(
	name: string,
	description: string | undefined,
	schema?: Record<string, unknown>
): OpenAIToolDefinition {
	return {
		type: ToolCallType.FUNCTION,
		function: {
			name,
			description,
			parameters: schema ?? { type: JsonSchemaType.OBJECT, properties: {}, required: [] }
		}
	};
}

class ToolsStore {
	private _builtinTools = $state<OpenAIToolDefinition[]>([]);
	private _loading = $state(false);
	private _error = $state<string | null>(null);
	private _disabledTools = $state(new SvelteSet<string>());
	private _legacyDisabledToolNames = new SvelteSet<string>();
	private _toolsEndpointUnreachable = $state(false);
	private builtinContext: ProviderRequestContext | null = null;
	private requestGeneration = 0;
	private registryGeneration = 0;
	private fetchController: AbortController | null = null;

	constructor() {
		if (typeof localStorage !== 'undefined') {
			this.loadDisabledTools();
			this.fetchBuiltinTools();
		}
	}

	private loadDisabledTools(): void {
		try {
			const storedKeys = localStorage.getItem(DISABLED_TOOL_KEYS_LOCALSTORAGE_KEY);
			if (storedKeys) {
				const parsedKeys = JSON.parse(storedKeys);
				if (Array.isArray(parsedKeys)) {
					for (const key of parsedKeys) {
						if (typeof key === 'string') this._disabledTools.add(key);
					}
				}
			}

			const legacyNames = localStorage.getItem(DISABLED_TOOLS_LOCALSTORAGE_KEY);
			if (legacyNames) {
				const parsedNames = JSON.parse(legacyNames);
				if (Array.isArray(parsedNames)) {
					for (const name of parsedNames) {
						if (typeof name === 'string') this._legacyDisabledToolNames.add(name);
					}
				}
			}
		} catch (err) {
			console.error('[ToolsStore] Failed to load disabled tools from localStorage:', err);
		}
	}

	private persistDisabledTools(): void {
		if (typeof localStorage === 'undefined') return;

		try {
			localStorage.setItem(
				DISABLED_TOOL_KEYS_LOCALSTORAGE_KEY,
				JSON.stringify([...this._disabledTools])
			);
		} catch {
			// ignore storage errors
		}
	}

	get supportsProviderTools(): boolean {
		const currentConfig = config();

		return getApiProviderCapabilities(String(currentConfig.apiProvider ?? ''), currentConfig)
			.supportsOpenAiToolCalls;
	}

	get supportsBuiltinToolsEndpoint(): boolean {
		const currentConfig = config();

		return getApiProviderCapabilities(String(currentConfig.apiProvider ?? ''), currentConfig)
			.supportsBuiltinToolsEndpoint;
	}

	get builtinTools(): OpenAIToolDefinition[] {
		return this.supportsBuiltinToolsEndpoint ? this._builtinTools : [];
	}

	get mcpTools(): OpenAIToolDefinition[] {
		return this.supportsProviderTools ? mcpStore.getToolDefinitionsForLLM() : [];
	}

	private mcpEntries(): {
		serverId: string;
		serverName: string;
		definition: OpenAIToolDefinition;
	}[] {
		if (!this.supportsProviderTools) return [];

		const entries: { serverId: string; serverName: string; definition: OpenAIToolDefinition }[] =
			[];

		const connections = mcpStore.getConnections();
		const connectedServerIds = new Set(connections.keys());

		for (const [serverId, connection] of connections) {
			const serverName = mcpStore.getServerDisplayName(serverId);
			for (const tool of connection.tools) {
				const rawSchema = (tool.inputSchema as Record<string, unknown>) ?? {
					type: JsonSchemaType.OBJECT,
					properties: {},
					required: []
				};

				entries.push({
					serverId,
					serverName,
					definition: mcpDefinition(
						tool.name,
						tool.description,
						mcpStore.normalizeSchemaProperties(rawSchema)
					)
				});
			}
		}

		for (const { serverId, serverName, tools } of this.getMcpToolsFromHealthChecks(
			connectedServerIds
		)) {
			for (const tool of tools) {
				entries.push({
					serverId,
					serverName,
					definition: mcpDefinition(tool.name, tool.description)
				});
			}
		}

		return entries;
	}

	private migrateLegacyDisabledToolNames(entries: ToolEntry[]): void {
		if (this._legacyDisabledToolNames.size === 0) return;

		let changed = false;
		for (const entry of entries) {
			if (
				this._legacyDisabledToolNames.has(entry.definition.function.name) &&
				!this._disabledTools.has(entry.key)
			) {
				this._disabledTools.add(entry.key);
				changed = true;
			}
		}

		if (changed) {
			this.persistDisabledTools();
		}
	}

	/** Canonical flat list of tool entries with source metadata and stable keys. */
	get allTools(): ToolEntry[] {
		const entries: ToolEntry[] = [];

		if (!this.supportsProviderTools) return [];

		for (const definition of this._builtinTools) {
			const name = definition.function.name;
			entries.push({
				source: ToolSource.BUILTIN,
				apiName: name,
				key: toolKey(ToolSource.BUILTIN, name),
				sourceGeneration: this.builtinContext?.sourceGeneration,
				registryGeneration: this.registryGeneration,
				definition
			});
		}

		for (const { serverId, serverName, definition } of this.mcpEntries()) {
			const name = definition.function.name;
			entries.push({
				source: ToolSource.MCP,
				apiName: name,
				serverId,
				serverName,
				key: toolKey(ToolSource.MCP, name, serverId),
				registryGeneration: this.registryGeneration,
				mcpGeneration: mcpStore.getToolRegistryGeneration(),
				definition
			});
		}

		this.migrateLegacyDisabledToolNames(entries);

		return entries;
	}

	/** Tools grouped by category/server for UI display, derived from canonical entries. */
	get toolGroups(): ToolGroup[] {
		const groups: ToolGroup[] = [];
		const byKey = new SvelteMap<string, ToolGroup>();

		for (const entry of this.allTools) {
			const groupKey =
				entry.source === ToolSource.MCP ? `mcp:${entry.serverId ?? ''}` : entry.source;

			let group = byKey.get(groupKey);
			if (!group) {
				group = {
					source: entry.source,
					label: this.groupLabel(entry),
					serverId: entry.serverId,
					tools: []
				};
				byKey.set(groupKey, group);
				groups.push(group);
			}

			if (!group.tools.some((candidate) => candidate.key === entry.key)) {
				group.tools.push(entry);
			}
		}

		return groups;
	}

	private groupLabel(entry: ToolEntry): string {
		switch (entry.source) {
			case ToolSource.MCP:
				return entry.serverName ?? '';
			default:
				return TOOL_GROUP_LABELS[ToolSource.BUILTIN];
		}
	}

	private availableEntries(context?: ProviderRequestContext): ToolEntry[] {
		const byApiName = new SvelteMap<string, ToolEntry[]>();
		for (const entry of this.allTools) {
			if (
				entry.source === ToolSource.BUILTIN &&
				(!this.builtinContext ||
					(context !== undefined &&
						(entry.sourceGeneration !== context.sourceGeneration ||
							this.builtinContext.providerId !== context.providerId ||
							this.builtinContext.serverBaseUrl !== context.serverBaseUrl ||
							this.builtinContext.apiKey !== context.apiKey)))
			) {
				continue;
			}
			const candidates = byApiName.get(entry.apiName) ?? [];
			candidates.push(entry);
			byApiName.set(entry.apiName, candidates);
		}

		return [...byApiName.values()].flatMap((entries) => {
			const resolution = resolveToolName(entries);
			return resolution.status === 'unique' ? [resolution.entry] : [];
		});
	}

	/** Only enabled, unambiguous tool definitions for sending to the API. */
	get enabledToolDefinitions(): OpenAIToolDefinition[] {
		return this.availableEntries()
			.filter((entry) => this.isToolEnabled(entry.key))
			.map((entry) => entry.definition);
	}

	/**
	 * Returns enabled tool definitions for sending to the LLM.
	 * Every duplicate API-visible name is excluded, regardless of enabled state.
	 */
	getEnabledToolEntriesForLLM(context: ProviderRequestContext): ToolEntry[] {
		return this.availableEntries(context).filter((entry) => this.isToolEnabled(entry.key));
	}

	getEnabledToolsForLLM(context?: ProviderRequestContext): OpenAIToolDefinition[] {
		const entries = context ? this.getEnabledToolEntriesForLLM(context) : this.availableEntries();
		return entries
			.filter((entry) => this.isToolEnabled(entry.key))
			.map((entry) => entry.definition);
	}

	get allToolDefinitions(): OpenAIToolDefinition[] {
		return this.allTools.map((entry) => entry.definition);
	}

	get loading(): boolean {
		return this._loading;
	}

	get error(): string | null {
		return this._error;
	}

	get isToolsEndpointUnreachable(): boolean {
		return this._toolsEndpointUnreachable;
	}

	get disabledTools(): SvelteSet<string> {
		return this._disabledTools;
	}

	isToolEnabled(key: string): boolean {
		return !this._disabledTools.has(key);
	}

	toggleTool(key: string): void {
		if (this._disabledTools.has(key)) {
			this._disabledTools.delete(key);
		} else {
			this._disabledTools.add(key);
		}
		this.persistDisabledTools();
	}

	setToolEnabled(key: string, enabled: boolean): void {
		if (enabled) {
			this._disabledTools.delete(key);
		} else {
			this._disabledTools.add(key);
		}
		this.persistDisabledTools();
	}

	/**
	 * Enable all tools belonging to a specific MCP server.
	 * Called when a server is enabled for a conversation.
	 */
	enableAllToolsForServer(serverId: string): void {
		for (const entry of this.allTools) {
			if (entry.source === ToolSource.MCP && entry.serverId === serverId) {
				this._disabledTools.delete(entry.key);
			}
		}
		this.persistDisabledTools();
	}

	toggleGroup(group: ToolGroup): void {
		const allEnabled = group.tools.every((entry) => this.isToolEnabled(entry.key));
		for (const entry of group.tools) {
			this.setToolEnabled(entry.key, !allEnabled);
		}
		this.persistDisabledTools();
	}

	isGroupFullyEnabled(group: ToolGroup): boolean {
		return group.tools.length > 0 && group.tools.every((entry) => this.isToolEnabled(entry.key));
	}

	isGroupPartiallyEnabled(group: ToolGroup): boolean {
		const enabledCount = group.tools.filter((entry) => this.isToolEnabled(entry.key)).length;
		return enabledCount > 0 && enabledCount < group.tools.length;
	}

	/**
	 * Get MCP tools from health check data (reactive).
	 * Used when live connections aren't established yet.
	 */
	private getMcpToolsFromHealthChecks(excludeServerIds = new Set<string>()): {
		serverId: string;
		serverName: string;
		tools: { name: string; description?: string }[];
	}[] {
		const result: ReturnType<ToolsStore['getMcpToolsFromHealthChecks']> = [];
		for (const server of mcpStore.getServersSorted().filter((s) => s.enabled)) {
			if (excludeServerIds.has(server.id)) continue;

			const health = mcpStore.getHealthCheckState(server.id);
			if (health.status === HealthCheckStatus.SUCCESS && health.tools.length > 0) {
				result.push({
					serverId: server.id,
					serverName: mcpStore.getServerLabel(server),
					tools: health.tools
				});
			}
		}
		return result;
	}

	private findEntryByName(toolName: string): ToolEntry | null {
		const resolution = resolveToolName(this.allTools.filter((entry) => entry.apiName === toolName));
		return resolution.status === 'unique' ? resolution.entry : null;
	}

	/** Determine the source of a tool by its name. */
	getToolSource(toolName: string): ToolSource | null {
		return this.findEntryByName(toolName)?.source ?? null;
	}

	/** Get the display label for the server that owns a given tool. */
	getToolServerLabel(toolName: string): string {
		const entry = this.findEntryByName(toolName);
		if (!entry) return '';
		if (entry.serverName) return entry.serverName;
		if (entry.source === ToolSource.BUILTIN) return TOOL_SERVER_LABELS[ToolSource.BUILTIN];
		return '';
	}

	/** Permission key for a tool name, identical to the stable selection key. */
	getPermissionKey(toolName: string): string | null {
		return this.findEntryByName(toolName)?.key ?? null;
	}

	/** Check if there are any enabled tools available (builtin, MCP, or custom). */
	get hasEnabledTools(): boolean {
		return this.getEnabledToolsForLLM().length > 0;
	}

	getServerPermissionKeys(entry: ToolEntry): string[] {
		return this.allTools
			.filter((candidate) =>
				entry.source === ToolSource.MCP
					? candidate.source === ToolSource.MCP && candidate.serverId === entry.serverId
					: candidate.source === entry.source
			)
			.map((candidate) => candidate.key);
	}

	hasBuiltinToolsForContext(context: ProviderRequestContext): boolean {
		return (
			this._builtinTools.length > 0 &&
			this.builtinContext?.providerId === context.providerId &&
			this.builtinContext.serverBaseUrl === context.serverBaseUrl &&
			this.builtinContext.apiKey === context.apiKey &&
			this.builtinContext.sourceGeneration === context.sourceGeneration
		);
	}

	async executeTool(
		entry: ToolEntry,
		params: Record<string, unknown>,
		context: ProviderRequestContext,
		signal?: AbortSignal
	): Promise<ToolExecutionResult> {
		const currentConfig = config();
		if (
			getApiProvider(String(currentConfig.apiProvider ?? '')).id !== context.providerId ||
			String(currentConfig.serverBaseUrl ?? '') !== context.serverBaseUrl ||
			String(currentConfig.apiKey ?? '') !== context.apiKey
		) {
			throw new Error(`Tool unavailable for provider source: ${entry.apiName}`);
		}
		if (entry.registryGeneration !== this.registryGeneration) {
			throw new Error(`Tool unavailable: ${entry.apiName}`);
		}
		const candidates = this.allTools.filter((candidate) => candidate.apiName === entry.apiName);
		const resolution = resolveToolName(candidates);
		if (resolution.status === 'conflicted') throw new Error(`Tool name conflict: ${entry.apiName}`);
		if (resolution.status === 'unavailable') throw new Error(`Tool unavailable: ${entry.apiName}`);
		if (
			entry.source === ToolSource.MCP &&
			entry.mcpGeneration !== mcpStore.getToolRegistryGeneration()
		) {
			throw new Error(`Tool unavailable: ${entry.apiName}`);
		}
		const current = resolution.entry;
		if (!current || current.key !== entry.key || !this.isToolEnabled(current.key)) {
			throw new Error(`Tool unavailable: ${entry.apiName}`);
		}

		if (entry.source === ToolSource.BUILTIN) {
			if (
				!this.builtinContext ||
				entry.sourceGeneration !== context.sourceGeneration ||
				this.builtinContext.providerId !== context.providerId ||
				this.builtinContext.serverBaseUrl !== context.serverBaseUrl ||
				this.builtinContext.apiKey !== context.apiKey
			) {
				throw new Error(`Tool unavailable for provider source: ${entry.apiName}`);
			}
			return ToolsService.executeTool(entry.apiName, params, context, signal);
		}

		if (!entry.serverId) throw new Error(`Tool unavailable: ${entry.apiName}`);
		return mcpStore.executeToolOnServer(entry.serverId, entry.apiName, params, signal);
	}

	clear(): void {
		this.requestGeneration++;
		this.registryGeneration++;
		this.fetchController?.abort();
		this.fetchController = null;
		this.builtinContext = null;
		this._builtinTools = [];
		this._loading = false;
		this._error = null;
		this._toolsEndpointUnreachable = false;
	}

	private currentRequestContext(): ProviderRequestContext {
		const currentConfig = config();
		return Object.freeze({
			providerId: getApiProvider(String(currentConfig.apiProvider ?? '')).id,
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? ''),
			sourceGeneration: this.registryGeneration
		});
	}

	async fetchBuiltinTools(context = this.currentRequestContext()): Promise<void> {
		if (!getApiProvider(context.providerId).capabilities.supportsBuiltinToolsEndpoint) {
			this.clear();
			return;
		}

		this.fetchController?.abort();
		const generation = ++this.requestGeneration;
		const controller = new AbortController();
		this.fetchController = controller;

		this._loading = true;
		this._error = null;
		this._toolsEndpointUnreachable = false;

		try {
			const toolInfos = await ToolsService.list(context, controller.signal);
			if (generation !== this.requestGeneration || controller.signal.aborted) return;
			this.registryGeneration++;
			this._builtinTools = toolInfos.map((info) => info.definition);
			this.builtinContext = Object.freeze({ ...context });
		} catch (err) {
			if (generation !== this.requestGeneration || controller.signal.aborted) return;
			const errorMessage = err instanceof Error ? err.message : String(err);
			this._error = errorMessage;
			// 404 from /tools means the server was started without --tools
			if (errorMessage.includes('404') || errorMessage.toLowerCase().includes('not found')) {
				this._toolsEndpointUnreachable = true;
			}
			console.error('[ToolsStore] Failed to fetch built-in tools:', err);
		} finally {
			if (generation === this.requestGeneration) {
				this._loading = false;
				if (this.fetchController === controller) this.fetchController = null;
			}
		}
	}
}

export const toolsStore = new ToolsStore();

export const allTools = () => toolsStore.allTools;
export const allToolDefinitions = () => toolsStore.allToolDefinitions;
export const toolGroups = () => toolsStore.toolGroups;
