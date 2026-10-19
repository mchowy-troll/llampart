import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageRole, ToolSource } from '$lib/enums';
import { ChatService } from '$lib/services/chat.service';
import { agenticStore } from '$lib/stores/agentic.svelte';
import { toolsStore } from '$lib/stores/tools.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { permissionsStore } from '$lib/stores/permissions.svelte';
import type { AgenticToolOutcome } from '$lib/types/agentic';
import type { DatabaseMessage } from '$lib/types/database';

const image =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const secondImage =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC';
const entry = {
	key: 'builtin:synthetic',
	apiName: 'synthetic',
	source: ToolSource.BUILTIN,
	registryGeneration: 1,
	definition: { type: 'function' as const, function: { name: 'synthetic', parameters: {} } }
};

afterEach(() => vi.restoreAllMocks());

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => (resolve = done));
	return { promise, resolve };
}

function start(options: {
	result: string;
	canonical?: 'missing' | 'stripped' | 'partial' | 'valid';
	stop?: 'after-commit' | 'before-execution-result';
	previousResult?: string;
	renamedExtra?: boolean;
}) {
	const controller = new AbortController();
	const ready = deferred(),
		release = deferred();
	vi.spyOn(agenticStore, 'getConfig').mockReturnValue({
		enabled: true,
		maxTurns: 2,
		maxToolPreviewLines: 10
	});
	vi.spyOn(toolsStore, 'hasBuiltinToolsForContext').mockReturnValue(true);
	vi.spyOn(toolsStore, 'getEnabledToolEntriesForLLM').mockReturnValue([entry]);
	vi.spyOn(toolsStore, 'validateToolExecution').mockImplementation(() => undefined);
	let executions = 0;
	const execute = vi.spyOn(toolsStore, 'executeTool').mockImplementation(async () => {
		executions++;
		if (options.stop === 'before-execution-result') {
			ready.resolve();
			await release.promise;
		}
		return {
			content: executions === 1 && options.previousResult ? options.previousResult : options.result,
			isError: false
		};
	});
	vi.spyOn(mcpStore, 'hasEnabledServers').mockReturnValue(false);
	vi.spyOn(permissionsStore, 'hasTool').mockReturnValue(true);
	vi.spyOn(ChatService, 'isProviderRequestContextCurrent').mockReturnValue(true);
	const history: unknown[][] = [];
	const send = vi
		.spyOn(ChatService, 'sendMessage')
		.mockImplementation(async (messages, callbacks) => {
			history.push(messages);
			if (history.length === 1)
				callbacks?.onToolCallChunk?.(
					JSON.stringify(
						(options.previousResult ? ['first', 'call'] : ['call']).map((id) => ({
							id,
							type: 'function',
							function: { name: 'synthetic', arguments: '{}' }
						}))
					)
				);
		});
	const states: AgenticToolOutcome[] = [];
	const commits: DatabaseMessage[] = [];
	const onError = vi.fn();
	const onFlowComplete = vi.fn();
	const pending = agenticStore.runAgenticFlow({
		conversationId: 'owned-image',
		messages: [{ role: MessageRole.USER, content: 'synthetic' }],
		options: {
			assistantMessageId: 'assistant',
			operationId: 'operation',
			providerRequestContext: {
				providerId: 'llama-server',
				serverBaseUrl: 'http://synthetic.test',
				apiKey: '',
				sourceGeneration: 1,
				protocol: 'chat-completions'
			}
		},
		signal: controller.signal,
		callbacks: {
			onFlowStart: async () => {},
			onAssistantTurnComplete: async () => {},
			onToolCallState: async (_identity, id, outcome) => {
				states.push(outcome);
				if (!outcome.result) return undefined;
				const extra = outcome.result.extras ?? [];
				const record: DatabaseMessage = {
					id: `tool-${id}`,
					convId: 'owned-image',
					role: MessageRole.TOOL,
					type: 'text',
					parent: 'assistant',
					children: [],
					timestamp: 1,
					toolCallId: id,
					content: outcome.result.content,
					extra: options.renamedExtra
						? extra.map((item, index) => ({ ...item, name: `previously-saved-${index}.png` }))
						: extra
				};
				commits.push(record);
				if (options.stop === 'after-commit' && id === 'call') controller.abort();
				if (id === 'call' && options.canonical === 'missing') return undefined;
				if (id === 'call' && options.canonical === 'stripped') return { ...record, extra: [] };
				if (id === 'call' && options.canonical === 'partial')
					return { ...record, extra: record.extra?.slice(0, 1) };
				return record;
			},
			createAssistantMessage: async () => ({ id: 'assistant-next' }) as DatabaseMessage,
			onFlowComplete,
			onError
		}
	});
	return {
		pending,
		controller,
		ready,
		release,
		execute,
		send,
		history,
		states,
		commits,
		onFlowComplete,
		onError
	};
}

