/**
 * mcpStore - Reactive State Store for MCP Operations
 *
 * Implements the "Host" role in MCP architecture, coordinating multiple server
 * connections and providing a unified interface for tool operations.
 *
 * **Architecture & Relationships:**
 * - **MCPService**: Stateless protocol layer (transport, connect, callTool)
 * - **mcpStore** (this): Reactive state + business logic
 *
 * **Key Responsibilities:**
 * - Lifecycle management (initialize, shutdown)
 * - Multi-server coordination
 * - Tool name conflict detection and resolution
 * - OpenAI-compatible tool definition generation
 * - Automatic tool-to-server routing
 * - Health checks
 *
 * @see MCPService in services/mcp.service.ts for protocol operations
 */

import { browser } from '$app/environment';
import { MCPService } from '$lib/services/mcp.service';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import { mcpResourceStore } from '$lib/stores/mcp-resources.svelte';
import { getApiBaseUrl } from '$lib/utils/api-fetch';
import { getProxiedUrlString } from '$lib/utils/cors-proxy';
import { getFaviconUrl } from '$lib/utils/favicon';
import {
	parseMcpServerSettings,
	buildMcpClientConfig,
	buildMcpServerConfig
} from '$lib/utils/mcp-config';
import { uuid } from '$lib/utils/uuid';
import { resolveToolName } from '$lib/utils/tool-registry';
import {
	MCPConnectionPhase,
	MCPLogLevel,
	HealthCheckStatus,
	MCPRefType,
	UrlProtocol,
	JsonSchemaType,
	ToolCallType
} from '$lib/enums';
import {
	CORS_PROXY_ENDPOINT,
	DEFAULT_CACHE_TTL_MS,
	DEFAULT_MCP_CONFIG,
	EXPECTED_THEMED_ICON_PAIR_COUNT,
	MCP_ALLOWED_ICON_MIME_TYPES,
	MCP_RECONNECT_INITIAL_DELAY,
	MCP_RECONNECT_BACKOFF_MULTIPLIER,
	MCP_RECONNECT_MAX_DELAY,
	MCP_RECONNECT_ATTEMPT_TIMEOUT_MS
} from '$lib/constants';
import type {
	MCPToolCall,
	OpenAIToolDefinition,
	ServerStatus,
	ToolExecutionResult,
	MCPClientConfig,
	MCPConnection,
	HealthCheckParams,
	ServerCapabilities,
	ClientCapabilities,
	MCPCapabilitiesInfo,
	MCPConnectionLog,
	MCPPromptInfo,
	GetPromptResult,
	Tool,
	HealthCheckState,
	MCPServerSettingsEntry,
	MCPServerConfig,
	MCPResourceIcon,
	MCPResourceAttachment,
	MCPResourceContent
} from '$lib/types';
import type { ListChangedHandlers } from '@modelcontextprotocol/sdk/types.js';
import type { DatabaseMessageExtraMcpResource, McpServerOverride } from '$lib/types/database';
import type { SettingsConfigType } from '$lib/types/settings';
import { SvelteMap } from 'svelte/reactivity';

class MCPStore {
	private _isInitializing = $state(false);
	private _error = $state<string | null>(null);
	private _toolCount = $state(0);
	private _connectedServers = $state<string[]>([]);
	private _healthChecks = $state<Record<string, HealthCheckState>>({});
	private _proxyAvailable = $state(false);

	private connections = new Map<string, MCPConnection>();
	private toolsIndex = new Map<string, string[]>();
	private serverConfigs = new Map<string, MCPServerConfig>(); // Store configs for reconnection
	private reconnectingServers = new Set<string>(); // Guard against concurrent reconnections
	private reconnectPromises = new Map<string, Promise<void>>();
	private reconnectControllers = new Map<string, AbortController>();
	private pendingConnectControllers = new Set<AbortController>();
	private configSignature: string | null = null;
	private initPromise: Promise<boolean> | null = null;
	private activeFlowCount = 0;
	private lifecycleGeneration = 0;
	private toolRegistryGeneration = 0;
	private proxyProbeGeneration = 0;

	constructor() {
		if (browser) {
			this.probeProxy();
		}
	}

	/**
	 * Probes the CORS proxy endpoint to determine availability.
	 * The endpoint is registered when llama-server runs with --ui-mcp-proxy.
	 * Older llama-server builds may also accept --webui-mcp-proxy as a deprecated alias.
	 */
	async probeProxy(): Promise<void> {
		const generation = ++this.proxyProbeGeneration;
		let available = false;
		try {
			const response = await fetch(`${getApiBaseUrl()}${CORS_PROXY_ENDPOINT}`, {
				method: 'HEAD'
			});
			available = response.status !== 404;
		} catch {
			// An unreachable endpoint means the proxy is unavailable for this source.
		}
		if (generation === this.proxyProbeGeneration) this._proxyAvailable = available;
	}

	get isProxyAvailable(): boolean {
		return this._proxyAvailable;
	}

