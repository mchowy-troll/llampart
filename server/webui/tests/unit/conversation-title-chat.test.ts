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
	vi.unstubAllGlobals();
	settingsStore.config = { ...originalConfig };
	serverStore.role = originalRole;
	modelsStore.selectedModelName = originalModel;
	conversationsStore.clearActiveConversation();
	conversationsStore.conversations = [];
	chatStore.chatLoadingStates.clear();
	chatStore.chatStreamingStates.clear();
	chatStore.clearUIState();
});

describe('first-response LLM title lifecycle', () => {
	beforeEach(() => {
		failName = () => false;
		settingsStore.config = { ...settingsStore.config, titleGenerationUseLLM: true };
	});

	it('does not request a title when disabled or after a later answer', async () => {
		const generate = vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Generated title');
		settingsStore.config = { ...settingsStore.config, titleGenerationUseLLM: false };
		await chatStore.sendMessage('Standard title');
		expect(owner.name).toBe('Standard title');
		expect(generate).not.toHaveBeenCalled();
		settingsStore.config = { ...settingsStore.config, titleGenerationUseLLM: true };
		await chatStore.sendMessage('Later question');
		expect(generate).not.toHaveBeenCalled();
		expect(owner.name).toBe('Standard title');
	});

	it('requests only once even with duplicate completion callbacks and concurrent sends', async () => {
		let release!: (title: string) => void;
		const generate = vi.spyOn(ChatService, 'generateTitle').mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		vi.mocked(ChatService.sendMessage).mockImplementation(async (_history, options) => {
			await Promise.all([options?.onComplete?.('Answer'), options?.onComplete?.('Answer')]);
		});
		const sending = chatStore.sendMessage('First question');
		await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
		await Promise.all([chatStore.sendMessage('Duplicate'), chatStore.sendMessage('Duplicate')]);
		release('Generated title');
		await sending;
		expect(ChatService.sendMessage).toHaveBeenCalledTimes(1);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(owner.name).toBe('Generated title');
	});

	it.each(['Manual title', 'First question'])(
		'preserves a manual Save during title inference, including the same name (%s)',
		async (manualTitle) => {
			let release!: (title: string) => void;
			const generate = vi.spyOn(ChatService, 'generateTitle').mockImplementation(
				() =>
					new Promise((resolve) => {
						release = resolve;
					})
			);
			const sending = chatStore.sendMessage('First question');
			await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
			await conversationsStore.updateConversationName('A', manualTitle);
			release('Must not replace manual title');
			await sending;
			expect(owner.name).toBe(manualTitle);
			expect(conversationsStore.activeConversation?.name).toBe(manualTitle);
		}
	);

	it('skips inference if the user renamed while the first answer was streaming', async () => {
		const generate = vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Wrong title');
		vi.mocked(ChatService.sendMessage).mockImplementation(async (_history, options) => {
			await conversationsStore.updateConversationName('A', 'Manual before completion');
			await options?.onComplete?.('Answer');
		});
		await chatStore.sendMessage('First question');
		expect(generate).not.toHaveBeenCalled();
		expect(owner.name).toBe('Manual before completion');
	});

	it('preserves even a manual rename during first-message persistence', async () => {
		const generate = vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Wrong title');
		const create = vi.mocked(DatabaseService.createMessageBranch).getMockImplementation()!;
		vi.mocked(DatabaseService.createMessageBranch).mockImplementation(async (input, parent) => {
			const message = await create(input, parent);
			if (input.role === MessageRole.USER) {
				await conversationsStore.updateConversationName('A', 'Early manual title');
			}
			return message;
		});
		await chatStore.sendMessage('First question');
		expect(generate).not.toHaveBeenCalled();
		expect(owner.name).toBe('Early manual title');
	});

	it('persists only the original owner after navigation during inference', async () => {
		vi.spyOn(ChatService, 'generateTitle').mockImplementation(async () => {
			conversationsStore.activeConversation = {
				id: 'B',
				name: 'Other chat',
				currNode: null,
				lastModified: 1
			};
			return 'Generated for A';
		});
		await chatStore.sendMessage('First question');
		expect(owner.name).toBe('Generated for A');
		expect(conversationsStore.conversations.find((item) => item.id === 'A')?.name).toBe(
			'Generated for A'
		);
		expect(conversationsStore.activeConversation?.name).toBe('Other chat');
	});

	it.each(['', '""', 'x', 'Title: "Useful topic"'])(
		'uses existing cleanup/fallback for title response %j',
		async (response) => {
			vi.spyOn(ChatService, 'generateTitle').mockResolvedValue(response);
			await chatStore.sendMessage('Fallback first line\nSecond line');
			expect(owner.name).toBe(
				response === ''
					? 'Fallback first line\nSecond line'
					: response.startsWith('Title:')
						? 'Useful topic'
						: 'Fallback first line'
			);
		}
	);

	it.each(['empty', 'error'])(
		'does not generate a title after an %s main response',
		async (outcome) => {
			const generate = vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Wrong title');
			vi.mocked(ChatService.sendMessage).mockImplementation(async (_history, options) => {
				if (outcome === 'empty') await options?.onComplete?.('');
				else throw new Error('Synthetic main request failure');
			});
			await chatStore.sendMessage('First question');
			expect(generate).not.toHaveBeenCalled();
			expect(owner.name).toBe('First question');
		}
	);

	it('treats a failed auxiliary request as best-effort', async () => {
		vi.spyOn(ChatService, 'generateTitle').mockRejectedValue(new Error('Title failure'));
		await chatStore.sendMessage('First question');
		expect(owner.name).toBe('First question');
		expect(rows.find((item) => item.role === MessageRole.ASSISTANT)?.content).toBe(
			'Synthetic answer'
		);
		expect(chatStore.chatLoadingStates.get('A')).toBeFalsy();
	});

	it('does not title a cancelled main response even if a late completion arrives', async () => {
		const generate = vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Wrong title');
		vi.spyOn(ChatService, 'stopResumableStream').mockResolvedValue();
		vi.mocked(ChatService.sendMessage).mockImplementation(async (_history, options) => {
			await chatStore.stopGenerationForChat('A');
			await options?.onComplete?.('Late partial answer');
		});
		await chatStore.sendMessage('First question');
		expect(generate).not.toHaveBeenCalled();
		expect(owner.name).toBe('First question');
	});

	it.each(['completed', 'stopped', 'error', 'limit'] as const)(
		'generates an agentic title only for a completed successful flow (%s)',
		async (reason) => {
			vi.mocked(agenticStore.getConfig).mockReturnValue({
				enabled: true,
				maxTurns: 1,
				maxToolPreviewLines: 10
			});
			const generate = vi.spyOn(ChatService, 'generateTitle').mockResolvedValue('Agentic title');
			vi.spyOn(DatabaseService, 'finishAgenticTurn').mockImplementation(async () => ({
				...rows.find((item) => item.role === MessageRole.ASSISTANT)!,
				content: 'Final agentic answer'
			}));
			vi.spyOn(agenticStore, 'runAgenticFlow').mockImplementation(async (input) => {
				await input.callbacks.onFlowComplete?.({
					identity: {
						conversationId: 'A',
						assistantMessageId: input.options!.assistantMessageId!,
						operationId: input.options!.operationId!
					},
					reason
				});
				return { handled: true };
			});
			await chatStore.sendMessage('First question');
			expect(generate).toHaveBeenCalledTimes(reason === 'completed' ? 1 : 0);
			expect(owner.name).toBe(reason === 'completed' ? 'Agentic title' : 'First question');
		}
	);
});

