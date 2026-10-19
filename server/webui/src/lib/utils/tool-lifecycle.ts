import type { ApiChatMessageData } from '$lib/types/api';
import type { ToolCallExecution } from '$lib/types/agentic';

/** Presentation/protocol description, never persisted as if returned by a tool. */
export function toolExecutionDescription(execution?: ToolCallExecution): string {
	switch (execution?.status) {
		case 'not_started':
			return 'Tool was not executed: the operation stopped before execution.';
		case 'denied':
			return 'Tool was not executed: permission was denied.';
		case 'error':
			return `Tool execution failed: ${execution.error ?? 'no confirmed output is available'}. Do not automatically retry.`;
		case 'completed':
			return 'Tool completed, but its output is not included in this history. Do not automatically retry.';
		default:
			return 'Tool outcome is unknown; external effects may have occurred. No confirmed output is available. Do not automatically retry.';
	}
}

/**
 * A read-only request projection. Actual outputs always win, even when empty.
 * Historical missing outputs and persisted `started` are unknown, not cancelled.
 * Preserve assistant reasoning/opaque continuation; never rebuild it from text.
 * Reject ambiguous identities within a turn rather than discard actual data.
 */
export function projectToolHistory(messages: readonly ApiChatMessageData[]): ApiChatMessageData[] {
	const projected: ApiChatMessageData[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== 'assistant' || !message.tool_calls?.length) {
			projected.push(message);
			continue;
		}
		const callIds = new Set<string>();
		for (const call of message.tool_calls) {
			if (!call.id) continue;
			if (callIds.has(call.id))
				throw new Error(`Ambiguous tool history: duplicate assistant tool call ID: ${call.id}`);
			callIds.add(call.id);
		}
		const calls = message.tool_calls.filter((call) => {
			// An interrupted stream may have persisted incomplete arguments. It was
			// never registered for execution; do not send an invalid function call.
			try {
				return (
					!!call.id &&
					!!call.function?.name &&
					JSON.parse(call.function.arguments ?? '') !== undefined
				);
			} catch {
				return false;
			}
		});
		projected.push({ ...message, tool_calls: calls.length ? calls : undefined });
		const outputs: ApiChatMessageData[] = [];
		while (messages[index + 1]?.role === 'tool') outputs.push(messages[++index]);
		const outputIds = new Set<string | undefined>();
		for (const output of outputs) {
			if (outputIds.has(output.tool_call_id))
				throw new Error(`Ambiguous tool history: duplicate tool result ID: ${output.tool_call_id}`);
			outputIds.add(output.tool_call_id);
		}
		if (outputs.some((output) => !calls.some((call) => call.id === output.tool_call_id))) {
			throw new Error('Tool output has no complete matching assistant call in this history');
		}
		for (const call of calls) {
			const output = outputs.find((item) => item.tool_call_id === call.id);
			projected.push(
				output ?? {
					role: 'tool',
					tool_call_id: call.id,
					content: toolExecutionDescription(
						message.agentic?.calls.find((item) => item.toolCallId === call.id)
					)
				}
			);
		}
	}
	return projected;
}
