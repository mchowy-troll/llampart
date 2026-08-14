import { z } from 'zod';
import { DEFAULT_MCP_CONFIG, MCP_SERVER_ID_PREFIX } from '$lib/constants';
import { MCPTransportType, UrlProtocol } from '$lib/enums';
import type { MCPClientConfig, MCPServerConfig, MCPServerSettingsEntry } from '$lib/types';

const mcpHeadersSchema = z.record(z.string(), z.string());
const mcpServerEntrySchema = z.preprocess(
	(value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}),
	z.object({
		id: z.unknown().optional(),
		enabled: z.unknown().optional(),
		url: z.unknown().optional(),
		name: z.unknown().optional(),
		headers: z.unknown().optional(),
		useProxy: z.unknown().optional()
	})
);
const mcpServersSchema = z.array(z.unknown());

export function detectMcpTransportFromUrl(url: string): MCPTransportType {
	const normalized = url.trim().toLowerCase();

	return normalized.startsWith(UrlProtocol.WEBSOCKET) ||
		normalized.startsWith(UrlProtocol.WEBSOCKET_SECURE)
		? MCPTransportType.WEBSOCKET
		: MCPTransportType.STREAMABLE_HTTP;
}

export function parseMcpHeaders(headersJson?: string): Record<string, string> | undefined {
	if (!headersJson?.trim()) return undefined;

	try {
		const result = mcpHeadersSchema.safeParse(JSON.parse(headersJson));
		if (result.success) return result.data;
	} catch {
		// Report only the invalid field, never the raw value because it can contain credentials.
	}

	console.warn('[MCP] Invalid custom headers JSON/header map; ignoring headers');
	return undefined;
}

export function parseMcpServerSettings(rawServers: unknown): MCPServerSettingsEntry[] {
	if (!rawServers) return [];

	let parsed: unknown;
	if (typeof rawServers === 'string') {
		const trimmed = rawServers.trim();
		if (!trimmed) return [];

		try {
			parsed = JSON.parse(trimmed);
		} catch {
			console.warn('[MCP] Invalid mcpServers JSON; ignoring value');
			return [];
		}
	} else {
		parsed = rawServers;
	}

	const serversResult = mcpServersSchema.safeParse(parsed);
	if (!serversResult.success) return [];

	return serversResult.data.map((rawEntry, index) => {
		const entry = mcpServerEntrySchema.parse(rawEntry);
		const id =
			typeof entry.id === 'string' && entry.id.trim()
				? entry.id.trim()
				: `${MCP_SERVER_ID_PREFIX}-${index + 1}`;
		const url = typeof entry.url === 'string' ? entry.url.trim() : '';
		const headers = typeof entry.headers === 'string' ? entry.headers.trim() : undefined;

		return {
			id,
			enabled: Boolean(entry.enabled),
			url,
			name: typeof entry.name === 'string' ? entry.name : undefined,
			requestTimeoutSeconds: DEFAULT_MCP_CONFIG.requestTimeoutSeconds,
			headers: headers || undefined,
			useProxy: Boolean(entry.useProxy)
		};
	});
}

export function buildMcpServerConfig(
	entry: MCPServerSettingsEntry,
	connectionTimeoutMs = DEFAULT_MCP_CONFIG.connectionTimeoutMs
): MCPServerConfig | undefined {
	if (!entry.url) return undefined;

	return {
		url: entry.url,
		transport: detectMcpTransportFromUrl(entry.url),
		handshakeTimeoutMs: connectionTimeoutMs,
		requestTimeoutMs: Math.round(entry.requestTimeoutSeconds * 1000),
		headers: parseMcpHeaders(entry.headers),
		useProxy: entry.useProxy
	};
}

export function buildMcpClientConfig(
	entries: MCPServerSettingsEntry[],
	isEnabled: (entry: MCPServerSettingsEntry) => boolean
): MCPClientConfig | undefined {
	const servers: Record<string, MCPServerConfig> = {};

	for (const entry of entries) {
		if (!isEnabled(entry)) continue;
		const server = buildMcpServerConfig(entry);
		if (server) servers[entry.id] = server;
	}

	if (Object.keys(servers).length === 0) return undefined;

	return {
		protocolVersion: DEFAULT_MCP_CONFIG.protocolVersion,
		capabilities: DEFAULT_MCP_CONFIG.capabilities,
		clientInfo: DEFAULT_MCP_CONFIG.clientInfo,
		requestTimeoutMs: Math.round(DEFAULT_MCP_CONFIG.requestTimeoutSeconds * 1000),
		servers
	};
}
