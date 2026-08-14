import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildMcpClientConfig,
	buildMcpServerConfig,
	parseMcpHeaders,
	parseMcpServerSettings
} from '$lib/utils/mcp-config';
import { DEFAULT_MCP_CONFIG } from '$lib/constants';

describe('MCP config parsing', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('does not log raw header secrets when JSON is invalid', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const rawHeaders = '{"Authorization":"Bearer SECRET-123"';

		expect(parseMcpHeaders(rawHeaders)).toBeUndefined();
		expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('Bearer SECRET-123');
		expect(warnSpy).toHaveBeenCalledWith(
			'[MCP] Invalid custom headers JSON/header map; ignoring headers'
		);
	});

	it('keeps a server entry but ignores headers with a non-string value', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const rawHeaders = JSON.stringify({
			Authorization: 'Bearer SECRET-123',
			'x-retry-count': 3
		});
		const [entry] = parseMcpServerSettings([
			{ id: 'server', enabled: true, url: ' https://example.com/mcp ', headers: rawHeaders }
		]);

		expect(entry).toMatchObject({
			id: 'server',
			url: 'https://example.com/mcp',
			headers: rawHeaders
		});
		expect(buildMcpServerConfig(entry)?.headers).toBeUndefined();
		expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('Bearer SECRET-123');
	});

	it('uses the same normalized entries for JSON and object config paths', () => {
		const rawServers = [
			{
				id: ' server-a ',
				enabled: true,
				url: ' https://example.com/mcp ',
				name: 'Example',
				headers: '{"Authorization":"Bearer token"}',
				useProxy: true
			}
		];
		const fromArray = parseMcpServerSettings(rawServers);
		const fromJson = parseMcpServerSettings(JSON.stringify(rawServers));

		expect(fromJson).toEqual(fromArray);
		expect(buildMcpClientConfig(fromJson, () => true)).toEqual({
			protocolVersion: DEFAULT_MCP_CONFIG.protocolVersion,
			capabilities: DEFAULT_MCP_CONFIG.capabilities,
			clientInfo: DEFAULT_MCP_CONFIG.clientInfo,
			requestTimeoutMs: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000,
			servers: {
				'server-a': {
					url: 'https://example.com/mcp',
					transport: 'streamable_http',
					handshakeTimeoutMs: DEFAULT_MCP_CONFIG.connectionTimeoutMs,
					requestTimeoutMs: DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000,
					headers: { Authorization: 'Bearer token' },
					useProxy: true
				}
			}
		});
	});
});
