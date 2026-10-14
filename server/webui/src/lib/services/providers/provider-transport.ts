/** Stateless same-origin transport. Destination DNS/IP policy is intentionally
 * outside this trusted-LAN gateway's scope; this is not an SSRF firewall. */
export type GatewayProviderId = 'llama-server' | 'openai-compatible' | 'vllm';

/** Standard local default; a blank UI address selects the gateway's environment
 * default, not a browser-owned concrete target. Caddy preserves its installer target. */
export const DEFAULT_LLAMA_SERVER_BASE_URL = 'http://127.0.0.1:8080';

export interface GatewaySource {
	baseUrl: string;
	scheme: 'http' | 'https';
	host: string;
	port: string;
	prefix: string;
}

function hasControl(value: string, includeSpace = false): boolean {
	return [...value].some(
		(character) =>
			character.charCodeAt(0) <= (includeSpace ? 32 : 31) || character.charCodeAt(0) === 127
	);
}

export function normalizeGatewaySource(
	provider: GatewayProviderId,
	value: string,
	stripVersionPrefix = true
): GatewaySource {
	if (!['llama-server', 'openai-compatible', 'vllm'].includes(provider))
		throw new Error('Unknown gateway provider');
	if (hasControl(value) || value.includes('\\')) throw new Error('Invalid server address');
	const source = value.trim();
	if (!source) {
		if (provider !== 'llama-server') throw new Error('This provider requires a server address');
		// Both gateways resolve this sentinel using their own configured default.
		return { baseUrl: '', scheme: 'http', host: '-', port: '0', prefix: '-' };
	}
	const match = /^(https?):\/\/([^/?#]+)([^?#]*)$/i.exec(source);
	if (!match || /\s/.test(source))
		throw new Error(
			'Server address must be an absolute HTTP or HTTPS URL without query or fragment'
		);
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		throw new Error('Invalid server address');
	}
	if (url.username || url.password || match[2].includes('@'))
		throw new Error('Server address cannot contain credentials');
	const rawHost = match[2].startsWith('[')
		? match[2].slice(0, match[2].indexOf(']') + 1)
		: match[2].split(':')[0];
	const rawPort = match[2].slice(rawHost.length);
	if (rawPort && (!/^:[1-9][0-9]{0,4}$/.test(rawPort) || Number(rawPort.slice(1)) > 65535))
		throw new Error('Invalid upstream port');
	// Reject abbreviated/octal/hexadecimal IPv4, rather than silently changing
	// its meaning. IPv6 and DNS use the URL parser's canonical representation.
	if (
		!rawHost.startsWith('[') &&
		/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) &&
		rawHost !== url.hostname
	)
		throw new Error('Ambiguous upstream address');
	const hostname = url.hostname.toLowerCase();
	if (
		!hostname.startsWith('[') &&
		(hostname.length > 253 ||
			!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/.test(
				hostname
			))
	)
		throw new Error('Invalid upstream host');
	if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(match[3]) || /%(?![a-f0-9]{2})|%2e|\/\//i.test(match[3]))
		throw new Error('Ambiguous API prefix');
	// Decode once to rule out encoded separators, dot traversal and nested
	// escapes; otherwise retain safe, correctly encoded backend base prefixes.
	const segments = match[3].split('/').slice(1);
	for (const segment of segments) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			throw new Error('Invalid API prefix');
		}
		if (
			decoded === '.' ||
			decoded === '..' ||
			hasControl(decoded, true) ||
			/[/\\%?#]/.test(decoded)
		)
			throw new Error('Ambiguous API prefix');
	}
	let path = url.pathname.replace(/\/+$/, '');
	if (stripVersionPrefix) path = path.replace(/\/v1$/i, '');
	const host = hostname === '0.0.0.0' ? '127.0.0.1' : hostname;
	const scheme = url.protocol === 'https:' ? 'https' : 'http';
	const port = url.port || (scheme === 'https' ? '443' : '80');
	const authority = `${host}${url.port ? `:${url.port}` : ''}`;
	return { baseUrl: `${scheme}://${authority}${path}`, scheme, host, port, prefix: path || '-' };
}

export function buildGatewayRequest(
	provider: GatewayProviderId,
	serverBaseUrl: string,
	endpoint: string,
	apiKey: string,
	init: RequestInit = {}
): { url: string; init: RequestInit } {
	const source = normalizeGatewaySource(provider, serverBaseUrl);
	const path = endpoint.split('?')[0];
	const method = (init.method ?? 'GET').toUpperCase();
	if (
		!isGatewayEndpointAllowed(provider, method, path) ||
		hasControl(endpoint, true) ||
		/[#\\]/.test(endpoint)
	)
		throw new Error('Gateway endpoint or method not allowed');
	if (hasControl(apiKey)) throw new Error('Invalid API credential');
	const headers = new Headers(init.headers);
	for (const name of headers.keys())
		if (name.startsWith('x-llampart-'))
			throw new Error('Routing headers are owned by the transport');
	headers.set('X-Llampart-Gateway', '1');
	headers.set('X-Llampart-Scheme', source.scheme);
	headers.set('X-Llampart-Host', source.host);
	headers.set('X-Llampart-Port', source.port);
	headers.set('X-Llampart-Prefix', source.prefix);
	headers.delete('Authorization');
	if (apiKey.trim()) headers.set('Authorization', `Bearer ${apiKey.trim()}`);
	const headerRecord = Object.fromEntries(
		[...headers].map(([name, value]) => [
			name
				.split('-')
				.map((part) => part[0].toUpperCase() + part.slice(1))
				.join('-'),
			value
		])
	);
	return {
		url: `/__llampart/api/${provider}${endpoint}`,
		init: { ...init, method, headers: headerRecord, redirect: 'error', credentials: 'omit' }
	};
}

/** Shared browser/Vite endpoint contract; production Caddy independently enforces it. */
export function isGatewayEndpointAllowed(
	provider: GatewayProviderId,
	method: string,
	path: string
): boolean {
	const common =
		(method === 'GET' && path === '/v1/models') ||
		(method === 'POST' && path === '/v1/chat/completions');
	const responses = provider !== 'llama-server' && method === 'POST' && path === '/v1/responses';
	const telemetry =
		provider === 'vllm' && method === 'GET' && ['/metrics', '/version'].includes(path);
	const native =
		provider === 'llama-server' &&
		((['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'].includes(method) && path === '/cors-proxy') ||
			(method === 'GET' && ['/props', '/models', '/slots', '/tools'].includes(path)) ||
			(method === 'POST' &&
				['/tools', '/models/load', '/models/unload', '/v1/streams/lookup'].includes(path)) ||
			(['GET', 'DELETE'].includes(method) && path === '/v1/stream'));
	return common || responses || telemetry || native;
}

export function fetchProviderEndpoint(
	context: { providerId: GatewayProviderId; serverBaseUrl: string; apiKey: string },
	endpoint: string,
	init: RequestInit = {},
	fetchImpl: typeof fetch = globalThis.fetch
): Promise<Response> {
	const request = buildGatewayRequest(
		context.providerId,
		context.serverBaseUrl,
		endpoint,
		context.apiKey,
		init
	);
	return fetchImpl(request.url, request.init);
}
