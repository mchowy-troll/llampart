/** Historical marker interpretation only; graph mutations belong to DatabaseService. */
import { LEGACY_AGENTIC_REGEX } from '$lib/constants/agentic';
import { DatabaseService } from '$lib/services/database.service';
import {
	LEGACY_MIGRATION_DONE_KEY,
	type LegacyMessageSegment,
	type LegacyMessageSource
} from '$lib/types/legacy-migration';

/** @deprecated Retained for startup and historical-format compatibility. */
export function isMigrationNeeded(): boolean {
	try {
		return !localStorage.getItem(LEGACY_MIGRATION_DONE_KEY);
	} catch {
		return false;
	}
}

interface LegacyToolCall {
	id: string;
	type?: string;
	function?: { name: string; arguments: string };
}

/** Exact legacy text remains supported; JSON object key order/whitespace is not identity. */
function equivalentLegacyArguments(stored: unknown, marker: string): boolean {
	if (typeof stored !== 'string') return false;
	if (stored === marker) return true;
	const equalValues = (left: unknown, right: unknown): boolean => {
		// Do not infer equivalence from overflow or unsafe integer rounding in JSON.parse.
		if (
			typeof left === 'number' &&
			(!Number.isFinite(left) || (Number.isInteger(left) && !Number.isSafeInteger(left)))
		)
			return false;
		if (Object.is(left, right)) return true;
		if (
			left === null ||
			right === null ||
			typeof left !== 'object' ||
			typeof right !== 'object' ||
			Array.isArray(left) !== Array.isArray(right)
		)
			return false;
		const keys = Object.keys(left);
		return (
			keys.length === Object.keys(right).length &&
			keys.every(
				(key) =>
					Object.hasOwn(right, key) &&
					equalValues(
						(left as Record<string, unknown>)[key],
						(right as Record<string, unknown>)[key]
					)
			)
		);
	};
	try {
		return equalValues(JSON.parse(stored), JSON.parse(marker));
	} catch {
		return false;
	}
}

/** Pure, synchronous plan. Incomplete/unknown reserved markers fail closed without data loss. */
export function planLegacyMessage(message: LegacyMessageSource): LegacyMessageSegment[] | null {
	if (
		message.role !== 'assistant' ||
		!LEGACY_AGENTIC_REGEX.HAS_LEGACY_MARKERS.test(message.content)
	) {
		return null;
	}
	let reasoning = '';
	const content = message.content;
	const extractReasoning = (text: string) =>
		text.replace(new RegExp(LEGACY_AGENTIC_REGEX.REASONING_BLOCK.source, 'g'), (block) => {
			reasoning += LEGACY_AGENTIC_REGEX.REASONING_EXTRACT.exec(block)![1];
			return '';
		});
	const segments: LegacyMessageSegment[] = [];
	let existing: LegacyToolCall[] = [];
	if (message.toolCalls) {
		const parsed: unknown = JSON.parse(message.toolCalls);
		if (
			!Array.isArray(parsed) ||
			parsed.some((call) => !call || typeof call.id !== 'string' || !call.id)
		) {
			throw new Error(`Invalid legacy toolCalls in ${message.id}`);
		}
		existing = parsed;
		if (new Set(existing.map((call) => call.id)).size !== existing.length) {
			throw new Error(`Duplicate legacy tool call IDs in ${message.id}`);
		}
	}
	const used = new Set<string>();
	const reserved = new Set(existing.map((call) => call.id));
	let callIndex = 0;
	let lastIndex = 0;
	let assistant: LegacyMessageSegment | undefined;
	const assertPlainText = (text: string) => {
		if (/<<<(?:AGENTIC_|TOOL_|reasoning_content_)/.test(text)) {
			throw new Error(`Incomplete or unknown legacy marker in ${message.id}`);
		}
	};
	const toolMatches = [
		...content.matchAll(new RegExp(LEGACY_AGENTIC_REGEX.COMPLETED_TOOL_CALL.source, 'g'))
	];
	for (const match of toolMatches) {
		const text = extractReasoning(content.slice(lastIndex, match.index)).trim();
		assertPlainText(text);
		if (!assistant || text) {
			assistant = { role: 'assistant', content: text, toolCalls: '[]' };
			segments.push(assistant);
		}
		const available = existing.filter((call) => !used.has(call.id));
		const candidates = available.filter(
			(call) =>
				call.function?.name === match[1] &&
				equivalentLegacyArguments(call.function?.arguments, match[2])
		);
		if (
			candidates.length > 1 ||
			(candidates.length === 1 &&
				toolMatches.filter(
					(other) =>
						other[1] === match[1] &&
						equivalentLegacyArguments(candidates[0].function?.arguments, other[2])
				).length > 1)
		) {
			throw new Error(`Ambiguous legacy tool calls in ${message.id}`);
		}
		const matched =
			candidates[0] ??
			// Some historical records contain only IDs, in marker order.
			available.find((call) => !call.function);
		let id = matched?.id ?? `legacy_tool_${message.id}_${callIndex}`;
		while (!matched && (reserved.has(id) || used.has(id))) id += '_';
		used.add(id);
		callIndex++;
		const calls = JSON.parse(assistant.toolCalls!) as LegacyToolCall[];
		calls.push({
			...matched,
			id,
			type: 'function',
			function: { ...matched?.function, name: match[1], arguments: match[2] }
		});
		assistant.toolCalls = JSON.stringify(calls);
		segments.push({ role: 'tool', content: match[3].replace(/^\n+|\n+$/g, ''), toolCallId: id });
		lastIndex = match.index + match[0].length;
	}
	const remaining = extractReasoning(content.slice(lastIndex)).trim();
	assertPlainText(remaining);
	if (remaining || !segments.length)
		segments.push({ role: 'assistant', content: remaining, toolCalls: '' });
	// Do not silently discard structured calls that could not be associated with a marker.
	if (callIndex && existing.some((call) => !used.has(call.id))) {
		throw new Error(`Unmatched legacy tool calls in ${message.id}`);
	}
	if (!callIndex) segments[0].toolCalls = message.toolCalls;
	segments[0].reasoningContent = reasoning
		? [message.reasoningContent, reasoning].filter(Boolean).join('\n')
		: message.reasoningContent;
	return segments;
}

/** @deprecated Run once at startup; completed migrations are intentionally not recovered. */
export async function runLegacyMigration(): Promise<void> {
	if (!isMigrationNeeded()) return;
	try {
		await DatabaseService.migrateLegacyMessages(planLegacyMessage);
	} catch (error) {
		console.error('[Migration] Failed to migrate legacy messages:', error);
	}
}
