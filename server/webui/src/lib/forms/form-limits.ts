/** Shared generation, validation, serialization and persistence boundaries. */
export const FORM_LIMITS = {
	completionTokens: 12000,
	timeoutMs: 210000,
	specBytes: 96 * 1024,
	nodes: 128,
	children: 64,
	depth: 6,
	choices: 24,
	valuesBytes: 32 * 1024,
	questionCharacters: 20000,
	proposalBytes: 64 * 1024,
	recoveredQuestions: 128,
	sourceBytes: 64 * 1024,
	// Each field/selected option label occurs at most once in the spec and answer.
	// Other answers fit valuesBytes; 16 bytes/node covers numbering, separators,
	// empty-answer dashes and boolean text. Individual field limits stay unchanged.
	answerBytes: 96 * 1024 + 32 * 1024 + 128 * 16,
	// JSON can escape source text up to sixfold. The serialized answer is bounded
	// by specBytes + valuesBytes + 24 bytes/node (including escaped separators).
	// 6*64 + 2*96 + 3*32 + 3 + 4 KiB metadata = 679 KiB; retain a finite margin.
	recordBytes: 704 * 1024
} as const;

export function formBytes(value: unknown): number {
	return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}
