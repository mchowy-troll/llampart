import { describe, expect, it } from 'vitest';
import {
	captureMessageModelInfo,
	modelInfoForResponse,
	messageModelInfoSnapshotSchema,
	MAX_MODEL_CHAT_TEMPLATE_LENGTH
} from '$lib/utils/message-model-info';
import {
	createConversationExportEnvelope,
	parseConversationImport,
	validateConversationImportRecords
} from '$lib/utils/conversation-import-export';
import type { ApiLlamaCppServerProps } from '$lib/types/api';

const props = {
	model_alias: 'Qwen-Test-A',
	model_path: '/synthetic/models/qwen-a.gguf',
	default_generation_settings: { n_ctx: 65536, params: { apiKey: 'SECRET' } },
	total_slots: 2,
	build_info: 'build-A',
	chat_template: 'template-A',
	modalities: { vision: true },
	apiKey: 'SECRET',
	Authorization: 'Bearer SECRET',
	raw: { password: 'SECRET' }
} as unknown as ApiLlamaCppServerProps;
const option = {
	id: 'Qwen-Test-A',
	name: 'A',
	model: 'Qwen-Test-A',
	capabilities: [],
	aliases: ['verified-alias'],
	meta: {
		n_ctx_train: 131072,
		n_params: 8000000000,
		size: 5000000000,
		n_embd: 4096,
		n_vocab: 128000,
		vocab_type: 'bpe',
		raw: 'SECRET'
	}
};
const make = () => captureMessageModelInfo('llama-server', 'Qwen-Test-A', props, option);
const record = (modelInfo = make()) => ({
	conv: { id: 'conversation', name: 'Synthetic', currNode: 'a', lastModified: 1 },
	messages: [
		{
			id: 'a',
			convId: 'conversation',
			type: 'text' as const,
			role: 'assistant' as const,
			timestamp: 1,
			content: 'Answer',
			reasoningContent: 'Reasoning',
			toolCalls: '',
			parent: null,
			children: [],
			model: 'Qwen-Test-A',
			modelInfo,
			timings: { predicted_n: 3 }
		}
	]
});

describe('AUD-010 bounded message evidence', () => {
	it('projects every displayed native field and strips secrets/raw/connection objects', () => {
		const snapshot = make();
		expect(snapshot).toMatchObject({
			schemaVersion: 1,
			providerId: 'llama-server',
			modelId: 'Qwen-Test-A',
			displayName: 'Qwen-Test-A',
			contextSize: 65536,
			identity: 'verified',
			modalities: { vision: true },
			native: {
				model_path: '/synthetic/models/qwen-a.gguf',
				chat_template: 'template-A',
				build_info: 'build-A',
				total_slots: 2
			}
		});
		expect(snapshot.meta).toEqual({
			n_ctx_train: 131072,
			n_params: 8000000000,
			size: 5000000000,
			n_embd: 4096,
			n_vocab: 128000,
			vocab_type: 'bpe'
		});
		expect(
			captureMessageModelInfo('llama-server', 'Qwen-Test-A', props, {
				...option,
				meta: { vocab_type: 2 }
			}).meta?.vocab_type
		).toBe(2);
		expect(JSON.stringify(snapshot)).not.toMatch(
			/SECRET|apiKey|Authorization|Bearer|password|raw|serverBaseUrl/
		);
		const detached = make();
		detached.native!.chat_template = 'changed';
		expect(make().native?.chat_template).toBe('template-A');
	});
	it('retains details only for exact verified aliases, not basename guesses or different response models', () => {
		const snapshot = make();
		expect(modelInfoForResponse(snapshot, 'verified-alias').native).toEqual(snapshot.native);
		expect(modelInfoForResponse(snapshot, '/synthetic/models/qwen-a.gguf').native).toEqual(
			snapshot.native
		);
		for (const model of ['Gemma-Test-B', '/different/models/qwen-a.gguf', 'qwen-a.gguf']) {
			const result = modelInfoForResponse(snapshot, model);
			expect(result.identity).toBe('response-only');
			expect(result.modelId).toBe(model);
			expect(result.native).toBeUndefined();
			expect(result.meta).toBeUndefined();
			expect(result.contextSize).toBeUndefined();
		}
		expect(snapshot.native?.chat_template).toBe('template-A');
	});
	it('keeps non-native metadata sparse, despite arbitrary raw/native input', () => {
		// Both non-native providers use the same projection; one representative is sufficient.
		const provider = 'openai-compatible';
		const snapshot = captureMessageModelInfo(provider, 'provider/model', props, {
			...option,
			contextSize: 32768
		});
		expect(snapshot).toMatchObject({
			providerId: provider,
			modelId: 'provider/model',
			displayName: 'provider/model',
			contextSize: 32768
		});
		expect(snapshot.native).toBeUndefined();
		expect(snapshot.meta).toBeUndefined();
		expect(snapshot.modalities).toBeUndefined();
		const minimal = captureMessageModelInfo(provider, 'provider/model', null, null);
		expect(minimal.contextSize).toBeUndefined();
	});
	it('bounds optional runtime fields without blocking generation; rejects oversized or malformed import', () => {
		const snapshot = captureMessageModelInfo(
			'llama-server',
			'A',
			{
				...props,
				chat_template: 'x'.repeat(MAX_MODEL_CHAT_TEMPLATE_LENGTH + 1),
				model_path: 'https://user:password@synthetic.invalid/model'
			},
			option
		);
		expect(snapshot.native?.chat_template).toBeUndefined();
		expect(snapshot.native?.model_path).toBeUndefined();
		for (const patch of [
			{ schemaVersion: 2 },
			{ native: { chat_template: 'x'.repeat(MAX_MODEL_CHAT_TEMPLATE_LENGTH + 1) } },
			{ contextSize: '65536' },
			{ native: { raw: {} } },
			{ Authorization: 'Bearer SECRET' },
			{ modelId: 'https://user:password@synthetic.invalid' },
			{ contextSize: Infinity }
		]) {
			expect(messageModelInfoSnapshotSchema.safeParse({ ...make(), ...patch }).success).toBe(false);
		}
	});
	it('round-trips optional snapshot in strict V2, retaining reasoning/timings; accepts old records', () => {
		const item = record();
		const exported = createConversationExportEnvelope([item], '2.0.1');
		expect(exported.formatVersion).toBe(2);
		expect(parseConversationImport(JSON.parse(JSON.stringify(exported)))).toEqual([item]);
		const legacy = structuredClone(exported);
		delete legacy.conversations[0].messages[0].modelInfo;
		expect(parseConversationImport(legacy)[0].messages[0].modelInfo).toBeUndefined();
		const invalid = structuredClone(exported);
		(invalid.conversations[0].messages[0] as unknown as { modelInfo: unknown }).modelInfo = {
			...make(),
			contextSize: 'bad'
		};
		expect(() => parseConversationImport(invalid)).toThrow(/modelInfo/);
		expect(() =>
			validateConversationImportRecords([
				{ ...item, messages: [{ ...item.messages[0], role: 'tool' }] }
			])
		).toThrow(/assistant/);
	});
});
