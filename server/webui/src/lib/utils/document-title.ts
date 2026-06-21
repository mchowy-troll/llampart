const APP_TITLE = 'llampart';

function normalizeTitle(title: string): string {
	return title.replace(/\s+/g, ' ').trim();
}

export function formatConversationDocumentTitle(
	conversationTitle: string,
	fallbackTitle: string
): string {
	const title = normalizeTitle(conversationTitle || fallbackTitle);

	return title ? `${title} - ${APP_TITLE}` : APP_TITLE;
}
