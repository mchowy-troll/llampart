<script lang="ts">
	import type { BaseComponentProps } from '@json-render/svelte';
	let { props, children }: BaseComponentProps<{ title: string; columns?: 1 | 2 | 3 }> = $props();
</script>

<!-- Retain the transparent 1px edge so removing the surface does not shift the field grid. -->
<section class="llampart-form-group border border-transparent p-4" aria-label={props.title}>
	<h4 class="llampart-form-group-title">{props.title}</h4>
	<div class="llampart-form-grid" data-columns={props.columns ?? 3}>{@render children?.()}</div>
</section>
