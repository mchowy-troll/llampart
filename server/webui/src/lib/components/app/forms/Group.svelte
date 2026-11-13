<script lang="ts">
	import type { BaseComponentProps } from '@json-render/svelte';
	let { props, children }: BaseComponentProps<{ title: string; columns?: 1 | 2 | 3 }> = $props();
</script>

<!-- Same light frame geometry/tokens as framed groups in ChatSettings. -->
<section class="llampart-form-group rounded-2xl border border-border p-4" aria-label={props.title}>
	<h4 class="llampart-form-group-title">{props.title}</h4>
	<div class="llampart-form-grid" data-columns={props.columns ?? 3}>{@render children?.()}</div>
</section>
