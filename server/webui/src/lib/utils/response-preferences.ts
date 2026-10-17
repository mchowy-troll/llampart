import type { ApiChatMessageData } from '$lib/types/api';
import { CHART_INSTRUCTIONS, withChartInstructions } from '$lib/markdown/chart-instructions';
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';

/** Stable order and English request contract; only label/help keys are translated. */
export const RESPONSE_PREFERENCES = [
	{
		key: 'responsePrefNoHeadings',
		name: 'NoHeadings',
		instruction:
			'Never use Markdown headings (#, ##, etc.) in your answers. Use bold text for section titles instead. Preserve code, quotations, and text the user asks to reproduce literally.'
	},
	{
		key: 'responsePrefTables',
		name: 'Tables',
		instruction:
			'You MUST present comparisons, structured facts, and tabular data as Markdown tables instead of prose or bullet lists whenever a table can represent them clearly. A chart does not replace the table. Do not force tables for single sentences, procedures, or non-tabular content.'
	},
	{
		key: 'responsePrefCharts',
		name: 'Charts',
		instruction:
			'When numeric data support a meaningful comparison, trend, or distribution, you MUST include a valid fenced llampart-chart JSON block. Do not replace the chart with prose alone. Never invent data. Do not chart a single number or insufficient data.'
	},
	{
		key: 'responsePrefDiagrams',
		name: 'Diagrams',
		instruction:
			'When a process, workflow, state transition, hierarchy, or project schedule would be clearer visually, you MUST include a valid Mermaid diagram. Use only flowchart, stateDiagram-v2, mindmap, or gantt. Never invent steps or relationships.'
	},
	{
		key: 'responsePrefNoDecorations',
		name: 'NoDecorations',
		instruction:
			'Never use emojis, emoticons, pictograms, or decorative Unicode symbols. Preserve necessary language characters, mathematical notation, and punctuation. Preserve necessary characters in code, data, examples, and quotations.'
	},
	{
		key: 'responsePrefConcise',
		name: 'Concise',
		instruction:
			'Be concise and direct. Omit filler, redundant introductions, unnecessary conclusions, and repetition. Keep all essential information.'
	},
	{
		key: 'responsePrefExamples',
		name: 'Examples',
		instruction:
			'When explaining a complex topic, include a concrete, practical example. Do not add irrelevant or artificial examples.'
	},
	{
		key: 'responsePrefSteps',
		name: 'Steps',
		instruction:
			'For procedures and how-to tasks, you MUST provide numbered steps in execution order.'
	},
	{
		key: 'responsePrefUserLanguage',
		name: 'UserLanguage',
		instruction:
			"Always answer in the language of the user's latest message unless the user explicitly requests another language."
	}
] as const;

export type ResponsePreferenceKey = (typeof RESPONSE_PREFERENCES)[number]['key'];
export type ResponsePreferences = Partial<Record<ResponsePreferenceKey, boolean>>;

const START = '<llampart-response-preferences>';
const END = '</llampart-response-preferences>';
const PRIORITY =
	'Apply these preferences to your own answers. Explicit user instructions, including the manual system message below, take precedence.';

/** Also used verbatim by the read-only draft preview. No UI-language dependency. */
export function buildResponsePreferenceInstructions(settings: ResponsePreferences): string {
	const active = RESPONSE_PREFERENCES.filter(({ key }) => settings[key] === true);
	if (!active.length) return '';
	return [START, PRIORITY, ...active.map(({ instruction }) => instruction), END].join('\n');
}

/** Request-local composition only. Replaces only our anchored generated prefix.
 * The manual prompt is last and wins conflicts; no natural-language conflict parser.
 * Never pass the result to history persistence or the editable system-message field.
 */
export function withResponsePreferences(
	messages: ApiChatMessageData[],
	settings: ResponsePreferences
): ApiChatMessageData[] {
	const instructions = buildResponsePreferenceInstructions(settings);
	const index = messages.findIndex(
		(message) => message.role === 'system' && typeof message.content === 'string'
	);
	if (index < 0)
		return instructions ? [{ role: 'system', content: instructions }, ...messages] : messages;
	const original = messages[index].content as string;
	const chartPrefix = original.startsWith(CHART_INSTRUCTIONS) ? CHART_INSTRUCTIONS : '';
	let manual = chartPrefix ? original.slice(chartPrefix.length).replace(/^\n\n/, '') : original;
	const mermaidPrefix = manual.startsWith(MERMAID_INSTRUCTIONS) ? MERMAID_INSTRUCTIONS : '';
	if (mermaidPrefix) manual = manual.slice(mermaidPrefix.length).replace(/^\n\n/, '');
	if (manual.startsWith(START + '\n')) {
		const end = manual.indexOf('\n' + END);
		if (end >= 0) manual = manual.slice(end + END.length + 1).replace(/^\n\n/, '');
	}
	const content = [chartPrefix, mermaidPrefix, instructions, manual].filter(Boolean).join('\n\n');
	if (content === original) return messages;
	return messages.flatMap((message, i) =>
		i !== index ? [message] : content ? [{ ...message, content }] : []
	);
}

export function withChatInstructions(
	messages: ApiChatMessageData[],
	settings: ResponsePreferences
): ApiChatMessageData[] {
	const withCharts = withChartInstructions(messages);
	const index = withCharts.findIndex(
		(message) => message.role === 'system' && typeof message.content === 'string'
	);
	const original = withCharts[index].content as string;
	const prefix = CHART_INSTRUCTIONS + '\n\n';
	// The legacy chart helper also recognizes literal instructions anywhere in
	// any system message. Only an anchored generated prefix may be sliced off;
	// never truncate a manual prompt that merely quotes the chart contract.
	const rest = original.startsWith(CHART_INSTRUCTIONS)
		? original.slice(CHART_INSTRUCTIONS.length).replace(/^\n\n/, '')
		: original;
	const withDiagrams = rest.startsWith(MERMAID_INSTRUCTIONS)
		? withCharts
		: withCharts.map((message, i) =>
				i === index
					? { ...message, content: prefix + MERMAID_INSTRUCTIONS + (rest ? '\n\n' + rest : '') }
					: message
			);
	return withResponsePreferences(withDiagrams, settings);
}
