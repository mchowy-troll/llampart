import type { ApiChatMessageData } from '$lib/types/api';

export const CHART_INSTRUCTIONS = `llampart chart format (use when requested by the user or active response preferences; otherwise optional): when a chart genuinely helps, use a fenced llampart-chart block containing JSON, never invent data. No colors, fonts, HTML or code. Supported types: line, area, bar, donut. Cartesian example: {"type":"line","title":"Sales","xKey":"month","series":[{"key":"sales","label":"Sales"}],"data":[{"month":"Jan","sales":12},{"month":"Feb","sales":18}]}. Bar may use "orientation":"horizontal"; multiple series are grouped. Donut example: {"type":"donut","labelKey":"category","valueKey":"amount","data":[{"category":"A","amount":3},{"category":"B","amount":7}]}. Optional: description, xLabel/yLabel (Cartesian), format (number or percent, fractions), decimals (0–6). All rows must contain exactly the declared columns and finite numbers (absolute value <=1e12); no null/missing values. Max 5 series, 500 rows (20 for donut), 8 charts, 128 KiB per block; labels <=120 characters. Donut values must be nonnegative with positive total. Donut presentation sorts categories by ascending value, preserving input order for ties; CSV retains source order. Use unique categories. Otherwise use ordinary Markdown.`;

/** Request-local only: database history and user prompt text remain untouched. */
export function withChartInstructions(messages: ApiChatMessageData[]): ApiChatMessageData[] {
	if (
		messages.some(
			(message) =>
				message.role === 'system' &&
				typeof message.content === 'string' &&
				message.content.includes(CHART_INSTRUCTIONS)
		)
	)
		return messages;
	const index = messages.findIndex(
		(message) => message.role === 'system' && typeof message.content === 'string'
	);
	if (index < 0) return [{ role: 'system', content: CHART_INSTRUCTIONS }, ...messages];
	return messages.map((message, i) =>
		i === index ? { ...message, content: `${CHART_INSTRUCTIONS}\n\n${message.content}` } : message
	);
}
