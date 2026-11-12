import type { ApiChatMessageData } from '$lib/types/api';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';
import { TABLE_INSTRUCTIONS } from '$lib/markdown/table-instructions';

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
			'When numeric data support a meaningful comparison, trend, or distribution, you MUST include a valid fenced llampart-chart JSON block whenever a compliant chart can be produced. You MUST follow the llampart chart format instructions, including the required JSON schema, supported chart types, accurate data, and all technical limits. Check JSON syntax, schema compliance, data accuracy, and limits before responding. Simplify the visualization when necessary without inventing or distorting data. Do not chart a single number or insufficient data. If a compliant chart cannot be created, use a Markdown table or clear text instead. Never output an invalid llampart-chart block.'
	},
	{
		key: 'responsePrefDiagrams',
		name: 'Diagrams',
		instruction:
			'When a process, workflow, state transition, hierarchy, or project schedule would be clearer visually, you MUST include a valid fenced mermaid diagram whenever a compliant diagram can be produced. You MUST follow the llampart diagram format instructions, including supported diagram families, valid Mermaid syntax, safety restrictions, and all technical size and complexity limits. Use only flowchart, stateDiagram-v2, mindmap, or gantt. Check Mermaid syntax, safety, and limits before responding. Simplify overly complex diagrams without inventing steps or relationships. If a compliant diagram cannot be created, use a clear Markdown or text explanation instead. Never output invalid Mermaid code.'
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
export type ChatInstructionSettings = ResponsePreferences & {
	chartsEnabled?: boolean;
	diagramsEnabled?: boolean;
};

/** Scalar, immutable operation policy. Never read the Settings draft. */
export function captureChatInstructionSettings(settings: ChatInstructionSettings) {
	return Object.freeze({
		chartsEnabled: settings.chartsEnabled !== false,
		diagramsEnabled: settings.diagramsEnabled !== false,
		...Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, settings[key] === true]))
	});
}

const START = '<llampart-response-preferences>';
const END = '</llampart-response-preferences>';
const PRIORITY =
	'Apply these preferences to your own answers. Explicit user instructions, including the manual system message below, take precedence.';

/** Also used verbatim by the read-only draft preview. No UI-language dependency. */
export function buildResponsePreferenceInstructions(settings: ChatInstructionSettings): string {
	const active = RESPONSE_PREFERENCES.filter(
		({ key }) =>
			settings[key] === true &&
			(key !== 'responsePrefCharts' || settings.chartsEnabled !== false) &&
			(key !== 'responsePrefDiagrams' || settings.diagramsEnabled !== false)
	);
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

// Request-local ownership, never inferred from text or serialized to the provider.
// Copies/imports/manual prompts (even byte-identical ones) are unowned. Only an
// unchanged message object created here may have its generated portion replaced.
const composedChatMessages = new WeakMap<ApiChatMessageData, { content: string; manual: string }>();

export function withChatInstructions(
	messages: ApiChatMessageData[],
	settings: ChatInstructionSettings
): ApiChatMessageData[] {
	const start = '<llampart-chat-instructions>\n';
	const end = '\n</llampart-chat-instructions>';
	const index = messages.findIndex(
		(message) => message.role === 'system' && typeof message.content === 'string'
	);
	const original = index < 0 ? '' : (messages[index].content as string);
	const owned = index < 0 ? undefined : composedChatMessages.get(messages[index]);
	const manual = owned?.content === original ? owned.manual : original;
	const instructions = [
		settings.chartsEnabled !== false ? CHART_INSTRUCTIONS : '',
		settings.diagramsEnabled !== false ? MERMAID_INSTRUCTIONS : '',
		TABLE_INSTRUCTIONS,
		buildResponsePreferenceInstructions(settings)
	]
		.filter(Boolean)
		.join('\n\n');
	const content = [instructions ? start + instructions + end : '', manual]
		.filter(Boolean)
		.join('\n\n');
	if (content === original) return messages;
	if (!content) return messages.filter((_, i) => i !== index);
	const composed: ApiChatMessageData =
		index < 0 ? { role: 'system', content } : { ...messages[index], content };
	composedChatMessages.set(composed, { content, manual });
	return index < 0
		? [composed, ...messages]
		: messages.map((message, i) => (i === index ? composed : message));
}
