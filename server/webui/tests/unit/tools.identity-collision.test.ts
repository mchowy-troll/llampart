import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { ToolSource } from '$lib/enums';
import { MCPService } from '$lib/services/mcp.service';
import { ToolsService } from '$lib/services/tools.service';
import { sourceLifecycleService } from '$lib/services/source-lifecycle.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import type {
	MCPConnection,
	OpenAIToolDefinition,
	ProviderRequestContext,
	Tool,
	ToolEntry
} from '$lib/types';

interface McpHarness {
	connections: Map<string, MCPConnection>;
	serverConfigs: Map<string, { url: string; transport?: string; useProxy?: boolean }>;
	rebuildToolsIndex(): void;
	handleToolsListChanged(serverName: string, tools: Tool[]): void;
}

interface ToolsHarness {
	_disabledTools: Set<string>;
	clear(): void;
	fetchBuiltinTools(context: ProviderRequestContext): Promise<void>;
	getEnabledToolEntriesForLLM(context: ProviderRequestContext): ToolEntry[];
	getServerPermissionKeys(entry: ToolEntry): string[];
	executeTool(
		entry: ToolEntry,
		params: Record<string, unknown>,
		context: ProviderRequestContext,
		signal?: AbortSignal
	): Promise<{ content: string; isError?: boolean }>;
	allTools: ToolEntry[];
	setToolEnabled(key: string, enabled: boolean): void;
}

