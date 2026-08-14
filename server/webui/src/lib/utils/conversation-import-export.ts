import { z } from 'zod';
import type { ExportedConversation } from '$lib/types/database';

export const CONVERSATION_EXPORT_TYPE = 'llampart-conversations';
export const CONVERSATION_EXPORT_FORMAT_VERSION = 1;

export interface ConversationExportEnvelopeV1 {
	type: typeof CONVERSATION_EXPORT_TYPE;
	formatVersion: typeof CONVERSATION_EXPORT_FORMAT_VERSION;
	appVersion: string;
	exportedAt: string;
	conversations: ExportedConversation[];
}

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const mcpServerOverrideSchema = z
	.object({ serverId: nonEmptyString, enabled: z.boolean() })
	.strict();
const conversationSchema = z
	.object({
		id: nonEmptyString,
		name: z.string(),
		currNode: z.string().nullable(),
		lastModified: finiteNumber,
		pinned: z.boolean().optional(),
		mcpServerOverrides: z.array(mcpServerOverrideSchema).optional(),
		thinkingEnabled: z.boolean().optional(),
		reasoningEffort: z.enum(['low', 'medium', 'high', 'max']).optional(),
		forkedFromConversationId: z.string().optional()
	})
	.strict();
const toolCallTimingSchema = z
	.object({ name: z.string(), duration_ms: finiteNumber, success: z.boolean() })
	.strict();
const llmTimingsSchema = z
	.object({
		predicted_n: finiteNumber,
		predicted_ms: finiteNumber,
		prompt_n: finiteNumber,
		prompt_ms: finiteNumber
	})
	.strict();
const agenticTurnTimingsSchema = z
	.object({
		turn: finiteNumber,
		llm: llmTimingsSchema,
		toolCalls: z.array(toolCallTimingSchema),
		toolsMs: finiteNumber
	})
	.strict();
const agenticTimingsSchema = z
	.object({
		turns: finiteNumber,
		toolCallsCount: finiteNumber,
		toolsMs: finiteNumber,
		toolCalls: z.array(toolCallTimingSchema).optional(),
		perTurn: z.array(agenticTurnTimingsSchema).optional(),
		llm: llmTimingsSchema
	})
	.strict();
const messageTimingsSchema = z
	.object({
		cache_n: finiteNumber.optional(),
		context_total: finiteNumber.optional(),
		draft_n: finiteNumber.optional(),
		draft_n_accepted: finiteNumber.optional(),
		predicted_ms: finiteNumber.optional(),
		predicted_n: finiteNumber.optional(),
		predicted_per_second: finiteNumber.optional(),
		predicted_per_token_ms: finiteNumber.optional(),
		prompt_ms: finiteNumber.optional(),
		prompt_n: finiteNumber.optional(),
		prompt_per_second: finiteNumber.optional(),
		prompt_per_token_ms: finiteNumber.optional(),
		agentic: agenticTimingsSchema.optional()
	})
	.strict();
const messageExtraSchema = z.discriminatedUnion('type', [
	z
		.object({
			type: z.literal('AUDIO'),
			name: z.string(),
			base64Data: z.string(),
			mimeType: z.string()
		})
		.strict(),
	z
		.object({
			type: z.literal('VIDEO'),
			name: z.string(),
			base64Data: z.string(),
			mimeType: z.string()
		})
		.strict(),
	z.object({ type: z.literal('IMAGE'), name: z.string(), base64Url: z.string() }).strict(),
	z.object({ type: z.literal('context'), name: z.string(), content: z.string() }).strict(),
	z
		.object({
			type: z.literal('PDF'),
			base64Data: z.string(),
			name: z.string(),
			content: z.string(),
			images: z.array(z.string()).optional(),
			processedAsImages: z.boolean()
		})
		.strict(),
	z
		.object({
			type: z.literal('TEXT'),
			name: z.string(),
			content: z.string(),
			source: z.literal('PASTED_TEXT').optional()
		})
		.strict(),
	z
		.object({
			type: z.literal('MCP_PROMPT'),
			name: z.string(),
			serverName: z.string(),
			promptName: z.string(),
			content: z.string(),
			arguments: z.record(z.string(), z.string()).optional()
		})
		.strict(),
	z
		.object({
			type: z.literal('MCP_RESOURCE'),
			name: z.string(),
			uri: z.string(),
			serverName: z.string(),
			content: z.string(),
			mimeType: z.string().optional()
		})
		.strict()
]);
const messageShape = {
	id: nonEmptyString,
	convId: nonEmptyString,
	type: z.enum(['root', 'text', 'think', 'system']),
	timestamp: finiteNumber,
	role: z.enum(['user', 'assistant', 'system', 'tool']),
	content: z.string(),
	parent: nonEmptyString.nullable(),
	children: z.array(nonEmptyString),
	thinking: z.string().optional(),
	reasoningContent: z.string().optional(),
	completionId: z.string().optional(),
	toolCallId: z.string().optional(),
	extra: z.array(messageExtraSchema).optional(),
	timings: messageTimingsSchema.optional(),
	model: z.string().nullable().optional()
};
const strictMessageSchema = z.object({ ...messageShape, toolCalls: z.string() }).strict();
const legacyMessageSchema = z
	.object({ ...messageShape, toolCalls: z.string().optional().default('') })
	.passthrough();
const strictConversationExportSchema = z
	.object({ conv: conversationSchema, messages: z.array(strictMessageSchema) })
	.strict();
const legacyConversationExportSchema = z
	.object({ conv: conversationSchema.passthrough(), messages: z.array(legacyMessageSchema) })
	.passthrough();
