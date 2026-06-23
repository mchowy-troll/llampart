/**
 * Provider identity variants for llampart API backends.
 *
 * Keep provider IDs in constants/types so services, stores and components can
 * consume stable variants without hardcoded string literals.
 */
export const API_PROVIDER_IDS = {
	LLAMA_SERVER: 'llama-server',
	OPENAI_COMPATIBLE: 'openai-compatible'
} as const;

export type ApiProviderId = (typeof API_PROVIDER_IDS)[keyof typeof API_PROVIDER_IDS];

export const DEFAULT_API_PROVIDER_ID: ApiProviderId = API_PROVIDER_IDS.LLAMA_SERVER;

export const API_PROVIDER_LABELS: Record<ApiProviderId, string> = {
	[API_PROVIDER_IDS.LLAMA_SERVER]: 'llama-server',
	[API_PROVIDER_IDS.OPENAI_COMPATIBLE]: 'OpenAI-compatible'
};

export const API_PROVIDER_OPTIONS = [
	{
		value: API_PROVIDER_IDS.LLAMA_SERVER,
		label: API_PROVIDER_LABELS[API_PROVIDER_IDS.LLAMA_SERVER]
	},
	{
		value: API_PROVIDER_IDS.OPENAI_COMPATIBLE,
		label: API_PROVIDER_LABELS[API_PROVIDER_IDS.OPENAI_COMPATIBLE]
	}
] as const satisfies ReadonlyArray<{ value: ApiProviderId; label: string }>;

export function isApiProviderId(value: unknown): value is ApiProviderId {
	return typeof value === 'string' && (Object.values(API_PROVIDER_IDS) as string[]).includes(value);
}
