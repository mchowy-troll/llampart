<script lang="ts">
	import { getContext } from 'svelte';
	import type { BaseComponentProps } from '@json-render/svelte';
	import { FORM_HOST, type FormHost } from '$lib/forms/form-host';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';
	let { props, emit }: BaseComponentProps<{ label: string }> = $props();
	const host = getContext<FormHost>(FORM_HOST);
</script>

<div class="llampart-form-submit-row">
	<Button
		class="llampart-form-submit"
		size="sm"
		type="button"
		disabled={!host.submittable}
		aria-busy={host.submitting}
		onclick={(event) => host.authorize(event, () => emit('press'))}
		>{host.retry ? t('interactiveForms.retry') : props.label}</Button
	>
</div>
