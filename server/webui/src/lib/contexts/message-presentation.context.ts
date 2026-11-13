import { getContext, setContext } from 'svelte';

const MESSAGE_PRESENTATION = Symbol('message-presentation');

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
