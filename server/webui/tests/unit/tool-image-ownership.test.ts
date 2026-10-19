import { afterEach, describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { AttachmentType, ContentPartType, MessageRole, ToolSource } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { buildChatBody } from '$lib/services/providers/openai-chat.protocol';
import { buildResponsesBody } from '$lib/services/providers/openai-responses.protocol';
import { getApiProvider } from '$lib/services/providers';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { permissionsStore } from '$lib/stores/permissions.svelte';
import { projectToolHistory } from '$lib/utils/tool-lifecycle';
import { extractToolResultImages } from '$lib/utils/tool-result-images';
import { deriveAgenticSections, parseToolResultWithImages } from '$lib/utils/agentic';
import type { DatabaseMessage, DatabaseMessageExtra } from '$lib/types/database';
import type { ProviderChatCompletionInput } from '$lib/types/provider';

// A 1x1 red RGB PNG with valid signature, IHDR, IDAT and IEND (not the historical YQ==).
const png =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const dataUrl = `data:image/png;base64,${png}`;

const extract = extractToolResultImages;

const toolMessage = (content: string, extra: DatabaseMessageExtra[]): DatabaseMessage => ({
	id: 'result',
	convId: 'synthetic',
	role: MessageRole.TOOL,
	type: 'text',
	content,
	extra,
	toolCallId: 'call-1',
	parent: 'assistant',
	children: [],
	timestamp: 1
});

afterEach(() => vi.restoreAllMocks());

describe('LLP-009: real tool image bytes', () => {
	it('decodes the valid PNG and retains two distinct ordered images and surrounding text', () => {
		const { cleanedResult, attachments } = extract(
			`before\n${dataUrl}\nbetween\n${dataUrl}\nafter`
		);
		expect(attachments).toHaveLength(2);
		expect(attachments.map((item) => item.type)).toEqual([
			AttachmentType.IMAGE,
			AttachmentType.IMAGE
		]);
		expect(attachments[0].name).not.toBe(attachments[1].name);
		const bytes = Buffer.from(png, 'base64');
		expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
		expect(bytes.readUInt32BE(16)).toBe(1);
		expect(bytes.readUInt32BE(20)).toBe(1);
		expect(inflateSync(bytes.subarray(41, 41 + bytes.readUInt32BE(33))).length).toBe(4);
		for (const image of attachments) {
			expect(image).toMatchObject({ type: AttachmentType.IMAGE, base64Url: dataUrl });
			if (image.type === AttachmentType.IMAGE)
				expect(Buffer.from(image.base64Url.split(',')[1], 'base64')).toEqual(bytes);
		}
		expect(cleanedResult).toMatch(
			/^before\n\[Attachment saved: .+\]\nbetween\n\[Attachment saved: .+\]\nafter$/
		);
		expect(
			parseToolResultWithImages(cleanedResult, attachments).filter((line) => line.image)
		).toHaveLength(2);
	});

	it('does not promote unsupported payload, invalid base64 or a fake PNG to an image extra', () => {
		expect(extract('https://example.test/image.png').attachments).toEqual([]);
		expect(extract('data:image/png;base64,%%%').attachments).toEqual([]);
		expect(extract('data:image/png;base64,YQ==').attachments).toEqual([]);
		expect(extract(`data:image/not-real;base64,${png}`).attachments).toEqual([]);
		const corrupt = Buffer.from(png, 'base64');
		corrupt[45] ^= 1; // IDAT content changed, CRC unchanged.
		expect(extract(`data:image/png;base64,${corrupt.toString('base64')}`).attachments).toEqual([]);
	});

	it('retains the confirmed image in projected history after DB conversion, like the live result', () => {
		const { cleanedResult, attachments } = extract(`description\n${dataUrl}`);
		const stored = structuredClone(toolMessage(cleanedResult, attachments));
		const assistant = {
			role: MessageRole.ASSISTANT,
			content: '',
			tool_calls: [
				{
					id: 'call-1',
					type: 'function' as const,
					function: { name: 'synthetic', arguments: '{}' }
				}
			]
		};
		const live = {
			role: MessageRole.TOOL,
			tool_call_id: 'call-1',
			content: [
				{ type: ContentPartType.TEXT, text: cleanedResult },
				{ type: ContentPartType.IMAGE_URL, image_url: { url: dataUrl } }
			]
		};
		const projected = projectToolHistory([
			assistant,
			ChatService.convertDbMessageToApiChatMessageData(stored)
		]);
		expect(projected[1]).toEqual(live);
		expect(
			deriveAgenticSections(
				{
					...stored,
					id: 'assistant',
					role: MessageRole.ASSISTANT,
					toolCalls: JSON.stringify(assistant.tool_calls),
					extra: undefined
				},
				[stored]
			).find((section) => section.toolResultExtras)?.toolResultExtras
		).toEqual(attachments);
	});

	it('keeps text/image/text/image/text order and both deliberately identical extras', () => {
		const { cleanedResult, attachments } = extract(
			`before\n${dataUrl}\nbetween\n${dataUrl}\nafter`
		);
		const tool = ChatService.convertDbMessageToApiChatMessageData(
			toolMessage(cleanedResult, attachments)
		);
		expect(tool.content).toEqual([
			{ type: ContentPartType.TEXT, text: `before\n[Attachment saved: ${attachments[0].name}]` },
			{ type: ContentPartType.IMAGE_URL, image_url: { url: dataUrl } },
			{ type: ContentPartType.TEXT, text: `\nbetween\n[Attachment saved: ${attachments[1].name}]` },
			{ type: ContentPartType.IMAGE_URL, image_url: { url: dataUrl } },
			{ type: ContentPartType.TEXT, text: '\nafter' }
		]);
		const legacy = toolMessage('legacy text', [attachments[0], attachments[0]]);
		expect(
			ChatService.convertDbMessageToApiChatMessageData(legacy).content as unknown[]
		).toHaveLength(3);
	});
});

describe('OWN-007: one confirmed outcome has one persistence channel', () => {
	it('commits the result and extras once without a second attachment callback', async () => {
		const result = `description\n${dataUrl}`;
		const entry = {
			key: 'builtin:synthetic',
			apiName: 'synthetic',
			source: ToolSource.BUILTIN,
			registryGeneration: 1,
			definition: { type: 'function' as const, function: { name: 'synthetic', parameters: {} } }
		};
		vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
			enabled: true,
			maxTurns: 1,
			maxToolPreviewLines: 10
		});
		vi.spyOn(toolsStore, 'hasBuiltinToolsForContext').mockReturnValue(true);
		vi.spyOn(toolsStore, 'getEnabledToolEntriesForLLM').mockReturnValue([entry]);
		vi.spyOn(toolsStore, 'validateToolExecution').mockImplementation(() => undefined);
		const execute = vi
			.spyOn(toolsStore, 'executeTool')
			.mockResolvedValue({ content: result, isError: false });
		vi.spyOn(mcpStore, 'hasEnabledServers').mockReturnValue(false);
		vi.spyOn(permissionsStore, 'hasTool').mockReturnValue(true);
		vi.spyOn(ChatService, 'isProviderRequestContextCurrent').mockReturnValue(true);
		vi.spyOn(ChatService, 'sendMessage').mockImplementation(async (_messages, options) => {
			options?.onToolCallChunk?.(
				JSON.stringify([
					{ id: 'call-1', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
				])
			);
		});
		const states: string[] = [];
		const committed: DatabaseMessage[] = [];
		const flow = await agenticStore.runAgenticFlow({
			conversationId: 'synthetic',
			messages: [{ role: MessageRole.USER, content: 'synthetic' }],
			options: {
				assistantMessageId: 'assistant',
				operationId: 'op',
				providerRequestContext: {
					providerId: 'llama-server',
					serverBaseUrl: 'http://synthetic.test',
					apiKey: '',
					sourceGeneration: 1,
					protocol: 'chat-completions'
				}
			},
			callbacks: {
				onFlowStart: async () => {},
				onAssistantTurnComplete: async () => {},
				onToolCallState: async (_identity, id, outcome) => {
					states.push(outcome.status);
					if (!outcome.result) return undefined;
					const message = toolMessage(outcome.result.content, outcome.result.extras ?? []);
					committed.push(message);
					expect(id).toBe('call-1');
					return message;
				},
				onFlowComplete: async () => {}
			}
		});
		expect(flow.error).toBeUndefined();
		expect(execute).toHaveBeenCalledTimes(1);
		expect(states).toEqual(['started', 'completed']);
		expect(committed).toHaveLength(1);
		expect(committed[0].extra).toHaveLength(1);
		expect(committed[0].toolCallId).toBe('call-1');
	});
});

describe('provider tool image protocol guard', () => {
	const input: ProviderChatCompletionInput = {
		serverBaseUrl: 'https://synthetic.test',
		apiKey: '',
		options: { model: 'synthetic-model', stream: false },
		messages: [
			{
				role: MessageRole.ASSISTANT,
				content: '',
				tool_calls: [
					{ id: 'call-1', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
				]
			},
			{
				role: MessageRole.TOOL,
				tool_call_id: 'call-1',
				content: [
					{ type: ContentPartType.TEXT, text: 'description' },
					{ type: ContentPartType.IMAGE_URL, image_url: { url: dataUrl } }
				]
			}
		]
	};

	it('Chat Completions refuses image_url under role tool', () => {
		expect(() => buildChatBody(input)).toThrow(/tool output.*media/i);
		expect(() => getApiProvider('llama-server').buildChatCompletionRequest(input)).toThrow(
			/tool output.*media/i
		);
	});

	it('Responses refuses unconfirmed image output rather than stringify base64', () => {
		expect(() => buildResponsesBody(input)).toThrow(/tool output.*media/i);
	});
});
