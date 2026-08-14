import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPService } from '$lib/services/mcp.service';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { MCPTransportType } from '$lib/enums';
import type { MCPClientConfig, MCPConnection, MCPServerConfig, Tool } from '$lib/types';

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

interface LifecycleHarness {
	connections: Map<string, MCPConnection>;
	serverConfigs: Map<string, MCPServerConfig>;
	reconnectingServers: Set<string>;
	reconnectPromises: Map<string, Promise<void>>;
	reconnectControllers: Map<string, AbortController>;
	pendingConnectControllers: Set<AbortController>;
	configSignature: string | null;
	lifecycleGeneration: number;
	toolCount: number;
	connectedServerNames: string[];
	initialize(signature: string, config: MCPClientConfig): Promise<boolean>;
	autoReconnect(serverName: string): Promise<void>;
	reconnectServer(serverName: string): Promise<void>;
	commitConnection(serverName: string, connection?: MCPConnection): void;
	handleToolsListChanged(serverName: string, tools: Tool[]): void;
	runHealthCheck(
		server: {
			id: string;
			enabled: boolean;
			url: string;
			requestTimeoutSeconds: number;
		},
		promoteToActive?: boolean
	): Promise<void>;
	hasTool(toolName: string): boolean;
	executeToolOnServer(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>
	): Promise<{ content: string; isError?: boolean }>;
	shutdown(): Promise<void>;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});

	return { promise, resolve };
}

function createStore(): LifecycleHarness {
	const Store = mcpStore.constructor as new () => typeof mcpStore;
	return new Store() as unknown as LifecycleHarness;
}

function createTool(name: string): Tool {
	return { name, inputSchema: { type: 'object' } } as Tool;
}

function createConnection(serverName: string, toolNames: string[] = []): MCPConnection {
	return {
		serverName,
		client: {},
		transport: {},
		tools: toolNames.map(createTool),
		transportType: MCPTransportType.STREAMABLE_HTTP,
		connectionTimeMs: 1
	} as unknown as MCPConnection;
}

