import type { ChatMessageTimings } from '$lib/types/chat';

/** Backend metrics take precedence. Only an explicitly named token-counter-based
 * client rate may supply an approximate speed; elapsed time/TTFT never supply timings. */
export function getProviderStatistics(
	provider: NonNullable<ChatMessageTimings['provider']>,
	view: 'reading' | 'generation'
): { tokens?: number; timeMs?: number; tokensPerSecond?: number; approximate?: boolean } {
	const finite = (value: number | undefined) =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
	const metric = (name: string, unit: 'ms' | 'tokens/s') =>
		finite(
			provider.metrics?.find(
				(item) =>
					item.name === name && item.unit === unit && item.source === 'backend' && item.available
			)?.value
		);
	const live = provider.metrics?.find(
		(item) =>
			item.name === 'liveTokensPerSecond' &&
			item.unit === 'tokens/s' &&
			item.source === 'browser' &&
			item.available
	);
	const approximate =
		metric('tokensPerSecond', 'tokens/s') === undefined && finite(live?.value) !== undefined;
	return view === 'reading'
		? {
				tokens: finite(provider.usage?.promptTokens),
				timeMs: metric('promptTime', 'ms'),
				tokensPerSecond: metric('promptTokensPerSecond', 'tokens/s')
			}
		: {
				tokens: finite(provider.usage?.completionTokens),
				timeMs: metric('generationTime', 'ms'),
				tokensPerSecond: metric('tokensPerSecond', 'tokens/s') ?? finite(live?.value),
				...(approximate ? { approximate: true } : {})
			};
}
