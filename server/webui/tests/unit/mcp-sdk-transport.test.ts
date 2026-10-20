import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client';
import {
	exchangeAuthorization,
	refreshAuthorization,
	registerClient
} from '@modelcontextprotocol/sdk/client/auth.js';
import { MCPService } from '$lib/services/mcp.service';
import { MCPTransportType } from '$lib/enums';

// Real loopback HTTP, not a fetch mock: a second origin records any leaked request.
const secretHeaders = { authorization: 'Bearer synthetic-token', 'x-api-key': 'synthetic-key' };
const message = {
	jsonrpc: '2.0' as const,
	id: 1,
	method: 'tools/call',
	params: { secret: 'body' }
};
let servers: Server[];
let origin: string;
let receiver: string;
let received: string[];
let sent: Array<{ path: string; body: string; headers: IncomingMessage['headers'] }>;
let stream: ServerResponse | undefined;

async function listen(server: Server): Promise<string> {
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing loopback port');
	return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
	servers = [];
	received = [];
	sent = [];
	stream = undefined;
	receiver = await listen(
		createServer((req, res) => {
			received.push(req.url ?? '');
			res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
		})
	);
	origin = await listen(
		createServer(async (req, res) => {
			let body = '';
			for await (const chunk of req) body += chunk;
			const path = req.url ?? '/';
			sent.push({ path, body, headers: req.headers });
			if (path.startsWith('/redirect/')) {
				res.writeHead(Number(path.split('/').at(-1)), { location: `${receiver}/leak` }).end();
				return;
			}
			if (path === '/same') {
				res.writeHead(307, { location: '/rpc' }).end();
				return;
			}
			if (path.startsWith('/sse')) {
				stream = res;
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(`event: endpoint\ndata: ${path.slice(4) || '/messages'}\n\n`);
				return;
			}
			if (path === '/resume' && req.method === 'GET') {
				stream = res;
				res.writeHead(200, { 'content-type': 'text/event-stream' });
				res.write(
					'event: message\nid: replay-2\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n'
				);
				return;
			}
			if (req.method === 'DELETE') {
				res.writeHead(204).end();
				return;
			}
			if (req.method === 'GET') {
				res.writeHead(405).end();
				return;
			}
			if (path === '/token') {
				res
					.writeHead(200, { 'content-type': 'application/json' })
					.end(JSON.stringify({ access_token: 'new-token', token_type: 'Bearer' }));
				return;
			}
			const rpc = JSON.parse(body);
			if (rpc.id === undefined) {
				res.writeHead(202).end();
				return;
			}
			const result =
				rpc.method === 'initialize'
					? {
							protocolVersion: '2025-11-25',
							capabilities: { tools: {} },
							serverInfo: { name: 'loopback', version: '1.0.0' }
						}
					: rpc.method === 'tools/list'
						? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
						: { content: [{ type: 'text', text: 'echo result' }] };
			const response = JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result });
			if (path === '/messages') {
				stream?.write(`event: message\ndata: ${response}\n\n`);
				res.writeHead(202).end();
			} else {
				res
					.writeHead(200, {
						'content-type': 'application/json',
						'mcp-session-id': 'loopback-session'
					})
					.end(response);
			}
		})
	);
});

afterEach(async () => {
	stream?.end();
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.close((error) => (error ? reject(error) : resolve()));
					server.closeAllConnections();
				})
		)
	);
});

