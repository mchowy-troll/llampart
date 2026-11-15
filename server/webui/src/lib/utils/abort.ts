/**
 * Abort Signal Utilities
 *
 * Provides utilities for consistent AbortSignal propagation across the application.
 * These utilities help ensure that async operations can be properly cancelled
 * when needed (e.g., user stops generation, navigates away, etc.).
 */

/**
 * Throws an AbortError if the signal is aborted.
 * Use this at the start of async operations to fail fast.
 *
 * @param signal - Optional AbortSignal to check
 * @throws DOMException with name 'AbortError' if signal is aborted
 *
 * @example
 * ```ts
 * async function fetchData(signal?: AbortSignal) {
 *   throwIfAborted(signal);
 *   // ... proceed with operation
 * }
 * ```
 */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException('Operation was aborted', 'AbortError');
	}
}

/**
 * Checks if an error is an AbortError.
 * Use this to distinguish between user-initiated cancellation and actual errors.
 *
 * @param error - Error to check
 * @returns true if the error is an AbortError
 *
 * @example
 * ```ts
 * try {
 *   await fetchData(signal);
 * } catch (error) {
 *   if (isAbortError(error)) {
 *     // User cancelled - no error dialog needed
 *     return;
 *   }
 *   // Handle actual error
 * }
 * ```
 */
export function isAbortError(error: unknown): boolean {
	if (error instanceof DOMException && error.name === 'AbortError') {
		return true;
	}
	if (error instanceof Error && error.name === 'AbortError') {
		return true;
	}
	return false;
}

/**
 * Wraps a promise to reject if the signal is aborted.
 * Useful for making non-abortable promises respect an AbortSignal.
 *
 * @param promise - Promise to wrap
 * @param signal - AbortSignal to respect
 * @returns Promise that rejects with AbortError if signal aborts
 *
 * @example
 * ```ts
 * // Make a non-abortable operation respect abort signal
 * const result = await withAbortSignal(
 *   someNonAbortableOperation(),
 *   signal
 * );
 * ```
 */
export async function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;

	throwIfAborted(signal);

	return new Promise<T>((resolve, reject) => {
		const abortHandler = () => {
			reject(new DOMException('Operation was aborted', 'AbortError'));
		};

		signal.addEventListener('abort', abortHandler, { once: true });

		promise
			.then((value) => {
				signal.removeEventListener('abort', abortHandler);
				resolve(value);
			})
			.catch((error) => {
				signal.removeEventListener('abort', abortHandler);
				reject(error);
			});
	});
}
