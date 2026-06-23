import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { validateConnectionSettings } from '$lib/utils/connection-validation';

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	});
}

describe('provider-aware connection validation', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('validates llama-server through /props by default', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				default_generation_settings: {},
				build_info: {}
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await validateConnectionSettings('http://127.0.0.1:8080', '');

		expect(result.ok).toBe(true);
		expect(result.provider).toBe(API_PROVIDER_IDS.LLAMA_SERVER);
		expect(fetchMock).toHaveBeenCalledWith(
			'http://127.0.0.1:8080/props',
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: 'application/json'
				})
			})
		);
	});

	it('validates OpenAI-compatible providers through /v1/models', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				object: 'list',
				data: [{ id: 'gpt-test', object: 'model' }]
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await validateConnectionSettings(
			'https://api.example.test/v1',
			'sk-test',
			API_PROVIDER_IDS.OPENAI_COMPATIBLE
		);

		expect(result.ok).toBe(true);
		expect(result.provider).toBe(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.example.test/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: 'application/json',
					Authorization: 'Bearer sk-test'
				})
			})
		);
	});

	it('rejects invalid OpenAI-compatible model list payloads', async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }));
		vi.stubGlobal('fetch', fetchMock);

		const result = await validateConnectionSettings(
			'https://api.example.test',
			'',
			API_PROVIDER_IDS.OPENAI_COMPATIBLE
		);

		expect(result.ok).toBe(false);
		expect(result.provider).toBe(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		expect(result.errorMessage).toContain('/v1/models');
	});

	it('falls back to llama-server for unknown provider ids', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				default_generation_settings: {},
				build_info: {}
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await validateConnectionSettings('http://127.0.0.1:8080', '', 'unknown');

		expect(result.ok).toBe(true);
		expect(result.provider).toBe(API_PROVIDER_IDS.LLAMA_SERVER);
	});
});