describe('tool image callback must be canonical before the next model request', () => {
	it.each(['missing', 'stripped'] as const)(
		'%s record fails closed after a confirmed PNG',
		async (canonical) => {
			const flow = start({ result: `description\n${image}`, canonical });
			const outcome = await flow.pending;
			expect(outcome.error?.message).toMatch(/canonical.*image.*not sent/i);
			expect(flow.send).toHaveBeenCalledTimes(1);
			expect(flow.execute).toHaveBeenCalledTimes(1);
			expect(flow.states.map((state) => state.status)).toEqual(['started', 'completed']);
			expect(flow.commits[0].extra).toHaveLength(1);
			expect(flow.onFlowComplete).toHaveBeenCalledWith(
				expect.objectContaining({ reason: 'error' })
			);
			expect(flow.onError).toHaveBeenCalledWith(outcome.error);
		}
	);

	it('passes the canonical DB image to the provider boundary despite a different saved filename', async () => {
		const flow = start({ result: `description\n${image}`, canonical: 'valid', renamedExtra: true });
		await flow.pending;
		expect(flow.send).toHaveBeenCalledTimes(2);
		expect(flow.history[1]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: MessageRole.TOOL,
					tool_call_id: 'call',
					content: expect.arrayContaining([
						expect.objectContaining({ type: 'image_url', image_url: { url: image } })
					])
				})
			])
		);
		expect(flow.commits).toHaveLength(1);
		expect(flow.commits[0].extra?.[0].name).toMatch(/^previously-saved/);
	});

	it('requires both intentionally identical images, without comparing newly generated names', async () => {
		const flow = start({ result: `${image}\n${image}`, canonical: 'valid', renamedExtra: true });
		await flow.pending;
		expect(flow.send).toHaveBeenCalledTimes(2);
		expect(
			(flow.history[1].at(-1) as { content: { type: string }[] }).content.filter(
				(part) => part.type === 'image_url'
			)
		).toHaveLength(2);
	});

	it('does not accept one canonical image as two deliberately identical results', async () => {
		const flow = start({ result: `${image}\n${image}`, canonical: 'partial' });
		const outcome = await flow.pending;
		expect(outcome.error?.message).toMatch(/canonical.*image/i);
		expect(flow.send).toHaveBeenCalledTimes(1);
		expect(flow.states.at(-1)?.status).toBe('completed');
	});

	it('preserves earlier successful tool outputs when the later image lacks a DB record', async () => {
		const flow = start({
			previousResult: `earlier\n${secondImage}`,
			result: `later\n${image}`,
			canonical: 'missing'
		});
		const outcome = await flow.pending;
		expect(outcome.error?.message).toMatch(/canonical.*image/i);
		expect(flow.execute).toHaveBeenCalledTimes(2);
		expect(flow.send).toHaveBeenCalledTimes(1);
		expect(flow.commits).toHaveLength(2);
		expect(flow.commits[0].extra).toEqual([expect.objectContaining({ base64Url: secondImage })]);
		expect(flow.states.map((state) => state.status)).toEqual([
			'started',
			'completed',
			'started',
			'completed'
		]);
		expect(flow.onFlowComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'error' }));
	});

	it('keeps text-only tool result fallback unchanged', async () => {
		const flow = start({ result: 'plain text', canonical: 'missing' });
		await flow.pending;
		expect(flow.send).toHaveBeenCalledTimes(2);
		expect(flow.history[1]).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: MessageRole.TOOL, content: 'plain text' })
			])
		);
	});

	it.each(['after-commit', 'before-execution-result'] as const)(
		'Stop %s keeps late confirmed image without false error',
		async (stop) => {
			const flow = start({ result: `description\n${image}`, canonical: 'missing', stop });
			if (stop === 'before-execution-result') {
				await flow.ready.promise;
				flow.controller.abort();
				flow.release.resolve();
			}
			const outcome = await flow.pending;
			expect(outcome.error).toBeUndefined();
			expect(flow.onError).not.toHaveBeenCalled();
			expect(flow.onFlowComplete).toHaveBeenCalledWith(
				expect.objectContaining({ reason: 'stopped' })
			);
			expect(flow.states.at(-1)?.status).toBe('completed');
			expect(flow.commits[0].extra).toHaveLength(1);
			expect(flow.send).toHaveBeenCalledTimes(1);
			expect(flow.execute).toHaveBeenCalledTimes(1);
		}
	);
});
