<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/components/ui/utils';
	let {
		type = 'checkbox',
		class: className,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { type?: 'checkbox' | 'radio' } = $props();
</script>

<input
	{type}
	class={cn(
		'llampart-selection-control size-4 shrink-0 cursor-pointer transition-colors',
		className
	)}
	{...rest}
/>
