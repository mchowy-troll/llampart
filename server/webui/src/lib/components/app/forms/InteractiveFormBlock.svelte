<script lang="ts">
	import type { Component } from 'svelte';
	import type { DatabaseMessage } from '$lib/types/database';
	import type { InteractiveForm } from '$lib/types/interactive-forms';
	import { config } from '$lib/stores/settings.svelte';
	import { formAnswerText, validateInteractiveForm } from '$lib/services/interactive-forms';
	import { t } from '$lib/i18n';
	import { getFormPresentation } from '$lib/contexts/message-presentation.context';

	let { message }: { message: DatabaseMessage } = $props();
	const enabled = $derived(config().interactiveFormsEnabled === true);
	const form = $derived.by(() => {
		try {
			return validateInteractiveForm(message.interactiveForm, message);
		} catch {
			return null;
		}
	});
	const usable = $derived(form && form.sourceContent === message.content);
	let View = $state<Component<{ record: InteractiveForm; enabled: boolean }> | null>(null);
	let failed = $state(false);
	const presentation = getFormPresentation();
	$effect(() => {
		if (form && usable && enabled && View && !failed)
			return presentation?.register(message.id, form.id);
	});
	$effect(() => {
		if (!enabled || !usable || View || failed) return;
		let disposed = false;
		void import('./InteractiveFormView.svelte')
			.then((module) => {
				if (!disposed) View = module.default;
			})
			.catch(() => {
				if (!disposed) failed = true;
			});
		return () => {
			disposed = true;
		};
	});
</script>

<div class="llampart-interactive-form-block min-w-0" data-form-id={form?.id}>
	{#if form && usable && enabled && View && !failed}
		{#key form.id}
			<svelte:boundary
				onerror={() => {
					failed = true;
				}}
			>
				<View record={form} {enabled} />
			</svelte:boundary>
		{/key}
	{:else if form}
		{#if !usable || failed}<p role="status">{t('interactiveForms.invalid')}</p>{/if}
		<pre class="font-inherit text-sm break-words whitespace-pre-wrap">{formAnswerText(
				form.spec,
				form.values
			)}</pre>
	{:else}
		<p role="status">{t('interactiveForms.invalid')}</p>
	{/if}
</div>

<style>
	pre {
		font-family: inherit;
	}
</style>
