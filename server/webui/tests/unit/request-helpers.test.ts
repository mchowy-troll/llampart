import { describe, expect, it } from 'vitest';
import {
	getRequestUrl,
	getRequestMethod,
	getRequestBody,
	summarizeRequestBody,
	formatDiagnosticErrorMessage,
	extractJsonRpcMethods
} from '$lib/utils/request-helpers';

describe('request metadata', () => {
	it('accepts fetch URL input forms', () => {
		const url = 'https://example.com/mcp';

		expect(getRequestUrl(url)).toBe(url);
		expect(getRequestUrl(new URL(url))).toBe(url);
		expect(getRequestUrl(new Request(url))).toBe(url);
	});

	it('resolves method overrides before Request, base init and GET', () => {
		const url = 'https://example.com/mcp';
		const request = new Request(url, { method: 'PUT' });
		const baseInit = { method: 'DELETE' };

		expect(getRequestMethod(request, { method: 'POST' }, baseInit)).toBe('POST');
		expect(getRequestMethod(request, undefined, baseInit)).toBe('PUT');
		expect(getRequestMethod(url, undefined, baseInit)).toBe('DELETE');
		expect(getRequestMethod(url)).toBe('GET');
	});

	it('returns the supplied body or undefined when absent', () => {
		expect(getRequestBody('https://example.com', { body: 'payload' })).toBe('payload');
		expect(getRequestBody('https://example.com')).toBeUndefined();
	});
});

describe('summarizeRequestBody', () => {
	it('reports an absent body as empty', () => {
		expect(summarizeRequestBody(null)).toEqual({ kind: 'empty' });
	});

	it('reports string metadata without exposing its content', () => {
		const body = 'token=secret-token';

		expect(summarizeRequestBody(body)).toEqual({ kind: 'string', size: body.length });
	});

	it('reports binary body metadata without exposing content', () => {
		const blob = new Blob(['secret-token']);

		expect(summarizeRequestBody(blob)).toEqual({ kind: 'blob', size: blob.size });
		expect(summarizeRequestBody(new ArrayBuffer(8))).toEqual({ kind: 'arraybuffer', size: 8 });
	});

	it('reports formdata metadata without exposing fields', () => {
		const body = new FormData();
		body.set('token', 'secret-token');

		expect(summarizeRequestBody(body)).toEqual({ kind: 'formdata' });
	});
});

describe('formatDiagnosticErrorMessage', () => {
	it('adds a CORS hint only for fetch failures and accepts non-Error values', () => {
		expect(formatDiagnosticErrorMessage(new TypeError('Failed to fetch'))).toBe(
			'Failed to fetch (check CORS?)'
		);
		expect(formatDiagnosticErrorMessage(new Error('timeout'))).toBe('timeout');
		expect(formatDiagnosticErrorMessage('some string')).toBe('some string');
	});
});

describe('extractJsonRpcMethods', () => {
	it('extracts only method names from a JSON-RPC batch', () => {
		const body = JSON.stringify([
			{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { token: 'secret-token' } },
			{ jsonrpc: '2.0', method: 'notifications/initialized' }
		]);

		expect(extractJsonRpcMethods(body)).toEqual(['initialize', 'notifications/initialized']);
	});

	it('extracts method from a single JSON-RPC message', () => {
		const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

		expect(extractJsonRpcMethods(body)).toEqual(['tools/list']);
	});

	it('ignores absent, malformed and non-method payloads', () => {
		expect(extractJsonRpcMethods(null)).toBeUndefined();
		expect(extractJsonRpcMethods(undefined)).toBeUndefined();
		expect(extractJsonRpcMethods('not json')).toBeUndefined();
		expect(extractJsonRpcMethods(JSON.stringify({ foo: 'bar' }))).toBeUndefined();
	});
});
