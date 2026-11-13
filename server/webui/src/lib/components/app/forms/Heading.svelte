<script lang="ts">
	import type { BaseComponentProps } from '@json-render/svelte';
	let { props }: BaseComponentProps<{ text: string }> = $props();
</script>

<h3 class="llampart-form-heading">{props.text}</h3>
