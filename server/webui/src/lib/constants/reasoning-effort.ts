import { ReasoningEffort } from '$lib/enums';
import type { ReasoningEffortLevel } from '$lib/types';

/**
 * Reasoning effort options shown by the composer control.
 * Labels stay in i18n; this module only owns stable values and metadata.
 */
export const REASONING_EFFORT_LEVELS: ReasoningEffortLevel[] = [
	{ value: 'off', isOff: true },
	{ value: ReasoningEffort.LOW },
	{ value: ReasoningEffort.MEDIUM },
	{ value: ReasoningEffort.HIGH },
	{ value: ReasoningEffort.MAX, hasInfo: true }
];
