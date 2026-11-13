<script lang="ts">
	import type { BaseComponentProps } from '@json-render/svelte';
	let { props, children }: BaseComponentProps<{ columns?: 1 | 2 | 3 }> = $props();
</script>

<div class="llampart-form-grid" data-columns={props.columns ?? 3}>{@render children?.()}</div>
