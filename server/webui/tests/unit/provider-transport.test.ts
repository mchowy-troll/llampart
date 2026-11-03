import { describe, expect, it, vi } from 'vitest';
import {
	buildGatewayRequest,
	DEFAULT_LLAMA_SERVER_BASE_URL,
	normalizeGatewaySource,
	validateGatewayConnection
} from '$lib/services/providers/provider-transport';

describe('same-origin gateway transport', () => {
	it.each([
		'http://127.0.0.1:8080',
		'http://192.168.1.60:8000',
		'https://api.openai.com',
		'http://[::1]:8080',
		'https://[2001:db8::1]',
		'http://169.254.169.254',
		'http://localhost:2019'
	])('accepts %s without destination IP policy', (address) => {
		expect(normalizeGatewaySource('vllm', address).host).toBe(new URL(address).hostname);
	});
	it('maps the unspecified IPv4 convenience address to the Caddy machine loopback', () => {
		expect(normalizeGatewaySource('vllm', 'http://0.0.0.0:8080/v1')).toMatchObject({
			baseUrl: 'http://127.0.0.1:8080',
			host: '127.0.0.1',
			port: '8080'
		});
	});
	it('normalizes DNS case and expanded IPv6, retaining valid prefixes', () => {
		expect(normalizeGatewaySource('vllm', 'HTTPS://EXAMPLE.COM/proxy/v1/').prefix).toBe('/proxy');
		expect(normalizeGatewaySource('vllm', 'http://[0:0:0:0:0:0:0:1]:8080').host).toBe('[::1]');
		expect(normalizeGatewaySource('vllm', 'https://example.com/api+test/v1').prefix).toBe(
			'/api+test'
		);
	});
	it('selects the environment gateway default only for a blank llama-server address', () => {
		expect(DEFAULT_LLAMA_SERVER_BASE_URL).toBe('http://127.0.0.1:8080');
		for (const address of ['', '   ']) {
			expect(normalizeGatewaySource('llama-server', address)).toEqual({
				baseUrl: '',
				scheme: 'http',
				host: '-',
				port: '0',
				prefix: '-'
			});
			const headers = new Headers(
				buildGatewayRequest('llama-server', address, '/v1/models', '').init.headers
			);
			expect(headers.get('X-Llampart-Host')).toBe('-');
			expect(headers.get('X-Llampart-Port')).toBe('0');
		}
		expect(() => normalizeGatewaySource('vllm', '')).toThrow();
		expect(() => normalizeGatewaySource('openai-compatible', '')).toThrow();
	});
	it.each([
		'ftp://localhost',
		'http://user:secret@localhost',
		'http://@localhost',
		'http://localhost/#',
		'http://localhost?',
		'http://localhost:0',
		'http://localhost:65536',
		'http://localhost:0080',
		'http://127.1',
		'http://0177.0.0.1',
		'http://0x7f000001',
		'http://999.1.1.1',
		'http://localhost/a/../b',
		'http://localhost/%2e%2e',
		'http://localhost/%2f',
		'http://localhost/%252f',
		'http://localhost\\test',
		'http://localhost\r\n',
		'http://localhost//api'
	])('rejects malformed or ambiguous %s', (address) => {
		expect(() => normalizeGatewaySource('vllm', address)).toThrow();
		expect(() => validateGatewayConnection('vllm', address, '')).toThrow();
		expect(() => buildGatewayRequest('vllm', address, '/v1/models', '')).toThrow();
	});
	it('shares safe credential validation between offline preflight and transport, without HTTP', () => {
		const fetch = vi.spyOn(globalThis, 'fetch');
		try {
			for (const key of ['secret\nvalue', 'secret\rvalue', 'secret\u007f', 'secret🔑']) {
				for (const validate of [
					() => validateGatewayConnection('vllm', 'http://unreachable.invalid', key),
					() => buildGatewayRequest('vllm', 'http://unreachable.invalid', '/v1/models', key)
				])
					expect(validate).toThrow('Invalid API credential');
			}
			expect(
				validateGatewayConnection('vllm', 'http://unreachable.invalid/v1', ' secret ')
			).toMatchObject({
				source: { baseUrl: 'http://unreachable.invalid' },
				authorization: 'Bearer secret'
			});
			expect(validateGatewayConnection('llama-server', '', '').source.baseUrl).toBe('');
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
		}
	});
	it('keeps query, credentials and abort identity out of routing metadata', () => {
		const signal = new AbortController().signal;
		const request = buildGatewayRequest(
			'vllm',
			'https://example.com/proxy/v1',
			'/v1/chat/completions?model=a%2Fb',
			'secret',
			{ method: 'POST', signal }
		);
		expect(request.url).toBe('/__llampart/api/vllm/v1/chat/completions?model=a%2Fb');
		expect(request.url).not.toContain('secret');
		expect(new Headers(request.init.headers).get('Authorization')).toBe('Bearer secret');
		expect(new Headers(request.init.headers).get('X-Llampart-Prefix')).toBe('/proxy');
		expect(request.init.signal).toBe(signal);
		expect(request.init.redirect).toBe('error');
	});
	it('protects endpoint, method and header ownership', () => {
		expect(() => buildGatewayRequest('vllm', 'http://localhost', '/admin', '')).toThrow();
		expect(() =>
			buildGatewayRequest('vllm', 'http://localhost', '/v1/models', '', { method: 'DELETE' })
		).toThrow();
		expect(() =>
			buildGatewayRequest('vllm', 'http://localhost', '/v1/models', 'secret\nvalue')
		).toThrow('Invalid API credential');
		expect(() =>
			buildGatewayRequest('vllm', 'http://localhost', '/v1/models', '', {
				headers: { 'X-Llampart-Host': 'forged' }
			})
		).toThrow();
	});
	it('preserves resumable V2 query identities and native tool execution', () => {
		expect(
			buildGatewayRequest('llama-server', '', '/v1/stream?conv_id=x&from=42', '', {
				method: 'DELETE'
			}).url
		).toContain('/v1/stream?conv_id=x&from=42');
		expect(buildGatewayRequest('llama-server', '', '/tools', '', { method: 'POST' }).url).toContain(
			'/llama-server/tools'
		);
	});
});
