import { z } from 'zod';

/** Only an anchored, reserved first line is a format decision; never scan Markdown. */
export const FORM_PROPOSAL = '[[llampart-form]]\n';
export const FORM_CAPABILITY_INSTRUCTIONS = `Interactive forms are available. Decide yourself, without requiring a special user command: use a form only when collecting several independent answers or choices helps. Prefer normal text for simple questions, code, math and explanations. To propose a form, start with exactly ${JSON.stringify(FORM_PROPOSAL.trim())} on its own line, then ONE JSON object: {"intro":"","questions":""}. intro is optional natural context (empty allowed, <=1000 characters), never a question list or field-type instructions. questions contains natural-language questions grouped by topic (<=10000 characters); these become the form or the text fallback, not duplicate prose above it. Do not describe technical control types, output a component schema or call tools. Otherwise answer normally without a marker. Never ask for secrets.`;

const proposalSchema = z
	.object({ intro: z.string().max(1000).default(''), questions: z.string().min(1).max(10000) })
	.strict();

/** Parse only at a terminal boundary, never on each streamed token. */
export function readFormProposal(content: string) {
	if (!content.startsWith(FORM_PROPOSAL) || content.length > 32768) return null;
	const body = content.slice(FORM_PROPOSAL.length).trim();
	if (!body) return null;
	// Earlier unstructured prose has no declared slots authorizing its removal.
	if (!body.startsWith('{')) return { intro: body, questions: body, structured: false };
	try {
		return { ...proposalSchema.parse(JSON.parse(body)), structured: true };
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
	if (content.startsWith(FORM_PROPOSAL)) {
		const body = content.slice(FORM_PROPOSAL.length);
		if (body.startsWith('{') || (body.length > 0 && /[\s]/.test(body[0]))) {
			if (!complete) return '';
			const proposal = readFormProposal(content);
			return proposal ? formFallbackText(proposal) : '';
		}
		return body;
	}
	if (content && FORM_PROPOSAL.startsWith(content)) return '';
	return content;
}
