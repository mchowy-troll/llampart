import '../fixtures/verified-backend';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, MessageType, ServerRole } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { DatabaseService } from '$lib/services/database.service';
import { chatStore } from '$lib/stores/chat.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { agenticStore } from '$lib/stores/agentic.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));

const originalConfig = { ...settingsStore.config };
const originalRole = serverStore.role;
const originalModel = modelsStore.selectedModelName;
let owner: DatabaseConversation;
let rows: DatabaseMessage[];
let sequence: number;
let failName: (name: string) => boolean;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	owner = { id: 'A', name: 'Old A', currNode: null, lastModified: 1 };
	rows = [];
	sequence = 0;
	failName = () => true;
	settingsStore.config = {
		...originalConfig,
		apiProvider: 'llama-server',
		preEncodeConversation: false,
		askForTitleConfirmation: false,
		titleGenerationUseLLM: false,
		systemMessage: ''
	};
	serverStore.role = ServerRole.ROUTER;
	modelsStore.selectedModelName = 'synthetic-model';
	vi.spyOn(modelsStore, 'getModelProps').mockReturnValue(null);
	vi.spyOn(modelsStore, 'fetchModelProps').mockResolvedValue(null);
	vi.spyOn(modelsStore, 'fetchRouterModels').mockResolvedValue();
	vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
		enabled: false,
		maxTurns: 1,
		maxToolPreviewLines: 10
	});
	vi.spyOn(DatabaseService, 'getConversation').mockImplementation(async () => ({ ...owner }));
	vi.spyOn(DatabaseService, 'getConversationMessages').mockImplementation(async () =>
		structuredClone(rows)
	);
	vi.spyOn(DatabaseService, 'createConversation').mockImplementation(async () => ({ ...owner }));
	vi.spyOn(DatabaseService, 'updateConversation').mockImplementation(async (_id, updates) => {
		if (updates.name && failName(updates.name)) throw new Error('AUD-006 synthetic name failure');
		Object.assign(owner, updates);
	});
	vi.spyOn(DatabaseService, 'updateCurrentNode').mockImplementation(async (_id, node) => {
		owner.currNode = node;
	});
	vi.spyOn(DatabaseService, 'updateMessage').mockImplementation(async (id, updates) => {
		Object.assign(rows.find((item) => item.id === id)!, updates);
	});
	vi.spyOn(DatabaseService, 'createRootMessage').mockImplementation(async () => {
		rows.push({
			id: 'root',
			convId: 'A',
			parent: null,
			children: [],
			role: MessageRole.SYSTEM,
			type: MessageType.ROOT,
			content: '',
			toolCalls: '',
			timestamp: 0
		});
		return 'root';
	});
	vi.spyOn(DatabaseService, 'createMessageBranch').mockImplementation(async (input, parent) => {
		const message = { ...input, id: `message-${++sequence}`, parent } as DatabaseMessage;
		rows.push(message);
		rows.find((item) => item.id === parent)!.children.push(message.id);
		owner.currNode = message.id;
		return structuredClone(message);
	});
	vi.spyOn(DatabaseService, 'updateConversationMessage').mockImplementation(
		async (_id, id, updates) => {
			Object.assign(rows.find((item) => item.id === id)!, updates);
		}
	);
	vi.spyOn(ChatService, 'sendMessage').mockImplementation(async (_history, options) => {
		await options?.onComplete?.('Synthetic answer');
	});
	conversationsStore.conversations = [{ ...owner }];
	conversationsStore.clearActiveConversation();
});

afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.config = { ...originalConfig };
	serverStore.role = originalRole;
	modelsStore.selectedModelName = originalModel;
	conversationsStore.clearActiveConversation();
	conversationsStore.conversations = [];
	chatStore.chatLoadingStates.clear();
	chatStore.chatStreamingStates.clear();
	chatStore.clearUIState();
});

describe('AUD-006 automatic naming is best-effort, not a message failure', () => {
	it('continues the first send and response when the first-message title cannot be saved', async () => {
		await expect(chatStore.sendMessage('First user message')).resolves.toBeUndefined();
		expect(ChatService.sendMessage).toHaveBeenCalledTimes(1);
		expect(
			rows.filter((item) => item.role === MessageRole.USER).map((item) => item.content)
		).toEqual(['First user message']);
		expect(rows.find((item) => item.role === MessageRole.ASSISTANT)?.content).toBe(
			'Synthetic answer'
		);
		expect(conversationsStore.activeConversation?.name).toBe('Old A');
		expect(owner.name).toBe('Old A');
		expect(chatStore.chatLoadingStates.get('A')).toBeFalsy();
	});

	it.each([false, true])(
		'handles LLM title persistence (success=%s) without losing a completed answer',
		async (success) => {
			settingsStore.config = { ...settingsStore.config, titleGenerationUseLLM: true };
			failName = (name) => !success && name === 'Generated title';
			vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Generated title');
			await chatStore.sendMessage('First user message');
			expect(ChatService.generateTitle).toHaveBeenCalledTimes(1);
			expect(rows.find((item) => item.role === MessageRole.ASSISTANT)?.content).toBe(
				'Synthetic answer'
			);
			expect(owner.name).toBe(success ? 'Generated title' : 'First user message');
			expect(conversationsStore.activeConversation?.name).toBe(owner.name);
			expect(chatStore.chatLoadingStates.get('A')).toBeFalsy();
		}
	);

	it.each(['preserve', 'replace', 'branch'])(
		'keeps first-message %s edits and generation after title failure',
		async (operation) => {
			failName = () => false;
			await chatStore.sendMessage('First user message');
			failName = () => true;
			const user = rows.find((item) => item.role === MessageRole.USER)!;
			const responseCount = vi.mocked(ChatService.sendMessage).mock.calls.length;
			vi.spyOn(DatabaseService, 'replaceUserMessageAndTruncateBranch').mockImplementation(
				async (_id, id, content) => {
					rows.find((item) => item.id === id)!.content = content;
					return { deletedIds: [], lastModified: 2 };
				}
			);
			if (operation === 'preserve')
				await chatStore.editUserMessagePreserveResponses(user.id, 'Edited first');
			else if (operation === 'replace') await chatStore.updateMessage(user.id, 'Edited first');
			else await chatStore.editMessageWithBranching(user.id, 'Edited first');
			expect(rows.some((item) => item.content === 'Edited first')).toBe(true);
			expect(owner.name).toBe('First user message');
			expect(conversationsStore.activeConversation?.name).toBe(owner.name);
			expect(ChatService.sendMessage).toHaveBeenCalledTimes(
				responseCount + (operation === 'preserve' ? 0 : 1)
			);
			expect(chatStore.chatLoadingStates.get('A')).toBeFalsy();
		}
	);

	it('retains branch navigation when its title update fails', async () => {
		failName = () => false;
		await chatStore.sendMessage('First user message');
		const root = rows.find((item) => item.id === 'root')!;
		const sibling = {
			...rows.find((item) => item.role === MessageRole.USER)!,
			id: 'sibling',
			content: 'Other first message',
			children: []
		};
		rows.push(sibling);
		root.children.push(sibling.id);
		failName = () => true;
		await expect(conversationsStore.navigateToSibling(sibling.id)).resolves.toBeUndefined();
		expect(owner.currNode).toBe(sibling.id);
		expect(conversationsStore.activeMessages.some((item) => item.id === sibling.id)).toBe(true);
		expect(conversationsStore.activeConversation?.name).toBe('First user message');
	});
});
