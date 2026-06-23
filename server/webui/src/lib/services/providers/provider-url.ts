export interface ProviderEndpointUrlOptions {
	stripOpenAiV1?: boolean;
}

const OPENAI_V1_SUFFIX_PATTERN = /\/v1\/?$/i;

export function normalizeProviderBaseUrl(
	value: string,
	options: ProviderEndpointUrlOptions = {}
): string {
	let normalized = value.trim().replace(/\/+$/, '');

	if (options.stripOpenAiV1) {
		normalized = normalized.replace(OPENAI_V1_SUFFIX_PATTERN, '');
	}

	return normalized;
}

export function isAbsoluteHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

function getCurrentOrigin(): string {
	if (typeof window !== 'undefined' && window.location?.origin) {
		return window.location.origin;
	}

	return '';
}

export function buildProviderEndpointUrl(
	serverBaseUrl: string,
	endpointPath: string,
	options: ProviderEndpointUrlOptions = {}
): string {
	const normalizedBaseUrl = normalizeProviderBaseUrl(serverBaseUrl, options);
	const normalizedEndpointPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;

	if (!normalizedBaseUrl) {
		return `${getCurrentOrigin()}${normalizedEndpointPath}`;
	}

	return `${normalizedBaseUrl}${normalizedEndpointPath}`;
}
