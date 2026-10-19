/** Parser output only: no ownership, message IDs, edges, selection or persistence commands. */
export interface LegacyMessageSegment {
	role: 'assistant' | 'tool';
	content: string;
	reasoningContent?: string;
	toolCalls?: string;
	toolCallId?: string;
}

export type LegacyMessageSource = Readonly<
	Pick<DatabaseMessage, 'id' | 'role' | 'content' | 'reasoningContent' | 'toolCalls'>
>;

export type LegacyMessagePlanner = (
	message: LegacyMessageSource
) => readonly LegacyMessageSegment[] | null;

/** Keep the shipped marker: a completed old migration is not authorization for recovery. */
export const LEGACY_MIGRATION_DONE_KEY = 'llama-webui-migration-v2-done';
