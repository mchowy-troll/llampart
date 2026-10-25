import '../fixtures/verified-backend';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, MessageType, ServerRole } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { DatabaseService } from '$lib/services/database.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import type { McpServerOverride } from '$lib/types/database';

const originalConfig = { ...settingsStore.config };
const originalServerRole = serverStore.role;
const originalModelName = modelsStore.selectedModelName;
const getAgenticConfig = agenticStore.getConfig.bind(agenticStore);
const runAgenticFlow = agenticStore.runAgenticFlow.bind(agenticStore);

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

function message(id: string, convId: string, parent: string | null): DatabaseMessage {
	return {
		id,
		convId,
		parent,
		children: [],
		content: id,
		timestamp: 1,
		toolCalls: '',
		role: parent ? MessageRole.USER : MessageRole.SYSTEM,
		type: parent ? MessageType.TEXT : MessageType.ROOT
	};
}

let rows: DatabaseMessage[];
let conversations: DatabaseConversation[];
let sequence: number;

beforeEach(async () => {
	sequence = 0;
	rows = ['A', 'B'].flatMap((id) => [
		{ ...message(`${id}-root`, id, null), children: [`${id}-user`] },
		message(`${id}-user`, id, `${id}-root`)
	]);
	conversations = ['A', 'B'].map((id) => ({
		id,
		name: id,
		currNode: `${id}-user`,
		lastModified: 1
	}));
	vi.spyOn(DatabaseService, 'getConversation').mockImplementation(async (id) =>
		structuredClone(conversations.find((item) => item.id === id))
	);
	vi.spyOn(DatabaseService, 'getConversationMessages').mockImplementation(async (id) =>
		structuredClone(rows.filter((item) => item.convId === id))
	);
	vi.spyOn(DatabaseService, 'createMessageBranch').mockImplementation(async (input, parent) => {
		const created = { ...input, parent, id: `created-${++sequence}` } as DatabaseMessage;
		expect(rows.find((item) => item.id === parent)?.convId).toBe(input.convId);
		rows.push(created);
		rows.find((item) => item.id === parent)!.children.push(created.id);
		conversations.find((item) => item.id === input.convId)!.currNode = created.id;
		return structuredClone(created);
	});
	vi.spyOn(DatabaseService, 'updateCurrentNode').mockImplementation(async (id, node) => {
		// Deliberately allow the old broken write; assertions must catch it, not hide it.
		const target = conversations.find((item) => item.id === id)!;
		target.currNode = node;
		target.lastModified++;
	});
	vi.spyOn(DatabaseService, 'updateMessage').mockImplementation(async (id, updates) => {
		Object.assign(rows.find((item) => item.id === id)!, updates);
	});
	vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
		enabled: false,
		maxTurns: 1,
		maxToolPreviewLines: 10
	});
	vi.spyOn(ChatService, 'sendMessage').mockImplementation(async (history, options, convId) => {
		expect(history.every((item) => !('convId' in item) || item.convId === convId)).toBe(true);
		await options?.onComplete?.('Synthetic answer');
	});
	conversationsStore.conversations = structuredClone(conversations);
	await conversationsStore.loadConversation('A');
});

afterEach(() => {
	settingsStore.config = { ...originalConfig };
	serverStore.role = originalServerRole;
	modelsStore.selectedModelName = originalModelName;
	vi.restoreAllMocks();
	conversationsStore.clearActiveConversation();
	conversationsStore.conversations = [];
	chatStore.chatLoadingStates.clear();
	chatStore.chatStreamingStates.clear();
	chatStore.clearUIState();
	vi.unstubAllGlobals();
});

describe('serialized operation ownership', () => {
	// Ownership is provider-independent; one serialized request covers this persistence race.
	it('keeps the A request snapshot when navigation and settings change during persistence', async () => {
		vi.mocked(ChatService.sendMessage).mockRestore();
		settingsStore.updateMultipleConfig({
			apiProvider: 'llama-server',
			serverBaseUrl: 'http://reasoning.test',
			apiKey: 'operation-key',
			top_p: 0.7,
			preEncodeConversation: false
		});
		serverStore.role = ServerRole.ROUTER;
		modelsStore.selectedModelName = 'model-A';
		vi.spyOn(modelsStore, 'fetchRouterModels').mockResolvedValue();
		vi.spyOn(modelsStore, 'refreshCapabilities').mockImplementation((context, model) =>
			createCapabilitySnapshot(context, model ?? null, {})
		);
		const requests: {
			url: string;
			body: Record<string, unknown>;
			headers: Record<string, string>;
		}[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url, init) => {
				requests.push({
					url: String(url),
					body: JSON.parse(String(init.body)),
					headers: init.headers
				});
				const event = {
					model: 'model-A',
					choices: [{ delta: { content: 'A answer' }, finish_reason: 'stop' }]
				};
				return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
					headers: { 'Content-Type': 'text/event-stream' }
				});
			})
		);
		const ready = deferred(),
			gate = deferred();
		const create = vi.mocked(DatabaseService.createMessageBranch).getMockImplementation()!;
		vi.mocked(DatabaseService.createMessageBranch).mockImplementation(async (...args) => {
			const created = await create(...args);
			if (created.role === MessageRole.USER) {
				ready.resolve();
				await gate.promise;
			}
			return created;
		});
		const pending = chatStore.sendMessage('Synthetic operation A');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		modelsStore.selectedModelName = 'model-B';
		settingsStore.updateConfig('top_p', 0.9);
		gate.resolve();
		await pending;
		expect(chatStore.errorDialogState).toBeNull();
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toMatchObject({
			model: 'model-A',
			top_p: 0.7
		});
		expect(requests[0].url).toContain('/api/llama-server/');
		expect(requests[0].headers.Authorization).toBe('Bearer operation-key');
		assertOwned('B');
		expect(rows.find((item) => item.content === 'A answer')?.convId).toBe('A');
	});
});

