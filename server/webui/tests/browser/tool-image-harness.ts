import { DatabaseService as db } from '$lib/services/database.service';
import { extractToolResultImages, toolResultContentParts } from '$lib/utils/tool-result-images';
import { filterByLeafNodeId } from '$lib/utils/branching';
import { validateConversationGraph } from '$lib/utils/conversation-graph';
import {
	createConversationExportEnvelope,
	parseConversationImport
} from '$lib/utils/conversation-import-export';
import type { AgenticMessageIdentity } from '$lib/types/agentic';
import type { DatabaseMessage } from '$lib/types/database';

const red =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const green =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC';
const ensure = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};

export async function toolImageScenario() {
	const counts: number[] = [];
	for (const [index, images] of [[red], [red, green], [red, red]].entries()) {
		const conv = await db.createConversation(`tool-image-${index}`);
		const root = await db.createRootMessage(conv.id);
		const assistant = await db.createMessageBranch(
			{
				convId: conv.id,
				parent: root,
				children: [],
				timestamp: 1,
				role: 'assistant',
				type: 'text',
				content: '',
				toolCalls: ''
			},
			root
		);
		const identity: AgenticMessageIdentity = {
			conversationId: conv.id,
			operationId: `operation-${index}`,
			assistantMessageId: assistant.id
		};
		await db.completeAgenticAssistant(identity, {
			content: '',
			toolCalls: JSON.stringify([
				{ id: 'call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
			])
		});
		await db.transitionAgenticToolCall(identity, 'call', { status: 'started' }, assistant.id);
		const { cleanedResult, attachments } = extractToolResultImages(
			`FIRST\n${images.join('\nMIDDLE\n')}\nLAST`
		);
		ensure(attachments.length === images.length, 'extraction lost an image');
		const outcome = {
			status: 'completed' as const,
			result: { content: cleanedResult, extras: attachments }
		};
		const first = await db.transitionAgenticToolCall(identity, 'call', outcome, assistant.id);
		const repeated = await db.transitionAgenticToolCall(identity, 'call', outcome, assistant.id);
		ensure(first.result?.id === repeated.result?.id, 'duplicate tool result');
		const renamed = attachments.map((attachment, i) => ({
			...attachment,
			name: `regenerated-${index}-${i}.png`
		}));
		const renamedText = attachments.reduce(
			(text, attachment, i) =>
				text.replace(
					`[Attachment saved: ${attachment.name}]`,
					`[Attachment saved: ${renamed[i].name}]`
				),
			cleanedResult
		);
		const renamedRepeat = await db.transitionAgenticToolCall(
			identity,
			'call',
			{
				status: 'completed',
				result: { content: renamedText, extras: renamed }
			},
			assistant.id
		);
		ensure(
			renamedRepeat.result?.id === first.result?.id &&
				JSON.stringify(renamedRepeat.result?.extra) === JSON.stringify(attachments),
			'idempotent result replaced the authoritative saved names'
		);
		if (index === 0) await db.finishAgenticTurn(identity, 'error'); // Model continuation refused; tool completed.
		const current = (await db.getConversation(conv.id))!;
		const rows = await db.getConversationMessages(conv.id);
		validateConversationGraph(current, rows);
		const result = rows.find((row) => row.role === 'tool')!;
		ensure(
			rows.filter((row) => row.role === 'tool').length === 1 &&
				result.extra?.length === images.length,
			'duplicate extras'
		);
		ensure(
			result.toolCallId === 'call' &&
				rows.find((row) => row.id === assistant.id)?.agentic?.calls[0].resultMessageId ===
					result.id,
			'call relationship'
		);
		if (index === 0)
			ensure(
				rows.find((row) => row.id === assistant.id)?.agentic?.calls[0].status === 'completed' &&
					rows.find((row) => row.id === assistant.id)?.agentic?.terminalReason === 'error',
				'continuation error rewrote completed tool'
			);
		ensure(
			images.every(
				(image, i) =>
					result.extra?.[i]?.type === 'IMAGE' &&
					'base64Url' in result.extra[i] &&
					result.extra[i].base64Url === image
			),
			'image byte order'
		);
		ensure(
			(result.content.match(/\[Attachment saved: [^\]]+\]/g) ?? []).length === images.length,
			'placeholder order lost'
		);
		ensure(
			toolResultContentParts(result.content, attachments)
				.filter((part) => part.type === 'image_url')
				.every((part, i) => part.image_url?.url === images[i]),
			'next request image order lost'
		);
		ensure(
			(filterByLeafNodeId(rows, result.id, false) as DatabaseMessage[]).at(-1)?.id === result.id,
			'active branch lost confirmed result'
		);
		const beforeFork = await db.forkConversation(conv.id, assistant.id, {
			name: 'Before tool',
			includeAttachments: true
		});
		const afterFork = await db.forkConversation(conv.id, result.id, {
			name: 'After tool',
			includeAttachments: true
		});
		ensure(
			!(await db.getConversationMessages(beforeFork.id)).some((row) => row.role === 'tool'),
			'before fork has tool'
		);
		ensure(
			(await db.getConversationMessages(afterFork.id)).find((row) => row.role === 'tool')?.extra
				?.length === images.length,
			'after fork lost image'
		);
		const envelope = createConversationExportEnvelope([{ conv: current, messages: rows }], '1.9.0');
		const imported = parseConversationImport(JSON.parse(JSON.stringify(envelope)));
		ensure(
			envelope.formatVersion === 2 &&
				imported[0].messages.find((row) => row.id === result.id)?.extra?.length === images.length,
			'V2 export loss'
		);
		await db.deleteConversation(conv.id);
		await db.importConversations(imported);
		ensure(
			JSON.stringify(
				(await db.getConversationMessages(conv.id)).find((row) => row.id === result.id)?.extra
			) === JSON.stringify(attachments),
			'V2 reimport byte loss'
		);
		if (index === 2) {
			const legacyExtras = [
				...attachments,
				attachments[0],
				{ type: 'IMAGE' as const, name: 'old-invalid.png', base64Url: 'data:image/png;base64,YQ==' }
			];
			await db.updateMessage(result.id, { extra: legacyExtras });
			const oldRows = await db.getConversationMessages(conv.id);
			const oldExport = createConversationExportEnvelope(
				[{ conv: (await db.getConversation(conv.id))!, messages: oldRows }],
				'1.9.0'
			);
			ensure(
				JSON.stringify(
					parseConversationImport(oldExport)[0].messages.find((row) => row.id === result.id)?.extra
				) === JSON.stringify(legacyExtras),
				'legacy invalid/duplicate extras changed'
			);
		}
		counts.push(images.length);
	}

	const conv = await db.createConversation('late-image');
	const root = await db.createRootMessage(conv.id);
	const assistant = await db.createMessageBranch(
		{
			convId: conv.id,
			parent: root,
			children: [],
			timestamp: 1,
			role: 'assistant',
			type: 'text',
			content: '',
			toolCalls: ''
		},
		root
	);
	const identity: AgenticMessageIdentity = {
		conversationId: conv.id,
		operationId: 'late',
		assistantMessageId: assistant.id
	};
	await db.completeAgenticAssistant(identity, {
		content: '',
		toolCalls: JSON.stringify([
			{ id: 'call', type: 'function', function: { name: 'synthetic', arguments: '{}' } }
		])
	});
	await db.transitionAgenticToolCall(identity, 'call', { status: 'started' }, assistant.id);
	await db.transitionAgenticToolCall(
		identity,
		'call',
		{ status: 'interrupted_unknown' },
		assistant.id
	);
	await db.finishAgenticTurn(identity, 'stopped');
	const sibling = await db.createMessageBranch(
		{
			convId: conv.id,
			parent: assistant.id,
			children: [],
			timestamp: 2,
			role: 'user',
			type: 'text',
			content: 'new branch',
			toolCalls: ''
		},
		assistant.id
	);
	const { cleanedResult, attachments } = extractToolResultImages(`LATE\n${red}`);
	const late = await db.transitionAgenticToolCall(
		identity,
		'call',
		{ status: 'completed', result: { content: cleanedResult, extras: attachments } },
		assistant.id
	);
	const rows = await db.getConversationMessages(conv.id);
	ensure(
		(await db.getConversation(conv.id))?.currNode === sibling.id,
		'late result stole active branch'
	);
	ensure(
		rows.find((row) => row.id === assistant.id)?.agentic?.calls[0].status === 'completed',
		'late status lost'
	);
	ensure(
		rows.find((row) => row.id === assistant.id)?.agentic?.terminalReason === 'stopped',
		'stop reason lost'
	);
	ensure(
		late.result?.extra?.length === 1 &&
			!(filterByLeafNodeId(rows, sibling.id, false) as DatabaseMessage[]).some(
				(row) => row.role === 'tool'
			),
		'inactive image leaked'
	);
	return { counts, late: true };
}
