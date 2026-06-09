import type { ReasoningEffort } from '$lib/enums';

export type ReasoningEffortOptionValue = ReasoningEffort | 'off';

export interface ReasoningEffortLevel {
	value: ReasoningEffortOptionValue;
	isOff?: boolean;
	hasInfo?: boolean;
}