describe('conversation-owned MCP operation snapshot', () => {
	const overridesA = [{ serverId: 'synthetic-mcp-A', enabled: true }];
	const overridesB = [{ serverId: 'synthetic-mcp-B', enabled: true }];

	beforeEach(() => {
		settingsStore.config = {
			...originalConfig,
			apiProvider: 'llama-server',
			preEncodeConversation: false
		};
		serverStore.role = ServerRole.ROUTER;
		modelsStore.selectedModelName = 'synthetic-model';
		vi.spyOn(modelsStore, 'getModelProps').mockReturnValue(null);
		vi.spyOn(modelsStore, 'fetchModelProps').mockResolvedValue(null);
		vi.spyOn(modelsStore, 'fetchRouterModels').mockResolvedValue();
		for (const conversation of conversations) {
			conversation.mcpServerOverrides = structuredClone(
				conversation.id === 'A' ? overridesA : overridesB
			);
		}
		conversationsStore.conversations = structuredClone(conversations);
		conversationsStore.activeConversation!.mcpServerOverrides = structuredClone(overridesA);
		vi.mocked(agenticStore.getConfig).mockImplementation(getAgenticConfig);
		vi.spyOn(mcpStore, 'hasEnabledServers').mockImplementation((overrides) =>
			Boolean(overrides?.some((override) => override.enabled))
		);
		vi.spyOn(mcpStore, 'ensureInitialized').mockResolvedValue(false);
		vi.spyOn(toolsStore, 'builtinTools', 'get').mockReturnValue([]);
		vi.spyOn(toolsStore, 'executeTool').mockRejectedValue(new Error('No real tools in this test'));
		vi.spyOn(agenticStore, 'runAgenticFlow').mockResolvedValue({ handled: false });
	});

	function pauseModelProps() {
		const ready = deferred(),
			gate = deferred();
		vi.mocked(modelsStore.fetchModelProps).mockImplementation(async () => {
			ready.resolve();
			await gate.promise;
			return null;
		});
		return { ready, gate };
	}

	function expectSnapshot(expected: McpServerOverride[] | undefined) {
		expect(agenticStore.getConfig).toHaveBeenCalled();
		for (const [, overrides] of vi.mocked(agenticStore.getConfig).mock.calls) {
			expect(overrides).toEqual(expected);
		}
		if (expected?.some((override) => override.enabled)) {
			expect(agenticStore.runAgenticFlow).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ conversationId: 'A', perChatOverrides: expected })
			);
		} else {
			expect(agenticStore.runAgenticFlow).not.toHaveBeenCalled();
		}
		expect(mcpStore.ensureInitialized).not.toHaveBeenCalled();
		expect(toolsStore.executeTool).not.toHaveBeenCalled();
	}

	it('uses A overrides when navigation happens before streamChatCompletion starts', async () => {
		const ready = deferred(),
			gate = deferred();
		const create = vi.mocked(DatabaseService.createMessageBranch).getMockImplementation()!;
		vi.mocked(DatabaseService.createMessageBranch).mockImplementation(async (...args) => {
			const created = await create(...args);
			if (created.role === MessageRole.USER) {
				ready.resolve();
				await gate.promise;
			}
			return created;
		});
		const pending = chatStore.sendMessage('Synthetic MCP ownership');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		gate.resolve();
		await pending;
		expectSnapshot(overridesA);
		assertOwned('B');
		expect(ChatService.sendMessage).toHaveBeenCalledOnce();
		expect(rows.find((item) => item.content === 'Synthetic answer')?.convId).toBe('A');
		expect(chatStore.isChatLoadingPublic('A')).toBe(false);
		expect(chatStore.errorDialogState).toBeNull();
	});

	// A -> B at this await is covered by the real orchestration test below.
	it.each(['A-B-A', 'clear'])(
		'keeps the A snapshot during model props preparation (%s)',
		async (navigation) => {
			const { ready, gate } = pauseModelProps();
			const pending = chatStore.sendMessage('Synthetic MCP ownership');
			await ready.promise;
			if (navigation === 'clear') conversationsStore.clearActiveConversation();
			else {
				await conversationsStore.loadConversation('B');
				if (navigation === 'A-B-A') await conversationsStore.loadConversation('A');
			}
			gate.resolve();
			await pending;
			expectSnapshot(overridesA);
		}
	);

	it('copies override entries before awaiting so later edits do not mutate the operation', async () => {
		const { ready, gate } = pauseModelProps();
		const pending = chatStore.sendMessage('Synthetic MCP snapshot');
		await ready.promise;
		conversationsStore.activeConversation!.mcpServerOverrides![0].enabled = false;
		conversationsStore.activeConversation!.mcpServerOverrides!.push(...overridesB);
		gate.resolve();
		await pending;
		expectSnapshot(overridesA);
	});

	it.each(['update', 'regenerate', 'regenerate-branch', 'edit-branch'])(
		'passes the owner snapshot through %s after navigation during persistence',
		async (operation) => {
			const assistant = {
				...message('A-answer', 'A', 'A-user'),
				role: MessageRole.ASSISTANT
			};
			rows.push(assistant);
			rows.find((row) => row.id === 'A-user')!.children.push(assistant.id);
			conversations[0].currNode = assistant.id;
			await conversationsStore.loadConversation('A');
			vi.spyOn(conversationsStore, 'updateConversationTitleWithConfirmation').mockResolvedValue(
				true
			);
			vi.spyOn(DatabaseService, 'replaceUserMessageAndTruncateBranch').mockResolvedValue({
				deletedIds: [assistant.id],
				lastModified: 2
			});
			vi.spyOn(DatabaseService, 'truncateBranchForRegeneration').mockResolvedValue({
				parentId: 'A-user',
				deletedIds: [assistant.id],
				lastModified: 2
			});
			const ready = deferred(),
				gate = deferred();
			const create = vi.mocked(DatabaseService.createMessageBranch).getMockImplementation()!;
			vi.mocked(DatabaseService.createMessageBranch).mockImplementationOnce(async (...args) => {
				const created = await create(...args);
				ready.resolve();
				await gate.promise;
				return created;
			});
			const pending =
				operation === 'update'
					? chatStore.updateMessage('A-user', 'Synthetic edit')
					: operation === 'regenerate'
						? chatStore.regenerateMessage(assistant.id)
						: operation === 'regenerate-branch'
							? chatStore.regenerateMessageWithBranching(assistant.id)
							: chatStore.editMessageWithBranching('A-user', 'Synthetic branch');
			await ready.promise;
			await conversationsStore.loadConversation('B');
			gate.resolve();
			await pending;
			expectSnapshot(overridesA);
			assertOwned('B');
		}
	);

	it('passes A overrides into the real agent orchestration with mocked MCP and tools', async () => {
		vi.mocked(agenticStore.runAgenticFlow).mockImplementation(runAgenticFlow);
		vi.spyOn(toolsStore, 'hasBuiltinToolsForContext').mockReturnValue(true);
		vi.spyOn(toolsStore, 'fetchBuiltinTools').mockResolvedValue();
		vi.spyOn(toolsStore, 'getEnabledToolEntriesForLLM').mockReturnValue([]);
		const { ready, gate } = pauseModelProps();
		const pending = chatStore.sendMessage('Synthetic orchestration');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		gate.resolve();
		await pending;
		expect(agenticStore.getConfig).toHaveBeenCalled();
		for (const [, overrides] of vi.mocked(agenticStore.getConfig).mock.calls) {
			expect(overrides).toEqual(overridesA);
		}
		expect(mcpStore.ensureInitialized).toHaveBeenCalledExactlyOnceWith(overridesA);
		expect(toolsStore.fetchBuiltinTools).not.toHaveBeenCalled();
		expect(toolsStore.executeTool).not.toHaveBeenCalled();
		assertOwned('B');
	});

	it.each([
		{ overrides: undefined },
		{ overrides: [{ serverId: 'synthetic-mcp-A', enabled: false }] }
	])('preserves A overrides $overrides instead of enabling B MCP', async ({ overrides }) => {
		// The active A view is authoritative, including undefined; its sidebar entry may be older.
		conversationsStore.activeConversation!.mcpServerOverrides = overrides;
		const { ready, gate } = pauseModelProps();
		const pending = chatStore.sendMessage('Synthetic MCP disabled');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		gate.resolve();
		await pending;
		expectSnapshot(overrides);
	});
});

