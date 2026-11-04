import { z } from 'zod';
import type { ApiProviderId } from '$lib/constants/api-providers';
import type { MessageModelInfoSnapshot } from '$lib/types/message-model-info';
import type { ApiLlamaCppServerProps } from '$lib/types/api';
import type { ModelOption } from '$lib/types/models';
import { normalizeModelName } from './model-names';

/** Resolve presentation from the response's own evidence, never the live catalog/selection. */
export function getMessageModelDisplayName(message: {
	model?: string | null;
	modelInfo?: MessageModelInfoSnapshot | null;
}): string | null {
	const snapshot = message.modelInfo;
	if (snapshot?.identity === 'unavailable') return null;
	const savedName = snapshot ? snapshot.displayName?.trim() || snapshot.modelId : message.model;
	if (!savedName?.trim()) return null;
	// Existing snapshots/legacy records may still contain a GGUF filename or path.
	const name = normalizeModelName(savedName);
	return (
		(/\.gguf$/i.test(name)
			? name
					.split(/[\\/]/)
					.pop()!
					.replace(/\.gguf$/i, '')
			: name) || null
	);
}

export const MAX_MODEL_CHAT_TEMPLATE_LENGTH = 65_536;
const text = (max: number) =>
	z
		.string()
		.max(max)
		.refine(
			(s) => !/[a-z][a-z\d+.-]*:\/\/[^\s/]*@/i.test(s),
			'Credential URL is not model metadata'
		);
const id = text(4096);
const number = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const messageModelInfoSnapshotSchema = z
	.object({
		schemaVersion: z.literal(1),
		providerId: z.enum(['llama-server', 'vllm', 'openai-compatible']),
		requestedModelId: id.nullable(),
		modelId: id.nullable(),
		displayName: id.nullable(),
		identity: z.enum(['verified', 'response-only', 'unavailable']),
		aliases: z.array(id).max(32),
		contextSize: number.optional(),
		modalities: z
			.object({
				vision: z.boolean().optional(),
				audio: z.boolean().optional(),
				video: z.boolean().optional()
			})
			.strict()
			.optional(),
		native: z
			.object({
				model_path: text(8192).optional(),
				default_generation_settings: z.object({ n_ctx: number.optional() }).strict().optional(),
				total_slots: number.optional(),
				build_info: text(4096).optional(),
				chat_template: text(MAX_MODEL_CHAT_TEMPLATE_LENGTH).optional()
			})
			.strict()
			.optional(),
		meta: z
			.object({
				n_ctx_train: number.optional(),
				size: number.optional(),
				n_params: number.optional(),
				n_embd: number.optional(),
				n_vocab: number.optional(),
				vocab_type: z.union([text(256), number]).optional()
			})
			.strict()
			.optional()
	})
	.strict() satisfies z.ZodType<MessageModelInfoSnapshot>;

function bounded<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
	const result = schema.safeParse(value);
	return result.success ? result.data : undefined;
}

/** Explicit projection: no connection, headers, raw backend objects or mutable store references. */
export function captureMessageModelInfo(
	providerId: ApiProviderId,
	requestedModelId: string | null,
	props: ApiLlamaCppServerProps | null,
	option: ModelOption | null
): MessageModelInfoSnapshot {
	const native = providerId === 'llama-server' ? props : null;
	const modelId =
		bounded(id, requestedModelId ?? native?.model_alias ?? option?.model ?? native?.model_path) ??
		null;
	const aliases = [
		...new Set(
			[
				modelId,
				option?.id,
				option?.model,
				...(option?.aliases ?? []),
				native?.model_alias,
				native?.model_path
			]
				.map((value) => bounded(id, value))
				.filter((value): value is string => Boolean(value))
		)
	].slice(0, 32);
	const snapshot: MessageModelInfoSnapshot = {
		schemaVersion: 1,
		providerId,
		requestedModelId: bounded(id, requestedModelId) ?? null,
		modelId,
		displayName: modelId
			? providerId === 'llama-server'
				? normalizeModelName(modelId)
				: modelId
			: null,
		identity: modelId ? 'verified' : 'unavailable',
		aliases,
		contextSize: bounded(number, native?.default_generation_settings?.n_ctx ?? option?.contextSize)
	};
	if (native) {
		snapshot.native = {
			model_path: bounded(text(8192), native.model_path),
			default_generation_settings: {
				n_ctx: bounded(number, native.default_generation_settings?.n_ctx)
			},
			total_slots: bounded(number, native.total_slots),
			build_info: bounded(text(4096), native.build_info),
			chat_template: bounded(text(MAX_MODEL_CHAT_TEMPLATE_LENGTH), native.chat_template)
		};
		const meta = option?.meta;
		snapshot.meta = {
			n_ctx_train: bounded(number, meta?.n_ctx_train),
			size: bounded(number, meta?.size),
			n_params: bounded(number, meta?.n_params),
			n_embd: bounded(number, meta?.n_embd),
			n_vocab: bounded(number, meta?.n_vocab),
			vocab_type: bounded(z.union([text(256), number]), meta?.vocab_type)
		};
		if (native.modalities)
			snapshot.modalities = {
				vision: bounded(z.boolean(), native.modalities.vision),
				audio: bounded(z.boolean(), native.modalities.audio),
				video: bounded(z.boolean(), native.modalities.video)
			};
	}
	// Parsing and JSON cloning detach all references and remove undefined members.
	return JSON.parse(JSON.stringify(messageModelInfoSnapshotSchema.parse(snapshot)));
}

/** Response identity wins, but only exact verified aliases may retain detailed evidence. */
export function modelInfoForResponse(
	snapshot: MessageModelInfoSnapshot,
	responseModel: string
): MessageModelInfoSnapshot {
	const model = bounded(id, responseModel);
	if (!model)
		return {
			schemaVersion: 1,
			providerId: snapshot.providerId,
			requestedModelId: snapshot.requestedModelId,
			modelId: null,
			displayName: null,
			identity: 'unavailable',
			aliases: []
		};
	const displayName = snapshot.providerId === 'llama-server' ? normalizeModelName(model) : model;
	if (snapshot.aliases.includes(model))
		return {
			...snapshot,
			modelId: model,
			displayName,
			identity: snapshot.identity === 'response-only' ? 'response-only' : 'verified'
		};
	return {
		schemaVersion: 1,
		providerId: snapshot.providerId,
		requestedModelId: snapshot.requestedModelId,
		modelId: model,
		displayName,
		identity: 'response-only',
		aliases: [model]
	};
}
