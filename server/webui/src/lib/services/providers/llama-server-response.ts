import { z } from 'zod';

// llama.cpp server-task.cpp: chat deltas (including empty/role-only deltas),
// usage-only final chunks, prompt progress and timings. Unknown extension fields
// are allowed, but cannot by themselves identify a valid event.
const toolCall = z
	.object({
		index: z.number().int().nonnegative().optional(),
		id: z.string().optional(),
		type: z.literal('function').optional(),
		function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional()
	})
	.passthrough();
const message = z
	.object({
		role: z.string().optional(),
		content: z.string().nullable().optional(),
		reasoning_content: z.string().nullable().optional(),
		model: z.string().optional(),
		tool_calls: z.array(toolCall).optional()
	})
	.passthrough();
const timingFields = {
	cache_n: z.number().optional(),
	context_total: z.number().optional(),
	prompt_n: z.number().optional(),
	prompt_ms: z.number().optional(),
	prompt_per_token_ms: z.number().optional(),
	prompt_per_second: z.number().optional(),
	predicted_n: z.number().optional(),
	predicted_ms: z.number().optional(),
	predicted_per_token_ms: z.number().optional(),
	predicted_per_second: z.number().optional(),
	draft_n: z.number().optional(),
	draft_n_accepted: z.number().optional()
};
const usageFields = {
	prompt_tokens: z.number().optional(),
	completion_tokens: z.number().optional(),
	total_tokens: z.number().optional()
};
const hasKnownField = (value: object, fields: object) =>
	Object.keys(fields).some((key) => Object.hasOwn(value, key));
const common = {
	id: z.string().optional(),
	model: z.string().optional(),
	usage: z
		.object(usageFields)
		.passthrough()
		.refine((value) => hasKnownField(value, usageFields))
		.nullable()
		.optional(),
	timings: z
		.object(timingFields)
		.passthrough()
		.refine((value) => hasKnownField(value, timingFields))
		.optional(),
	prompt_progress: z
		.object({
			total: z.number(),
			cache: z.number(),
			processed: z.number(),
			time_ms: z.number()
		})
		.passthrough()
		.optional()
};
const choiceFields = {
	index: z.number().int().nonnegative().optional(),
	model: z.string().optional(),
	finish_reason: z.string().nullable().optional()
};
const streamChunk = z
	.object({
		...common,
		choices: z
			.array(
				z
					.object({
						...choiceFields,
						delta: message,
						message: message.optional()
					})
					.passthrough()
			)
			.optional()
	})
	.passthrough()
	.refine((value) =>
		Boolean(value.choices?.length || value.timings || value.prompt_progress || value.usage)
	);
const response = z
	.object({
		...common,
		choices: z
			.array(
				z
					.object({
						...choiceFields,
						message,
						delta: message.optional()
					})
					.passthrough()
			)
			.min(1)
	})
	.passthrough();
const backendError = z.object({
	message: z.string(),
	code: z.number().int().optional(),
	type: z.string().optional()
});

/** Keep backend failures distinct from malformed records. Do not retain/log the
 * raw envelope or free-form backend message: either may contain credentials or
 * echoed request data. Only known error types and numeric codes are diagnostic. */
export class LlamaServerBackendError extends Error {
	readonly name = 'LlamaServerBackendError';
	readonly backendType: string;
	constructor(
		readonly code: number | undefined,
		type: string | undefined
	) {
		const safeType = [
			'invalid_request_error',
			'server_error',
			'authentication_error',
			'permission_error',
			'not_found_error',
			'rate_limit_error',
			'unavailable_error',
			'not_supported_error',
			'exceed_context_size_error'
		].includes(type ?? '')
			? type!
			: 'backend_error';
		super(
			`llama-server reported an error (${safeType}${code === undefined ? '' : `, code ${code}`})`
		);
		this.backendType = safeType;
	}
}

function checkBackendError(data: unknown): void {
	if (data && typeof data === 'object' && Object.hasOwn(data, 'error')) {
		const error = backendError.parse((data as Record<string, unknown>).error);
		throw new LlamaServerBackendError(error.code, error.type);
	}
}

export function readLlamaServerStreamChunk(data: string) {
	const parsed: unknown = JSON.parse(data);
	checkBackendError(parsed);
	return streamChunk.parse(parsed);
}

export function readLlamaServerResponse(data: unknown) {
	checkBackendError(data);
	return response.parse(data);
}