	/**
	 * Checks if a server is enabled for a given chat.
	 * Only per-chat overrides (persisted in localStorage for new chats,
	 * or in IndexedDB for existing conversations) control enabled state.
	 */
	#checkServerEnabled(
		server: MCPServerSettingsEntry,
		perChatOverrides?: McpServerOverride[]
	): boolean {
		const override = perChatOverrides?.find((o) => o.serverId === server.id);
		return override?.enabled ?? false;
	}

	/**
	 * Builds MCP client configuration from settings.
	 */
	#buildMcpClientConfig(
		cfg: SettingsConfigType,
		perChatOverrides?: McpServerOverride[]
	): MCPClientConfig | undefined {
		const rawServers = parseMcpServerSettings(cfg.mcpServers);
		if (!rawServers.length) {
			return undefined;
		}

		return buildMcpClientConfig(rawServers, (entry) =>
			this.#checkServerEnabled(entry, perChatOverrides)
		);
	}

	/**
	 * Builds capabilities info from server and client capabilities.
	 */
	#buildCapabilitiesInfo(
		serverCaps?: ServerCapabilities,
		clientCaps?: ClientCapabilities
	): MCPCapabilitiesInfo {
		return {
			server: {
				tools: serverCaps?.tools ? { listChanged: serverCaps.tools.listChanged } : undefined,
				prompts: serverCaps?.prompts ? { listChanged: serverCaps.prompts.listChanged } : undefined,
				resources: serverCaps?.resources
					? {
							subscribe: serverCaps.resources.subscribe,
							listChanged: serverCaps.resources.listChanged
						}
					: undefined,
				logging: !!serverCaps?.logging,
				completions: !!serverCaps?.completions,
				tasks: !!serverCaps?.tasks
			},
			client: {
				roots: clientCaps?.roots ? { listChanged: clientCaps.roots.listChanged } : undefined,
				sampling: !!clientCaps?.sampling,
				elicitation: clientCaps?.elicitation
					? { form: !!clientCaps.elicitation.form, url: !!clientCaps.elicitation.url }
					: undefined,
				tasks: !!clientCaps?.tasks
			}
		};
	}

	get isInitializing(): boolean {
		return this._isInitializing;
	}

	get isInitialized(): boolean {
		return this.connections.size > 0;
	}

	get error(): string | null {
		return this._error;
	}

	get toolCount(): number {
		return this._toolCount;
	}

	get connectedServerCount(): number {
		return this._connectedServers.length;
	}

	get connectedServerNames(): string[] {
		return this._connectedServers;
	}

	get isEnabled(): boolean {
		const mcpConfig = this.#buildMcpClientConfig(config());
		return (
			mcpConfig !== null && mcpConfig !== undefined && Object.keys(mcpConfig.servers).length > 0
		);
	}

	get availableTools(): string[] {
		return this.getToolNames();
	}

	private rebuildToolsIndex(): void {
		this.toolRegistryGeneration++;
		this.toolsIndex.clear();
		for (const [serverName, connection] of this.connections) {
			for (const tool of connection.tools) {
				const owners = this.toolsIndex.get(tool.name) ?? [];
				owners.push(serverName);
				this.toolsIndex.set(tool.name, owners);
			}
		}
		this.updateState({
			toolCount: this.getToolNames().length,
			connectedServers: Array.from(this.connections.keys())
		});
	}

	private commitConnection(serverName: string, connection?: MCPConnection): void {
		if (connection) this.connections.set(serverName, connection);
		else this.connections.delete(serverName);
		this.rebuildToolsIndex();
	}

	getToolRegistryGeneration(): number {
		return this.toolRegistryGeneration;
	}

	private updateState(state: {
		isInitializing?: boolean;
		error?: string | null;
		toolCount?: number;
		connectedServers?: string[];
	}): void {
		if (state.isInitializing !== undefined) {
			this._isInitializing = state.isInitializing;
		}

		if (state.error !== undefined) {
			this._error = state.error;
		}

		if (state.toolCount !== undefined) {
			this._toolCount = state.toolCount;
		}

		if (state.connectedServers !== undefined) {
			this._connectedServers = state.connectedServers;
		}
	}

	updateHealthCheck(serverId: string, state: HealthCheckState): void {
		this._healthChecks = { ...this._healthChecks, [serverId]: state };
	}

	getHealthCheckState(serverId: string): HealthCheckState {
		return this._healthChecks[serverId] ?? { status: HealthCheckStatus.IDLE };
	}

	hasHealthCheck(serverId: string): boolean {
		return (
			serverId in this._healthChecks &&
			this._healthChecks[serverId].status !== HealthCheckStatus.IDLE
		);
	}

	clearHealthCheck(serverId: string): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { [serverId]: _removed, ...rest } = this._healthChecks;
		this._healthChecks = rest;
	}

	clearAllHealthChecks(): void {
		this._healthChecks = {};
	}

	clearError(): void {
		this._error = null;
	}

	getServers(): MCPServerSettingsEntry[] {
		return parseMcpServerSettings(config().mcpServers);
	}

	/**
	 * Get all active MCP connections.
	 * @returns Map of server names to connections
	 */
	getConnections(): Map<string, MCPConnection> {
		return this.connections;
	}

	getServerLabel(server: MCPServerSettingsEntry): string {
		const healthState = this.getHealthCheckState(server.id);

		if (healthState?.status === HealthCheckStatus.SUCCESS)
			return (
				healthState.serverInfo?.title || healthState.serverInfo?.name || server.name || server.url
			);
		return server.url;
	}

	getServerById(serverId: string): MCPServerSettingsEntry | undefined {
		return this.getServers().find((s) => s.id === serverId);
	}

	/**
	 * Get display name for an MCP server by its ID.
	 * Falls back to the server ID if server is not found.
	 */
	getServerDisplayName(serverId: string): string {
		const server = this.getServerById(serverId);
		return server ? this.getServerLabel(server) : serverId;
	}

	/**
	 * Validates that an icon URI uses a safe scheme (https: or data:).
	 */
	#isValidIconUri(src: string): boolean {
		try {
			if (src.startsWith(UrlProtocol.DATA)) return true;
			const url = new URL(src);
			return url.protocol === UrlProtocol.HTTPS;
		} catch {
			return false;
		}
	}

	/**
	 * Selects the best icon URL from an MCP icons array.
	 * Follows security guidelines from the MCP specification:
	 * - Only allows https: and data: URIs
	 * - Filters to supported MIME types
	 *
	 * Selection priority:
	 * 1. Icon matching the current color scheme (dark/light)
	 * 2. Universal icon (no theme specified); if exactly 2, assumes [0]=light, [1]=dark
	 * 3. First valid icon as last resort
	 */
	#getMcpIconUrl(icons: MCPResourceIcon[] | undefined): string | null {
		if (!icons?.length) return null;

		const validIcons = icons.filter((icon) => {
			if (!icon.src || !this.#isValidIconUri(icon.src)) return false;
			if (icon.mimeType && !MCP_ALLOWED_ICON_MIME_TYPES.has(icon.mimeType)) return false;
			return true;
		});

		if (validIcons.length === 0) return null;

		const preferredTheme = 'light' as const;

		// 1. Prefer icon explicitly matching the current color scheme
		const themedIcon = validIcons.find((icon) => icon.theme === preferredTheme);
		if (themedIcon) return this.#proxyIconSrc(themedIcon.src);

		// 2. Handle universal icons (no theme specified)
		const universalIcons = validIcons.filter((icon) => !icon.theme);

		if (universalIcons.length === EXPECTED_THEMED_ICON_PAIR_COUNT) {
			// Heuristic: two theme-less icons → assume [0] = light, [1] = dark
			return this.#proxyIconSrc(universalIcons[0].src);
		}

		if (universalIcons.length > 0) {
			return this.#proxyIconSrc(universalIcons[0].src);
		}

		// 3. Last resort: use opposite-theme icon
		return this.#proxyIconSrc(validIcons[0].src);
	}

	/**
	 * Route an icon src through the CORS proxy if it's an HTTPS URL.
	 * Data URIs are returned as-is.
	 */
	#proxyIconSrc(src: string): string {
		if (src.startsWith('data:')) return src;
		if (!this._proxyAvailable) return src;

		return getProxiedUrlString(src);
	}

	/**
	 * Get icon URL for an MCP server by its ID.
	 * Prefers the server's own icons (from MCP spec) and falls back
	 * to Google's favicon service.
	 * Returns null if server is not found.
	 */
	getServerFavicon(serverId: string): string | null {
		const server = this.getServerById(serverId);
		if (!server) {
			return null;
		}

		const healthState = this.getHealthCheckState(serverId);
		if (healthState.status === HealthCheckStatus.SUCCESS && healthState.serverInfo?.icons) {
			const mcpIconUrl = this.#getMcpIconUrl(healthState.serverInfo.icons);

			if (mcpIconUrl) {
				return mcpIconUrl;
			}
		}

		return getFaviconUrl(server.url, this._proxyAvailable);
	}

	isAnyServerLoading(): boolean {
		return this.getServers().some((s) => {
			const state = this.getHealthCheckState(s.id);

			return (
				state.status === HealthCheckStatus.IDLE || state.status === HealthCheckStatus.CONNECTING
			);
		});
	}

	getServersSorted(): MCPServerSettingsEntry[] {
		const servers = this.getServers();
		if (this.isAnyServerLoading()) {
			return servers;
		}

		return [...servers].sort((a, b) =>
			this.getServerLabel(a).localeCompare(this.getServerLabel(b))
		);
	}

	addServer(
		serverData: Omit<MCPServerSettingsEntry, 'id' | 'requestTimeoutSeconds'> & { id?: string }
	): void {
		const servers = this.getServers();
		const newServer: MCPServerSettingsEntry = {
			id: serverData.id || (uuid() ?? `server-${Date.now()}`),
			enabled: serverData.enabled,
			url: serverData.url.trim(),
			name: serverData.name,
			headers: serverData.headers?.trim() || undefined,
			requestTimeoutSeconds: DEFAULT_MCP_CONFIG.requestTimeoutSeconds,
			useProxy: serverData.useProxy
		};
		settingsStore.updateConfig('mcpServers', JSON.stringify([...servers, newServer]));
	}

	updateServer(id: string, updates: Partial<MCPServerSettingsEntry>): void {
		const servers = this.getServers();
		settingsStore.updateConfig(
			'mcpServers',
			JSON.stringify(
				servers.map((server) => (server.id === id ? { ...server, ...updates } : server))
			)
		);
	}

	removeServer(id: string): void {
		const servers = this.getServers();
		settingsStore.updateConfig('mcpServers', JSON.stringify(servers.filter((s) => s.id !== id)));
		this.clearHealthCheck(id);
	}

	hasAvailableServers(): boolean {
		return parseMcpServerSettings(config().mcpServers).some((s) => s.enabled && s.url.trim());
	}
	hasEnabledServers(perChatOverrides?: McpServerOverride[]): boolean {
		return Boolean(this.#buildMcpClientConfig(config(), perChatOverrides));
	}

	getEnabledServersForConversation(
		perChatOverrides?: McpServerOverride[]
	): MCPServerSettingsEntry[] {
		return this.getServers().filter((server) => {
			return this.#checkServerEnabled(server, perChatOverrides);
		});
	}

	async ensureInitialized(perChatOverrides?: McpServerOverride[]): Promise<boolean> {
		if (!browser) {
			return false;
		}

		const mcpConfig = this.#buildMcpClientConfig(config(), perChatOverrides);
		const signature = mcpConfig ? JSON.stringify(mcpConfig) : null;
		if (!signature) {
			await this.shutdown();

			return false;
		}
		if (this.isInitialized && this.configSignature === signature) {
			return true;
		}

		if (this.initPromise && this.configSignature === signature) {
			return this.initPromise;
		}

		if (
			this.connections.size > 0 ||
			this.initPromise ||
			(this.configSignature !== null && this.configSignature !== signature)
		) {
			await this.shutdown();
		}
		return this.initialize(signature, mcpConfig!);
	}

	private async initialize(signature: string, mcpConfig: MCPClientConfig): Promise<boolean> {
		const generation = this.lifecycleGeneration;
		this.updateState({ isInitializing: true, error: null });
		this.configSignature = signature;

		const serverEntries = Object.entries(mcpConfig.servers);

		if (serverEntries.length === 0) {
			this.updateState({ isInitializing: false, toolCount: 0, connectedServers: [] });

			return false;
		}
		this.initPromise = this.doInitialize(signature, mcpConfig, serverEntries, generation);

		return this.initPromise;
	}

	private async doInitialize(
		signature: string,
		mcpConfig: MCPClientConfig,
		serverEntries: [string, MCPClientConfig['servers'][string]][],
		generation: number
	): Promise<boolean> {
		const clientInfo = mcpConfig.clientInfo ?? DEFAULT_MCP_CONFIG.clientInfo;
		const capabilities = mcpConfig.capabilities ?? DEFAULT_MCP_CONFIG.capabilities;
		const results = await Promise.allSettled(
			serverEntries.map(async ([name, serverConfig]) => {
				if (generation !== this.lifecycleGeneration) {
					throw new DOMException('Operation was aborted', 'AbortError');
				}
				// Store config for reconnection
				this.serverConfigs.set(name, serverConfig);

				const listChangedHandlers = this.createListChangedHandlers(name);
				const connection = await this.connectServer(
					name,
					serverConfig,
					clientInfo,
					capabilities,
					(phase) => {
						// Handle WebSocket disconnection
						if (
							phase === MCPConnectionPhase.DISCONNECTED &&
							generation === this.lifecycleGeneration
						) {
							console.log(`[MCPStore][${name}] Connection lost, starting auto-reconnect`);
							this.autoReconnect(name);
						}
					},
					listChangedHandlers,
					generation
				);

				return { name, connection };
			})
		);
		if (generation !== this.lifecycleGeneration || this.configSignature !== signature) {
			for (const result of results) {
				if (result.status === 'fulfilled')
					await MCPService.disconnect(result.value.connection).catch(console.warn);
			}

			return false;
		}
		for (const result of results) {
			if (generation !== this.lifecycleGeneration) return false;
			if (result.status === 'fulfilled') {
				const { name, connection } = result.value;

				this.commitConnection(name, connection);
			} else {
				console.error(`[MCPStore] Failed to connect:`, result.reason);
			}
		}

		const successCount = this.connections.size;
		if (successCount === 0 && serverEntries.length > 0) {
			this.updateState({
				isInitializing: false,
				error: 'All MCP server connections failed',
				toolCount: 0,
				connectedServers: []
			});
			this.initPromise = null;

			return false;
		}

		this.updateState({ isInitializing: false, error: null });
		this.initPromise = null;

		return true;
	}

	private async connectServer(
		serverName: string,
		serverConfig: MCPServerConfig,
		clientInfo: MCPClientConfig['clientInfo'],
		capabilities: MCPClientConfig['capabilities'],
		onPhase: Parameters<typeof MCPService.connect>[4],
		listChangedHandlers: Parameters<typeof MCPService.connect>[5],
		generation: number,
		controller = new AbortController(),
		parentSignal?: AbortSignal
	): Promise<MCPConnection> {
		const abortFromParent = () => controller.abort(parentSignal?.reason);
		if (parentSignal?.aborted) abortFromParent();
		else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

		this.pendingConnectControllers.add(controller);
		const connectPromise = MCPService.connect(
			serverName,
			serverConfig,
			clientInfo,
			capabilities,
			onPhase,
			listChangedHandlers,
			controller.signal
		);

		try {
			return await new Promise<MCPConnection>((resolve, reject) => {
				const rejectAborted = () => {
					reject(
						controller.signal.reason instanceof Error
							? controller.signal.reason
							: new DOMException('Operation was aborted', 'AbortError')
					);
				};
				controller.signal.addEventListener('abort', rejectAborted, { once: true });

				connectPromise.then(
					async (connection) => {
						controller.signal.removeEventListener('abort', rejectAborted);
						if (controller.signal.aborted || generation !== this.lifecycleGeneration) {
							await MCPService.disconnect(connection).catch(console.warn);
							rejectAborted();
							return;
						}
						resolve(connection);
					},
					(error) => {
						controller.signal.removeEventListener('abort', rejectAborted);
						reject(error);
					}
				);
			});
		} finally {
			parentSignal?.removeEventListener('abort', abortFromParent);
			this.pendingConnectControllers.delete(controller);
		}
	}

	private sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) return Promise.reject(signal.reason);

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				signal.removeEventListener('abort', onAbort);
				resolve();
			}, ms);
			const onAbort = () => {
				clearTimeout(timeout);
				signal.removeEventListener('abort', onAbort);
				reject(signal.reason);
			};
			signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	private createListChangedHandlers(serverName: string): ListChangedHandlers {
		return {
			tools: {
				onChanged: (error: Error | null, tools: Tool[] | null) => {
					if (error) {
						console.warn(`[MCPStore][${serverName}] Tools list changed error:`, error);
						return;
					}
					this.handleToolsListChanged(serverName, tools ?? []);
				}
			},
			prompts: {
				onChanged: (error: Error | null) => {
					if (error) {
						console.warn(`[MCPStore][${serverName}] Prompts list changed error:`, error);
						return;
					}
				}
			}
		};
	}

	private handleToolsListChanged(serverName: string, tools: Tool[]): void {
		const connection = this.connections.get(serverName);
		if (!connection) {
			return;
		}

		connection.tools = tools;
		this.commitConnection(serverName, connection);
	}

	acquireConnection(): void {
		this.activeFlowCount++;
	}

	/**
	 * Release a connection reference.
	 * By default, keeps connections alive for reuse (shutdownIfUnused=false).
	 * MCP spec encourages long-lived sessions to avoid reconnection overhead.
	 */
	async releaseConnection(shutdownIfUnused = false): Promise<void> {
		this.activeFlowCount = Math.max(0, this.activeFlowCount - 1);
		if (shutdownIfUnused && this.activeFlowCount === 0) {
			await this.shutdown();
		}
	}

	getActiveFlowCount(): number {
		return this.activeFlowCount;
	}

	async shutdown(): Promise<void> {
		this.lifecycleGeneration++;
		for (const controller of this.reconnectControllers.values()) controller.abort();
		for (const controller of this.pendingConnectControllers) controller.abort();

		const initPromise = this.initPromise;
		const reconnectPromises = Array.from(this.reconnectPromises.values());
		const connections = Array.from(this.connections.values());
		this.initPromise = null;
		this.connections.clear();
		this.toolsIndex.clear();
		this.toolRegistryGeneration++;
		this.serverConfigs.clear();
		this.reconnectingServers.clear();
		this.reconnectPromises.clear();
		this.reconnectControllers.clear();
		this.pendingConnectControllers.clear();
		this.configSignature = null;
		this.updateState({ isInitializing: false, error: null, toolCount: 0, connectedServers: [] });

		await Promise.allSettled([...(initPromise ? [initPromise] : []), ...reconnectPromises]);
		await Promise.all(
			connections.map((conn) =>
				MCPService.disconnect(conn).catch((error) =>
					console.warn(`[MCPStore] Error disconnecting ${conn.serverName}:`, error)
				)
			)
		);
	}

	/**
	 * Immediately reconnect to a server by creating a fresh transport and session.
	 * Used when a session-expired error (HTTP 404) is detected during tool execution.
	 * Per MCP spec 2025-11-25: client MUST discard session ID and re-initialize.
	 *
	 * Unlike autoReconnect (which uses exponential backoff for connectivity issues),
	 * this performs a single immediate reconnection attempt since the server is known
	 * to be reachable (it responded with 404).
	 */
	private reconnectServer(serverName: string): Promise<void> {
		const pending = this.reconnectPromises.get(serverName);
		if (pending) return pending;

		const reconnect = this.doReconnectServer(serverName).finally(() => {
			if (this.reconnectPromises.get(serverName) === reconnect) {
				this.reconnectPromises.delete(serverName);
			}
		});
		this.reconnectPromises.set(serverName, reconnect);

		return reconnect;
	}

	private async doReconnectServer(serverName: string): Promise<void> {
		const generation = this.lifecycleGeneration;
		const serverConfig = this.serverConfigs.get(serverName);
		if (!serverConfig) {
			throw new Error(`[MCPStore] No config found for ${serverName}, cannot reconnect`);
		}

		// Disconnect stale connection (clears old transport + session ID)
		const oldConnection = this.connections.get(serverName);
		if (oldConnection) {
			this.commitConnection(serverName);
			await MCPService.disconnect(oldConnection).catch(console.warn);
			if (generation !== this.lifecycleGeneration) return;
		}

		console.log(`[MCPStore][${serverName}] Session expired, reconnecting with fresh session...`);

		const listChangedHandlers = this.createListChangedHandlers(serverName);
		const connection = await this.connectServer(
			serverName,
			serverConfig,
			DEFAULT_MCP_CONFIG.clientInfo,
			DEFAULT_MCP_CONFIG.capabilities,
			(phase) => {
				if (phase === MCPConnectionPhase.DISCONNECTED && generation === this.lifecycleGeneration) {
					console.log(`[MCPStore][${serverName}] Connection lost, starting auto-reconnect`);
					this.autoReconnect(serverName);
				}
			},
			listChangedHandlers,
			generation
		);

		if (generation !== this.lifecycleGeneration) {
			await MCPService.disconnect(connection).catch(console.warn);
			return;
		}
		const replacedConnection = this.connections.get(serverName);
		if (replacedConnection && replacedConnection !== connection) {
			this.commitConnection(serverName);
			await MCPService.disconnect(replacedConnection).catch(console.warn);
			if (generation !== this.lifecycleGeneration) {
				await MCPService.disconnect(connection).catch(console.warn);
				return;
			}
		}
		this.commitConnection(serverName, connection);

		console.log(`[MCPStore][${serverName}] Session recovered successfully`);
	}

	/**
	 * Auto-reconnect to a server with exponential backoff.
	 * Continues indefinitely until successful.
	 *
	 * Race-condition safety: when the phase callback fires a DISCONNECTED event
	 * while we are still inside this function (e.g., the server drops right after
	 * a successful connect()), a naive inner `autoReconnect()` call would be
	 * swallowed by the `reconnectingServers` guard, leaving the server
	 * permanently disconnected once the outer call exits. We solve this by
	 * deferring the new reconnection via the `needsReconnect` flag: the flag is
	 * set inside the phase callback and honoured in the `finally` block after
	 * the guard entry has been removed.
	 */
	private async autoReconnect(serverName: string): Promise<void> {
		// Guard against concurrent reconnections
		if (this.reconnectingServers.has(serverName)) {
			console.log(`[MCPStore][${serverName}] Reconnection already in progress, skipping`);

			return;
		}

		const serverConfig = this.serverConfigs.get(serverName);
		if (!serverConfig) {
			console.error(`[MCPStore] No config found for ${serverName}, cannot reconnect`);

			return;
		}

		const generation = this.lifecycleGeneration;
		const reconnectController = new AbortController();
		this.reconnectingServers.add(serverName);
		this.reconnectControllers.set(serverName, reconnectController);
		let backoff = MCP_RECONNECT_INITIAL_DELAY;
		// Flag set by the phase callback when a DISCONNECTED event fires while
		// reconnectingServers still holds this server (see JSDoc above).
		let needsReconnect = false;

		try {
			const staleConnection = this.connections.get(serverName);
			if (staleConnection) {
				this.commitConnection(serverName);
				await MCPService.disconnect(staleConnection).catch(console.warn);
				if (generation !== this.lifecycleGeneration || reconnectController.signal.aborted) return;
			}

			while (generation === this.lifecycleGeneration && !reconnectController.signal.aborted) {
				try {
					await this.sleepWithAbort(backoff, reconnectController.signal);
				} catch {
					break;
				}
				if (generation !== this.lifecycleGeneration || reconnectController.signal.aborted) break;

				console.log(`[MCPStore][${serverName}] Auto-reconnecting...`);

				let attemptTimeout: ReturnType<typeof setTimeout> | undefined;
				try {
					needsReconnect = false;
					const listChangedHandlers = this.createListChangedHandlers(serverName);
					const attemptController = new AbortController();
					attemptTimeout = setTimeout(
						() =>
							attemptController.abort(
								new Error(`Reconnect attempt timed out after ${MCP_RECONNECT_ATTEMPT_TIMEOUT_MS}ms`)
							),
						MCP_RECONNECT_ATTEMPT_TIMEOUT_MS
					);
					const connection = await this.connectServer(
						serverName,
						serverConfig,
						DEFAULT_MCP_CONFIG.clientInfo,
						DEFAULT_MCP_CONFIG.capabilities,
						(phase) => {
							if (
								phase === MCPConnectionPhase.DISCONNECTED &&
								generation === this.lifecycleGeneration &&
								!reconnectController.signal.aborted
							) {
								if (this.reconnectingServers.has(serverName)) {
									// Reconnect loop is active; defer to after it exits.
									needsReconnect = true;
								} else {
									console.log(
										`[MCPStore][${serverName}] Connection lost, restarting auto-reconnect`
									);
									this.autoReconnect(serverName);
								}
							}
						},
						listChangedHandlers,
						generation,
						attemptController,
						reconnectController.signal
					);
					clearTimeout(attemptTimeout);
					if (generation !== this.lifecycleGeneration || reconnectController.signal.aborted) {
						await MCPService.disconnect(connection).catch(console.warn);
						break;
					}
					const replacedConnection = this.connections.get(serverName);
					if (replacedConnection && replacedConnection !== connection) {
						this.commitConnection(serverName);
						await MCPService.disconnect(replacedConnection).catch(console.warn);
						if (generation !== this.lifecycleGeneration || reconnectController.signal.aborted) {
							await MCPService.disconnect(connection).catch(console.warn);
							break;
						}
					}

					this.commitConnection(serverName, connection);

					console.log(`[MCPStore][${serverName}] Reconnected successfully`);
					break;
				} catch (error) {
					if (attemptTimeout) clearTimeout(attemptTimeout);
					if (generation !== this.lifecycleGeneration || reconnectController.signal.aborted) break;
					console.warn(`[MCPStore][${serverName}] Reconnection failed:`, error);
					backoff = Math.min(backoff * MCP_RECONNECT_BACKOFF_MULTIPLIER, MCP_RECONNECT_MAX_DELAY);
				}
			}
		} finally {
			if (this.reconnectControllers.get(serverName) === reconnectController) {
				this.reconnectControllers.delete(serverName);
				this.reconnectingServers.delete(serverName);
			}
			// If the phase callback signalled a disconnect while this function held
			// the guard, kick off a fresh reconnect now that the guard is released.
			if (
				needsReconnect &&
				generation === this.lifecycleGeneration &&
				!reconnectController.signal.aborted
			) {
				console.log(
					`[MCPStore][${serverName}] Deferred disconnect detected, restarting auto-reconnect`
				);
				this.autoReconnect(serverName);
			}
		}
	}

	getToolDefinitionsForLLM(): OpenAIToolDefinition[] {
		const toolsByName = new SvelteMap<string, OpenAIToolDefinition[]>();

		for (const connection of this.connections.values()) {
			for (const tool of connection.tools) {
				const rawSchema = (tool.inputSchema as Record<string, unknown>) ?? {
					type: JsonSchemaType.OBJECT,
					properties: {},
					required: []
				};

				const definition: OpenAIToolDefinition = {
					type: ToolCallType.FUNCTION as const,
					function: {
						name: tool.name,
						description: tool.description,
						parameters: this.normalizeSchemaProperties(rawSchema)
					}
				};
				const candidates = toolsByName.get(tool.name) ?? [];
				candidates.push(definition);
				toolsByName.set(tool.name, candidates);
			}
		}

		return [...toolsByName.values()].flatMap((definitions) => {
			const resolution = resolveToolName(definitions);
			return resolution.status === 'unique' ? [resolution.entry] : [];
		});
	}

	normalizeSchemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
		if (!schema || typeof schema !== 'object') {
			return schema;
		}

		const normalized = { ...schema };
		if (normalized.properties && typeof normalized.properties === 'object') {
			const props = normalized.properties as Record<string, Record<string, unknown>>;
			const normalizedProps: Record<string, Record<string, unknown>> = {};
			for (const [key, prop] of Object.entries(props)) {
				if (!prop || typeof prop !== 'object') {
					normalizedProps[key] = prop;
					continue;
				}
				const normalizedProp = { ...prop };
				if (!normalizedProp.type && normalizedProp.default !== undefined) {
					const defaultVal = normalizedProp.default;
					if (typeof defaultVal === 'string') normalizedProp.type = 'string';
					else if (typeof defaultVal === 'number')
						normalizedProp.type = Number.isInteger(defaultVal) ? 'integer' : 'number';
					else if (typeof defaultVal === 'boolean') normalizedProp.type = 'boolean';
					else if (Array.isArray(defaultVal)) normalizedProp.type = 'array';
					else if (typeof defaultVal === 'object' && defaultVal !== null)
						normalizedProp.type = 'object';
				}
				if (normalizedProp.properties)
					Object.assign(
						normalizedProp,
						this.normalizeSchemaProperties(normalizedProp as Record<string, unknown>)
					);
				if (normalizedProp.items && typeof normalizedProp.items === 'object')
					normalizedProp.items = this.normalizeSchemaProperties(
						normalizedProp.items as Record<string, unknown>
					);
				normalizedProps[key] = normalizedProp;
			}
			normalized.properties = normalizedProps;
		}

		return normalized;
	}

	getToolNames(): string[] {
		return Array.from(this.toolsIndex.entries())
			.filter(([, owners]) => owners.length === 1)
			.map(([name]) => name);
	}

	hasTool(toolName: string): boolean {
		return this.toolsIndex.get(toolName)?.length === 1;
	}

	getToolServer(toolName: string): string | undefined {
		const owners = this.toolsIndex.get(toolName);
		const resolution = resolveToolName(owners ? [...owners] : []);
		return resolution.status === 'unique' ? resolution.entry : undefined;
	}

	hasPromptsSupport(): boolean {
		for (const connection of this.connections.values()) {
			if (connection.serverCapabilities?.prompts) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if any enabled server with successful health check supports prompts.
	 * Uses health check state since servers may not have active connections until
	 * the user actually sends a message or uses prompts.
	 * @param perChatOverrides - Per-chat server overrides to filter by enabled servers.
	 *                          If provided (even empty array), only checks enabled servers.
	 *                          If undefined, checks all servers with successful health checks.
	 */
	hasPromptsCapability(perChatOverrides?: McpServerOverride[]): boolean {
		// If perChatOverrides is provided (even empty array), filter by enabled servers
		if (perChatOverrides !== undefined) {
			const enabledServerIds = new Set(
				perChatOverrides.filter((o) => o.enabled).map((o) => o.serverId)
			);

			// No enabled servers = no capability
			if (enabledServerIds.size === 0) {
				return false;
			}

			// Check health check states for enabled servers with prompts capability
			for (const [serverId, state] of Object.entries(this._healthChecks)) {
				if (!enabledServerIds.has(serverId)) continue;
				if (
					state.status === HealthCheckStatus.SUCCESS &&
					state.capabilities?.server?.prompts !== undefined
				) {
					return true;
				}
			}

			// Also check active connections as fallback
			for (const [serverName, connection] of this.connections) {
				if (!enabledServerIds.has(serverName)) continue;
				if (connection.serverCapabilities?.prompts) {
					return true;
				}
			}

			return false;
		}

		// No overrides provided - check all servers (global mode)
		for (const state of Object.values(this._healthChecks)) {
			if (
				state.status === HealthCheckStatus.SUCCESS &&
				state.capabilities?.server?.prompts !== undefined
			) {
				return true;
			}
		}

		for (const connection of this.connections.values()) {
			if (connection.serverCapabilities?.prompts) {
				return true;
			}
		}

		return false;
	}

	async getAllPrompts(): Promise<MCPPromptInfo[]> {
		const results: MCPPromptInfo[] = [];

		for (const [serverName, connection] of this.connections) {
			if (!connection.serverCapabilities?.prompts) continue;

			const prompts = await MCPService.listPrompts(connection);

			for (const prompt of prompts) {
				results.push({
					name: prompt.name,
					description: prompt.description,
					title: prompt.title,
					serverName,
					arguments: prompt.arguments?.map((arg) => ({
						name: arg.name,
						description: arg.description,
						required: arg.required
					}))
				});
			}
		}

		return results;
	}

	async getPrompt(
		serverName: string,
		promptName: string,
		args?: Record<string, string>
	): Promise<GetPromptResult> {
		const connection = this.connections.get(serverName);
		if (!connection) throw new Error(`Server "${serverName}" not found for prompt "${promptName}"`);

		return MCPService.getPrompt(connection, promptName, args);
	}

	async executeTool(toolCall: MCPToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> {
		const toolName = toolCall.function.name;

		const serverName = this.getToolServer(toolName);
		if (!serverName) {
			throw new Error(
				this.toolsIndex.has(toolName)
					? `Tool name conflict: ${toolName}`
					: `Unknown tool: ${toolName}`
			);
		}

		const args = this.parseToolArguments(toolCall.function.arguments);
		return this.executeToolOnServer(serverName, toolName, args, signal);
	}

	async executeToolByName(
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<ToolExecutionResult> {
		const serverName = this.getToolServer(toolName);
		if (!serverName) {
			throw new Error(
				this.toolsIndex.has(toolName)
					? `Tool name conflict: ${toolName}`
					: `Unknown tool: ${toolName}`
			);
		}
		return this.executeToolOnServer(serverName, toolName, args, signal);
	}

	async executeToolOnServer(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
		signal?: AbortSignal
	): Promise<ToolExecutionResult> {
		const owner = this.getToolServer(toolName);
		if (owner !== serverName) {
			throw new Error(
				this.toolsIndex.has(toolName)
					? `Tool name conflict: ${toolName}`
					: `Tool unavailable: ${serverName}:${toolName}`
			);
		}
		const connection = this.connections.get(serverName);
		if (!connection || !connection.tools.some((tool) => tool.name === toolName)) {
			throw new Error(`Tool unavailable: ${serverName}:${toolName}`);
		}

		try {
			return await MCPService.callTool(connection, { name: toolName, arguments: args }, signal);
		} catch (error) {
			if (!MCPService.isSessionExpiredError(error)) throw error;
			await this.reconnectServer(serverName);
			if (this.getToolServer(toolName) !== serverName) {
				throw new Error(`Tool name conflict after reconnect: ${toolName}`);
			}
			const newConnection = this.connections.get(serverName);
			if (!newConnection || !newConnection.tools.some((tool) => tool.name === toolName)) {
				throw new Error(`Tool unavailable after reconnect: ${serverName}:${toolName}`);
			}
			return MCPService.callTool(newConnection, { name: toolName, arguments: args }, signal);
		}
	}

	private parseToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
		if (typeof args === 'string') {
			const trimmed = args.trim();
			if (trimmed === '') {
				return {};
			}

			try {
				const parsed = JSON.parse(trimmed);
				if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
					throw new Error(
						`Tool arguments must be an object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
					);

				return parsed as Record<string, unknown>;
			} catch (error) {
				throw new Error(`Failed to parse tool arguments as JSON: ${(error as Error).message}`);
			}
		}

		if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
			return args;
		}

		throw new Error(`Invalid tool arguments type: ${typeof args}`);
	}

	async getPromptCompletions(
		serverName: string,
		promptName: string,
		argumentName: string,
		argumentValue: string
	): Promise<{ values: string[]; total?: number; hasMore?: boolean } | null> {
		const connection = this.connections.get(serverName);
		if (!connection) {
			console.warn(`[MCPStore] Server "${serverName}" is not connected`);
			return null;
		}
		if (!connection.serverCapabilities?.completions) {
			return null;
		}

		return MCPService.complete(
			connection,
			{ type: MCPRefType.PROMPT, name: promptName },
			{ name: argumentName, value: argumentValue }
		);
	}

	/**
	 * Get completions for a resource template argument.
	 * Uses the MCP Completion API with ref/resource.
	 */
	async getResourceCompletions(
		serverName: string,
		uriTemplate: string,
		argumentName: string,
		argumentValue: string
	): Promise<{ values: string[]; total?: number; hasMore?: boolean } | null> {
		const connection = this.connections.get(serverName);

		if (!connection) {
			console.warn(`[MCPStore] Server "${serverName}" is not connected`);
			return null;
		}

		if (!connection.serverCapabilities?.completions) {
			return null;
		}

		return MCPService.complete(
			connection,
			{ type: MCPRefType.RESOURCE, uri: uriTemplate },
			{ name: argumentName, value: argumentValue }
		);
	}

	/**
	 * Read a resource by an arbitrary URI (e.g., one expanded from a template).
	 * Unlike readResource(), this does not require the URI to be in the resources list.
	 */
	async readResourceByUri(serverName: string, uri: string): Promise<MCPResourceContent[] | null> {
		const connection = this.connections.get(serverName);

		if (!connection) {
			console.error(`[MCPStore] No connection found for server: ${serverName}`);

			return null;
		}

		try {
			const result = await MCPService.readResource(connection, uri);

			return result.contents;
		} catch (error) {
			console.error(`[MCPStore] Failed to read resource ${uri}:`, error);

			return null;
		}
	}

	async runHealthChecksForServers(
		servers: {
			id: string;
			enabled: boolean;
			url: string;
			requestTimeoutSeconds: number;
			headers?: string;
		}[],
		skipIfChecked = true,
		promoteToActive = false
	): Promise<void> {
		const serversToCheck = skipIfChecked
			? servers.filter((s) => !this.hasHealthCheck(s.id) && s.url.trim())
			: servers.filter((s) => s.url.trim());

		if (serversToCheck.length === 0) {
			return;
		}

		const BATCH_SIZE = 5;
		for (let i = 0; i < serversToCheck.length; i += BATCH_SIZE) {
			const batch = serversToCheck.slice(i, i + BATCH_SIZE);
			await Promise.allSettled(batch.map((server) => this.runHealthCheck(server, promoteToActive)));
		}
	}

	/**
	 * Check if a server already has an active connection that can be reused.
	 * Returns the existing connection if available.
	 */
	getExistingConnection(serverId: string): MCPConnection | undefined {
		return this.connections.get(serverId);
	}

	/**
	 * Run a health check for a server.
	 * If the server already has an active connection, reuses it instead of creating a new one.
	 * If promoteToActive is true and server is enabled, the connection will be kept
	 * and promoted to an active connection instead of being disconnected.
	 */
	async runHealthCheck(server: HealthCheckParams, promoteToActive = false): Promise<void> {
		const generation = this.lifecycleGeneration;
		// Check if we already have an active connection for this server
		const existingConnection = this.connections.get(server.id);
		if (existingConnection) {
			// Reuse existing connection - just refresh tools list
			try {
				const tools = await MCPService.listTools(existingConnection);
				if (generation !== this.lifecycleGeneration) return;
				existingConnection.tools = tools;
				this.commitConnection(server.id, existingConnection);
				const capabilities = this.#buildCapabilitiesInfo(
					existingConnection.serverCapabilities,
					existingConnection.clientCapabilities
				);
				this.updateHealthCheck(server.id, {
					status: HealthCheckStatus.SUCCESS,
					tools: tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						title: tool.title
					})),
					serverInfo: existingConnection.serverInfo,
					capabilities,
					transportType: existingConnection.transportType,
					protocolVersion: existingConnection.protocolVersion,
					instructions: existingConnection.instructions,
					connectionTimeMs: existingConnection.connectionTimeMs,
					logs: []
				});
				return;
			} catch (error) {
				if (generation !== this.lifecycleGeneration) return;
				console.warn(
					`[MCPStore] Failed to reuse connection for ${server.id}, creating new one:`,
					error
				);
				// Connection may be stale, remove it and create new one
				this.commitConnection(server.id);
				await MCPService.disconnect(existingConnection).catch(console.warn);
				if (generation !== this.lifecycleGeneration) return;
			}
		}

		const trimmedUrl = server.url.trim();
		const logs: MCPConnectionLog[] = [];
		let currentPhase: MCPConnectionPhase = MCPConnectionPhase.IDLE;

		if (!trimmedUrl) {
			this.updateHealthCheck(server.id, {
				status: HealthCheckStatus.ERROR,
				message: 'Please enter a server URL first.',
				logs: []
			});
			return;
		}

		this.updateHealthCheck(server.id, {
			status: HealthCheckStatus.CONNECTING,
			phase: MCPConnectionPhase.TRANSPORT_CREATING,
			logs: []
		});

		try {
			const serverConfig = buildMcpServerConfig({ ...server, url: trimmedUrl });
			if (!serverConfig) return;

			// Store config for reconnection
			this.serverConfigs.set(server.id, serverConfig);

			const connection = await this.connectServer(
				server.id,
				serverConfig,
				DEFAULT_MCP_CONFIG.clientInfo,
				DEFAULT_MCP_CONFIG.capabilities,
				(phase, log) => {
					if (generation !== this.lifecycleGeneration) return;
					currentPhase = phase;
					logs.push(log);
					this.updateHealthCheck(server.id, {
						status: HealthCheckStatus.CONNECTING,
						phase,
						logs: [...logs]
					});

					// Handle WebSocket disconnection
					if (
						phase === MCPConnectionPhase.DISCONNECTED &&
						promoteToActive &&
						generation === this.lifecycleGeneration
					) {
						console.log(
							`[MCPStore][${server.id}] Connection lost during health check, starting auto-reconnect`
						);
						this.autoReconnect(server.id);
					}
				},
				promoteToActive ? this.createListChangedHandlers(server.id) : undefined,
				generation
			);
			if (generation !== this.lifecycleGeneration) {
				await MCPService.disconnect(connection).catch(console.warn);
				return;
			}

			const tools = connection.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				title: tool.title
			}));

			const capabilities = this.#buildCapabilitiesInfo(
				connection.serverCapabilities,
				connection.clientCapabilities
			);

			this.updateHealthCheck(server.id, {
				status: HealthCheckStatus.SUCCESS,
				tools,
				serverInfo: connection.serverInfo,
				capabilities,
				transportType: connection.transportType,
				protocolVersion: connection.protocolVersion,
				instructions: connection.instructions,
				connectionTimeMs: connection.connectionTimeMs,
				logs
			});

			// Promote to active connection or disconnect
			if (promoteToActive && server.enabled) {
				this.promoteHealthCheckToConnection(server.id, connection);
			} else {
				await MCPService.disconnect(connection);
			}
		} catch (error) {
			if (generation !== this.lifecycleGeneration) return;
			const message = error instanceof Error ? error.message : 'Unknown error occurred';

			if (logs.at(-1)?.phase !== MCPConnectionPhase.ERROR) {
				logs.push({
					timestamp: new Date(),
					phase: MCPConnectionPhase.ERROR,
					message: `Connection failed: ${message}`,
					level: MCPLogLevel.ERROR
				});
			}

			this.updateHealthCheck(server.id, {
				status: HealthCheckStatus.ERROR,
				message,
				phase: currentPhase,
				logs
			});
		}
	}

	/**
	 * Promote a health check connection to an active connection.
	 * This avoids the need to reconnect when the server is needed for agentic flows.
	 */
	private promoteHealthCheckToConnection(serverId: string, connection: MCPConnection): void {
		this.commitConnection(serverId, connection);
	}

	getServersStatus(): ServerStatus[] {
		const statuses: ServerStatus[] = [];

		for (const [name, connection] of this.connections) {
			statuses.push({
				name,
				isConnected: true,
				toolCount: connection.tools.length,
				error: undefined
			});
		}

		return statuses;
	}

	/**
	 * Get aggregated server instructions from all connected servers.
	 * Returns an array of { serverName, serverTitle, instructions } objects.
	 */
	getServerInstructions(): Array<{
		serverName: string;
		serverTitle?: string;
		instructions: string;
	}> {
		const results: Array<{ serverName: string; serverTitle?: string; instructions: string }> = [];

		for (const [serverName, connection] of this.connections) {
			if (connection.instructions) {
				results.push({
					serverName,
					serverTitle: connection.serverInfo?.title || connection.serverInfo?.name,
					instructions: connection.instructions
				});
			}
		}

		return results;
	}

	/**
	 * Get server instructions from health check results (for display before active connection).
	 * Useful for showing instructions in settings UI.
	 */
	getHealthCheckInstructions(): Array<{
		serverId: string;
		serverTitle?: string;
		instructions: string;
	}> {
		const results: Array<{ serverId: string; serverTitle?: string; instructions: string }> = [];

		for (const [serverId, state] of Object.entries(this._healthChecks)) {
			if (state.status === HealthCheckStatus.SUCCESS && state.instructions) {
				results.push({
					serverId,
					serverTitle: state.serverInfo?.title || state.serverInfo?.name,
					instructions: state.instructions
				});
			}
		}

		return results;
	}

	/**
	 * Check if any connected server has instructions.
	 */
	hasServerInstructions(): boolean {
		for (const connection of this.connections.values()) {
			if (connection.instructions) {
				return true;
			}
		}

		return false;
	}

	/**
	 *
	 *
	 * Resources Operations
	 *
	 *
	 */

	/**
	 * Check if any enabled server with successful health check supports resources.
	 * Uses health check state since servers may not have active connections until
	 * the user actually sends a message or uses prompts.
	 * @param perChatOverrides - Per-chat server overrides to filter by enabled servers.
	 *                          If provided (even empty array), only checks enabled servers.
	 *                          If undefined, checks all servers with successful health checks.
	 */
	hasResourcesCapability(perChatOverrides?: McpServerOverride[]): boolean {
		// If perChatOverrides is provided (even empty array), filter by enabled servers
		if (perChatOverrides !== undefined) {
			const enabledServerIds = new Set(
				perChatOverrides.filter((o) => o.enabled).map((o) => o.serverId)
			);
			// No enabled servers = no capability
			if (enabledServerIds.size === 0) {
				return false;
			}

			// Check health check states for enabled servers with resources capability
			for (const [serverId, state] of Object.entries(this._healthChecks)) {
				if (!enabledServerIds.has(serverId)) continue;
				if (
					state.status === HealthCheckStatus.SUCCESS &&
					state.capabilities?.server?.resources !== undefined
				) {
					return true;
				}
			}

			// Also check active connections as fallback
			for (const [serverName, connection] of this.connections) {
				if (!enabledServerIds.has(serverName)) continue;
				if (MCPService.supportsResources(connection)) {
					return true;
				}
			}

			return false;
		}

		// No overrides provided - check all servers (global mode)
		for (const state of Object.values(this._healthChecks)) {
			if (
				state.status === HealthCheckStatus.SUCCESS &&
				state.capabilities?.server?.resources !== undefined
			) {
				return true;
			}
		}

		for (const connection of this.connections.values()) {
			if (MCPService.supportsResources(connection)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Get list of servers that support resources.
	 * Checks active connections first, then health check state as fallback.
	 */
	getServersWithResources(): string[] {
		const servers: string[] = [];

		// Check active connections
		for (const [name, connection] of this.connections) {
			if (MCPService.supportsResources(connection) && !servers.includes(name)) {
				servers.push(name);
			}
		}

		// Also check health check states for servers not yet connected
		for (const [serverId, state] of Object.entries(this._healthChecks)) {
			if (
				!servers.includes(serverId) &&
				state.status === HealthCheckStatus.SUCCESS &&
				state.capabilities?.server?.resources !== undefined
			) {
				servers.push(serverId);
			}
		}

		return servers;
	}

	/**
	 * Fetch resources from all connected servers that support them.
	 * Updates mcpResourceStore with the results.
	 * @param forceRefresh - If true, bypass cache and fetch fresh data
	 */
	async fetchAllResources(forceRefresh: boolean = false): Promise<void> {
		const serversWithResources = this.getServersWithResources();
		if (serversWithResources.length === 0) {
			return;
		}

		// Check if we have cached resources and they're recent (unless force refresh)
		if (!forceRefresh) {
			const allServersCached = serversWithResources.every((serverName) => {
				const serverRes = mcpResourceStore.getServerResources(serverName);
				if (!serverRes || !serverRes.lastFetched) {
					return false;
				}

				// Cache is valid for 5 minutes
				const age = Date.now() - serverRes.lastFetched.getTime();

				return age < DEFAULT_CACHE_TTL_MS;
			});

			if (allServersCached) {
				console.log('[MCPStore] Using cached resources');

				return;
			}
		}

		mcpResourceStore.setLoading(true);

		try {
			await Promise.all(
				serversWithResources.map((serverName) => this.fetchServerResources(serverName))
			);
		} finally {
			mcpResourceStore.setLoading(false);
		}
	}

	/**
	 * Fetch resources from a specific server.
	 * Updates mcpResourceStore with the results.
	 */
	async fetchServerResources(serverName: string): Promise<void> {
		const connection = this.connections.get(serverName);
		if (!connection) {
			console.warn(`[MCPStore] No connection found for server: ${serverName}`);
			return;
		}

		if (!MCPService.supportsResources(connection)) {
			return;
		}

		mcpResourceStore.setServerLoading(serverName, true);

		try {
			const [resources, templates] = await Promise.all([
				MCPService.listAllResources(connection),
				MCPService.listAllResourceTemplates(connection)
			]);

			mcpResourceStore.setServerResources(serverName, resources, templates);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			mcpResourceStore.setServerError(serverName, message);
			console.error(`[MCPStore][${serverName}] Failed to fetch resources:`, error);
		}
	}

	/**
	 * Read resource content from a server.
	 * Caches the result in mcpResourceStore.
	 */
	async readResource(uri: string): Promise<MCPResourceContent[] | null> {
		// Check cache first
		const cached = mcpResourceStore.getCachedContent(uri);
		if (cached) {
			return cached.content;
		}

		// Find which server has this resource
		const serverName = mcpResourceStore.findServerForUri(uri);
		if (!serverName) {
			console.error(`[MCPStore] No server found for resource URI: ${uri}`);

			return null;
		}

		const connection = this.connections.get(serverName);
		if (!connection) {
			console.error(`[MCPStore] No connection found for server: ${serverName}`);

			return null;
		}

		try {
			const result = await MCPService.readResource(connection, uri);
			const resourceInfo = mcpResourceStore.findResourceByUri(uri);

			if (resourceInfo) {
				mcpResourceStore.cacheResourceContent(resourceInfo, result.contents);
			}

			return result.contents;
		} catch (error) {
			console.error(`[MCPStore] Failed to read resource ${uri}:`, error);

			return null;
		}
	}

	/**
	 * Subscribe to resource updates.
	 */
	async subscribeToResource(uri: string): Promise<boolean> {
		const serverName = mcpResourceStore.findServerForUri(uri);
		if (!serverName) {
			console.error(`[MCPStore] No server found for resource URI: ${uri}`);

			return false;
		}

		const connection = this.connections.get(serverName);
		if (!connection) {
			console.error(`[MCPStore] No connection found for server: ${serverName}`);

			return false;
		}

		if (!MCPService.supportsResourceSubscriptions(connection)) {
			return false;
		}

		try {
			await MCPService.subscribeResource(connection, uri);
			mcpResourceStore.addSubscription(uri, serverName);

			return true;
		} catch (error) {
			console.error(`[MCPStore] Failed to subscribe to resource ${uri}:`, error);

			return false;
		}
	}

	/**
	 * Unsubscribe from resource updates.
	 */
	async unsubscribeFromResource(uri: string): Promise<boolean> {
		const serverName = mcpResourceStore.findServerForUri(uri);
		if (!serverName) {
			console.error(`[MCPStore] No server found for resource URI: ${uri}`);

			return false;
		}

		const connection = this.connections.get(serverName);
		if (!connection) {
			console.error(`[MCPStore] No connection found for server: ${serverName}`);

			return false;
		}

		try {
			await MCPService.unsubscribeResource(connection, uri);
			mcpResourceStore.removeSubscription(uri);

			return true;
		} catch (error) {
			console.error(`[MCPStore] Failed to unsubscribe from resource ${uri}:`, error);

			return false;
		}
	}

	/**
	 * Add a resource as attachment to chat context.
	 * Automatically fetches content if not cached.
	 */
	async attachResource(uri: string): Promise<MCPResourceAttachment | null> {
		const resourceInfo = mcpResourceStore.findResourceByUri(uri);
		if (!resourceInfo) {
			console.error(`[MCPStore] Resource not found: ${uri}`);

			return null;
		}

		// Check if already attached
		if (mcpResourceStore.isAttached(uri)) {
			return null;
		}

		// Add attachment (initially loading)
		const attachment = mcpResourceStore.addAttachment(resourceInfo);

		// Fetch content
		try {
			const content = await this.readResource(uri);

			if (content) {
				mcpResourceStore.updateAttachmentContent(attachment.id, content);
			} else {
				mcpResourceStore.updateAttachmentError(attachment.id, 'Failed to read resource');
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			mcpResourceStore.updateAttachmentError(attachment.id, message);
		}

		return mcpResourceStore.getAttachment(attachment.id) ?? null;
	}

	/**
	 * Remove a resource attachment from chat context.
	 */
	removeResourceAttachment(attachmentId: string): void {
		mcpResourceStore.removeAttachment(attachmentId);
	}

	/**
	 * Clear all resource attachments.
	 */
	clearResourceAttachments(): void {
		mcpResourceStore.clearAttachments();
	}

	/**
	 * Get formatted resource context for chat.
	 */
	getResourceContextForChat(): string {
		return mcpResourceStore.formatAttachmentsForContext();
	}

	/**
	 * Convert current resource attachments to DatabaseMessageExtra[] and clear them.
	 * Called during message send to persist resources with the user message.
	 */
	consumeResourceAttachmentsAsExtras(): DatabaseMessageExtraMcpResource[] {
		const extras = mcpResourceStore.toMessageExtras();
		if (extras.length > 0) {
			mcpResourceStore.clearAttachments();
		}
		return extras;
	}
}

export const mcpStore = new MCPStore();

export const mcpIsInitializing = () => mcpStore.isInitializing;
export const mcpIsInitialized = () => mcpStore.isInitialized;
export const mcpError = () => mcpStore.error;
export const mcpIsEnabled = () => mcpStore.isEnabled;
export const mcpIsProxyAvailable = () => mcpStore.isProxyAvailable;
export const mcpAvailableTools = () => mcpStore.availableTools;
export const mcpConnectedServerCount = () => mcpStore.connectedServerCount;
export const mcpConnectedServerNames = () => mcpStore.connectedServerNames;
export const mcpToolCount = () => mcpStore.toolCount;
export const mcpServerInstructions = () => mcpStore.getServerInstructions();
export const mcpHasServerInstructions = () => mcpStore.hasServerInstructions();

// Resources exports
export const mcpHasResourcesCapability = () => mcpStore.hasResourcesCapability();
export const mcpServersWithResources = () => mcpStore.getServersWithResources();
export const mcpResourceContext = () => mcpStore.getResourceContextForChat();
