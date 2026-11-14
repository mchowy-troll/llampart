<script lang="ts">
	import { setContext, onDestroy, tick } from 'svelte';
	import { createStateStore } from '@json-render/core';
	import { StateProvider, ActionProvider, Renderer } from '@json-render/svelte';
	import { registry } from './registry';
	import { FORM_HOST, type FormHost } from '$lib/forms/form-host';
	import { validateFormValues } from '$lib/services/interactive-forms';
	import type { FormValues, InteractiveForm } from '$lib/types/interactive-forms';
	import { config } from '$lib/stores/settings.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { t } from '$lib/i18n';
	import '../content/visualization-frame.css';
	import './forms.css';

	let { record, enabled }: { record: InteractiveForm; enabled: boolean } = $props();
	// Controlled store, initialized once per keyed identity, never from model state.
	// svelte-ignore state_referenced_locally
	const store = createStateStore({ values: structuredClone(record.values), errors: {} });
	let previewValues = $state.raw(store.getSnapshot().values as FormValues);
	const validationErrors = $derived(validateFormValues(record.spec, previewValues).errors);
	let lastValues = JSON.stringify(store.getSnapshot().values);
	let busy = $state(false);
	let container = $state<HTMLElement>();
	$effect(() => {
		if (!container) return;
		// novalidate suppresses native hover hints; cancel explicit reportValidity()
		// bubbles too. Keep constraint metadata and scope capture to this form.
		const element = container;
		const suppressNativeValidation = (event: Event) => event.preventDefault();
		element.addEventListener('invalid', suppressNativeValidation, true);
		return () => element.removeEventListener('invalid', suppressNativeValidation, true);
	});
	let permit = false;
	const unsubscribe = store.subscribe(() => {
		const values = store.getSnapshot().values as FormValues;
		previewValues = values;
		const serialized = JSON.stringify(values);
		if (serialized === lastValues) return;
		lastValues = serialized;
		void conversationsStore
			.saveInteractiveFormValues(record.messageId, record.id, structuredClone(values))
			.catch(() => {
				// The store retains the write and before-unload protection for safe retry.
			});
	});
	onDestroy(unsubscribe);
	$effect(() => {
		const serialized = JSON.stringify(record.values);
		if (serialized === lastValues) return;
		lastValues = serialized;
		store.set('/values', structuredClone(record.values));
	});
	const host: FormHost = {
		get id() {
			return record.id;
		},
		get enabled() {
			return enabled && config().interactiveFormsEnabled === true;
		},
		get editable() {
			return !busy && record.status === 'draft' && !record.result;
		},
		get submittable() {
			return host.enabled && !busy && record.status === 'draft';
		},
		get submitting() {
			return busy;
		},
		get validationErrors() {
			return validationErrors;
		},
		authorize(event, emit) {
			if (!event.isTrusted || !host.enabled || busy || record.status !== 'draft') return;
			permit = true;
			try {
				emit();
			} finally {
				permit = false;
			}
		}
	};
	setContext(FORM_HOST, host);
	const handlers = {
		submit: async () => {
			if (!permit || !host.enabled || busy || record.status !== 'draft') return;
			let focusError = false;
			busy = true;
			try {
				const checked = validateFormValues(record.spec, store.getSnapshot().values);
				store.set('/errors', checked.errors);
				if (!checked.valid) {
					focusError = true;
					return;
				}
				// Retry a failed write too; no successful submission without durable answers.
				if (!record.result)
					await conversationsStore.saveInteractiveFormValues(
						record.messageId,
						record.id,
						checked.values
					);
				await chatStore.submitInteractiveForm(record.messageId, record.id);
			} catch {
				// Keep durable/pending ownership intact; the same action can safely retry.
			} finally {
				busy = false;
				if (focusError) {
					// Wait until errors are rendered and busy no longer disables controls.
					await tick();
					container
						?.querySelector('.llampart-form-field:has([aria-invalid="true"])')
						?.querySelector<HTMLElement>(
							'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), button:not(:disabled)'
						)
						?.focus();
				}
			}
		}
	};
</script>

<form
	bind:this={container}
	class="llampart-visualization-frame llampart-interactive-form"
	aria-label={t('settings.fieldInteractiveFormsEnabled')}
	novalidate
	onsubmit={(event) => event.preventDefault()}
>
	<StateProvider {store}>
		<ActionProvider {handlers}>
			<Renderer spec={record.spec} {registry} />
		</ActionProvider>
	</StateProvider>
</form>
