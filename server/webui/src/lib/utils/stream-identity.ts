import { uuid } from './uuid';

/**
 * Creates an opaque request identity without placing model names in a URL path.
 * URLSearchParams also makes model names containing slashes safe for headers and queries.
 */
export function createStreamIdentity(
	conversationId: string,
	model: string | null,
	requestId = uuid()
): string {
	return new URLSearchParams({
		conversation: conversationId,
		model: model ?? '',
		request: requestId
	}).toString();
}

export function buildStreamRequestUrl(
	endpointUrl: string,
	streamIdentity: string,
	from?: number
): string {
	const separator = endpointUrl.includes('?') ? '&' : '?';
	const params = new URLSearchParams({ conv_id: streamIdentity });
	if (from !== undefined) params.set('from', String(from));

	return `${endpointUrl}${separator}${params.toString()}`;
}
