import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client';
import { MCPService } from '$lib/services/mcp.service';
import { MCPConnectionPhase, MCPTransportType } from '$lib/enums';
import type { MCPConnectionLog, MCPServerConfig } from '$lib/types';

type DiagnosticFetchFactory = (
	serverName: string,
	config: MCPServerConfig,
	baseInit: RequestInit,
	targetUrl: URL,
	useProxy: boolean,
	onLog?: (log: MCPConnectionLog) => void
) => { fetch: typeof fetch; disable: () => void };

const createDiagnosticFetch = (
	config: MCPServerConfig,
	onLog?: (log: MCPConnectionLog) => void,
	baseInit: RequestInit = {}
) =>
	(
		MCPService as unknown as { createDiagnosticFetch: DiagnosticFetchFactory }
	).createDiagnosticFetch('test-server', config, baseInit, new URL(config.url), false, onLog);

describe('MCPService', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('uses the SDK HTTP handshake, session headers, tool calls and transport shutdown', async () => {
		const requests: Array<{ method: string; headers: Headers; body?: Record<string, unknown> }> =
			[];
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			const headers = new Headers(init?.headers);
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
			requests.push({ method, headers, body });

			if (method === 'GET') return new Response(null, { status: 405 });
			if (body?.id === undefined) return new Response(null, { status: 202 });

			const result =
				body.method === 'initialize'
					? {
							protocolVersion: '2025-11-25',
							capabilities: { tools: {} },
							serverInfo: { name: 'test-server', version: '1.0.0' }
						}
					: body.method === 'tools/list'
						? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
						: { content: [{ type: 'text', text: 'echo result' }] };

			return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
				headers: { 'content-type': 'application/json', 'mcp-session-id': 'test-session' }
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const connection = await MCPService.connect('test-server', {
			url: 'https://example.com/mcp',
			transport: MCPTransportType.STREAMABLE_HTTP,
			headers: { authorization: 'Bearer configured-token' },
			credentials: 'omit'
		});
		const closeSpy = vi.spyOn(connection.transport, 'close');

		try {
			expect(connection.tools.map((tool) => tool.name)).toEqual(['echo']);
			expect(connection.serverInfo?.name).toBe('test-server');
			await expect(
				MCPService.callTool(connection, { name: 'echo', arguments: {} })
			).resolves.toEqual({ content: 'echo result', isError: false });
		} finally {
			await MCPService.disconnect(connection);
		}

		expect(
			requests.filter((request) => request.body).map((request) => request.body?.method)
		).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
		expect(requests[0].headers.has('mcp-session-id')).toBe(false);
		expect(
			requests.slice(1).every((request) => request.headers.get('mcp-session-id') === 'test-session')
		).toBe(true);
		expect(
			requests.every(
				(request) => request.headers.get('authorization') === 'Bearer configured-token'
			)
		).toBe(true);
		expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
		expect(closeSpy).toHaveBeenCalled();
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});

	it('closes the real SDK transport when initialization is aborted', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const controller = new AbortController();
		const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			if (
				typeof init?.body === 'string' &&
				JSON.parse(init.body).method === 'notifications/cancelled'
			) {
				return Promise.resolve(new Response(null, { status: 202 }));
			}
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
				controller.abort();
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			MCPService.connect(
				'test-server',
				{ url: 'https://example.com/mcp', transport: MCPTransportType.STREAMABLE_HTTP },
				undefined,
				undefined,
				undefined,
				undefined,
				controller.signal
			)
		).rejects.toThrow('AbortError');
		expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string).method)).toEqual(
			['initialize', 'notifications/cancelled']
		);
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});

	it('stops transport phase logging after handshake diagnostics are disabled', async () => {
		const logs: MCPConnectionLog[] = [];
		const response = new Response('{}', {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

		const config: MCPServerConfig = {
			url: 'https://example.com/mcp',
			transport: MCPTransportType.STREAMABLE_HTTP
		};

		const controller = createDiagnosticFetch(config, (log) => logs.push(log));

		await controller.fetch(config.url, { method: 'POST', body: '{}' });
		expect(logs).toHaveLength(2);
		expect(logs.every((log) => log.message.includes('https://example.com/mcp'))).toBe(true);

		controller.disable();
		await controller.fetch(config.url, { method: 'POST', body: '{}' });

		expect(logs).toHaveLength(2);
	});

	it('redacts all configured custom headers in diagnostic request logs', async () => {
		const logs: MCPConnectionLog[] = [];
		const response = new Response('{}', {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

		const config: MCPServerConfig = {
			url: 'https://example.com/mcp',
			transport: MCPTransportType.STREAMABLE_HTTP,
			headers: {
				'x-auth-token': 'secret-token',
				'x-vendor-api-key': 'secret-key'
			}
		};

		const controller = createDiagnosticFetch(config, (log) => logs.push(log), {
			headers: config.headers
		});

		await controller.fetch(config.url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});

		expect(logs).toHaveLength(2);
		expect(logs[0].details).toMatchObject({
			request: {
				headers: {
					'x-auth-token': '[redacted]',
					'x-vendor-api-key': '[redacted]',
					'content-type': 'application/json'
				}
			}
		});
	});

	it('partially redacts mcp-session-id in diagnostic request and response logs', async () => {
		const logs: MCPConnectionLog[] = [];
		const response = new Response('{}', {
			status: 200,
			headers: {
				'content-type': 'application/json',
				'mcp-session-id': 'session-response-67890'
			}
		});

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

		const config: MCPServerConfig = {
			url: 'https://example.com/mcp',
			transport: MCPTransportType.STREAMABLE_HTTP
		};

		const controller = createDiagnosticFetch(config, (log) => logs.push(log));

		await controller.fetch(config.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'mcp-session-id': 'session-request-12345'
			},
			body: '{}'
		});

		expect(logs).toHaveLength(2);
		expect(logs[0].details).toMatchObject({
			request: {
				headers: {
					'content-type': 'application/json',
					'mcp-session-id': '....12345'
				}
			}
		});
		expect(logs[1].details).toMatchObject({
			response: {
				headers: {
					'content-type': 'application/json',
					'mcp-session-id': '....67890'
				}
			}
		});
	});

	it('extracts JSON-RPC methods without logging the raw request body', async () => {
		const logs: MCPConnectionLog[] = [];
		const response = new Response('{}', {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

		const config: MCPServerConfig = {
			url: 'https://example.com/mcp',
			transport: MCPTransportType.STREAMABLE_HTTP
		};

		const controller = createDiagnosticFetch(config, (log) => logs.push(log));

		await controller.fetch(config.url, {
			method: 'POST',
			body: JSON.stringify([
				{ jsonrpc: '2.0', id: 1, method: 'initialize' },
				{ jsonrpc: '2.0', method: 'notifications/initialized' }
			])
		});

		expect(logs[0].details).toMatchObject({
			request: {
				method: 'POST',
				body: {
					kind: 'string',
					size: expect.any(Number)
				},
				jsonRpcMethods: ['initialize', 'notifications/initialized']
			}
		});
	});

	it('adds a CORS hint to Failed to fetch diagnostic log messages', async () => {
		const logs: MCPConnectionLog[] = [];
		const fetchError = new TypeError('Failed to fetch');

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(fetchError));

		const config: MCPServerConfig = {
			url: 'http://localhost:8000/mcp',
			transport: MCPTransportType.STREAMABLE_HTTP
		};

		const controller = createDiagnosticFetch(config, (log) => logs.push(log));

		await expect(controller.fetch(config.url, { method: 'POST', body: '{}' })).rejects.toThrow(
			'Failed to fetch'
		);

		expect(logs).toHaveLength(2);
		expect(logs[1].message).toBe(
			'HTTP POST http://localhost:8000/mcp failed: Failed to fetch (check CORS?)'
		);
	});

	it('detaches phase error logging after the initialize handshake completes', async () => {
		const phaseLogs: Array<{ phase: MCPConnectionPhase; log: MCPConnectionLog }> = [];
		const stopPhaseLogging = vi.fn();
		let emitClientError: ((error: Error) => void) | undefined;

		vi.spyOn(MCPService, 'createTransport').mockReturnValue({
			transport: {} as never,
			type: MCPTransportType.WEBSOCKET,
			stopPhaseLogging
		});
		vi.spyOn(MCPService, 'listTools').mockResolvedValue([]);
		vi.spyOn(Client.prototype, 'getServerVersion').mockReturnValue(undefined);
		vi.spyOn(Client.prototype, 'getServerCapabilities').mockReturnValue(undefined);
		vi.spyOn(Client.prototype, 'getInstructions').mockReturnValue(undefined);
		vi.spyOn(Client.prototype, 'connect').mockImplementation(async function (this: Client) {
			emitClientError = (error: Error) => this.onerror?.(error);
			this.onerror?.(new Error('handshake protocol error'));
		});

		await MCPService.connect(
			'test-server',
			{
				url: 'ws://example.com/mcp',
				transport: MCPTransportType.WEBSOCKET
			},
			undefined,
			undefined,
			(phase, log) => phaseLogs.push({ phase, log })
		);

		expect(stopPhaseLogging).toHaveBeenCalledTimes(1);
		expect(
			phaseLogs.filter(
				({ phase, log }) =>
					phase === MCPConnectionPhase.ERROR &&
					log.message === 'Protocol error: handshake protocol error'
			)
		).toHaveLength(1);

		const expectedRuntimeError = new Error('runtime protocol error');
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		try {
			emitClientError?.(expectedRuntimeError);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				'[MCPService][test-server] Protocol error after initialize:',
				expectedRuntimeError
			);
		} finally {
			consoleErrorSpy.mockRestore();
		}

		expect(
			phaseLogs.filter(
				({ phase, log }) =>
					phase === MCPConnectionPhase.ERROR &&
					log.message === 'Protocol error: runtime protocol error'
			)
		).toHaveLength(0);
	});
});
