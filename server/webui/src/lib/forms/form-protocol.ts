import { z } from 'zod';
import { FORM_LIMITS, formBytes } from './form-limits';

/** Only an anchored, reserved first line is a format decision; never scan Markdown. */
export const FORM_PROPOSAL = '[[llampart-form]]\n';
const CRLF_PROPOSAL = '[[llampart-form]]\r\n';
export const FORM_CAPABILITY_INSTRUCTIONS = `Interactive forms are available. Decide yourself, without requiring a special user command: use a form only when collecting several independent answers or choices helps. Prefer normal text for simple questions, code, math and explanations. To propose a form, the EXACT FIRST LINE must be ${JSON.stringify(FORM_PROPOSAL.trim())}, with no introductory prose, whitespace or Markdown before it. After that line return exactly ONE JSON object, no code fence or trailing prose: {"intro":"","questions":"Your questions as one string, with topics separated by \\n."}. intro is an optional string (empty allowed, <=1000 characters), only natural context, never a question list or field-type instructions. questions MUST be ONE non-empty STRING of natural-language questions grouped by topic (<=${FORM_LIMITS.questionCharacters} characters); NEVER an object, array, null or component specification. The complete proposal including its marker must fit within ${FORM_LIMITS.proposalBytes} UTF-8 bytes. Put all questions, topic labels and choices inside that one string, preserving their order. This FIRST-PHASE JSON is only a proposal: do NOT output the SECOND-PHASE component tree, root, elements, controls or technical field types. The application creates those separately. Do not duplicate the questions as prose above or below the JSON. Do not call tools. Otherwise answer normally without a marker. Never ask for secrets.`;

const proposalSchema = z
	.object({
		intro: z.string().max(1000).default(''),
		questions: z.string().min(1).max(FORM_LIMITS.questionCharacters)
	})
	.strict();

export type FormProposal = z.infer<typeof proposalSchema> & { structured: boolean };

/** Only the reserved first line is trusted; never trim/scan the message prefix. */
export function hasFormProposal(content: string): boolean {
	return content.startsWith(FORM_PROPOSAL) || content.startsWith(CRLF_PROPOSAL);
}

function proposalBody(content: string): string {
	return content
		.slice(content.startsWith(CRLF_PROPOSAL) ? CRLF_PROPOSAL.length : FORM_PROPOSAL.length)
		.trim();
}

function unwrappedProposalBody(content: string): string {
	const body = proposalBody(content);
	return /^```(?:json)?\r?\n([\s\S]*)\r?\n```$/.exec(body)?.[1] ?? body;
}

function unwrapProposal(value: unknown): unknown {
	return value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		Object.hasOwn(value, 'proposal')
		? (value as { proposal: unknown }).proposal
		: value;
}

function structuredBody(body: string): boolean {
	return /^[{["`]/.test(body) || ['null', 'true', 'false'].includes(body);
}

/** Strict JSON-only boundary; the original schema remains authoritative. */
function readFormProposalJson(body: string): FormProposal | null {
	if (formBytes(body) > FORM_LIMITS.proposalBytes) return null;
	try {
		return { ...proposalSchema.parse(JSON.parse(body)), structured: true };
	} catch {
		return null;
	}
}

/** Parse only at a terminal boundary, never on each streamed token. */
export function readFormProposal(content: string): FormProposal | null {
	if (!content.startsWith(FORM_PROPOSAL) || formBytes(content) > FORM_LIMITS.proposalBytes)
		return null;
	const body = content.slice(FORM_PROPOSAL.length).trim();
	if (!body) return null;
	// Earlier unstructured prose has no declared slots authorizing its removal.
	if (!structuredBody(body)) return { intro: body, questions: body, structured: false };
	return readFormProposalJson(body);
}

/** Bounded representation corrections only. Never stringify unknown objects or
 * parse incomplete JSON. Every corrected object passes the original schema.
 */
export function recoverFormProposal(content: string): FormProposal | null {
	const strict = readFormProposal(content);
	if (strict) return strict;
	if (!hasFormProposal(content) || formBytes(content) > FORM_LIMITS.proposalBytes) return null;
	try {
		// Exactly one explicit wrapper, not a search through arbitrary JSON.
		let value = unwrapProposal(JSON.parse(unwrappedProposalBody(content)));
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
		const candidate = value as Record<string, unknown>;
		if (Array.isArray(candidate.questions)) {
			const questions = candidate.questions;
			if (
				!questions.length ||
				questions.length > FORM_LIMITS.recoveredQuestions ||
				!questions.every(
					(q) => typeof q === 'string' && q.trim() && q.length <= FORM_LIMITS.questionCharacters
				)
			)
				return null;
			value = { ...candidate, questions: questions.join('\n\n') };
		}
		return { ...proposalSchema.parse(value), structured: true };
	} catch {
		return null;
	}
}

export function formFallbackText(
	proposal: NonNullable<ReturnType<typeof readFormProposal>>
): string {
	return proposal.structured
		? [proposal.intro, proposal.questions].filter(Boolean).join('\n\n')
		: proposal.questions;
}

/** Constant-size prefix work. Ordinary text is returned unchanged, without buffering. */
export function formVisibleText(content: string, complete = false): string {
	if (hasFormProposal(content)) {
		if (complete) {
			const proposal = recoverFormProposal(content);
			return proposal ? formFallbackText(proposal) : '';
		}
		const body = content.slice(
			content.startsWith(CRLF_PROPOSAL) ? CRLF_PROPOSAL.length : FORM_PROPOSAL.length
		);
		return structuredBody(body) || /^\s/.test(body) ? '' : body;
	}
	if (content && (FORM_PROPOSAL.startsWith(content) || CRLF_PROPOSAL.startsWith(content)))
		return '';
	return content;
}
