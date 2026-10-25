import { describe, expect, it } from 'vitest';
import {
	API_PROVIDER_IDS,
	DEFAULT_API_PROVIDER_ID,
	isApiProviderId
} from '$lib/constants/api-providers';
import { PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
import {
	API_PROVIDER_REGISTRY,
	getApiProvider,
	getApiProviderCapabilities
} from '$lib/services/providers';

describe('api provider registry', () => {
	it('registers and selects each provider under its own id', () => {
		expect(Object.keys(API_PROVIDER_REGISTRY).sort()).toEqual(
			[
				API_PROVIDER_IDS.LLAMA_SERVER,
				API_PROVIDER_IDS.OPENAI_COMPATIBLE,
				API_PROVIDER_IDS.VLLM
			].sort()
		);
		for (const id of Object.values(API_PROVIDER_IDS)) {
			expect(API_PROVIDER_REGISTRY[id].id).toBe(id);
			expect(getApiProvider(id).id).toBe(id);
		}
	});

	it('falls back to llama-server for unknown provider ids', () => {
		expect(DEFAULT_API_PROVIDER_ID).toBe(API_PROVIDER_IDS.LLAMA_SERVER);
		expect(getApiProvider('unknown-provider').id).toBe(API_PROVIDER_IDS.LLAMA_SERVER);
		expect(getApiProvider(null).id).toBe(API_PROVIDER_IDS.LLAMA_SERVER);
	});

	it('keeps provider capabilities owned by each provider', () => {
		for (const id of Object.values(API_PROVIDER_IDS))
			expect(getApiProviderCapabilities(id).supportsOpenAiToolCalls).toBe(true);

		expect(PROVIDER_CAPABILITIES[API_PROVIDER_IDS.LLAMA_SERVER].supportsServerProps).toBe(true);
		expect(PROVIDER_CAPABILITIES[API_PROVIDER_IDS.LLAMA_SERVER].supportsBuiltinToolsEndpoint).toBe(
			true
		);
		expect(PROVIDER_CAPABILITIES[API_PROVIDER_IDS.LLAMA_SERVER].supportsTopK).toBe(true);
		expect(PROVIDER_CAPABILITIES[API_PROVIDER_IDS.LLAMA_SERVER].supportsPreEncode).toBe(true);
		expect(PROVIDER_CAPABILITIES[API_PROVIDER_IDS.LLAMA_SERVER].supportsResumableStreams).toBe(
			true
		);

		const openAiCapabilities = getApiProviderCapabilities(API_PROVIDER_IDS.OPENAI_COMPATIBLE);
		expect(openAiCapabilities.supportsServerProps).toBe(false);
		expect(openAiCapabilities.supportsModelLoadUnload).toBe(false);
		expect(openAiCapabilities.supportsModelProps).toBe(false);
		expect(openAiCapabilities.supportsTopK).toBe(false);
		expect(openAiCapabilities.supportsPreEncode).toBe(false);
		expect(openAiCapabilities.supportsBuiltinToolsEndpoint).toBe(false);
		expect(openAiCapabilities.supportsCustomJsonPayload).toBe(true);
		expect(openAiCapabilities.supportsStreamUsage).toBe(true);
		expect(openAiCapabilities.requiresModelInChatRequest).toBe(true);
		expect(openAiCapabilities.supportsResumableStreams).toBe(false);
	});

	it('validates provider ids without component-local string checks', () => {
		expect(isApiProviderId(API_PROVIDER_IDS.LLAMA_SERVER)).toBe(true);
		expect(isApiProviderId(API_PROVIDER_IDS.OPENAI_COMPATIBLE)).toBe(true);
		expect(isApiProviderId('ollama')).toBe(false);
		expect(isApiProviderId(undefined)).toBe(false);
	});
});
