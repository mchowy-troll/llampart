import '../fixtures/verified-backend';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentType, MessageRole, ServerRole, ToolSource } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { ModelsService } from '$lib/services/models.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { permissionsStore } from '$lib/stores/permissions.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import type {
	AgenticFlowOptions,
	AgenticMessageIdentity,
	AgenticToolOutcome
} from '$lib/types/agentic';
import type { ApiProviderId } from '$lib/constants/api-providers';
import type { ProviderProtocol } from '$lib/types/provider';

const originalConfig = { ...settingsStore.config };
const originalRole = serverStore.role;
const originalProps = serverStore.props;
const image =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
// Representative request paths, not evidence of real provider compatibility.
const requestPaths = [
	['llama-server', 'chat-completions'],
	['openai-compatible', 'chat-completions'],
	['openai-compatible', 'responses']
] as const;
const entry = {
	key: 'builtin:synthetic',
	apiName: 'synthetic',
	source: ToolSource.BUILTIN,
	registryGeneration: 1,
	definition: { type: 'function' as const, function: { name: 'synthetic', parameters: {} } }
};

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
		enabled: true,
		maxTurns: 4,
		maxToolPreviewLines: 10
	});
	vi.spyOn(toolsStore, 'hasBuiltinToolsForContext').mockReturnValue(true);
	vi.spyOn(toolsStore, 'getEnabledToolEntriesForLLM').mockReturnValue([entry]);
	vi.spyOn(toolsStore, 'validateToolExecution').mockImplementation(() => undefined);
	vi.spyOn(toolsStore, 'executeTool').mockResolvedValue({
		content: 'CONFIRMED_RESULT',
		isError: false
	});
	vi.spyOn(mcpStore, 'hasEnabledServers').mockReturnValue(false);
	vi.spyOn(permissionsStore, 'hasTool').mockReturnValue(true);
	vi.spyOn(modelsStore, 'fetchModelProps').mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	settingsStore.config = { ...originalConfig };
	serverStore.role = originalRole;
	serverStore.props = originalProps;
	modelsStore.resetAllModelState();
	ChatService.invalidateProviderRequestContexts();
	conversationsStore.clearActiveConversation();
});

async function prepare(
	providerId: ApiProviderId,
	protocol: ProviderProtocol,
	vision: (boolean | undefined)[] = [true, false],
	ids = ['model-A', 'model-B']
) {
	settingsStore.updateMultipleConfig({
		apiProvider: providerId,
		serverBaseUrl: 'http://synthetic.test',
		apiKey: ''
	});
	serverStore.role = providerId === 'llama-server' ? ServerRole.ROUTER : null;
	serverStore.props = { role: 'router' } as ApiLlamaCppServerProps;
	vi.spyOn(ModelsService, 'list').mockResolvedValue({
		object: 'list',
		data: ids.map((id, index) => ({
			id,
			capabilities: {
				reasoning_effort: { supported: true, values: index === 0 ? ['low'] : ['high'] },
				...(vision[index] === undefined ? {} : { vision: vision[index] }),
				...(protocol === 'responses' ? { required_protocol: 'responses' } : {})
			}
		}))
	} as Awaited<ReturnType<typeof ModelsService.list>>);
	await modelsStore.fetch();
	modelsStore.models = modelsStore.models.map((model, index) => ({
		...model,
		modalities: providerId === 'llama-server' ? { vision: vision[index] } : undefined
	}));
	await modelsStore.selectModelById(ids[0]);
}

