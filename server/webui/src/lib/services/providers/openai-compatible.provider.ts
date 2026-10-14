import { API_PROVIDER_IDS } from '$lib/constants/api-providers';
import { OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES } from '$lib/constants/provider-capabilities';
import { createOpenAiProvider } from './openai-provider';

export const openAiCompatibleProvider = createOpenAiProvider(
	API_PROVIDER_IDS.OPENAI_COMPATIBLE,
	OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES
);
