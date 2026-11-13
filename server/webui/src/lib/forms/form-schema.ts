import { z } from 'zod';

export const FORM_LIMITS = { specBytes: 32768, nodes: 64, depth: 6, valuesBytes: 8192 } as const;
export const forbiddenFormKeys = new Set(['__proto__', 'prototype', 'constructor']);
const id = z
	.string()
	.regex(/^[a-z][a-z0-9_]{0,39}$/)
	.refine((s) => !forbiddenFormKeys.has(s));
const label = z.string().min(1).max(120);
const text = z.string().max(600);
const base = {
	field: id,
	label,
	required: z.boolean(),
	help: text,
	fullWidth: z.boolean().optional()
};
const columns = z.union([z.literal(1), z.literal(2), z.literal(3)]).optional();
const numericBound = z.number().finite().min(-1e12).max(1e12);
export const formDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((value) => {
		const [year, month, day] = value.split('-').map(Number);
		if (year < 1 || month < 1 || month > 12 || day < 1) return false;
		const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
		return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	});
const option = z.object({ value: z.string().min(1).max(60), label }).strict();
const options = z
	.array(option)
	.min(2)
	.max(12)
	.refine((a) => new Set(a.map((o) => o.value)).size === a.length);
export const formPropSchemas = {
	Container: z.object({ columns }).strict(),
	Group: z.object({ title: label, columns }).strict(),
	Heading: z.object({ text: label }).strict(),
	Description: z.object({ text }).strict(),
	TextInput: z.object({ ...base, format: z.enum(['text', 'email']) }).strict(),
	Number: z
		.object({
			...base,
			min: numericBound.optional(),
			max: numericBound.optional(),
			step: z.number().finite().positive().max(1e12).optional()
		})
		.strict()
		.refine((p) => p.min === undefined || p.max === undefined || p.max >= p.min),
	Date: z
		.object({ ...base, min: formDateSchema.optional(), max: formDateSchema.optional() })
		.strict()
		.refine((p) => !p.min || !p.max || p.max >= p.min),
	Textarea: z.object(base).strict(),
	Checkbox: z.object(base).strict(),
	CheckboxGroup: z.object({ ...base, options }).strict(),
	RadioGroup: z.object({ ...base, options }).strict(),
	Select: z.object({ ...base, options }).strict(),
	Slider: z
		.object({
			...base,
			min: z.number().finite().min(-10000).max(10000),
			max: z.number().finite().min(-10000).max(10000),
			step: z.number().finite().min(0.01).max(1000)
		})
		.strict()
		.refine((p) => p.max > p.min && p.step <= p.max - p.min),
	SubmitButton: z.object({ label }).strict()
};
export type FormComponentName = keyof typeof formPropSchemas;
export const formSpecSchema = z
	.object({
		root: id,
		elements: z.record(
			id,
			z
				.object({
					type: z.enum(Object.keys(formPropSchemas) as [FormComponentName, ...FormComponentName[]]),
					props: z.record(z.string(), z.unknown()),
					children: z.array(id).max(32),
					on: z
						.object({ press: z.object({ action: z.literal('submit') }).strict() })
						.strict()
						.optional()
				})
				.strict()
		)
	})
	.strict();
const values = z.record(
	id,
	z.union([
		z.string().max(2000),
		z.number().finite(),
		z.boolean(),
		z.array(z.string().min(1).max(60)).max(12)
	])
);
export const interactiveFormSchema = z
	.object({
		id: z.string().min(1).max(100),
		messageId: z.string().min(1).max(100),
		conversationId: z.string().min(1).max(100),
		sourceContent: z.string().max(12000),
		spec: formSpecSchema,
		values,
		revision: z.number().int().nonnegative(),
		status: z.enum(['draft', 'submitted']),
		result: z
			.object({ values, content: z.string().max(24576), messageId: z.string().min(1).max(100) })
			.strict()
			.optional()
	})
	.strict();
