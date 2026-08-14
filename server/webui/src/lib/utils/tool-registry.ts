export type ToolNameResolution<T> =
	| { status: 'unique'; entry: T }
	| { status: 'conflicted' }
	| { status: 'unavailable' };

export function resolveToolName<T>(entries: readonly T[]): ToolNameResolution<T> {
	if (entries.length === 0) return { status: 'unavailable' };
	if (entries.length > 1) return { status: 'conflicted' };
	return { status: 'unique', entry: entries[0] };
}
