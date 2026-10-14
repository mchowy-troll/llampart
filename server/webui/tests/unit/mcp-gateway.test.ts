import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPService } from '$lib/services/mcp.service';
import { buildGatewayRequest } from '$lib/services/providers/provider-transport';
import { buildProxiedUrl, buildProxiedHeaders } from '$lib/utils/cors-proxy';
import { settingsStore } from '$lib/stores/settings.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { sanitizeHeaders } from '$lib/utils/api-headers';

const original = { ...settingsStore.config };
afterEach(() => {
	settingsStore.updateMultipleConfig(original);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
const origin = 'http://192.168.1.10:8100';
function setup() {
	vi.stubGlobal('window', {
		location: { origin, href: origin, protocol: 'http:' },
		isSecureContext: false
	});
	settingsStore.updateMultipleConfig({
		apiProvider: 'llama-server',
		serverBaseUrl: 'http://0.0.0.0:8081',
		apiKey: 'native-secret'
	});
}
interface DiagnosticHarness {
	createDiagnosticRequestDetails(
		input: string,
		init: RequestInit | undefined,
		base: RequestInit,
		headers: Headers,
		extraRedactedHeaders?: Iterable<string>
	): { url: string; headers: Record<string, string> };
	createDiagnosticFetch(
		name: string,
		config: { url: string; useProxy: boolean; headers: Record<string, string> },
		base: RequestInit,
		target: URL,
		proxy: boolean
	): { fetch: typeof fetch };
}
describe('native MCP gateway integration', () => {
	it('redacts native and wrapped credentials plus nested diagnostic URL secrets', () => {
		setup();
		const url = new URL('/__llampart/api/llama-server/cors-proxy', origin);
		url.searchParams.set('url', 'http://user:password@mcp.test/sse?api_key=query-secret&mode=sse');
		const headers = new Headers({
			Authorization: 'Bearer native-secret',
			...buildProxiedHeaders({
				Authorization: 'Bearer target-secret',
				'X-Custom-Credential': 'custom-secret'
			})
		});
		const harness = MCPService as unknown as DiagnosticHarness;
		const details = harness.createDiagnosticRequestDetails(url.href, undefined, {}, headers, [
			'X-Custom-Credential'
		]);
		const serialized = JSON.stringify(details);
		for (const secret of [
			'native-secret',
			'target-secret',
			'custom-secret',
			'query-secret',
			'user',
			'password'
		]) {
			expect(serialized).not.toContain(secret);
		}
		expect(new URL(details.url).searchParams.get('url')).toContain('mode=sse');
	});
	it('redacts wrapped target credentials and configured custom headers in diagnostic logs', () => {
		const sanitized = sanitizeHeaders(
			buildProxiedHeaders({
				Authorization: 'Bearer target-secret',
				'X-Api-Key': 'target-key',
				'X-Custom-Credential': 'custom-secret'
			}),
			['X-Custom-Credential']
		);
		expect(JSON.stringify(sanitized)).not.toContain('target-secret');
		expect(JSON.stringify(sanitized)).not.toContain('target-key');
		expect(JSON.stringify(sanitized)).not.toContain('custom-secret');
	});
	it('uses a same-origin URL while keeping native and target credentials in separate headers', () => {
		setup();
		const url = buildProxiedUrl('http://mcp.test/mcp');
		expect(url.origin).toBe(origin);
		expect(url.pathname).toBe('/__llampart/api/llama-server/cors-proxy');
		expect(url.searchParams.get('url')).toBe('http://mcp.test/mcp');
		expect(url.href).not.toContain('secret');
		const request = buildGatewayRequest(
			'llama-server',
			'http://0.0.0.0:8081',
			'/cors-proxy',
			'native-secret',
			{ method: 'POST', headers: buildProxiedHeaders({ Authorization: 'Bearer target-secret' }) }
		);
		expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer native-secret');
		expect(new Headers(request.init.headers).get('x-proxy-header-authorization')).toBe(
			'Bearer target-secret'
		);
		expect(new Headers(request.init.headers).get('x-llampart-host')).toBe('127.0.0.1');
	});
	it('does not probe native MCP proxy on other providers', async () => {
		setup();
		settingsStore.updateMultipleConfig({ apiProvider: 'vllm' });
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await mcpStore.probeProxy();
		expect(mcpStore.isProxyAvailable).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(() => buildProxiedUrl('http://mcp.test/mcp')).toThrow('requires llama-server');
	});
	it('probes the selected native backend through the gateway, not browser-direct', async () => {
		setup();
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
		vi.stubGlobal('fetch', fetchMock);
		await mcpStore.probeProxy();
		expect(mcpStore.isProxyAvailable).toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			'/__llampart/api/llama-server/cors-proxy',
			expect.objectContaining({
				method: 'HEAD',
				headers: expect.objectContaining({
					'X-Llampart-Port': '8081',
					Authorization: 'Bearer native-secret'
				})
			})
		);
	});
	it('freezes routing/credentials and rewraps legacy SSE endpoints without leaking keys to another origin', async () => {
		setup();
		const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);
		const base = buildGatewayRequest(
			'llama-server',
			'http://0.0.0.0:8081',
			'/cors-proxy',
			'native-secret',
			{ headers: buildProxiedHeaders({ Authorization: 'Bearer target-secret' }) }
		).init;
		const harness = MCPService as unknown as DiagnosticHarness;
		const config = { url: 'http://mcp.test/sse', useProxy: true, headers: {} };
		const wrapper = harness.createDiagnosticFetch(
			'fixture',
			config,
			base,
			buildProxiedUrl(config.url),
			true
		);
		settingsStore.updateMultipleConfig({
			serverBaseUrl: 'http://other.test:8082',
			apiKey: 'different'
		});
		await wrapper.fetch('http://mcp.test/messages?session_id=abc', {
			method: 'POST',
			body: '{}',
			headers: { 'X-Llampart-Port': '9' },
			redirect: 'follow',
			credentials: 'include'
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain(`${origin}/__llampart/api/llama-server/cors-proxy?url=`);
		expect(new URL(String(url)).searchParams.get('url')).toBe(
			'http://mcp.test/messages?session_id=abc'
		);
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer native-secret');
		expect(new Headers(init.headers).get('x-llampart-port')).toBe('8081');
		expect(init.redirect).toBe('error');
		expect(init.credentials).toBe('omit');
		await expect(wrapper.fetch('http://evil.test/messages')).rejects.toThrow('escaped');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
