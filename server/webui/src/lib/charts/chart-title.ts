import { MAX_CHART_SOURCE_BYTES } from '$lib/markdown/chart-blocks';

/** Only a bounded, complete JSON object can provide an unvalidated chart title.
 * Render as text, never HTML. Do not guess at partial/malformed JSON.
 */
export function chartSourceTitle(source: string): string | undefined {
	if (
		source.length > MAX_CHART_SOURCE_BYTES ||
		new TextEncoder().encode(source).length > MAX_CHART_SOURCE_BYTES
	)
		return;
	try {
		const value: unknown = JSON.parse(source);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return;
		const title = (value as Record<string, unknown>).title;
		if (typeof title !== 'string' || !title.trim() || title.length > 120) return;
		for (const character of title) {
			if (character.charCodeAt(0) < 0x20) return;
		}
		return title.trim();
	} catch {
		// Malformed JSON has no reliable title.
	}
}
