import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/svelte/schema';
import { z } from 'zod';
import { formPropSchemas } from './form-schema';

export const formCatalog = defineCatalog(schema, {
	components: Object.fromEntries(
		Object.entries(formPropSchemas).map(([name, props]) => [
			name,
			{
				props,
				description: name,
				...(['Container', 'Group'].includes(name) ? { slots: ['default'] } : {})
			}
		])
	),
	actions: { submit: { description: 'Only after deliberate user confirmation. No tools.' } }
});

/** Deliberately narrower than catalog.prompt(): no expressions or built-in state actions. */
export function buildFormCatalogInstructions(): string {
	return [
		'Return ONE complete JSON object, no Markdown. Convert the supplied questions into a declarative form, never executable code. Use the language of the questions.',
		'Shape: {"root":"root","elements":{"root":{"type":"Container","props":{"columns":1},"children":["field","submit"]}}}. Every child must exist; leaves have children:[].',
		'IDs: [a-z][a-z0-9_]{0,39}; no constructor/prototype/__proto__. One Container root, exactly one SubmitButton, at least one field. Tree only; <=64 nodes, depth<=6, children<=32; JSON<=32768 UTF-8 bytes.',
		'Only SubmitButton has on:{"press":{"action":"submit"}}. No other actions, events, params, state, repeat, visible, bindings, expressions, HTML, CSS, JS, URLs, imports, tools, defaults, automatic submission or requests for secrets. Do not request sensitive personal data unless necessary for the stated task.',
		...Object.entries(formPropSchemas).map(
			([name, props]) =>
				`${name}: ${JSON.stringify(z.toJSONSchema(props, { unrepresentable: 'any' }))}`
		),
		'Slider max>min; step<=max-min. Unique field IDs and option values. All fields include required:boolean and help:string (empty allowed).',
		'Always include help as a string, but prefer help:"" when the label is sufficient. Do not paraphrase the label or add generic instructions to enter an answer. Keep brief help only when it clarifies format or units, permitted ranges or constraints, multiple-value entry conventions, or ambiguity that could affect the answer. For example, "Favorite color" needs no "Enter your favorite color" help; "Weekly hobby hours" needs no "Enter the number of hours" help. For "Three main hobbies", "Separate the three hobbies with commas" is useful guidance.',
		'Checkbox is ONE boolean only (for example accepting terms). For select-all-that-apply questions use CheckboxGroup with a separate option for EVERY choice; it returns an array of selected option values, empty [] allowed unless required=true (then at least one). Never collapse multiple choices into one boolean. Use RadioGroup for a single-choice question; Select is also single choice when a dropdown fits better. Use concise labels; keep any useful help brief. Put SubmitButton last, directly in the root Container, after all sections.',
		'Make the form the main answer, not a second copy of its questions. Description is only useful extra context, never filler, a repeated question list or technical field-type instructions. Use Number for quantities (min/max within +/-1e12, positive step); Date for calendar dates with YYYY-MM-DD bounds. Do not invent a date or numeric value.',
		'Composition: elegant, minimal, structured, balanced and spacious, not dense. Explicitly set columns on every Container and Group; omission renders as a three-column maximum, not one. Normally use columns:1 on the root Container to stack semantic sections. Prefer columns:2 for sections containing compact Select, Date or Number controls, even a single one, unless the content needs a full-width track; also use columns:2 for balanced, semantically related pairs of compact fields. Use columns:1 for sections needing only full-width content without compact controls or natural pairs. Natural pairs include start/end dates, related preferences or resource/priority decisions; mixed control types can form a balanced pair. Do not put related Select fields in separate full-width rows without a readability reason. Choose columns:3 only exceptionally for three compact, strongly related fields. Columns are responsive maxima, not fixed widths. Never add columns merely to occupy horizontal space.',
		'Organize fields into a few coherent topics with concise, informative Group titles. A short, single-topic form need not be split into sections. Preserve every question and all logical dependencies. Within one semantic section, a small reordering may bring natural pairs together when reading and keyboard order remain logical; never reorder across unrelated sections merely to fill space. Avoid unnecessary nesting and sections with only one trivial field unless semantically justified. Do not repeat question labels in titles or descriptions.',
		'Plan semantic rows BEFORE serializing children, not by mechanically pairing consecutive questions in the source list. Keep range endpoints (start/end, minimum/maximum) together in the same row; do not separate them by pairing each endpoint with another compact field. Bring other coherent compact pairs together within the same section without breaking dependencies. In a two-column section, paired fields must omit fullWidth or set fullWidth:false; use fullWidth:true only for deliberate spanning rows. A compact text answer and a related stage/status choice can share a row; different control types alone are not a reason to stack them. Honor suitable control types explicitly requested in the questions. Prefer Select for compact single-choice preferences that form a natural pair, rather than expanding both into separate RadioGroup rows.',
		'Use field fullWidth deliberately: set fullWidth:true for Textarea and long-answer questions, and for long labels, complex choices or multiple-option groups that need more room. A short primary identifier (such as a name or title) may also span the row to establish a clear hierarchy before detailed paired fields. Keep short related fields side by side only when readable. In a two-column section, a lone compact Select, Date or Number should normally omit fullWidth or set fullWidth:false and occupy the left column; the right column may remain empty. This is intentional whitespace, not a defective grid gap. A following fullWidth:true field starts a new spanning row: for example, a contact Date followed by a Textarea, or a programming-language Select followed by a full-width RadioGroup. Preserve deliberately full-width fields when long labels, options or context need the room. Do not stretch compact controls or pair unrelated questions merely to fill a row. Purposeful whitespace is preferable to forced density.',
		'Keep a steady reading rhythm without treating an intentional half-width compact row as a defect. Keep every RadioGroup or CheckboxGroup and all its options together as one semantic unit, not separate grid cells. Mixed control types may share a row only when strongly related, balanced and readable. Before returning JSON, review each section at wide and narrow widths: proportionate compact controls, related pairs where appropriate, enough room for long content, natural reading and keyboard order. Use only columns and fullWidth for layout; rely on existing responsive behavior and spacing. No layout CSS, ordering tricks or DOM reordering.'
	].join('\n');
}
