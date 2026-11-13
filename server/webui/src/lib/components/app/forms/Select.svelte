<script lang="ts">
	import type { BaseComponentProps } from '@json-render/svelte';
	import type { FormFieldProps } from '$lib/types/interactive-forms';
	import Field from './Field.svelte';
	let props: BaseComponentProps<FormFieldProps> = $props();
</script>

<Field {...props} kind="Select" />
