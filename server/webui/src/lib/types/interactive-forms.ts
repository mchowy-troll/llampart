import type { z } from 'zod';
import type { formSpecSchema, interactiveFormSchema } from '$lib/forms/form-schema';

export type InteractiveFormSpec = z.infer<typeof formSpecSchema>;
export type InteractiveForm = z.infer<typeof interactiveFormSchema>;
export type FormValues = Record<string, string | number | boolean | string[]>;
export interface FormFieldProps {
	field: string;
	label: string;
	required: boolean;
	help: string;
	fullWidth?: boolean;
	format?: 'text' | 'email';
	options?: { value: string; label: string }[];
	min?: number | string;
	max?: number | string;
	step?: number;
}
