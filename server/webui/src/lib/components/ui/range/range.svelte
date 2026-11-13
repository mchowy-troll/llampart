<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/components/ui/utils';
	let {
		class: className,
		accent = 'var(--foreground)',
		value,
		min = 0,
		max = 100,
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { accent?: string } = $props();
	const progress = $derived(
		Math.max(0, Math.min(100, ((Number(value) - Number(min)) / (Number(max) - Number(min))) * 100))
	);
</script>

<input
	type="range"
	class={cn('llampart-range', className)}
	style:--llampart-range-accent={accent}
	style:--llampart-range-progress={`${progress}%`}
	{value}
	{min}
	{max}
	{...rest}
/>
