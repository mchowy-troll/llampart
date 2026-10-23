import { z } from 'zod';
import type { ApiProviderId } from '$lib/constants/api-providers';
import type { ProviderProtocol } from '$lib/types/provider';

const effort = z.string().trim().min(1);
const budget = z.number().int().nonnegative();
const controls = {
	reasoning_effort: effort,
	reasoning_strength: effort,
	enable_thinking: z.boolean(),
	thinking_budget: budget,
	thinking_budget_tokens: budget,
	reasoning_budget: budget
};

/** Validation only: never infer, select or inject a generation parameter.
 * Discovery is not authoritative for explicit backend extensions or effort values.
 */
export function validateCustomReasoning(
	custom: Record<string, unknown>,
	provider: ApiProviderId,
	protocol: ProviderProtocol
): void {
	const kwargs =
		custom.chat_template_kwargs === undefined
			? {}
			: z.record(z.string(), z.unknown()).parse(custom.chat_template_kwargs);
	const representations: string[] = [];
	for (const [name, schema] of Object.entries(controls)) {
		for (const [location, values] of [
			['top-level', custom],
			['chat_template_kwargs', kwargs]
		] as const) {
			if (!Object.hasOwn(values, name)) continue;
			schema.parse(values[name]);
			if (protocol === 'responses' && location === 'top-level' && name === 'reasoning_effort')
				throw new Error('Responses requires reasoning.effort, not reasoning_effort');
			representations.push(`${location}.${name}`);
		}
	}
	if (Object.hasOwn(custom, 'reasoning')) {
		if (protocol !== 'responses')
			throw new Error('reasoning object requires the Responses protocol');
		z.object({
			effort: effort.optional(),
			summary: z.enum(['auto', 'concise', 'detailed']).nullable().optional()
		})
			.strict()
			.parse(custom.reasoning);
		representations.push('reasoning');
	}
	// A template toggle may accompany its effort/budget; competing effort/budget
	// representations or opposite toggles are ambiguous and rejected.
	const selections = representations.filter((name) => !name.endsWith('.enable_thinking'));
	if (
		selections.length > 1 ||
		representations.filter((name) => name.endsWith('.enable_thinking')).length > 1
	)
		throw new Error('Multiple reasoning representations');
	if ((custom.enable_thinking === false || kwargs.enable_thinking === false) && selections.length)
		throw new Error('Conflicting reasoning representations');
	if (provider === 'openai-compatible' && Object.hasOwn(custom, 'include_reasoning'))
		z.boolean().parse(custom.include_reasoning);
	if (Object.hasOwn(custom, 'reasoning_control')) z.boolean().parse(custom.reasoning_control);
	if (Object.hasOwn(custom, 'reasoning_format'))
		z.enum(['none', 'auto', 'deepseek']).parse(custom.reasoning_format);
}
