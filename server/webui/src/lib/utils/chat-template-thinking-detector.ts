/**
 * Detects whether a model chat template exposes thinking/reasoning controls.
 * Adapted from llama.cpp llama-ui b9585; kept as a focused utility for model capability detection.
 */
const THINKING_KWARG_VARS = ['enable_thinking', 'reasoning_effort', 'thinking_budget'];

const THINKING_TEMPLATE_PATTERNS = [
	/\{%-?\s*if\s+\(?\s*\w*enable[\s_]+\w*(thinking|think|reasoning)/i,
	/\{%-?\s*if\s+\w*(thinking|reasoning)\s*(is not|==|!=)/i,
	/\{%-?\s*if\s+ns\.enable_thinking/i,
	/enable_thinking/i,
	/reasoning_effort/i,
	/thinking_budget/i
];

export function detectThinkingSupport(chatTemplate?: string | null): boolean {
	if (!chatTemplate) return false;
	return THINKING_TEMPLATE_PATTERNS.some((pattern) => pattern.test(chatTemplate));
}

export function detectThinkingSupportWithReason(chatTemplate?: string | null): {
	supported: boolean;
	reason: string;
} {
	if (!chatTemplate) return { supported: false, reason: 'No chat template available' };

	for (const variable of THINKING_KWARG_VARS) {
		if (chatTemplate.includes(variable)) {
			return { supported: true, reason: `Template references ${variable}` };
		}
	}

	for (const pattern of THINKING_TEMPLATE_PATTERNS) {
		if (pattern.test(chatTemplate)) {
			return { supported: true, reason: `Template matches ${pattern.source}` };
		}
	}

	return { supported: false, reason: 'No thinking control markers found in chat template' };
}
