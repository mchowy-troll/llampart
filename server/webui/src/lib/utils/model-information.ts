/** Runtime context limits must be explicit metadata, never a guess from the
 * model name or its training context. */
export function getModelContextSize(metadata: unknown): number | undefined {
	if (!metadata || typeof metadata !== 'object') return undefined;
	const model = metadata as Record<string, unknown>;
	for (const value of [model.max_model_len, model.context_length]) {
		if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
	}
	return undefined;
}
