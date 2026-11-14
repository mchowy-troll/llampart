import { getContext, setContext } from 'svelte';

const MESSAGE_PRESENTATION = Symbol('message-presentation');
const FORM_PRESENTATION = Symbol('form-presentation');

/** Ephemeral mounted-form availability, never persisted or used by provider history. */
interface FormPresentation {
	register(messageId: string, formId: string): () => void;
}

export function setFormPresentation(context: FormPresentation) {
	setContext(FORM_PRESENTATION, context);
}

export function getFormPresentation(): FormPresentation | undefined {
	return getContext(FORM_PRESENTATION);
}

/** Local to a keyed message; restoration is not a global animation preference. */
interface MessagePresentation {
	historical: boolean;
}

export function setMessagePresentation(context: MessagePresentation) {
	setContext(MESSAGE_PRESENTATION, context);
}

export function getMessagePresentation(): MessagePresentation | undefined {
	return getContext(MESSAGE_PRESENTATION);
}