function assertOwned(activeId: string) {
	expect(conversationsStore.activeConversation?.id).toBe(activeId);
	expect(conversationsStore.activeMessages.every((item) => item.convId === activeId)).toBe(true);
	for (const conversation of conversations) {
		expect(rows.find((item) => item.id === conversation.currNode)?.convId).toBe(conversation.id);
	}
	expect(conversations.find((item) => item.id === 'B')?.currNode).toBe('B-user');
}

describe('conversation-owned asynchronous message writes', () => {
	it.each(['before', 'after'])(
		'keeps a new chat system/user/assistant chain owned across navigation %s system creation',
		async (phase) => {
			settingsStore.config = {
				...originalConfig,
				systemMessage: 'Synthetic system prompt',
				titleGenerationUseLLM: false
			};
			conversationsStore.clearActiveConversation();
			vi.spyOn(conversationsStore, 'createConversation').mockImplementation(async () => {
				const created = { id: 'C', name: 'New', currNode: '', lastModified: 1 };
				conversations.push(created);
				conversationsStore.activeConversation = { ...created };
				return created.id;
			});
			vi.spyOn(DatabaseService, 'createRootMessage').mockImplementation(async (id) => {
				rows.push(message(`${id}-root`, id, null));
				return `${id}-root`;
			});
			vi.spyOn(DatabaseService, 'createSystemMessage').mockImplementation(
				async (id, content, parent) => {
					if (phase === 'before') await conversationsStore.loadConversation('B');
					const system = {
						...message(`${id}-system`, id, parent),
						role: MessageRole.SYSTEM,
						content
					};
					rows.push(system);
					rows.find((item) => item.id === parent)!.children.push(system.id);
					if (phase === 'after') await conversationsStore.loadConversation('B');
					return system;
				}
			);
			vi.spyOn(DatabaseService, 'updateConversation').mockImplementation(async (id, updates) => {
				Object.assign(conversations.find((item) => item.id === id)!, updates);
			});
			await chatStore.sendMessage('First question');
			assertOwned('B');
			const created = rows.filter((item) => item.convId === 'C');
			expect(created.map((item) => item.role)).toEqual([
				MessageRole.SYSTEM,
				MessageRole.SYSTEM,
				MessageRole.USER,
				MessageRole.ASSISTANT
			]);
			expect(created[2].parent).toBe('C-system');
			expect(created[3].parent).toBe(created[2].id);
			expect(created[3].content).toBe('Synthetic answer');
			expect(chatStore.errorDialogState).toBeNull();
		}
	);

	// addMessage has no role-specific ownership path; sendMessage also covers user/assistant writes.
	it('keeps a delayed system message creation in A after switching to B', async () => {
		const ready = deferred(),
			gate = deferred();
		const original = vi.mocked(DatabaseService.createMessageBranch).getMockImplementation()!;
		vi.spyOn(DatabaseService, 'createMessageBranch').mockImplementation(async (...args) => {
			const result = await original(...args);
			ready.resolve();
			await gate.promise;
			return result;
		});
		const adding = chatStore.addMessage(MessageRole.SYSTEM, 'for A');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		gate.resolve();
		const created = await adding;
		expect(created.convId).toBe('A');
		assertOwned('B');
		expect(conversationsStore.activeMessages.map((item) => item.id)).toEqual(['B-user']);
	});

	it('does not append a second copy when A was reloaded before create returns', async () => {
		const ready = deferred(),
			gate = deferred();
		const original = vi.mocked(DatabaseService.createMessageBranch).getMockImplementation()!;
		vi.spyOn(DatabaseService, 'createMessageBranch').mockImplementation(async (...args) => {
			const result = await original(...args);
			ready.resolve();
			await gate.promise;
			return result;
		});
		const adding = chatStore.addMessage(MessageRole.USER, 'for A');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		await conversationsStore.loadConversation('A');
		gate.resolve();
		const created = await adding;
		assertOwned('A');
		expect(conversationsStore.activeMessages.filter((item) => item.id === created.id)).toHaveLength(
			1
		);
	});

	it('captures the view owner across the current-node persistence await', async () => {
		const ready = deferred(),
			gate = deferred();
		const original = vi.mocked(DatabaseService.updateCurrentNode).getMockImplementation()!;
		vi.spyOn(DatabaseService, 'updateCurrentNode').mockImplementation(async (...args) => {
			ready.resolve();
			await gate.promise;
			await original(...args);
		});
		const selecting = conversationsStore.updateCurrentNode('A-user');
		await ready.promise;
		await conversationsStore.loadConversation('B');
		gate.resolve();
		await selecting;
		assertOwned('B');
		expect(conversationsStore.activeConversation?.currNode).toBe('B-user');
	});
});
