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
		'Shape: {"root":"root","elements":{"root":{"type":"Container","props":{},"children":["field","submit"]}}}. Every child must exist; leaves have children:[].',
		'IDs: [a-z][a-z0-9_]{0,39}; no constructor/prototype/__proto__. One Container root, exactly one SubmitButton, at least one field. Tree only; <=64 nodes, depth<=6, children<=32; JSON<=32768 UTF-8 bytes.',
		'Only SubmitButton has on:{"press":{"action":"submit"}}. No other actions, events, params, state, repeat, visible, bindings, expressions, HTML, CSS, JS, URLs, imports, tools, defaults, automatic submission or requests for secrets. Do not request sensitive personal data unless necessary for the stated task.',
		...Object.entries(formPropSchemas).map(
			([name, props]) =>
				`${name}: ${JSON.stringify(z.toJSONSchema(props, { unrepresentable: 'any' }))}`
		),
		'Slider max>min; step<=max-min. Unique field IDs and option values. All fields include required:boolean and help:string (empty allowed).',
		'Checkbox is ONE boolean only (for example accepting terms). For select-all-that-apply questions use CheckboxGroup with a separate option for EVERY choice; it returns an array of selected option values, empty [] allowed unless required=true (then at least one). Never collapse multiple choices into one boolean. Use RadioGroup for a single-choice question; Select is also single choice when a dropdown fits better. Use concise labels and helpful, brief help text. Put SubmitButton last, directly in the root Container, after all sections.',
		'Make the form the main answer, not a second copy of its questions. Description is only useful extra context, never a repeated question list or technical field-type instructions. Group related fields into a few titled Group sections. Container/Group columns: 1, 2 or 3 (optional, responsive maximum); field fullWidth:boolean (optional). Prefer short fields side by side; textarea and long choice groups fullWidth. Keep semantic reading order. Use Number for quantities (min/max within +/-1e12, positive step); Date for calendar dates with YYYY-MM-DD bounds. Do not invent a date or numeric value. No layout CSS.'
	].join('\n');
}
