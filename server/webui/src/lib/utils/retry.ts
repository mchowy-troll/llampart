export interface SleepTimer {
	setTimeout: (callback: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
}

const defaultSleepTimer: SleepTimer = {
	setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function getReconnectDelay(attempt: number, random = Math.random): number {
	const exponentialDelay = Math.min(4000, 250 * 2 ** Math.max(0, attempt));
	const jitterMultiplier = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;

	return Math.min(4000, Math.round(exponentialDelay * jitterMultiplier));
}

export function sleepWithAbort(
	ms: number,
	signal?: AbortSignal,
	timer: SleepTimer = defaultSleepTimer
): Promise<boolean> {
	if (signal?.aborted) return Promise.resolve(false);

	return new Promise((resolve) => {
		let settled = false;
		const timeoutRef: { handle?: unknown } = {};
		const finish = (completed: boolean) => {
			if (settled) return;
			settled = true;
			if (!completed && timeoutRef.handle !== undefined) timer.clearTimeout(timeoutRef.handle);
			signal?.removeEventListener('abort', onAbort);
			resolve(completed);
		};
		const onAbort = () => finish(false);

		timeoutRef.handle = timer.setTimeout(() => finish(true), ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