function providerIO(protocol: ProviderProtocol, toolTurns = 1) {
	const payloads: Record<string, unknown>[] = [];
	const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
		const body = JSON.parse(String(init?.body));
		payloads.push(body);
		const tool = payloads.length <= toolTurns;
		const call = {
			id: `call-${payloads.length}`,
			type: 'function',
			function: { name: 'synthetic', arguments: JSON.stringify({ model: body.model }) }
		};
		const event =
			protocol === 'responses'
				? {
						type: 'response.completed',
						response: {
							id: `response-${payloads.length}`,
							status: 'completed',
							model: body.model,
							output: [
								{ type: 'reasoning', id: 'opaque', encrypted_content: 'SYNTHETIC_OPAQUE' },
								tool
									? {
											type: 'function_call',
											call_id: call.id,
											name: 'synthetic',
											arguments: call.function.arguments
										}
									: { type: 'message', content: [{ type: 'output_text', text: 'FINAL' }] }
							]
						}
					}
				: {
						model: body.model,
						choices: [
							{
								delta: tool ? { tool_calls: [{ ...call, index: 0 }] } : { content: 'FINAL' },
								finish_reason: tool ? 'tool_calls' : 'stop'
							}
						]
					};
		return new Response(
			`data: ${JSON.stringify(event)}\n\n${protocol === 'responses' ? '' : 'data: [DONE]\n\n'}`,
			{
				headers: { 'Content-Type': 'text/event-stream' }
			}
		);
	});
	vi.stubGlobal('fetch', fetchMock);
	return { payloads, fetchMock };
}

function flow(
	options: AgenticFlowOptions = {},
	signal?: AbortSignal,
	conversationId = 'synthetic-operation'
) {
	let assistant = 0;
	const callbacks = {
		onFlowStart: vi.fn(async () => undefined),
		onAssistantTurnComplete: vi.fn(async () => undefined),
		onToolCallState: vi.fn(
			async (identity: AgenticMessageIdentity, toolCallId: string, outcome: AgenticToolOutcome) =>
				outcome.result
					? ({
							id: `tool-${toolCallId}`,
							convId: identity.conversationId,
							role: MessageRole.TOOL,
							type: 'text',
							content: outcome.result.content,
							extra: outcome.result.extras,
							toolCallId,
							parent: identity.assistantMessageId,
							children: [],
							timestamp: 1
						} satisfies DatabaseMessage)
					: undefined
		),
		onFlowComplete: vi.fn(async () => undefined),
		onError: vi.fn(),
		createAssistantMessage: vi.fn(
			async () => ({ id: `assistant-${++assistant}` }) as DatabaseMessage
		)
	};
	return {
		callbacks,
		pending: agenticStore.runAgenticFlow({
			conversationId,
			messages: [{ role: MessageRole.USER, content: 'Synthetic question' }],
			options: {
				assistantMessageId: 'first',
				operationId: 'operation',
				providerRequestContext: ChatService.createProviderRequestContext(),
				...options
			},
			callbacks,
			signal
		})
	};
}

describe.each(requestPaths)('operation model %s/%s', (providerId, protocol) => {
	it('keeps operation A after switching conversation and selector, then uses B for the next operation', async () => {
		await prepare(providerId, protocol);
		conversationsStore.activeConversation = {
			id: 'A',
			reasoning: { mode: 'effort', value: 'low' }
		} as DatabaseConversation;
		const context = ChatService.createProviderRequestContext();
		const operationModel = ChatService.captureOperationModel(context, undefined, undefined, {
			conversationId: 'A'
		});
		const { payloads } = providerIO(protocol);
		const ready = deferred(),
			gate = deferred();
		vi.mocked(toolsStore.executeTool).mockImplementation(async () => {
			ready.resolve();
			await gate.promise;
			return { content: 'CONFIRMED_RESULT', isError: false };
		});
		const { pending, callbacks } = flow(
			{ operationModel, providerRequestContext: context },
			undefined,
			'A'
		);
		await Promise.race([
			ready.promise,
			pending.then(() => {
				throw new Error(`Ended before tool: ${callbacks.onError.mock.calls}`);
			})
		]);
		conversationsStore.activeConversation = {
			id: 'B',
			reasoning: { mode: 'effort', value: 'high' }
		} as DatabaseConversation;
		await modelsStore.selectModelById('model-B');
		gate.resolve();
		await pending;
		expect(payloads).toHaveLength(2);
		for (const body of payloads) {
			expect(body.model).toBe('model-A');
			expect(body).not.toHaveProperty('reasoning_effort');
			expect(body).not.toHaveProperty('reasoning');
			expect(body).not.toHaveProperty('chat_template_kwargs');
		}
		expect(callbacks.onFlowComplete).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'completed' })
		);
		if (protocol === 'responses') {
			expect(payloads.every((body) => body.store === false)).toBe(true);
			expect(JSON.stringify(payloads[1])).toContain('SYNTHETIC_OPAQUE');
		}
		await flow({}, undefined, 'B').pending;
		expect(payloads.at(-1)?.model).toBe('model-B');
	});
});

