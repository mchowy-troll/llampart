<script lang="ts">
	import { Arc } from 'layerchart/svg';
	import type { ArcProps } from 'layerchart';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	let {
		arcProps,
		radius,
		active,
		exporting
	}: {
		arcProps: ArcProps;
		radius: number;
		active: boolean;
		exporting: boolean;
	} = $props();
	const expansion = new Tween(0, { duration: () => (prefersReducedMotion.current ? 0 : 140) });
	$effect(() => {
		expansion.target = active && !exporting ? 4 : 0;
	});
</script>

<Arc
	{...arcProps}
	class="chart-slice"
	outerRadius={radius + (exporting ? 0 : expansion.current)}
	innerRadius={radius * 0.59}
	motion="none"
	opacity={1}
/>
