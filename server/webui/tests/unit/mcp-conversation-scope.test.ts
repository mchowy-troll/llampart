import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPService } from '$lib/services/mcp.service';
import { ToolsService } from '$lib/services/tools.service';
import { ChatService } from '$lib/services/chat.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { ToolPermissionDecision } from '$lib/enums';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { permissionsStore } from '$lib/stores/permissions.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { buildMcpServerConfig } from '$lib/utils/mcp-config';
import type { MCPConnection, MCPServerConfig, ProviderRequestContext } from '$lib/types';
import type { AgenticFlowCallbacks, ToolExecutionStatus } from '$lib/types/agentic';

const originalConfig = { ...settingsStore.config };
const mcp = mcpStore as unknown as {
	commitConnection(id: string, connection?: MCPConnection): void;
	handleToolsListChanged(id: string, tools: MCPConnection['tools']): void;
	serverConfigs: Map<string, MCPServerConfig>;
};
const source: ProviderRequestContext = Object.freeze({
	providerId: 'llama-server',
	serverBaseUrl: 'https://synthetic.test',
	apiKey: '',
	sourceGeneration: 1
});
const builtin = {
	type: 'function' as const,
	function: { name: 'builtin_tool', parameters: { type: 'object' } }
};

const scope = (overrides?: Parameters<typeof mcpStore.createToolExecutionScope>[0]) =>
	mcpStore.createToolExecutionScope(overrides);
const tools = toolsStore;

beforeEach(async () => {
	settingsStore.updateMultipleConfig({
		apiProvider: source.providerId,
		serverBaseUrl: source.serverBaseUrl,
		apiKey: source.apiKey,
		mcpServers: JSON.stringify([{ id: 'mcp-B', enabled: true, url: 'https://mcp-b.test' }])
	});
	toolsStore.clear();
	vi.spyOn(ToolsService, 'list').mockResolvedValue([{ name: 'builtin_tool', definition: builtin }]);
	await toolsStore.fetchBuiltinTools(source);
	const server = mcpStore.getServerById('mcp-B')!;
	mcp.serverConfigs.set(server.id, buildMcpServerConfig(server)!);
	mcp.commitConnection(server.id, {
		serverName: server.id,
		tools: [{ name: 'foreign_mcp_tool', inputSchema: { type: 'object' } }]
	} as MCPConnection);
	vi.spyOn(MCPService, 'callTool').mockResolvedValue({ content: 'SYNTHETIC_ONLY', isError: false });
});

afterEach(() => {
	agenticStore.clearSession('scope-test');
	vi.restoreAllMocks();
	mcp.commitConnection('mcp-B');
	mcp.serverConfigs.clear();
	toolsStore.clear();
	permissionsStore.revokeTool('mcp-mcp-B:foreign_mcp_tool');
	settingsStore.config = { ...originalConfig };
});

