import type { ProviderChatCompletionStreamEvent, ProviderMetric } from '$lib/types/provider';

/** One tracker per frozen request. Counts are cumulative, including hidden reasoning.
 * Two positive, increasing observations are required; no text token estimation. */
export class VllmLiveStatistics {
	private first: { count: number; at: number } | undefined;
	private lastCount = 0;
	private lastAt = -Infinity;
	private invalid = false;
	private rate: number | undefined;

	observe(event: ProviderChatCompletionStreamEvent, now: number): ProviderMetric | undefined {
		const count = event.usage?.completionTokens;
		if (this.invalid) return undefined;
		if (!Number.isFinite(now) || now < this.lastAt) {
			this.invalid = true;
			return undefined;
		}
		this.lastAt = now;
		if (count !== undefined) {
			if (!Number.isSafeInteger(count) || count < this.lastCount || count < 0) {
				this.invalid = true;
				return undefined;
			}
			if (count > 0 && !this.first) this.first = { count, at: now };
			else if (this.first && count > this.lastCount && now > this.first.at)
				this.rate = ((count - this.first.count) * 1000) / (now - this.first.at);
			this.lastCount = count;
		}
		return this.rate !== undefined && Number.isFinite(this.rate)
			? {
					name: 'liveTokensPerSecond',
					value: this.rate,
					unit: 'tokens/s',
					source: 'browser',
					available: true
				}
			: undefined;
	}
}
