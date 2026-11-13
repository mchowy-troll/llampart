import { z } from 'zod';
import {
	FORM_LIMITS,
	forbiddenFormKeys,
	formPropSchemas,
	formDateSchema,
	formSpecSchema,
	interactiveFormSchema
} from '$lib/forms/form-schema';
import type {
	FormFieldProps,
	FormValues,
	InteractiveForm,
	InteractiveFormSpec
} from '$lib/types/interactive-forms';

export function formBytes(value: unknown): number {
	return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

function inspect(value: unknown, limit: number): void {
	if (formBytes(value) > limit) throw new Error('Form size limit exceeded');
	const pending = [{ value, depth: 0 }];
	while (pending.length) {
		const entry = pending.pop()!;
		if (entry.depth > 16) throw new Error('Form nesting limit exceeded');
		if (entry.value && typeof entry.value === 'object') {
			for (const [key, child] of Object.entries(entry.value)) {
				if (forbiddenFormKeys.has(key) || key.startsWith('$'))
					throw new Error('Forbidden form key');
				pending.push({ value: child, depth: entry.depth + 1 });
			}
		}
	}
}

export function validateFormSpec(value: unknown): InteractiveFormSpec {
	if (typeof value === 'string') {
		if (formBytes(value) > FORM_LIMITS.specBytes) throw new Error('Form size limit exceeded');
		value = JSON.parse(value);
	}
	inspect(value, FORM_LIMITS.specBytes);
	const spec = formSpecSchema.parse(value);
	const ids = Object.keys(spec.elements);
	if (!ids.length || ids.length > FORM_LIMITS.nodes) throw new Error('Form node limit exceeded');
	const visited = new Set<string>();
	const fields = new Set<string>();
	let submits = 0;
	let submitId = '';
	function visit(id: string, depth: number): void {
		if (depth > FORM_LIMITS.depth || visited.has(id)) throw new Error('Invalid form tree');
		visited.add(id);
		const node = spec.elements[id];
		if (!node) throw new Error('Missing form node');
		const props = formPropSchemas[node.type].parse(node.props);
		node.props = props;
		if ('field' in props && typeof props.field === 'string') {
			if (fields.has(props.field)) throw new Error('Duplicate form field');
			fields.add(props.field);
		}
		if (node.type === 'SubmitButton') {
			submits++;
			submitId = id;
			if (!node.on) throw new Error('Missing submit action');
		} else if (node.on) throw new Error('Forbidden form action');
		if (!['Container', 'Group'].includes(node.type) && node.children.length)
			throw new Error('Invalid form children');
		node.children.forEach((child) => visit(child, depth + 1));
	}
	if (spec.elements[spec.root]?.type !== 'Container') throw new Error('Invalid form root');
	visit(spec.root, 1);
	if (visited.size !== ids.length || submits !== 1 || !fields.size)
		throw new Error('Invalid form tree');
	// The host owns the final action position, including previously saved specs.
	// Move only the action, never fields or their semantic/tab order.
	for (const node of Object.values(spec.elements))
		node.children = node.children.filter((child) => child !== submitId);
	spec.elements[spec.root].children.push(submitId);
	return spec;
}

export function formFields(spec: InteractiveFormSpec) {
	const nodes: (typeof spec.elements)[string][] = [];
	function visit(id: string) {
		const node = spec.elements[id];
		if ('field' in node.props) nodes.push(node);
		node.children.forEach(visit);
	}
	visit(spec.root);
	return nodes;
}

export function formDefaults(spec: InteractiveFormSpec): FormValues {
	return Object.fromEntries(
		formFields(spec).map((n) => [
			String(n.props.field),
			n.type === 'Checkbox'
				? false
				: n.type === 'CheckboxGroup'
					? []
					: n.type === 'Slider'
						? Number(n.props.min)
						: ''
		])
	);
}

export function parseFormValues(spec: InteractiveFormSpec, value: unknown): FormValues {
	inspect(value, FORM_LIMITS.valuesBytes);
	const shape: Record<string, z.ZodType> = {};
	for (const n of formFields(spec)) {
		const p = n.props as unknown as FormFieldProps;
		shape[p.field] =
			n.type === 'Checkbox'
				? z.boolean()
				: n.type === 'CheckboxGroup'
					? z
							.array(z.enum(p.options!.map((o) => o.value)))
							.max(p.options!.length)
							.refine((a) => new Set(a).size === a.length)
							.transform((a) => p.options!.filter((o) => a.includes(o.value)).map((o) => o.value))
					: n.type === 'Number'
						? z.union([
								z.number().finite().min(-1e12).max(1e12),
								z.literal(''),
								z.literal('invalid')
							])
						: n.type === 'Slider'
							? z.number().finite().min(Number(p.min)).max(Number(p.max))
							: z.string().max(n.type === 'Textarea' ? 2000 : 240);
	}
	return z.object(shape).strict().parse(value) as FormValues;
}

export function validateFormValues(spec: InteractiveFormSpec, candidate: unknown) {
	const values = parseFormValues(spec, candidate);
	const errors: Record<string, string> = {};
	for (const n of formFields(spec)) {
		const p = n.props as unknown as FormFieldProps;
		const v = values[p.field];
		if (p.required && (v === false || (Array.isArray(v) ? !v.length : String(v).trim() === '')))
			errors[p.field] = 'required';
		else if (n.type === 'Number' && v !== '') {
			if (
				typeof v !== 'number' ||
				!Number.isFinite(v) ||
				(p.min !== undefined && v < Number(p.min)) ||
				(p.max !== undefined && v > Number(p.max)) ||
				(p.step !== undefined &&
					Math.abs(
						(v - Number(p.min ?? 0)) / p.step - Math.round((v - Number(p.min ?? 0)) / p.step)
					) > 1e-6)
			)
				errors[p.field] = 'value';
		} else if (
			n.type === 'Date' &&
			v !== '' &&
			(!formDateSchema.safeParse(v).success ||
				(p.min !== undefined && String(v) < String(p.min)) ||
				(p.max !== undefined && String(v) > String(p.max)))
		)
			errors[p.field] = 'value';
		else if (String(v).trim() && p.format === 'email' && !z.email().safeParse(v).success)
			errors[p.field] = 'email';
		else if (p.options && !Array.isArray(v) && v !== '' && !p.options.some((o) => o.value === v))
			errors[p.field] = 'option';
		else if (
			n.type === 'Slider' &&
			Math.abs(
				(Number(v) - Number(p.min)) / p.step! - Math.round((Number(v) - Number(p.min)) / p.step!)
			) > 1e-6
		)
			errors[p.field] = 'step';
	}
	return { values, errors, valid: !Object.keys(errors).length };
}

export function formAnswerText(spec: InteractiveFormSpec, values: FormValues): string {
	return formFields(spec)
		.map((n, i) => {
			const p = n.props as unknown as FormFieldProps;
			const value = values[p.field];
			const answer = Array.isArray(value)
				? p
						.options!.filter((o) => value.includes(o.value))
						.map((o) => o.label)
						.join(', ')
				: (p.options?.find((o) => o.value === value)?.label ?? String(value));
			return `${i + 1}. ${p.label}\n${answer || '—'}`;
		})
		.join('\n\n');
}

/** Revalidate local history too. No trust is conferred by IndexedDB. */
export function validateInteractiveForm(
	value: unknown,
	owner: { id: string; convId: string; role: string }
): InteractiveForm {
	inspect(value, 131072);
	const form = interactiveFormSchema.parse(value);
	if (
		owner.role !== 'assistant' ||
		form.messageId !== owner.id ||
		form.conversationId !== owner.convId
	)
		throw new Error('Invalid form owner');
	form.spec = validateFormSpec(form.spec);
	form.values = parseFormValues(form.spec, form.values);
	if (form.status === 'submitted' && !form.result) throw new Error('Missing form result');
	if (form.result) {
		const checked = validateFormValues(form.spec, form.result.values);
		if (
			!checked.valid ||
			JSON.stringify(form.values) !== JSON.stringify(checked.values) ||
			formAnswerText(form.spec, checked.values) !== form.result.content
		)
			throw new Error('Invalid form result');
	}
	return form;
}
