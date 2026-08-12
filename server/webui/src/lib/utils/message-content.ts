import { AgenticSectionType, FileExtensionText, MessageRole } from '$lib/enums';
import { deriveAgenticSections, hasAgenticContent } from './agentic';

type MessageSection = ReturnType<typeof deriveAgenticSections>[number];

export type MessageResponseLabels = {
	reasoning: string;
	toolCall: string;
	arguments: string;
	result: string;
};

function getSectionText(section: MessageSection): string {
	return section.content?.trim() ?? '';
}

function formatFallbackAgenticSection(
	section: MessageSection,
	labels: MessageResponseLabels
): string | null {
	const content = getSectionText(section);

	switch (section.type) {
		case AgenticSectionType.REASONING:
		case AgenticSectionType.REASONING_PENDING:
			return content ? `${labels.reasoning}:\n${content}` : null;

		case AgenticSectionType.TOOL_CALL:
		case AgenticSectionType.TOOL_CALL_PENDING:
		case AgenticSectionType.TOOL_CALL_STREAMING: {
			const parts = [
				section.toolName ? `${labels.toolCall}: ${section.toolName}` : labels.toolCall
			];

			const toolArgs = section.toolArgs?.trim();
			if (toolArgs) {
				parts.push(`${labels.arguments}:\n${toolArgs}`);
			}

			const toolResult = section.toolResult?.trim() || content;
			if (toolResult) {
				parts.push(`${labels.result}:\n${toolResult}`);
			}

			return parts.join('\n\n');
		}

		case AgenticSectionType.TEXT:
			return content || null;
	}
}

/** Return the visible response text shared by copy and Markdown export actions. */
export function getMessageResponseContent(
	message: DatabaseMessage,
	toolMessages: DatabaseMessage[] = [],
	labels?: MessageResponseLabels
): string {
	const hasStructuredAssistantContent =
		message.role === MessageRole.ASSISTANT &&
		(Boolean(message.reasoningContent) || hasAgenticContent(message, toolMessages));

	if (!hasStructuredAssistantContent) {
		return message.content ?? '';
	}

	const sections = deriveAgenticSections(message, toolMessages, [], false);
	const textParts = sections
		.filter((section) => section.type === AgenticSectionType.TEXT)
		.map((section) => getSectionText(section))
		.filter(Boolean);

	if (textParts.length > 0) {
		return textParts.join('\n\n');
	}

	const fallbackParts = labels
		? sections.map((section) => formatFallbackAgenticSection(section, labels)).filter(Boolean)
		: [];

	return fallbackParts.join('\n\n') || message.content || '';
}

export function generateAssistantResponseFilename(timestamp: number): string {
	const formattedTimestamp = new Date(timestamp)
		.toISOString()
		.slice(0, 19)
		.replace('T', '_')
		.replaceAll(':', '-');

	return `llampart-response-${formattedTimestamp}${FileExtensionText.MD}`;
}
