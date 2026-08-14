const SAFE_IMAGE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

export function getMarkdownFallbackText(markdown: string): string {
	return markdown;
}

export function getSafeImageFallbackLinkUrl(src: string, baseUrl: string): string | null {
	try {
		const url = new URL(src, baseUrl);

		return SAFE_IMAGE_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}
