import { ReasoningEffort } from '$lib/enums';

/**
 * Reasoning effort to token budget mapping, mirrored from upstream llama-ui b9585.
 * -1 means unlimited and is intentionally not sent as thinking_budget_tokens.
 */
export const REASONING_EFFORT_TOKENS: Record<ReasoningEffort, number> = {
	[ReasoningEffort.LOW]: 512,
	[ReasoningEffort.MEDIUM]: 2048,
	[ReasoningEffort.HIGH]: 8192,
	[ReasoningEffort.MAX]: -1
};