describe('operation model ownership', () => {
	it('preserves an explicit override and exact provider ID over selector changes', async () => {
		const exact = 'org/nested/model-B';
		await prepare('openai-compatible', 'responses', [false, true], ['model-A', exact]);
		const { payloads } = providerIO('responses', 2);
		vi.mocked(toolsStore.executeTool).mockImplementation(async () => {
			await modelsStore.selectModelById(
				modelsStore.selectedModelId === 'model-A' ? exact : 'model-A'
			);
			return { content: 'CONFIRMED_RESULT', isError: false };
		});
		await flow({ model: exact }).pending;
		expect(payloads.map((body) => body.model)).toEqual([exact, exact, exact]);
	});

	it.each([true, undefined])(
		'preserves image input for vision=%s on the second model',
		async (vision) => {
			await prepare('openai-compatible', 'chat-completions', [false, vision]);
			await modelsStore.selectModelById('model-B');
			const { payloads } = providerIO('chat-completions', 0);
			await ChatService.sendMessage(
				[{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }],
				{
					model: 'model-B',
					stream: true
				}
			);
			expect(JSON.stringify(payloads)).toContain(image);
			if (vision === undefined)
				expect(modelsStore.capabilitySnapshot?.features.vision.state).toBe('unknown');
		}
	);

	it('rejects an explicitly text-only active image before I/O without mutating history', async () => {
		await prepare('openai-compatible', 'chat-completions', [true, false]);
		await modelsStore.selectModelById('model-B');
		const { fetchMock } = providerIO('chat-completions', 0);
		const history: DatabaseMessage[] = [
			{
				id: 'user',
				convId: 'synthetic',
				timestamp: 1,
				parent: 'root',
				children: [],
				role: MessageRole.USER,
				type: 'text',
				content: 'image',
				toolCalls: '',
				extra: [{ type: AttachmentType.IMAGE, name: 'synthetic.png', base64Url: image }]
			}
		];
		const before = structuredClone(history);
		await expect(
			ChatService.sendMessage(history, { model: 'model-B', stream: true })
		).rejects.toThrow(/vision/i);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(history).toEqual(before);
	});

	it('does not fall back when the operation model disappears from the catalog', async () => {
		await prepare('openai-compatible', 'chat-completions');
		const { payloads } = providerIO('chat-completions');
		vi.mocked(toolsStore.executeTool).mockImplementation(async () => {
			modelsStore.models = modelsStore.models.filter((model) => model.model !== 'model-A');
			await modelsStore.selectModelById('model-B');
			return { content: 'CONFIRMED_RESULT', isError: false };
		});
		await flow().pending;
		expect(payloads.map((body) => body.model)).toEqual(['model-A', 'model-A']);
	});

	it('does not send the next turn to a changed provider context', async () => {
		await prepare('openai-compatible', 'chat-completions');
		const { payloads } = providerIO('chat-completions');
		const controller = new AbortController();
		vi.mocked(toolsStore.executeTool).mockImplementation(async () => {
			settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://changed.synthetic.test' });
			ChatService.invalidateProviderRequestContexts();
			controller.abort();
			return { content: 'CONFIRMED_RESULT', isError: false };
		});
		await flow({ model: 'model-A' }, controller.signal).pending;
		expect(payloads.map((body) => body.model)).toEqual(['model-A']);
	});

	it('captures before asynchronous tool discovery, not after it', async () => {
		await prepare('openai-compatible', 'chat-completions');
		const ready = deferred(),
			gate = deferred();
		vi.mocked(mcpStore.hasEnabledServers).mockReturnValue(true);
		vi.spyOn(mcpStore, 'ensureInitialized').mockImplementation(async () => {
			ready.resolve();
			await gate.promise;
			return false;
		});
		const { payloads } = providerIO('chat-completions', 0);
		const { pending } = flow();
		await ready.promise;
		await modelsStore.selectModelById('model-B');
		gate.resolve();
		await pending;
		expect(payloads.map((body) => body.model)).toEqual(['model-A']);
	});

	it('keeps capabilities with the operation across catalog mutations and other refreshes', async () => {
		await prepare('llama-server', 'chat-completions', [false, true]);
		const context = ChatService.createProviderRequestContext();
		const operationModel = ChatService.captureOperationModel(context);
		// The freshness barrier binds evidence before the first request. Once bound,
		// subsequent catalog mutations cannot replace the operation's frozen evidence.
		await operationModel.capabilities;
		if (modelsStore.models[0].modalities) modelsStore.models[0].modalities.vision = true;
		await modelsStore.selectModelById('model-B');
		await modelsStore.refreshCapabilities(context, 'model-B');
		modelsStore.models = [...modelsStore.models].reverse();
		const { fetchMock } = providerIO('chat-completions', 0);
		await expect(
			ChatService.sendMessage(
				[{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }],
				{
					operationModel,
					providerRequestContext: context,
					stream: true
				}
			)
		).rejects.toThrow(/vision/i);
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await operationModel.capabilities)?.features.vision.state).toBe('unsupported');
	});

	it('isolates simultaneous A and B flows', async () => {
		await prepare('openai-compatible', 'responses');
		const { payloads } = providerIO('responses', 2);
		const aReady = deferred(),
			aGate = deferred(),
			bReady = deferred(),
			bGate = deferred();
		vi.mocked(toolsStore.executeTool).mockImplementation(async (_entry, args) => {
			const ready = args.model === 'model-A' ? aReady : bReady;
			const gate = args.model === 'model-A' ? aGate : bGate;
			ready.resolve();
			await gate.promise;
			return { content: 'CONFIRMED_RESULT', isError: false };
		});
		const a = flow({}, undefined, 'conversation-A');
		await aReady.promise;
		await modelsStore.selectModelById('model-B');
		const b = flow({}, undefined, 'conversation-B');
		await bReady.promise;
		aGate.resolve();
		await a.pending;
		bGate.resolve();
		await b.pending;
		expect(payloads.map((body) => body.model)).toEqual([
			'model-A',
			'model-B',
			'model-A',
			'model-B'
		]);
	});

	it('preserves tool image history when its backend cannot accept tool images', async () => {
		await prepare('llama-server', 'chat-completions', [true, true]);
		const { fetchMock } = providerIO('chat-completions', 0);
		const history: DatabaseMessage[] = [
			{
				id: 'assistant',
				convId: 'synthetic',
				timestamp: 1,
				parent: 'user',
				children: ['result'],
				role: MessageRole.ASSISTANT,
				type: 'text',
				content: '',
				toolCalls: JSON.stringify([
					{ id: 'call-1', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
				])
			},
			{
				id: 'result',
				convId: 'synthetic',
				timestamp: 2,
				parent: 'assistant',
				children: [],
				role: MessageRole.TOOL,
				type: 'text',
				content: 'description',
				toolCallId: 'call-1',
				extra: [{ type: AttachmentType.IMAGE, name: 'synthetic.png', base64Url: image }]
			}
		];
		const before = structuredClone(history);
		expect(ChatService.convertDbMessageToApiChatMessageData(history[1]).content).toEqual([
			{ type: 'text', text: 'description' },
			{ type: 'image_url', image_url: { url: image } }
		]);
		await expect(
			ChatService.sendMessage(history, { model: 'model-B', stream: true })
		).rejects.toThrow(/tool result images.*not sent/i);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(history).toEqual(before);
	});

	it('does not redirect A tool PNG to concurrent B or interrupt B when A continuation is refused', async () => {
		await prepare('openai-compatible', 'chat-completions', [true, true]);
		const { payloads } = providerIO('chat-completions', 1);
		const ready = deferred(),
			gate = deferred();
		vi.mocked(toolsStore.executeTool).mockImplementation(async () => {
			ready.resolve();
			await gate.promise;
			return { content: `CONFIRMED_RESULT\n${image}`, isError: false };
		});
		const a = flow({ model: 'model-A' }, undefined, 'conversation-A');
		await ready.promise;
		const b = flow({ model: 'model-B' }, undefined, 'conversation-B');
		await b.pending;
		gate.resolve();
		await a.pending;
		expect(payloads.map((body) => body.model)).toEqual(['model-A', 'model-B']);
		expect(a.callbacks.onToolCallState).toHaveBeenCalledWith(
			expect.objectContaining({ conversationId: 'conversation-A' }),
			'call-1',
			expect.objectContaining({
				status: 'completed',
				result: expect.objectContaining({ extras: [expect.objectContaining({ base64Url: image })] })
			})
		);
		expect(a.callbacks.onFlowComplete).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'error' })
		);
		expect(b.callbacks.onFlowComplete).toHaveBeenCalledWith(
			expect.objectContaining({ reason: 'completed' })
		);
	});
});

