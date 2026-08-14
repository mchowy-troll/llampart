import { describe, expect, it } from 'vitest';
import { getMarkdownFallbackText, getSafeImageFallbackLinkUrl } from '$lib/utils/content-fallback';

describe('content fallbacks', () => {
	it('keeps failed Markdown processing output as literal plain text', () => {
		const markdown =
			'<img src=x onerror="window.__llampart_xss=1">\n<script>window.__llampart_xss=2</script>';

		expect(getMarkdownFallbackText(markdown)).toBe(markdown);
		expect(getMarkdownFallbackText(markdown)).not.toContain('<br>');
	});

	it.each([
		['https://example.com/image.png', 'https://example.com/image.png'],
		['/image.png', 'https://llampart.local/image.png'],
		['blob:https://llampart.local/id', 'blob:https://llampart.local/id']
	])('allows safe image fallback links', (input, expected) => {
		expect(getSafeImageFallbackLinkUrl(input, 'https://llampart.local/chat')).toBe(expected);
	});

	it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/a'])(
		'rejects unsafe image fallback link %s',
		(input) => {
			expect(getSafeImageFallbackLinkUrl(input, 'https://llampart.local/chat')).toBeNull();
		}
	);
});
