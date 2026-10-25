import { describe, expect, it, vi } from 'vitest';
import { llamaServerProvider } from '$lib/services/providers/llama-server.provider';
import { openAiCompatibleProvider } from '$lib/services/providers/openai-compatible.provider';

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json'
		}
	});
}

describe('provider-owned model lists', () => {
	it('loads llama-server models from /v1/models without rewriting the base URL', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				object: 'list',
				data: [
					{
						id: 'local-model',
						object: 'model',
						created: 1,
						owned_by: 'llamacpp'
					}
				]
			})
		);

		const result = await llamaServerProvider.listModels(
			{
				serverBaseUrl: 'http://127.0.0.1:8080',
				apiKey: ''
			},
			fetchMock
		);

		expect(result.data[0].id).toBe('local-model');
		expect(fetchMock).toHaveBeenCalledWith(
			'/__llampart/api/llama-server/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: 'application/json',
					'X-Llampart-Host': '127.0.0.1',
					'X-Llampart-Port': '8080'
				})
			})
		);
	});

	it('loads OpenAI-compatible models from /v1/models and accepts a base URL with /v1', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			jsonResponse({
				object: 'list',
				data: [
					{
						id: 'gpt-test',
						object: 'model',
						created: 2,
						owned_by: 'example'
					}
				]
			})
		);

		const result = await openAiCompatibleProvider.listModels(
			{
				serverBaseUrl: 'https://api.example.test/v1',
				apiKey: 'sk-test'
			},
			fetchMock
		);

		expect(result.data[0].id).toBe('gpt-test');
		expect(fetchMock).toHaveBeenCalledWith(
			'/__llampart/api/openai-compatible/v1/models',
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: 'application/json',
					Authorization: 'Bearer sk-test',
					'X-Llampart-Host': 'api.example.test'
				})
			})
		);
	});
});