describe('agentic image capability ownership', () => {
	it.each([true, false])(
		'keeps tool images owned by selected B (vision=%s), not the first model',
		async (vision) => {
			await prepare('llama-server', 'chat-completions', [!vision, vision]);
			await modelsStore.selectModelById('model-B');
			const { payloads } = providerIO('chat-completions');
			vi.mocked(toolsStore.executeTool).mockResolvedValue({
				content: `CONFIRMED_RESULT\n${image}`,
				isError: false
			});
			const { pending, callbacks } = flow();
			await pending;
			expect(payloads.map((body) => body.model)).toEqual(['model-B']);
			expect(callbacks.onToolCallState).toHaveBeenCalledWith(
				expect.anything(),
				'call-1',
				expect.objectContaining({
					status: 'completed',
					result: expect.objectContaining({
						extras: [expect.objectContaining({ base64Url: image })]
					})
				})
			);
			expect(callbacks.onFlowComplete).toHaveBeenCalledWith(
				expect.objectContaining({ reason: 'error' })
			);
			expect(callbacks.onError).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringMatching(vision ? /tool result images/i : /vision/i)
				})
			);
		}
	);
});

describe('model defaults and auxiliary requests', () => {
	it('preserves native selector/history/override priorities without catalog fallback', async () => {
		await prepare('llama-server', 'chat-completions');
		const context = ChatService.createProviderRequestContext();
		expect(ChatService.captureOperationModel(context, undefined, 'history-model').model).toBe(
			'model-A'
		);
		modelsStore.clearSelection();
		expect(ChatService.captureOperationModel(context, undefined, 'history-model').model).toBe(
			'history-model'
		);
		expect(
			ChatService.captureOperationModel(context, 'exact-override', 'history-model').model
		).toBe('exact-override');
		expect(ChatService.captureOperationModel(context).model).toBeNull();
	});

	it('fills missing native evidence only from props of the captured model before I/O', async () => {
		await prepare('llama-server', 'chat-completions', [undefined, true]);
		const ready = deferred(),
			gate = deferred();
		vi.mocked(modelsStore.fetchModelProps).mockImplementation(async (model) => {
			expect(model).toBe('model-A');
			ready.resolve();
			await gate.promise;
			return { modalities: { vision: false } } as ApiLlamaCppServerProps;
		});
		const operationModel = ChatService.captureOperationModel(
			ChatService.createProviderRequestContext()
		);
		await ready.promise;
		await modelsStore.selectModelById('model-B');
		const { fetchMock } = providerIO('chat-completions', 0);
		const pending = ChatService.sendMessage(
			[{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }],
			{ operationModel }
		);
		expect(fetchMock).not.toHaveBeenCalled();
		gate.resolve();
		await expect(pending).rejects.toThrow(/vision/i);
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await operationModel.capabilities)?.model).toBe('model-A');
	});

	it.each(['generation', 'provider', 'address'] as const)(
		'does not retarget an operation-only binding after a %s switch',
		async (kind) => {
			await prepare('openai-compatible', 'chat-completions');
			const operationModel = ChatService.captureOperationModel(
				ChatService.createProviderRequestContext()
			);
			await operationModel.capabilities;
			if (kind === 'generation') ChatService.invalidateProviderRequestContexts();
			if (kind === 'provider') settingsStore.updateMultipleConfig({ apiProvider: 'vllm' });
			if (kind === 'address')
				settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://changed.synthetic.test' });
			const { fetchMock } = providerIO('chat-completions', 0);
			await ChatService.sendMessage([{ role: 'user', content: 'text' }], { operationModel });
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it.each(['llama-server', 'openai-compatible'] as const)(
		'keeps an exact auto ID for %s rather than interpreting a sentinel',
		async (provider) => {
			await prepare(provider, 'chat-completions', [true], ['auto']);
			const { payloads } = providerIO('chat-completions', 0);
			await flow().pending;
			expect(payloads[0].model).toBe('auto');
		}
	);

	it('does not replace a captured missing compatible model with a later selection', async () => {
		await prepare('openai-compatible', 'chat-completions');
		modelsStore.clearSelection();
		const context = ChatService.createProviderRequestContext();
		const operationModel = ChatService.captureOperationModel(context);
		await modelsStore.selectModelById('model-B');
		const { fetchMock } = providerIO('chat-completions', 0);
		await expect(
			ChatService.sendMessage([{ role: 'user', content: 'text' }], {
				operationModel,
				providerRequestContext: context
			})
		).rejects.toThrow(/exact model ID/);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(operationModel.model).toBeNull();
	});

	it('keeps native MODEL wire omission while validating single-server vision props', async () => {
		await prepare('llama-server', 'chat-completions');
		serverStore.role = ServerRole.MODEL;
		serverStore.props = { modalities: { vision: false } } as ApiLlamaCppServerProps;
		const context = ChatService.createProviderRequestContext();
		const operationModel = ChatService.captureOperationModel(context);
		const { payloads, fetchMock } = providerIO('chat-completions', 0);
		await expect(
			ChatService.sendMessage(
				[{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }],
				{
					operationModel,
					stream: true
				}
			)
		).rejects.toThrow(/vision/i);
		expect(fetchMock).not.toHaveBeenCalled();
		await ChatService.sendMessage([{ role: 'user', content: 'text' }], {
			operationModel,
			stream: true
		});
		expect(payloads[0]).not.toHaveProperty('model');
	});

	it('uses the operation binding for auxiliary title generation', async () => {
		await prepare('openai-compatible', 'chat-completions');
		const providerRequestContext = ChatService.createProviderRequestContext();
		const operationModel = ChatService.captureOperationModel(
			providerRequestContext,
			undefined,
			undefined,
			{ conversationId: 'A' }
		);
		conversationsStore.activeConversation = {
			id: 'B',
			reasoning: { mode: 'effort', value: 'high' }
		} as DatabaseConversation;
		await modelsStore.selectModelById('model-B');
		const { payloads } = providerIO('chat-completions', 0);
		await ChatService.generateTitle({ role: 'user', content: 'title' }, null, undefined, {
			providerRequestContext,
			operationModel
		});
		expect(payloads.map((body) => body.model)).toEqual(['model-A']);
		expect(payloads[0]).not.toHaveProperty('reasoning_effort');
		expect(payloads[0]).not.toHaveProperty('chat_template_kwargs');
	});

	it('keeps pre-encode bound to A after a selector change and does not silently drop images', async () => {
		await prepare('llama-server', 'chat-completions', [true, false]);
		const context = ChatService.createProviderRequestContext();
		const operationModel = ChatService.captureOperationModel(context, undefined, undefined, {
			conversationId: 'A'
		});
		await modelsStore.selectModelById('model-B');
		const { payloads } = providerIO('chat-completions', 0);
		const history: ApiChatMessageData[] = [
			{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }] }
		];
		await ChatService.preEncode(history, context, 'model-B', false, undefined, operationModel);
		expect(payloads[0]).toMatchObject({
			model: 'model-A',
			stream: false,
			n_predict: 0
		});
		expect(payloads[0]).not.toHaveProperty('chat_template_kwargs');
		expect(JSON.stringify(payloads[0])).toContain(image);
		const textOnly = ChatService.captureOperationModel(context, 'model-B');
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await ChatService.preEncode(history, context, 'model-B', false, undefined, textOnly);
		expect(payloads).toHaveLength(1);
		expect(warning).toHaveBeenCalledWith(
			'[ChatService] Pre-encode request failed:',
			expect.objectContaining({ message: expect.stringMatching(/vision/i) })
		);
	});
});