function createConfig(url: string): MCPClientConfig {
	return {
		servers: {
			server: {
				url,
				transport: MCPTransportType.STREAMABLE_HTTP
			}
		}
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe('MCP lifecycle cancellation', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('does not connect after shutdown during reconnect backoff', async () => {
		vi.useFakeTimers();
		const store = createStore();
		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);
		const connectSpy = vi.spyOn(MCPService, 'connect');

		const reconnect = store.autoReconnect('server');
		const reconnectResult = reconnect.catch((error) => error);
		await store.shutdown();
		await vi.advanceTimersByTimeAsync(60_000);
		await reconnectResult;

		expect(connectSpy).not.toHaveBeenCalled();
	});

	it('aborts a timed out connect and closes a late resolution without promoting it', async () => {
		vi.useFakeTimers();
		const store = createStore();
		const lateConnect = deferred<MCPConnection>();
		const lateConnection = createConnection('server');
		let connectSignal: AbortSignal | undefined;
		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);
		vi.spyOn(MCPService, 'connect').mockImplementation((...args) => {
			connectSignal = args[6] as AbortSignal | undefined;
			return lateConnect.promise;
		});
		const disconnectSpy = vi.spyOn(MCPService, 'disconnect').mockResolvedValue();

		const reconnect = store.autoReconnect('server');
		const reconnectResult = reconnect.catch((error) => error);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(connectSignal?.aborted).toBe(false);

		await vi.advanceTimersByTimeAsync(15_000);
		expect(connectSignal?.aborted).toBe(true);

		lateConnect.resolve(lateConnection);
		await flushPromises();

		expect(disconnectSpy).toHaveBeenCalledWith(lateConnection);
		expect(store.connections.has('server')).toBe(false);

		await store.shutdown();
		await reconnectResult;
	});

	it('prevents config A from being promoted after config B replaces its lifecycle', async () => {
		vi.useFakeTimers();
		const store = createStore();
		const connectA = deferred<MCPConnection>();
		const connectionA = createConnection('server');
		const connectionB = createConnection('server-b');
		let signalA: AbortSignal | undefined;
		store.configSignature = 'A';
		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);

		vi.spyOn(MCPService, 'connect').mockImplementation((serverName, config, ...args) => {
			if (config.url.includes('a.test')) {
				signalA = args[4] as AbortSignal | undefined;
				return connectA.promise;
			}
			return Promise.resolve({ ...connectionB, serverName });
		});
		const disconnectSpy = vi.spyOn(MCPService, 'disconnect').mockResolvedValue();

		const reconnectA = store.autoReconnect('server');
		await vi.advanceTimersByTimeAsync(1_000);
		const shutdownA = store.shutdown();
		const wasAborted = signalA?.aborted;
		await shutdownA;
		await reconnectA;
		await store.initialize('B', createConfig('https://b.test/mcp'));

		connectA.resolve(connectionA);
		await flushPromises();
		const wasPromoted = store.connections.get('server');

		expect(wasAborted).toBe(true);
		expect(disconnectSpy).toHaveBeenCalledWith(connectionA);
		expect(wasPromoted).toMatchObject({ serverName: 'server' });
		expect(wasPromoted).not.toBe(connectionA);
	});

	it('clears lifecycle state on shutdown even when there are no connections', async () => {
		const store = createStore();
		const reconnectController = new AbortController();
		const connectController = new AbortController();
		const generation = store.lifecycleGeneration;

		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);
		store.reconnectingServers.add('server');
		store.reconnectControllers.set('server', reconnectController);
		store.pendingConnectControllers.add(connectController);
		store.configSignature = 'A';

		await store.shutdown();

		expect(store.lifecycleGeneration).toBe(generation + 1);
		expect(reconnectController.signal.aborted).toBe(true);
		expect(connectController.signal.aborted).toBe(true);
		expect(store.serverConfigs.size).toBe(0);
		expect(store.reconnectingServers.size).toBe(0);
		expect(store.reconnectControllers.size).toBe(0);
		expect(store.pendingConnectControllers.size).toBe(0);
		expect(store.configSignature).toBeNull();
	});

	it('replaces A+B with A on reconnect and refreshes reactive connection state', async () => {
		const store = createStore();
		const oldConnection = createConnection('server', ['A', 'B']);
		const newConnection = createConnection('server', ['A']);
		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);
		store.commitConnection('server', oldConnection);
		const commitSpy = vi.spyOn(store, 'commitConnection');
		vi.spyOn(MCPService, 'connect').mockResolvedValue(newConnection);
		vi.spyOn(MCPService, 'disconnect').mockResolvedValue();

		await store.reconnectServer('server');

		expect(commitSpy).toHaveBeenCalledWith('server', newConnection);
		expect(store.hasTool('A')).toBe(true);
		expect(store.hasTool('B')).toBe(false);
		expect(store.toolCount).toBe(1);
		expect(store.connectedServerNames).toEqual(['server']);
	});

	it('shares one deferred session reconnect and disconnects the stale connection', async () => {
		const store = createStore();
		const oldConnection = createConnection('server', ['A']);
		const newConnection = createConnection('server', ['A']);
		const oldDisconnected = deferred<void>();
		const connected = deferred<MCPConnection>();
		const expired = new Error('expired');
		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);
		store.commitConnection('server', oldConnection);
		vi.spyOn(MCPService, 'isSessionExpiredError').mockImplementation((error) => error === expired);
		vi.spyOn(MCPService, 'callTool').mockImplementation(async (connection) => {
			if (connection === oldConnection) throw expired;
			return { content: 'recovered', isError: false };
		});
		const disconnect = vi.spyOn(MCPService, 'disconnect').mockImplementation(async (connection) => {
			if (connection === oldConnection) await oldDisconnected.promise;
		});
		const connect = vi.spyOn(MCPService, 'connect').mockReturnValue(connected.promise);

		const first = store.executeToolOnServer('server', 'A', {});
		const second = store.executeToolOnServer('server', 'A', {});
		await flushPromises();

		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(disconnect).toHaveBeenCalledWith(oldConnection);
		expect(store.connections.has('server')).toBe(false);
		expect(store.reconnectPromises.size).toBe(1);
		expect(connect).not.toHaveBeenCalled();

		oldDisconnected.resolve();
		await flushPromises();
		expect(connect).toHaveBeenCalledTimes(1);
		connected.resolve(newConnection);

		await expect(Promise.all([first, second])).resolves.toEqual([
			{ content: 'recovered', isError: false },
			{ content: 'recovered', isError: false }
		]);
		expect(store.connections.get('server')).toBe(newConnection);
		expect(store.reconnectPromises.size).toBe(0);
	});

	it('commits auto-reconnected connections through the shared connection helper', async () => {
		vi.useFakeTimers();
		const store = createStore();
		const staleConnection = createConnection('server', ['stale']);
		const connection = createConnection('server', ['A']);
		store.serverConfigs.set('server', createConfig('https://a.test/mcp').servers.server);
		store.commitConnection('server', staleConnection);
		const commitSpy = vi.spyOn(store, 'commitConnection');
		const disconnect = vi.spyOn(MCPService, 'disconnect').mockResolvedValue();
		vi.spyOn(MCPService, 'connect').mockResolvedValue(connection);

		const reconnect = store.autoReconnect('server');
		await flushPromises();
		expect(disconnect).toHaveBeenCalledWith(staleConnection);
		expect(store.connections.has('server')).toBe(false);
		await vi.advanceTimersByTimeAsync(1_000);
		await reconnect;

		expect(commitSpy).toHaveBeenCalledWith('server', connection);
		expect(store.toolCount).toBe(1);
		expect(store.connectedServerNames).toEqual(['server']);
	});

	it('commits list changes through the shared connection helper', () => {
		const store = createStore();
		const connection = createConnection('server', ['A', 'B']);
		store.commitConnection('server', connection);
		const commitSpy = vi.spyOn(store, 'commitConnection');

		store.handleToolsListChanged('server', [createTool('A')]);

		expect(commitSpy).toHaveBeenCalledWith('server', connection);
		expect(store.hasTool('B')).toBe(false);
		expect(store.toolCount).toBe(1);
	});

	it('commits initialized connections through the shared connection helper', async () => {
		const store = createStore();
		const connection = createConnection('server', ['A']);
		const commitSpy = vi.spyOn(store, 'commitConnection');
		vi.spyOn(MCPService, 'connect').mockResolvedValue(connection);

		await store.initialize('A', createConfig('https://a.test/mcp'));

		expect(commitSpy).toHaveBeenCalledWith('server', connection);
		expect(store.toolCount).toBe(1);
		expect(store.connectedServerNames).toEqual(['server']);
	});

	it('commits promoted health-check connections through the shared connection helper', async () => {
		const store = createStore();
		const connection = createConnection('server', ['A']);
		const commitSpy = vi.spyOn(store, 'commitConnection');
		vi.spyOn(MCPService, 'connect').mockResolvedValue(connection);

		await store.runHealthCheck(
			{
				id: 'server',
				enabled: true,
				url: 'https://a.test/mcp',
				requestTimeoutSeconds: 1
			},
			true
		);

		expect(commitSpy).toHaveBeenCalledWith('server', connection);
		expect(store.toolCount).toBe(1);
		expect(store.connectedServerNames).toEqual(['server']);
	});
});
