/**
 * Reasoning effort levels for thinking-capable models.
 * Values match llama.cpp llama-ui upstream and are mapped to token budgets in constants.
 */
export enum ReasoningEffort {
	LOW = 'low',
	MEDIUM = 'medium',
	HIGH = 'high',
	MAX = 'max'
}
