import http, {
	type IncomingHttpHeaders,
	type IncomingMessage,
	type ServerResponse
} from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { Plugin } from 'vite';
import {
	isGatewayEndpointAllowed,
	DEFAULT_LLAMA_SERVER_BASE_URL,
	normalizeGatewaySource,
	type GatewaySource,
	type GatewayProviderId
} from '../src/lib/services/providers/provider-transport';

const root = '/__llampart/api/';
const hopHeaders = [
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
];

function cleanHeaders(headers: IncomingHttpHeaders, request = false): IncomingHttpHeaders {
	const excluded = new Set([
		...hopHeaders,
		...(headers.connection ?? '').split(',').map((name) => name.trim().toLowerCase())
	]);
	return Object.fromEntries(
		Object.entries(headers).filter(
			([name]) =>
				!excluded.has(name) &&
				!(request && (name.startsWith('x-llampart-') || name === 'cookie' || name === 'host'))
		)
	);
}

function privateClient(address = ''): boolean {
	const ip = address.replace(/^::ffff:/, '');
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 127 ||
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		);
	}
	return isIP(ip) === 6 && (ip === '::1' || /^(fc|fd|fe[89ab])/i.test(ip));
}

function routing(req: IncomingMessage, provider: GatewayProviderId, defaultSource: GatewaySource) {
	const get = (name: string) => {
		const values = req.rawHeaders
			.filter((_, index) => index % 2 === 0)
			.filter((key) => key.toLowerCase() === name);
		if (values.length !== 1 || typeof req.headers[name] !== 'string')
			throw new Error('Invalid routing header');
		return req.headers[name] as string;
	};
	if (get('x-llampart-gateway') !== '1') throw new Error('Invalid gateway marker');
	const scheme = get('x-llampart-scheme');
	const host = get('x-llampart-host');
	const port = get('x-llampart-port');
	const prefix = get('x-llampart-prefix');
	if (
		host === '-' &&
		port === '0' &&
		scheme === 'http' &&
		prefix === '-' &&
		provider === 'llama-server'
	)
		return defaultSource;
	if (
		!['http', 'https'].includes(scheme) ||
		!/^[1-9][0-9]{0,4}$/.test(port) ||
		Number(port) > 65535
	)
		throw new Error('Invalid scheme/port');
	if (
		prefix !== '-' &&
		!/^\/(?:[A-Za-z0-9_~.!$&'()+,;=@-]|%[0-9a-fA-F]{2})+(?:\/(?:[A-Za-z0-9_~.!$&'()+,;=@-]|%[0-9a-fA-F]{2})+)*$/.test(
			prefix
		)
	)
		throw new Error('Invalid API prefix');
	// Validate metadata independently of the browser. Do not strip /v1 a second time.
	const source = normalizeGatewaySource(
		'llama-server',
		`${scheme}://${host}:${port}${prefix === '-' ? '' : prefix}`,
		false
	);
	if (
		source.host !== (host === '0.0.0.0' ? '127.0.0.1' : host) ||
		source.port !== port ||
		source.prefix !== prefix
	)
		throw new Error('Noncanonical routing metadata');
	return source;
}

function reject(res: ServerResponse, status: number, message: string) {
	res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
	res.end(message);
}

/** Stateless streaming gateway inside Vite's existing process. No generation retries,
 * destination allowlists, DNS filters, extra services or dependency on installed Caddy. */
export function devGateway(
	defaultBackendUrl = process.env.LLAMPART_DEV_BACKEND_URL?.trim() || DEFAULT_LLAMA_SERVER_BASE_URL
): Plugin {
	const defaultSource = normalizeGatewaySource('llama-server', defaultBackendUrl);
	if (defaultSource.host === '-')
		throw new Error('Development default backend requires an absolute HTTP(S) URL');
	return {
		name: 'llampart-dev-gateway',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith(root)) return next();
				const site = req.headers['sec-fetch-site'];
				const origin = `${server.config.server.https ? 'https' : 'http'}://${req.headers.host}`;
				if (
					!privateClient(req.socket.remoteAddress) ||
					(site && site !== 'same-origin') ||
					(req.headers.origin && req.headers.origin !== origin)
				)
					return reject(res, 403, 'Cross-origin gateway request denied');
				const match =
					/^\/__llampart\/api\/(llama-server|openai-compatible|vllm)(\/[^?]*)(\?.*)?$/.exec(
						req.url
					);
				if (
					!match ||
					!isGatewayEndpointAllowed(match[1] as GatewayProviderId, req.method ?? 'GET', match[2])
				)
					return reject(res, 405, 'Gateway endpoint or method not allowed');
				if (
					[...req.url].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ||
					/[#\\]/.test(req.url)
				)
					return reject(res, 400, 'Invalid gateway URI');
				let source;
				try {
					source = routing(req, match[1] as GatewayProviderId, defaultSource);
				} catch {
					return reject(res, 400, 'Invalid gateway metadata');
				}
				const transport = source.scheme === 'https' ? https : http;
				const upstream = transport.request(
					{
						protocol: `${source.scheme}:`,
						hostname: source.host.replace(/^\[|\]$/g, ''),
						port: source.port,
						method: req.method,
						path: `${source.prefix === '-' ? '' : source.prefix}${match[2]}${match[3] ?? ''}`,
						headers: { ...cleanHeaders(req.headers, true), host: `${source.host}:${source.port}` },
						timeout: 0
					},
					(response) => {
						res.writeHead(response.statusCode ?? 502, cleanHeaders(response.headers));
						res.flushHeaders();
						response.on('error', () => res.destroy());
						response.pipe(res);
					}
				);
				const abort = () => upstream.destroy();
				req.on('aborted', abort);
				req.on('error', abort);
				res.on('error', abort);
				res.on('close', abort);
				upstream.on('error', () => {
					// Never log credentialed requests or retry a generation POST.
					if (!res.destroyed && !res.headersSent)
						reject(res, 502, 'Gateway upstream transport failed');
					else res.destroy();
				});
				req.pipe(upstream);
			});
		}
	};
}
