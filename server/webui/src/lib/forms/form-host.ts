export const FORM_HOST = Symbol('interactive-form-host');
export interface FormHost {
	readonly id: string;
	readonly enabled: boolean;
	readonly editable: boolean;
	readonly submittable: boolean;
	readonly retry: boolean;
	readonly submitting: boolean;
	readonly validationErrors: Record<string, string>;
	authorize(event: MouseEvent, emit: () => void): void;
}
