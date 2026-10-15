import { ReasoningEffort } from '$lib/enums';

export type LlamaReasoningControl = 'effort' | 'toggle' | 'none';

/** Historical conversation values are interpreted, never migrated or rewritten. */
export function effectiveLlamaReasoningEffort(value?: string): ReasoningEffort {
	if (value === ReasoningEffort.MAX) return ReasoningEffort.HIGH;
	return value === ReasoningEffort.LOW || value === ReasoningEffort.HIGH
		? value
		: ReasoningEffort.MEDIUM;
}

/**
 * Deliberately conservative Jinja heuristic, not a parser or model-name registry.
 * Only executable tags count. Defined checks/default assignments alone do not
 * establish level control; require a level comparison or rendering the value.
 */
export function detectReasoningControl(template?: string | null): LlamaReasoningControl {
	if (!template) return 'none';
	const executable = template
		.replace(/\{#[\s\S]*?#\}/g, '')
		.replace(/\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/g, '');
	let toggle = false;
	// Quoted delimiters (e.g. an example '{{ reasoning_effort }}') are literals.
	for (const tag of executable.matchAll(
		/\{({|%)-?((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?!(?:%\}|\}\}))[\s\S])*?)-?(?:%|})\}/g
	)) {
		const code = tag[2];
		const unquoted = code.replace(/'(?:(?:\\.)|[^'\\])*'|"(?:(?:\\.)|[^"\\])*"/g, '""');
		const reads = (variable: string, source = unquoted) =>
			new RegExp(`(?<![\\w.])${variable}\\b(?!\\s*=(?!=))`).test(source);
		const condition = /^\s*(?:if|elif)\b/.test(unquoted);
		const withoutDefined = unquoted.replace(
			/\b(?:reasoning_effort|enable_thinking)\s+is\s+(?:not\s+)?defined\b/g,
			''
		);
		if (reads('reasoning_effort', withoutDefined)) {
			if (
				tag[1] === '{' ||
				(condition &&
					reads('reasoning_effort', withoutDefined) &&
					/\breasoning_effort\s*(?:==|!=|in\b)\s*(?:['"](?:low|medium|high)['"]|\[[^\]]*['"](?:low|medium|high)['"])/.test(
						code
					))
			) {
				return 'effort';
			}
		}
		if (reads('enable_thinking', withoutDefined) && (condition || tag[1] === '{')) toggle = true;
	}
	return toggle ? 'toggle' : 'none';
}

export function detectThinkingSupport(chatTemplate?: string | null): boolean {
	return detectReasoningControl(chatTemplate) !== 'none';
}

export function detectThinkingSupportWithReason(chatTemplate?: string | null): {
	supported: boolean;
	reason: string;
} {
	const control = detectReasoningControl(chatTemplate);
	return {
		supported: control !== 'none',
		reason:
			control === 'none'
				? 'No confirmed reasoning control in chat template'
				: `Template exposes ${control} control`
	};
}
