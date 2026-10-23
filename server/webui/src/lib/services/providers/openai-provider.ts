import { z } from 'zod';
import { API_PROVIDER_LABELS } from '$lib/constants/api-providers';
import type { ApiModelListResponse } from '$lib/types/api';
import type {
	ProviderCapabilities,
	ProviderChatCompletionInput,
	ProviderChatCompletionStreamEvent,
	ProviderUsage
} from '$lib/types/provider';
import type { ApiProviderAdapter } from './provider.types';
import { buildGatewayRequest, fetchProviderEndpoint } from './provider-transport';
import { buildChatBody, parseChatResponse, parseChatStream } from './openai-chat.protocol';
import {
	buildResponsesBody,
	createResponsesStreamParser,
	parseResponsesResponse
} from './openai-responses.protocol';

const modelsSchema = z
	.object({
		object: z.literal('list'),
		data: z.array(z.object({ id: z.string().min(1) }).passthrough())
	})
	.passthrough();

export function createOpenAiProvider(
	id: 'openai-compatible' | 'vllm',
	capabilities: ProviderCapabilities,
	extension?: {
		mapRequest(
			input: ProviderChatCompletionInput,
			body: Record<string, unknown>
		): Record<string, unknown>;
		mapUsage(data: unknown, usage?: ProviderUsage): ProviderUsage | undefined;
	}
): ApiProviderAdapter {
	const parseStream = (data: string): ProviderChatCompletionStreamEvent => {
		const parsed = parseChatStream(data);
		if (extension && data !== '[DONE]')
			parsed.usage = extension.mapUsage(JSON.parse(data), parsed.usage);
		return parsed;
	};
	const parseResponse = (
		data: unknown,
		protocol: 'chat-completions' | 'responses' = 'chat-completions'
	) => {
		const parsed =
			protocol === 'responses' ? parseResponsesResponse(data) : parseChatResponse(data);
		if (extension) parsed.usage = extension.mapUsage(data, parsed.usage);
		return parsed;
	};
	const listModels: ApiProviderAdapter['listModels'] = async (input, fetchImpl) => {
		const response = await fetchProviderEndpoint(
			{ ...input, providerId: id },
			'/v1/models',
			{ cache: 'no-store', headers: { Accept: 'application/json' } },
			fetchImpl
		);
		if (!response.ok) throw new Error(`Model discovery failed (${response.status})`);
		if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
			throw new Error('Invalid model discovery response: expected JSON');
		const parsed = modelsSchema.safeParse(await response.json());
		if (!parsed.success) throw new Error('Invalid /v1/models response');
		return parsed.data as unknown as ApiModelListResponse;
	};
	return {
		id,
		label: API_PROVIDER_LABELS[id],
		description: `${API_PROVIDER_LABELS[id]} conversation provider`,
		capabilities,
		listModels,
		async validateConnection(input, fetchImpl) {
			try {
				await listModels(input, fetchImpl);
				return { ok: true, provider: id, status: 200 };
			} catch (error) {
				return {
					ok: false,
					provider: id,
					errorMessage:
						error instanceof Error
							? error.message.split(input.apiKey || '\u0000').join('[redacted]')
							: 'Connection failed'
				};
			}
		},
		buildChatCompletionRequest(input) {
			const protocol = input.capabilities?.protocol ?? 'chat-completions';
			let body =
				protocol === 'responses' ? buildResponsesBody(input, id) : buildChatBody(input, id);
			if (extension) body = extension.mapRequest(input, body);
			return buildGatewayRequest(
				id,
				input.serverBaseUrl,
				protocol === 'responses' ? '/v1/responses' : '/v1/chat/completions',
				input.apiKey,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: input.options.stream ? 'text/event-stream' : 'application/json'
					},
					body: JSON.stringify(body)
				}
			);
		},
		parseChatCompletionStreamData: parseStream,
		createStreamParser(protocol) {
			if (protocol !== 'responses') return parseStream;
			const parser = createResponsesStreamParser();
			return (data, eventType) => {
				const event = parser(data, eventType);
				if (event && extension) event.usage = extension.mapUsage(JSON.parse(data), event.usage);
				return event;
			};
		},
		parseChatCompletionResponse: (data) => parseResponse(data),
		parseResponse
	};
}