const envelopeSchema = z
	.object({
		type: z.literal(CONVERSATION_EXPORT_TYPE),
		formatVersion: z.literal(CONVERSATION_EXPORT_FORMAT_VERSION),
		appVersion: z.string(),
		exportedAt: z.string(),
		conversations: z.array(strictConversationExportSchema)
	})
	.strict();

function formatImportError(error: z.ZodError): Error {
	const issue = error.issues[0];
	const path = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
	return new Error(`Invalid conversation export${path}: ${issue?.message ?? 'invalid value'}`);
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw formatImportError(result.error);
	return result.data;
}

/** Runtime-validates records passed directly to the strict database import preflight. */
export function validateConversationImportRecords(value: unknown): ExportedConversation[] {
	return parseWithSchema(z.array(strictConversationExportSchema), value) as ExportedConversation[];
}

function createLegacyRootId(conversationId: string, messages: DatabaseMessage[]): string {
	const usedIds = new Set(messages.map((message) => message.id));
	let candidate = `${conversationId}-legacy-root`;
	let suffix = 1;
	while (usedIds.has(candidate)) candidate = `${conversationId}-legacy-root-${suffix++}`;
	return candidate;
}

function normalizeRootlessLegacyConversation(item: ExportedConversation): ExportedConversation {
	const { conv, messages } = item;
	if (messages.length === 0) {
		if (conv.currNode !== null && conv.currNode !== '') {
			throw new Error(`Legacy conversation ${conv.id} has currNode but no messages`);
		}
		return item;
	}

	const graph = new Map<string, DatabaseMessage>();
	for (const message of messages) {
		if (graph.has(message.id)) {
			throw new Error(`Duplicate message ID in legacy conversation ${conv.id}: ${message.id}`);
		}
		if (message.convId !== conv.id) {
			throw new Error(`Message ${message.id} does not belong to legacy conversation ${conv.id}`);
		}
		graph.set(message.id, message);
	}

	const includedParents = new Set(
		messages
			.map((message) => message.parent)
			.filter((parent): parent is string => parent !== null && graph.has(parent))
	);
	const visibleLeaves = messages.filter((message) => !includedParents.has(message.id));
	if (visibleLeaves.length !== 1) {
		throw new Error(`Legacy conversation ${conv.id} does not contain one exact visible leaf`);
	}

	const visibleLeaf = visibleLeaves[0];
	if (conv.currNode && graph.has(conv.currNode) && conv.currNode !== visibleLeaf.id) {
		throw new Error(`Legacy conversation ${conv.id} currNode is not its visible leaf`);
	}

	const path: DatabaseMessage[] = [];
	const visited = new Set<string>();
	let current: DatabaseMessage | undefined = visibleLeaf;
	while (current) {
		if (visited.has(current.id)) throw new Error(`Legacy conversation ${conv.id} contains a cycle`);
		visited.add(current.id);
		path.unshift(current);
		current = current.parent ? graph.get(current.parent) : undefined;
	}
	if (visited.size !== messages.length) {
		throw new Error(`Legacy conversation ${conv.id} contains an ambiguous or broken path`);
	}

	const first = path[0];
	if (first.type === 'root' || (first.role !== 'user' && first.role !== 'system')) {
		throw new Error(`Legacy conversation ${conv.id} has an invalid first visible message`);
	}
	const rootId =
		first.parent && !graph.has(first.parent) ? first.parent : createLegacyRootId(conv.id, messages);
	const normalizedPath = path.map((message, index) => ({
		...message,
		toolCalls: message.toolCalls ?? '',
		parent: index === 0 ? rootId : path[index - 1].id,
		children: index === path.length - 1 ? [] : [path[index + 1].id]
	}));
	const root: DatabaseMessage = {
		id: rootId,
		convId: conv.id,
		type: 'root',
		role: 'system',
		content: '',
		timestamp: first.timestamp,
		toolCalls: '',
		parent: null,
		children: [first.id]
	};

	return {
		...item,
		conv: { ...conv, currNode: visibleLeaf.id },
		messages: [root, ...normalizedPath]
	};
}

function parseLegacyConversations(value: unknown): ExportedConversation[] {
	const values = Array.isArray(value) ? value : [value];
	const parsed = parseWithSchema(z.array(legacyConversationExportSchema), values);
	return parsed.map((item) => {
		const roots = item.messages.filter((message) => message.type === 'root');
		return roots.length === 0
			? normalizeRootlessLegacyConversation(item as ExportedConversation)
			: (item as ExportedConversation);
	});
}

export function createConversationExportEnvelope(
	conversations: ExportedConversation[],
	appVersion: string
): ConversationExportEnvelopeV1 {
	return {
		type: CONVERSATION_EXPORT_TYPE,
		formatVersion: CONVERSATION_EXPORT_FORMAT_VERSION,
		appVersion,
		exportedAt: new Date().toISOString(),
		conversations: conversations.map((item) => ({
			...item,
			messages: item.messages.map((message) => ({
				...message,
				toolCalls: message.toolCalls ?? ''
			}))
		}))
	};
}

/** Parses V1 exports and explicitly migrates the shipped single/array V0 shape. */
export function parseConversationImport(value: unknown): ExportedConversation[] {
	if (typeof value === 'object' && value !== null && 'type' in value) {
		const envelope = value as Partial<ConversationExportEnvelopeV1>;
		if (envelope.type !== CONVERSATION_EXPORT_TYPE) {
			throw new Error('Invalid conversation export type');
		}
		if (envelope.formatVersion !== CONVERSATION_EXPORT_FORMAT_VERSION) {
			throw new Error(`Unsupported conversation export version: ${String(envelope.formatVersion)}`);
		}
		return parseWithSchema(envelopeSchema, value).conversations as ExportedConversation[];
	}

	return parseLegacyConversations(value);
}