interface AgenticHarness {
	flowControllers: Map<string, AbortController>;
	abortActiveSourceOperations(): void;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

const originalConfig = { ...settingsStore.config };
const mcpHarness = mcpStore as unknown as McpHarness;
const store = toolsStore as unknown as ToolsHarness;
const agenticHarness = agenticStore as unknown as AgenticHarness;

function context(baseUrl: string, sourceGeneration: number): ProviderRequestContext {
	return Object.freeze({
		providerId: API_PROVIDER_IDS.LLAMA_SERVER,
		serverBaseUrl: baseUrl,
		apiKey: `${baseUrl}-key`,
		sourceGeneration
	});
}

function definition(name: string, property: string): OpenAIToolDefinition {
	return {
		type: 'function',
		function: {
			name,
			description: `${name}-${property}`,
			parameters: {
				type: 'object',
				properties: { [property]: { type: 'string' } },
				required: [property]
			}
		}
	};
}

function installMcp(serverId: string, definitions: OpenAIToolDefinition[]): void {
	const tools = definitions.map(
		(tool): Tool => ({
			name: tool.function.name,
			description: tool.function.description,
			inputSchema: tool.function.parameters
		})
	);
	mcpHarness.connections.set(serverId, {
		serverName: serverId,
		tools
	} as MCPConnection);
	mcpHarness.rebuildToolsIndex();
}

async function installBuiltin(
	requestContext: ProviderRequestContext,
	definitions: OpenAIToolDefinition[]
): Promise<void> {
	vi.spyOn(ToolsService, 'list').mockResolvedValue(
		definitions.map((tool) => ({ name: tool.function.name, definition: tool }))
	);
	await store.fetchBuiltinTools(requestContext);
}

function select(source: ToolSource, serverId?: string, name = 'X'): ToolEntry {
	const entry = store.allTools.find(
		(candidate) =>
			candidate.source === source &&
			candidate.serverId === serverId &&
			candidate.definition.function.name === name
	);
	if (!entry) throw new Error(`Missing test tool ${source}:${serverId ?? ''}:${name}`);
	return entry;
}

beforeEach(() => {
	settingsStore.updateMultipleConfig({
		apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
		serverBaseUrl: 'https://a.test',
		apiKey: 'https://a.test-key'
	});
	mcpHarness.connections.clear();
	store._disabledTools.clear();
	store.clear();
	agenticHarness.flowControllers.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	mcpHarness.connections.clear();
	store._disabledTools.clear();
	store.clear();
	agenticHarness.flowControllers.clear();
	settingsStore.config = { ...originalConfig };
});

describe('exact tool identity and collision policy', () => {
	it('lists builtins with the frozen provider URL and credentials', async () => {
		const sourceA = context('https://a.test', 1);
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.test',
			apiKey: 'https://b.test-key'
		});
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		await ToolsService.list(sourceA);

		expect(fetchMock).toHaveBeenCalledWith(
			'https://a.test/tools',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer https://a.test-key' })
			})
		);
	});

	it('ignores a late builtin list from an invalidated generation', async () => {
		const sourceA = context('https://a.test', 2);
		const sourceB = context('https://b.test', 3);
		const listA = deferred<Awaited<ReturnType<typeof ToolsService.list>>>();
		const listB = deferred<Awaited<ReturnType<typeof ToolsService.list>>>();
		vi.spyOn(ToolsService, 'list').mockImplementation((requestContext) =>
			requestContext.serverBaseUrl === sourceA.serverBaseUrl ? listA.promise : listB.promise
		);

		const requestA = store.fetchBuiltinTools(sourceA);
		store.clear();
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: sourceB.serverBaseUrl,
			apiKey: sourceB.apiKey
		});
		const requestB = store.fetchBuiltinTools(sourceB);

		listB.resolve([{ name: 'B', definition: definition('B', 'argB') }]);
		await requestB;
		listA.resolve([{ name: 'A', definition: definition('A', 'argA') }]);
		await requestA;

		expect(store.allTools.map((entry) => entry.apiName)).toEqual(['B']);
		expect(store.getEnabledToolEntriesForLLM(sourceB).map((entry) => entry.apiName)).toEqual(['B']);
	});

	it('does not substitute a disabled builtin X with an enabled MCP X', async () => {
		const source = context('https://a.test', 1);
		await installBuiltin(source, [definition('X', 'builtinArg')]);
		installMcp('server-a', [definition('X', 'mcpArg')]);
		const builtin = select(ToolSource.BUILTIN);
		store.setToolEnabled(builtin.key, false);
		const builtinExecute = vi.spyOn(ToolsService, 'executeTool');
		const mcpExecute = vi.spyOn(MCPService, 'callTool');

		expect(store.getEnabledToolEntriesForLLM(source)).toEqual([]);
		await expect(store.executeTool(select(ToolSource.MCP, 'server-a'), {}, source)).rejects.toThrow(
			/conflict/i
		);
		expect(builtinExecute).not.toHaveBeenCalled();
		expect(mcpExecute).not.toHaveBeenCalled();
	});

	it('blocks every MCP X when two exact identities expose different schemas', async () => {
		const source = context('https://a.test', 2);
		installMcp('server-a', [definition('X', 'argA')]);
		installMcp('server-b', [definition('X', 'argB')]);
		const execute = vi.spyOn(MCPService, 'callTool');

		expect(store.getEnabledToolEntriesForLLM(source)).toEqual([]);
		await expect(store.executeTool(select(ToolSource.MCP, 'server-a'), {}, source)).rejects.toThrow(
			/conflict/i
		);
		await expect(store.executeTool(select(ToolSource.MCP, 'server-b'), {}, source)).rejects.toThrow(
			/conflict/i
		);
		expect(execute).not.toHaveBeenCalled();
	});

	it('blocks duplicate builtin entries with the same exact key and differing schemas', async () => {
		const source = context('https://a.test', 2);
		await installBuiltin(source, [definition('X', 'argA'), definition('X', 'argB')]);
		const candidates = store.allTools.filter((entry) => entry.apiName === 'X');
		const execute = vi.spyOn(ToolsService, 'executeTool');

		expect(candidates).toHaveLength(2);
		expect(candidates.map((entry) => entry.key)).toEqual(['builtin:X', 'builtin:X']);
		expect(store.getEnabledToolEntriesForLLM(source)).toEqual([]);
		await expect(store.executeTool(candidates[0], {}, source)).rejects.toThrow(/conflict/i);
		expect(execute).not.toHaveBeenCalled();
	});

	it('blocks duplicate names from one MCP server instead of deduping the first schema', async () => {
		const source = context('https://a.test', 2);
		installMcp('server-a', [definition('X', 'argA'), definition('X', 'argB')]);
		const candidates = store.allTools.filter((entry) => entry.apiName === 'X');
		const execute = vi.spyOn(MCPService, 'callTool');

		expect(candidates).toHaveLength(2);
		expect(candidates.map((entry) => entry.key)).toEqual(['mcp-server-a:X', 'mcp-server-a:X']);
		expect(mcpStore.hasTool('X')).toBe(false);
		expect(mcpStore.getToolDefinitionsForLLM()).toEqual([]);
		expect(store.getEnabledToolEntriesForLLM(source)).toEqual([]);
		await expect(store.executeTool(candidates[0], {}, source)).rejects.toThrow(/conflict/i);
		expect(execute).not.toHaveBeenCalled();
	});

	it('scopes ALWAYS_SERVER permission keys to the exact source/server identity', () => {
		installMcp('server-a', [definition('X', 'argX'), definition('Y', 'argY')]);
		installMcp('server-b', [definition('Z', 'argZ')]);

		expect(store.getServerPermissionKeys(select(ToolSource.MCP, 'server-a'))).toEqual([
			'mcp-server-a:X',
			'mcp-server-a:Y'
		]);
		expect(store.getServerPermissionKeys(select(ToolSource.MCP, 'server-b', 'Z'))).toEqual([
			'mcp-server-b:Z'
		]);
	});

	it('never changes a conflicted owner because connection order or tool lists change', async () => {
		const source = context('https://a.test', 3);
		installMcp('server-a', [definition('X', 'argA')]);
		const offeredByA = store.getEnabledToolEntriesForLLM(source);
		expect(offeredByA.map((entry) => entry.key)).toEqual(['mcp-server-a:X']);

		installMcp('server-b', [definition('X', 'argB')]);
		expect(store.getEnabledToolEntriesForLLM(source)).toEqual([]);
		await expect(store.executeTool(offeredByA[0], {}, source)).rejects.toThrow(/conflict/i);

		mcpHarness.handleToolsListChanged('server-a', []);
		expect(store.getEnabledToolEntriesForLLM(source).map((entry) => entry.key)).toEqual([
			'mcp-server-b:X'
		]);
		await expect(store.executeTool(offeredByA[0], {}, source)).rejects.toThrow(/unavailable/i);

		mcpHarness.handleToolsListChanged('server-a', [
			{
				name: 'X',
				description: 'reconnected-X',
				inputSchema: definition('X', 'reconnectedArg').function.parameters
			} as Tool
		]);
		expect(store.getEnabledToolEntriesForLLM(source)).toEqual([]);

		mcpHarness.connections.delete('server-a');
		mcpHarness.rebuildToolsIndex();
		expect(store.getEnabledToolEntriesForLLM(source).map((entry) => entry.key)).toEqual([
			'mcp-server-b:X'
		]);
		await expect(store.executeTool(offeredByA[0], {}, source)).rejects.toThrow(/unavailable/i);
	});

	it('clears A builtins on source switch and rejects their later execution', async () => {
		const sourceA = context('https://a.test', 4);
		await installBuiltin(sourceA, [definition('dangerous_action', 'target')]);
		const offeredByA = store.getEnabledToolEntriesForLLM(sourceA);
		const execute = vi.spyOn(ToolsService, 'executeTool');

		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.test',
			apiKey: 'https://b.test-key'
		});
		store.clear();
		const sourceB = context('https://b.test', 5);

		expect(store.getEnabledToolEntriesForLLM(sourceB)).toEqual([]);
		await expect(store.executeTool(offeredByA[0], {}, sourceA)).rejects.toThrow(/unavailable/i);
		expect(execute).not.toHaveBeenCalled();
	});

	it('disconnects a stale proxied MCP source before loading tools for the replacement source', async () => {
		const sourceA = context('https://a.test', 6);
		await installBuiltin(sourceA, [definition('builtin-a', 'argA')]);
		installMcp('server-a', [definition('proxied', 'argMcp')]);
		mcpHarness.serverConfigs.set('server-a', {
			url: 'https://mcp.test',
			useProxy: true
		});
		const staleMcpEntry = select(ToolSource.MCP, 'server-a', 'proxied');
		const oldConnection = mcpHarness.connections.get('server-a')!;
		const disconnect = vi.spyOn(MCPService, 'disconnect').mockResolvedValue();
		const initialize = vi.spyOn(mcpStore, 'ensureInitialized').mockResolvedValue(false);
		vi.spyOn(ToolsService, 'list').mockResolvedValue([
			{ name: 'builtin-b', definition: definition('builtin-b', 'argB') }
		]);
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.test',
			apiKey: 'https://b.test-key'
		});
		const sourceB = {
			providerId: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.test',
			apiKey: 'https://b.test-key'
		};
		const overrides = [{ serverId: 'server-a', enabled: true }];

		await sourceLifecycleService.switchSource(sourceB, overrides);

		expect(disconnect).toHaveBeenCalledWith(oldConnection);
		expect(mcpHarness.connections.has('server-a')).toBe(false);
		expect(initialize).toHaveBeenCalledWith(overrides);
		expect(store.allTools.map((entry) => entry.apiName)).toEqual(['builtin-b']);
		await expect(store.executeTool(staleMcpEntry, {}, sourceA)).rejects.toThrow(/unavailable/i);
		expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(
			initialize.mock.invocationCallOrder[0]
		);
	});

	it('keeps only the latest source lifecycle builtin fetch when responses resolve out of order', async () => {
		const listB = deferred<Awaited<ReturnType<typeof ToolsService.list>>>();
		const listC = deferred<Awaited<ReturnType<typeof ToolsService.list>>>();
		vi.spyOn(mcpStore, 'ensureInitialized').mockResolvedValue(false);
		vi.spyOn(ToolsService, 'list').mockImplementation((requestContext) =>
			requestContext.serverBaseUrl === 'https://b.test' ? listB.promise : listC.promise
		);

		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.test',
			apiKey: 'https://b.test-key'
		});
		const switchB = sourceLifecycleService.switchSource(
			{
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: 'https://b.test',
				apiKey: 'https://b.test-key'
			},
			[]
		);
		await Promise.resolve();
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://c.test',
			apiKey: 'https://c.test-key'
		});
		const switchC = sourceLifecycleService.switchSource(
			{
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: 'https://c.test',
				apiKey: 'https://c.test-key'
			},
			[]
		);

		listC.resolve([{ name: 'C', definition: definition('C', 'argC') }]);
		await switchC;
		listB.resolve([{ name: 'B', definition: definition('B', 'argB') }]);
		await switchB;

		expect(store.allTools.map((entry) => entry.apiName)).toEqual(['C']);
	});

	it('re-probes proxy availability when the provider source changes', async () => {
		vi.spyOn(mcpStore, 'shutdown').mockResolvedValue();
		vi.spyOn(mcpStore, 'ensureInitialized').mockResolvedValue(false);
		vi.spyOn(ToolsService, 'list').mockResolvedValue([]);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async (input: string | URL | Request) =>
					new Response(null, { status: String(input).includes('b.test') ? 200 : 404 })
			)
		);

		for (const serverBaseUrl of ['https://b.test', 'https://c.test']) {
			settingsStore.updateMultipleConfig({
				apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl,
				apiKey: `${serverBaseUrl}-key`
			});
			await sourceLifecycleService.switchSource(
				{
					providerId: API_PROVIDER_IDS.LLAMA_SERVER,
					serverBaseUrl,
					apiKey: `${serverBaseUrl}-key`
				},
				[]
			);
			expect(mcpStore.isProxyAvailable).toBe(serverBaseUrl.includes('b.test'));
		}
	});

	it('does not let a stale source proxy probe overwrite the latest result', async () => {
		const probeB = deferred<Response>();
		const probeC = deferred<Response>();
		vi.spyOn(mcpStore, 'shutdown').mockResolvedValue();
		vi.spyOn(mcpStore, 'ensureInitialized').mockResolvedValue(false);
		vi.spyOn(ToolsService, 'list').mockResolvedValue([]);
		vi.stubGlobal(
			'fetch',
			vi.fn((input: string | URL | Request) =>
				String(input).includes('b.test') ? probeB.promise : probeC.promise
			)
		);

		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://b.test',
			apiKey: 'https://b.test-key'
		});
		const switchB = sourceLifecycleService.switchSource(
			{
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: 'https://b.test',
				apiKey: 'https://b.test-key'
			},
			[]
		);
		await Promise.resolve();
		settingsStore.updateMultipleConfig({
			apiProvider: API_PROVIDER_IDS.LLAMA_SERVER,
			serverBaseUrl: 'https://c.test',
			apiKey: 'https://c.test-key'
		});
		const switchC = sourceLifecycleService.switchSource(
			{
				providerId: API_PROVIDER_IDS.LLAMA_SERVER,
				serverBaseUrl: 'https://c.test',
				apiKey: 'https://c.test-key'
			},
			[]
		);

		probeC.resolve(new Response(null, { status: 404 }));
		await switchC;
		probeB.resolve(new Response(null, { status: 200 }));
		await switchB;

		expect(mcpStore.isProxyAvailable).toBe(false);
	});

	it('aborts every active agentic flow during a source switch', () => {
		const controllerA = new AbortController();
		const controllerB = new AbortController();
		agenticHarness.flowControllers.set('conversation-a', controllerA);
		agenticHarness.flowControllers.set('conversation-b', controllerB);

		agenticHarness.abortActiveSourceOperations();

		expect(controllerA.signal.aborted).toBe(true);
		expect(controllerB.signal.aborted).toBe(true);
		expect(agenticHarness.flowControllers.size).toBe(0);
	});
});
