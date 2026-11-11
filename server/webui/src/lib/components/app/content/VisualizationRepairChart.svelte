<script lang="ts">
	import { onMount } from 'svelte';
	import ChartFrame from './ChartFrame.svelte';
	import type { ChartSpec } from '$lib/charts/chart-schema';

	let { spec, onresult }: { spec: ChartSpec; onresult: (valid: boolean) => void } = $props();
	let host: HTMLDivElement;

	onMount(() => {
		let disposed = false;
		let timer: ReturnType<typeof setTimeout>;
		let stable = 0;
		let previous = '';
		const inspect = () => {
			if (disposed) return;
			try {
				const svg = host.querySelector<SVGSVGElement>('.chart-plot svg');
				const marks = svg?.querySelectorAll(
					spec.type === 'bar'
						? '.lc-bars path, .lc-bars rect'
						: spec.type === 'donut'
							? '.chart-slice'
							: '.chart-series-line'
				);
				if (svg && marks?.length && svg.getBoundingClientRect().width > 0) {
					const geometry = [...svg.querySelectorAll('path, rect, circle, g')]
						.map((mark) =>
							['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'transform']
								.map((key) => mark.getAttribute(key))
								.join(',')
						)
						.join(';');
					if (/NaN|Infinity/.test(geometry)) return onresult(false);
					const box = svg.getBBox();
					if (
						[box.x, box.y, box.width, box.height].every(Number.isFinite) &&
						box.width > 0 &&
						box.height > 0
					) {
						stable = geometry === previous ? stable + 1 : 0;
						previous = geometry;
						if (stable >= 3) return onresult(true);
					}
				}
				timer = setTimeout(inspect, 60);
			} catch {
				onresult(false);
			}
		};
		void document.fonts.ready.then(
			() => {
				if (!disposed) timer = setTimeout(inspect, 60);
			},
			() => {
				if (!disposed) onresult(false);
			}
		);
		return () => {
			disposed = true;
			clearTimeout(timer);
		};
	});
</script>

<div bind:this={host}>
	<svelte:boundary onerror={() => onresult(false)}>
		<ChartFrame {spec} previewMode />
		{#snippet failed()}{/snippet}
	</svelte:boundary>
</div>