describe('installed MCP SDK redirect boundaries', () => {
	for (const status of [301, 302, 303, 307, 308]) {
		it.each(['http-post', 'http-get', 'http-delete', 'sse-get', 'sse-post'])(
			`blocks cross-origin ${status} for %s without sending headers or body`,
			async (kind) => {
				const path = `/redirect/${status}`;
				const transport = kind.startsWith('http-')
					? new StreamableHTTPClientTransport(new URL(origin + path), {
							requestInit: { headers: secretHeaders },
							sessionId: 'synthetic-session'
						})
					: new SSEClientTransport(new URL(origin + (kind === 'sse-post' ? '/sse' : '') + path), {
							requestInit: { headers: secretHeaders }
						});
				try {
					if (kind === 'sse-get') await expect(transport.start()).rejects.toThrow(/redirect/i);
					else {
						await transport.start();
						const request =
							transport instanceof StreamableHTTPClientTransport && kind === 'http-get'
								? transport.resumeStream('synthetic-event')
								: transport instanceof StreamableHTTPClientTransport && kind === 'http-delete'
									? transport.terminateSession()
									: transport.send(message);
						await expect(request).rejects.toThrow(/redirect/i);
					}
					expect(received).toEqual([]);
					const request = sent.find((request) => request.path === path)!;
					expect(request.headers['x-api-key']).toBe('synthetic-key');
					expect(request.headers.authorization).toBe('Bearer synthetic-token');
					if (kind === 'http-post' || kind === 'sse-post')
						expect(JSON.parse(request.body)).toEqual(message);
				} finally {
					await transport.close();
				}
			}
		);

		it.each(['exchange', 'refresh', 'register'])(
			`blocks cross-origin OAuth ${status} for %s`,
			async (operation) => {
				const endpoint = `${origin}/redirect/${status}`;
				const metadata = {
					issuer: origin,
					authorization_endpoint: `${origin}/authorize`,
					token_endpoint: endpoint,
					registration_endpoint: endpoint,
					response_types_supported: ['code']
				};
				const clientInformation = { client_id: 'client', client_secret: 'synthetic-secret' };
				const fetchFn: typeof fetch = (url, init) =>
					fetch(url, {
						...init,
						headers: { ...Object.fromEntries(new Headers(init?.headers)), ...secretHeaders }
					});
				const request =
					operation === 'exchange'
						? exchangeAuthorization(origin, {
								metadata,
								clientInformation,
								authorizationCode: 'synthetic-code',
								codeVerifier: 'synthetic-verifier',
								redirectUri: `${origin}/callback`,
								fetchFn
							})
						: operation === 'refresh'
							? refreshAuthorization(origin, {
									metadata,
									clientInformation,
									refreshToken: 'synthetic-refresh',
									fetchFn
								})
							: registerClient(origin, {
									metadata,
									clientMetadata: { redirect_uris: [`${origin}/callback`] },
									fetchFn
								});
				await expect(request).rejects.toThrow(/redirect/i);
				expect(received).toEqual([]);
				expect(sent).toHaveLength(1);
				expect(sent[0].headers['x-api-key']).toBe('synthetic-key');
				expect(sent[0].body.length).toBeGreaterThan(0);
			}
		);
	}

	it('replays Last-Event-ID on the same-origin SDK stream and terminates the session', async () => {
		const transport = new StreamableHTTPClientTransport(new URL(origin + '/resume'), {
			requestInit: { headers: secretHeaders },
			sessionId: 'synthetic-session'
		});
		const receivedMessage = new Promise<unknown>((resolve) => {
			transport.onmessage = resolve;
		});
		try {
			await transport.start();
			await transport.resumeStream('replay-1');
			await expect(receivedMessage).resolves.toMatchObject({ method: 'notifications/message' });
			expect(sent[0].headers['last-event-id']).toBe('replay-1');
			expect(sent[0].headers['mcp-session-id']).toBe('synthetic-session');
			await transport.terminateSession();
			expect(transport.sessionId).toBeUndefined();
			expect(sent.at(-1)?.headers['mcp-session-id']).toBe('synthetic-session');
			expect(received).toEqual([]);
		} finally {
			await transport.close();
		}
	});

	it('still allows OAuth refresh without a redirect', async () => {
		await expect(
			refreshAuthorization(origin, {
				metadata: {
					issuer: origin,
					authorization_endpoint: `${origin}/authorize`,
					token_endpoint: `${origin}/token`,
					response_types_supported: ['code']
				},
				clientInformation: { client_id: 'client' },
				refreshToken: 'synthetic-refresh'
			})
		).resolves.toMatchObject({ access_token: 'new-token' });
		expect(sent[0].body).toContain('synthetic-refresh');
	});

	it.each([
		[MCPTransportType.STREAMABLE_HTTP, '/rpc'],
		[MCPTransportType.STREAMABLE_HTTP, '/same'],
		[MCPTransportType.SSE, '/sse']
	])('keeps SDK/app %s handshake, headers, tools and shutdown at %s', async (transport, path) => {
		if (transport === MCPTransportType.SSE) {
			// The app currently selects HTTP first; exercise legacy SSE explicitly through
			// its real diagnostic fetch wrapper, without changing transport selection.
			const config = { url: origin + path, headers: secretHeaders };
			const factory = MCPService as unknown as {
				createDiagnosticFetch(
					name: string,
					serverConfig: typeof config,
					init: RequestInit,
					url: URL,
					proxy: boolean
				): { fetch: typeof fetch };
			};
			const wrapper = factory.createDiagnosticFetch(
				'loopback',
				config,
				{ headers: secretHeaders, credentials: 'omit' },
				new URL(config.url),
				false
			);
			const client = new Client({ name: 'loopback-client', version: '1.0.0' });
			try {
				await client.connect(
					new SSEClientTransport(new URL(config.url), {
						requestInit: { headers: secretHeaders },
						fetch: wrapper.fetch,
						eventSourceInit: { fetch: wrapper.fetch }
					})
				);
				expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['echo']);
				expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
					content: [{ type: 'text', text: 'echo result' }]
				});
				expect(sent.every((request) => request.headers['x-api-key'] === 'synthetic-key')).toBe(
					true
				);
				expect(received).toEqual([]);
			} finally {
				await client.close();
			}
			return;
		}
		const connection = await MCPService.connect('loopback', {
			url: origin + path,
			transport,
			headers: secretHeaders,
			credentials: 'omit'
		});
		try {
			expect(connection.tools.map((tool) => tool.name)).toEqual(['echo']);
			await expect(
				MCPService.callTool(connection, { name: 'echo', arguments: {} })
			).resolves.toEqual({
				content: 'echo result',
				isError: false
			});
			expect(sent.every((request) => request.headers['x-api-key'] === 'synthetic-key')).toBe(true);
			expect(received).toEqual([]);
		} finally {
			await MCPService.disconnect(connection);
		}
	});
});