describe('MCP conversation scope — real registry and resolution, synthetic final I/O', () => {
	it.each([
		{ label: 'undefined', overrides: undefined },
		{ label: 'empty array', overrides: [] },
		{ label: 'explicit false', overrides: [{ serverId: 'mcp-B', enabled: false }] }
	])('does not advertise B in builtin-only A with overrides $label', ({ overrides }) => {
		expect(
			tools.getEnabledToolEntriesForLLM(source, scope(overrides)).map((entry) => entry.apiName)
		).toEqual(['builtin_tool']);
		expect(mcpStore.getExistingConnection('mcp-B')).toBeDefined();
	});

	it.each([false, true])(
		'rejects direct foreign execution, remembered permission=%s',
		async (remembered) => {
			const entry = toolsStore.allTools.find((entry) => entry.apiName === 'foreign_mcp_tool')!;
			expect(entry.key).toBe('mcp-mcp-B:foreign_mcp_tool');
			if (remembered) permissionsStore.allowTool(entry.key);
			expect(permissionsStore.hasTool(entry.key)).toBe(remembered);
			await expect(tools.executeTool(entry, {}, source, undefined, scope([]))).rejects.toThrow(
				/scope|unavailable/i
			);
			expect(MCPService.callTool).not.toHaveBeenCalled();
		}
	);

	it('fails closed when the MCP execution scope is missing', async () => {
		const entry = toolsStore.allTools.find((entry) => entry.apiName === 'foreign_mcp_tool')!;
		await expect(tools.executeTool(entry, {}, source)).rejects.toThrow(/scope|unavailable/i);
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it('keeps B legal with its exact server identity', async () => {
		const executionScope = scope([{ serverId: 'mcp-B', enabled: true }]);
		const entry = tools
			.getEnabledToolEntriesForLLM(source, executionScope)
			.find((entry) => entry.serverId === 'mcp-B')!;
		await expect(tools.executeTool(entry, {}, source, undefined, executionScope)).resolves.toEqual({
			content: 'SYNTHETIC_ONLY',
			isError: false
		});
		expect(MCPService.callTool).toHaveBeenCalledTimes(1);
	});

	it('does not treat the global enabled flag as a per-chat grant or veto', () => {
		mcpStore.updateServer('mcp-B', { enabled: false });
		expect(scope().mcpServers).toEqual([]);
		expect(
			scope([{ serverId: 'mcp-B', enabled: true }]).mcpServers.map((server) => server.serverId)
		).toEqual(['mcp-B']);
	});

	it('resolves several independent overrides and freezes the snapshot, not the view', () => {
		mcpStore.addServer({ id: 'mcp-C', enabled: true, url: 'https://mcp-c.test' });
		const overrides = [
			{ serverId: 'mcp-B', enabled: true },
			{ serverId: 'mcp-C', enabled: false }
		];
		const captured = scope(overrides);
		overrides[0].enabled = false;
		overrides[1].enabled = true;
		expect(captured.mcpServers.map((server) => server.serverId)).toEqual(['mcp-B']);
		expect(scope(overrides).mcpServers.map((server) => server.serverId)).toEqual(['mcp-C']);
		expect(Object.isFrozen(captured)).toBe(true);
		expect(Object.isFrozen(captured.mcpServers)).toBe(true);
		expect(Object.isFrozen(captured.mcpServers[0])).toBe(true);
	});

	it.each(['url', 'headers', 'useProxy', 'removed', 'disconnected', 'reconnect', 'listChanged'])(
		'rejects the old identity after %s without dispatch',
		async (change) => {
			const captured = scope([{ serverId: 'mcp-B', enabled: true }]);
			const entry = tools
				.getEnabledToolEntriesForLLM(source, captured)
				.find((entry) => entry.serverId)!;
			if (change === 'removed') mcpStore.removeServer('mcp-B');
			else if (change === 'disconnected') mcp.commitConnection('mcp-B');
			else if (change === 'listChanged') {
				mcp.handleToolsListChanged('mcp-B', [
					{ name: 'foreign_mcp_tool', inputSchema: { type: 'object' }, description: 'changed' }
				]);
			} else if (change === 'reconnect') {
				mcp.commitConnection('mcp-B', { ...mcpStore.getExistingConnection('mcp-B')! });
			} else
				mcpStore.updateServer('mcp-B', {
					...(change === 'url' ? { url: 'https://replacement.test' } : {}),
					...(change === 'headers' ? { headers: '{"Authorization":"replacement"}' } : {}),
					...(change === 'useProxy' ? { useProxy: true } : {})
				});
			await expect(tools.executeTool(entry, {}, source, undefined, captured)).rejects.toThrow(
				/unavailable/i
			);
			expect(MCPService.callTool).not.toHaveBeenCalled();
		}
	);

	it('requires current transport configuration, not just a matching server ID', async () => {
		const captured = scope([{ serverId: 'mcp-B', enabled: true }]);
		const entry = toolsStore.allTools.find((entry) => entry.serverId)!;
		mcp.serverConfigs.delete('mcp-B');
		expect(
			tools.getEnabledToolEntriesForLLM(source, captured).map((entry) => entry.apiName)
		).toEqual(['builtin_tool']);
		await expect(tools.executeTool(entry, {}, source, undefined, captured)).rejects.toThrow(
			/scope/i
		);
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it('rejects forged source identity and never substitutes a same-name server', async () => {
		const captured = scope([{ serverId: 'mcp-B', enabled: true }]);
		const entry = toolsStore.allTools.find((entry) => entry.serverId)!;
		await expect(
			tools.executeTool({ ...entry, serverId: 'other-id' }, {}, source, undefined, captured)
		).rejects.toThrow(/unavailable/i);
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it('does not resolve a global name collision by selecting only the in-scope server', async () => {
		mcpStore.addServer({ id: 'mcp-C', enabled: true, url: 'https://mcp-c.test' });
		mcp.serverConfigs.set('mcp-C', buildMcpServerConfig(mcpStore.getServerById('mcp-C')!)!);
		mcp.commitConnection('mcp-C', {
			serverName: 'mcp-C',
			tools: [
				{
					name: 'foreign_mcp_tool',
					inputSchema: { type: 'object', properties: { other: { type: 'string' } } }
				}
			]
		} as MCPConnection);
		try {
			const captured = scope([{ serverId: 'mcp-B', enabled: true }]);
			expect(
				tools.getEnabledToolEntriesForLLM(source, captured).map((entry) => entry.apiName)
			).toEqual(['builtin_tool']);
			const entry = toolsStore.allTools.find((entry) => entry.serverId === 'mcp-B')!;
			await expect(tools.executeTool(entry, {}, source, undefined, captured)).rejects.toThrow(
				/conflict/i
			);
			expect(MCPService.callTool).not.toHaveBeenCalled();
		} finally {
			mcp.commitConnection('mcp-C');
		}
	});

	it('checks configuration again after session recovery before retrying transport I/O', async () => {
		const captured = scope([{ serverId: 'mcp-B', enabled: true }]);
		const entry = tools
			.getEnabledToolEntriesForLLM(source, captured)
			.find((entry) => entry.serverId)!;
		const expired = new Error('synthetic expired session');
		vi.mocked(MCPService.callTool).mockRejectedValueOnce(expired);
		vi.spyOn(MCPService, 'isSessionExpiredError').mockImplementation((error) => error === expired);
		vi.spyOn(MCPService, 'disconnect').mockResolvedValue();
		vi.spyOn(MCPService, 'connect').mockImplementation(async () => {
			mcpStore.updateServer('mcp-B', { url: 'https://replacement.test' });
			return {
				serverName: 'mcp-B',
				tools: [{ name: 'foreign_mcp_tool', inputSchema: { type: 'object' } }]
			} as MCPConnection;
		});
		await expect(tools.executeTool(entry, {}, source, undefined, captured)).rejects.toThrow(
			/unavailable after reconnect/i
		);
		expect(MCPService.callTool).toHaveBeenCalledTimes(1);
	});

	it('keeps builtin execution legal without MCP scope', async () => {
		const execute = vi
			.spyOn(ToolsService, 'executeTool')
			.mockResolvedValue({ content: 'BUILTIN_ONLY', isError: false });
		const entry = tools.getEnabledToolEntriesForLLM(source, scope([]))[0];
		await expect(tools.executeTool(entry, {}, source, undefined, scope([]))).resolves.toEqual({
			content: 'BUILTIN_ONLY',
			isError: false
		});
		expect(execute).toHaveBeenCalledTimes(1);
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it.each(['openai-compatible', 'vllm'] as const)(
		'uses the same scope boundary for %s MCP',
		async (providerId) => {
			settingsStore.updateConfig('apiProvider', providerId);
			toolsStore.clear();
			const context = ChatService.createProviderRequestContext();
			const allowed = scope([{ serverId: 'mcp-B', enabled: true }]);
			expect(tools.getEnabledToolEntriesForLLM(context, scope([]))).toEqual([]);
			const entry = tools.getEnabledToolEntriesForLLM(context, allowed)[0];
			expect(entry.key).toBe('mcp-mcp-B:foreign_mcp_tool');
			await expect(tools.executeTool(entry, {}, context, undefined, allowed)).resolves.toEqual({
				content: 'SYNTHETIC_ONLY',
				isError: false
			});
		}
	);
});

function startFlow(
	overrides = [{ serverId: 'mcp-B', enabled: true }],
	extras: Partial<AgenticFlowCallbacks> = {},
	signal?: AbortSignal
) {
	const states: ToolExecutionStatus[] = [];
	const advertised: string[][] = [];
	vi.spyOn(mcpStore, 'ensureInitialized').mockResolvedValue(true);
	vi.spyOn(ChatService, 'isProviderRequestContextCurrent').mockReturnValue(true);
	vi.spyOn(ChatService, 'sendMessage').mockImplementation(async (_history, options) => {
		advertised.push((options?.tools ?? []).map((tool) => tool.function.name));
		if (advertised.length === 1)
			options?.onToolCallChunk?.(
				JSON.stringify([
					{
						id: 'scope-call',
						type: 'function',
						function: { name: 'foreign_mcp_tool', arguments: '{}' }
					}
				])
			);
	});
	const result = agenticStore.runAgenticFlow({
		conversationId: 'scope-test',
		messages: [{ role: 'user', content: 'synthetic' }],
		perChatOverrides: overrides,
		signal,
		options: {
			assistantMessageId: 'assistant',
			operationId: 'operation',
			providerRequestContext: source
		},
		callbacks: {
			onFlowStart: async () => {},
			onAssistantTurnComplete: async () => {},
			onToolCallState: async (_identity, _id, outcome) => {
				states.push(outcome.status);
				return undefined;
			},
			onFlowComplete: async () => {},
			...extras
		}
	});
	return { states, advertised, result };
}

describe('scope through the real agent loop and permission decisions', () => {
	it('captures scope and overrides before builtin discovery awaits', async () => {
		toolsStore.clear();
		let resolve!: (value: Awaited<ReturnType<typeof ToolsService.list>>) => void;
		vi.mocked(ToolsService.list).mockReturnValue(
			new Promise((done) => {
				resolve = done;
			})
		);
		permissionsStore.allowTool('mcp-mcp-B:foreign_mcp_tool');
		const overrides = [{ serverId: 'mcp-B', enabled: true }];
		const flow = startFlow(overrides);
		overrides[0].enabled = false;
		resolve([{ name: 'builtin_tool', definition: builtin }]);
		await flow.result;
		expect(mcpStore.ensureInitialized).toHaveBeenCalledWith([{ serverId: 'mcp-B', enabled: true }]);
		expect(flow.advertised[0]).toEqual(['builtin_tool', 'foreign_mcp_tool']);
		expect(MCPService.callTool).toHaveBeenCalledTimes(1);
	});

	it('does not ask permission or execute a registry-only foreign call in A', async () => {
		permissionsStore.allowTool('mcp-mcp-B:foreign_mcp_tool');
		const permission = vi.spyOn(permissionsStore, 'hasTool');
		const flow = startFlow([]);
		expect((await flow.result).error?.message).toMatch(/scope/i);
		expect(flow.advertised).toEqual([['builtin_tool']]);
		expect(flow.states).toEqual(['error']);
		expect(permission).not.toHaveBeenCalled();
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it.each([ToolPermissionDecision.ONCE, ToolPermissionDecision.DENY])(
		'respects permission %s separately from scope',
		async (decision) => {
			const flow = startFlow();
			await vi.waitFor(() =>
				expect(agenticStore.pendingPermissionRequest('scope-test')).not.toBeNull()
			);
			expect(MCPService.callTool).not.toHaveBeenCalled();
			agenticStore.resolvePermission('scope-test', decision);
			expect((await flow.result).error).toBeUndefined();
			expect(flow.states).toEqual(
				decision === ToolPermissionDecision.DENY ? ['denied'] : ['started', 'completed']
			);
			expect(MCPService.callTool).toHaveBeenCalledTimes(
				decision === ToolPermissionDecision.DENY ? 0 : 1
			);
		}
	);

	it('rechecks current connection configuration after permission', async () => {
		const flow = startFlow();
		await vi.waitFor(() =>
			expect(agenticStore.pendingPermissionRequest('scope-test')).not.toBeNull()
		);
		mcpStore.updateServer('mcp-B', { url: 'https://replacement.test' });
		agenticStore.resolvePermission('scope-test', ToolPermissionDecision.ONCE);
		await flow.result;
		expect(flow.states).toEqual(['error']);
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it('marks a local refusal after durable started as error, never unknown or output', async () => {
		permissionsStore.allowTool('mcp-mcp-B:foreign_mcp_tool');
		const states: ToolExecutionStatus[] = [];
		const flow = startFlow(undefined, {
			onToolCallState: async (_identity, _id, outcome) => {
				states.push(outcome.status);
				if (outcome.status === 'started') mcpStore.removeServer('mcp-B');
				expect(outcome.result).toBeUndefined();
				return undefined;
			}
		});
		await flow.result;
		expect(states).toEqual(['started', 'error']);
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it('retains the override snapshot while approval waits, including the next turn', async () => {
		const overrides = [{ serverId: 'mcp-B', enabled: true }];
		const flow = startFlow(overrides);
		await vi.waitFor(() =>
			expect(agenticStore.pendingPermissionRequest('scope-test')).not.toBeNull()
		);
		overrides[0].enabled = false;
		agenticStore.resolvePermission('scope-test', ToolPermissionDecision.ONCE);
		await flow.result;
		expect(flow.advertised).toEqual([
			['builtin_tool', 'foreign_mcp_tool'],
			['builtin_tool', 'foreign_mcp_tool']
		]);
		expect(flow.states).toEqual(['started', 'completed']);
	});

	it('Stop during permission dispatches nothing', async () => {
		const controller = new AbortController();
		const flow = startFlow(undefined, {}, controller.signal);
		await vi.waitFor(() =>
			expect(agenticStore.pendingPermissionRequest('scope-test')).not.toBeNull()
		);
		controller.abort();
		await flow.result;
		expect(flow.states).toEqual([]);
		expect(agenticStore.pendingPermissionRequest('scope-test')).toBeNull();
		expect(agenticStore.getSession('scope-test').terminalReason).toBe('stopped');
		expect(MCPService.callTool).not.toHaveBeenCalled();
	});

	it('revoking remembered permission affects the next decision, not an already issued approval', async () => {
		permissionsStore.allowTool('mcp-mcp-B:foreign_mcp_tool');
		const first = startFlow(undefined, {
			onToolCallState: async (_identity, _id, outcome) => {
				if (outcome.status === 'started') permissionsStore.revokeTool('mcp-mcp-B:foreign_mcp_tool');
				return undefined;
			}
		});
		await first.result;
		expect(MCPService.callTool).toHaveBeenCalledTimes(1);
		const second = startFlow();
		await vi.waitFor(() =>
			expect(agenticStore.pendingPermissionRequest('scope-test')).not.toBeNull()
		);
		agenticStore.resolvePermission('scope-test', ToolPermissionDecision.DENY);
		await second.result;
		expect(MCPService.callTool).toHaveBeenCalledTimes(1);
		expect(second.states).toEqual(['denied']);
	});
});
