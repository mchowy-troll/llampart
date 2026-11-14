import { SvelteMap } from 'svelte/reactivity';
import type { SettingsChatServiceOptions } from '$lib/types/settings';

/** Request-local throughput only. Never context occupancy or persisted response statistics. */
class LiveInferenceStore {
	private requests = new SvelteMap<
		string,
		{ owner: symbol; isCurrent: () => boolean; tokensPerSecond: number | null }
	>();

	getRate(conversationId: string | undefined): { tokensPerSecond: number | null } | null {
		const request = conversationId ? this.requests.get(conversationId) : undefined;
		return request?.isCurrent() ? { tokensPerSecond: request.tokensPerSecond } : null;
	}

	async withRequest<T>(
		conversationId: string,
		signal: AbortSignal,
		isCurrent: () => boolean,
		run: (
			callbacks: Pick<SettingsChatServiceOptions, 'onTimings' | 'onProviderResult'>
		) => Promise<T>
	): Promise<T> {
		const owner = Symbol();
		const current = () => !signal.aborted && isCurrent();
		const clear = () => {
			if (this.requests.get(conversationId)?.owner === owner) this.requests.delete(conversationId);
		};
		if (current())
			this.requests.set(conversationId, { owner, isCurrent: current, tokensPerSecond: null });
		signal.addEventListener('abort', clear, { once: true });
		try {
			return await run({
				onTimings: (timings) => {
					if (this.requests.get(conversationId)?.owner !== owner || !current()) return;
					// Normalized provider usage may contain browser estimates. Accept only a
					// backend metric, or native backend timings, never estimated token counts.
					const rate = timings?.provider
						? timings.provider.metrics?.find(
								(metric) =>
									metric.name === 'tokensPerSecond' &&
									metric.source === 'backend' &&
									metric.available
							)?.value
						: timings?.predicted_per_second;
					this.requests.set(conversationId, {
						owner,
						isCurrent: current,
						tokensPerSecond:
							typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null
					});
				},
				onProviderResult: (event) => {
					if (event.done || event.finishReason || event.refusal || event.status) clear();
				}
			});
		} finally {
			clear();
			signal.removeEventListener('abort', clear);
		}
	}
}

export const liveInferenceStore = new LiveInferenceStore();
