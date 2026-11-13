<script lang="ts">
	import type { BaseComponentProps } from '@json-render/svelte';
	let { props }: BaseComponentProps<{ text: string }> = $props();
</script>

<p class="llampart-form-description">{props.text}</p>
