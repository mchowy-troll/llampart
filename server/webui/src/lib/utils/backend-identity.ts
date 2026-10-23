import { sha256 } from '@noble/hashes/sha2.js';

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonical(item)])
		);
	return value;
}

/** Observable backend identity, not a PID or proof of process continuity. */
export function backendIdentity(props: unknown): string {
	const raw = (props ?? {}) as Record<string, unknown>;
	const fields = Object.fromEntries(
		[
			'id',
			'model_path',
			'model_alias',
			'model',
			'build_info',
			'role',
			'chat_template',
			'chat_template_caps',
			'modalities',
			'capabilities',
			'default_generation_settings',
			'language_model_only',
			'meta',
			'mmproj_path'
		].map((key) => [key, raw[key] ?? null])
	);
	return Array.from(sha256(new TextEncoder().encode(JSON.stringify(canonical(fields)))), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('');
}

export function sameMetadata(left: unknown, right: unknown): boolean {
	return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