describe('title service uses completed visible output with backend generation defaults', () => {
	it.each(['llama-server', 'openai-compatible', 'vllm'])(
		'allows thinking before a title without overriding backend defaults (%s)',
		async (apiProvider) => {
			vi.mocked(ChatService.sendMessage).mockRestore();
			settingsStore.config = {
				...settingsStore.config,
				apiProvider,
				serverBaseUrl: 'http://synthetic.invalid'
			};
			let body: Record<string, unknown> = {};
			vi.stubGlobal(
				'fetch',
				vi.fn(async (_url, init) => {
					body = JSON.parse(String(init?.body));
					const exhausted = typeof body.max_tokens === 'number' && body.max_tokens <= 96;
					return new Response(
						[
							'data: {"choices":[{"delta":{"reasoning_content":"Thinking for 96 tokens"}}]}\n\n',
							exhausted ? '' : 'data: {"choices":[{"delta":{"content":"Verified title"}}]}\n\n',
							`data: {"choices":[{"delta":{},"finish_reason":"${exhausted ? 'length' : 'stop'}"}]}\n\n`,
							'data: [DONE]\n\n'
						].join(''),
						{ headers: { 'Content-Type': 'text/event-stream' } }
					);
				})
			);
			expect(
				await ChatService.generateTitle(
					{ role: 'user', content: 'Generate a title' },
					'synthetic-model'
				)
			).toBe('Verified title');
			expect(body).not.toHaveProperty('max_tokens');
			expect(body).not.toHaveProperty('max_completion_tokens');
			expect(body).not.toHaveProperty('reasoning_effort');
			expect(body).not.toHaveProperty('chat_template_kwargs');
			expect(body.messages).toEqual([{ role: 'user', content: 'Generate a title' }]);
		}
	);

	it.each(['incomplete', 'abort', 'http-error'])(
		'discards partial output when the title request ends with %s',
		async (outcome) => {
			vi.mocked(ChatService.sendMessage).mockRestore();
			const controller = new AbortController();
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					if (outcome === 'http-error') return new Response('Synthetic failure', { status: 500 });
					return new Response(
						new ReadableStream({
							start(stream) {
								stream.enqueue(
									new TextEncoder().encode(
										'data: {"choices":[{"delta":{"content":"Partial title"}}]}\n\n'
									)
								);
								if (outcome === 'abort') controller.abort();
								stream.close();
							}
						}),
						{ headers: { 'Content-Type': 'text/event-stream' } }
					);
				})
			);
			expect(
				await ChatService.generateTitle(
					{ role: 'user', content: 'Title' },
					'synthetic-model',
					controller.signal
				)
			).toBe('');
		}
	);
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
