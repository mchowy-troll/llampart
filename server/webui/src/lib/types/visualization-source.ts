/** Semantic owner of an unmodified, persisted assistant content field. */
export type MessageContentSource = {
	origin: 'assistant-message-content';
	conversationId: string;
	messageId: string;
	field: 'content';
};

/** A read-only snapshot, not permission to write or a live database reference. */
export type VisualizationSource = Readonly<
	MessageContentSource & {
		originalContent: string;
		rawStart: number;
		rawEnd: number;
		exactOriginalFence: string;
		source: string;
	} & ({ kind: 'chart'; language: 'llampart-chart' } | { kind: 'diagram'; language: 'mermaid' })
>;
