<script lang="ts">
	import { ArrowBigUp } from '@lucide/svelte';

	interface Props {
		keys: string[];
		variant?: 'default' | 'destructive';
		class?: string;
	}

	let { keys, variant = 'default', class: className = '' }: Props = $props();

	let colorClass = $derived(
		variant === 'destructive' ? 'text-destructive' : 'text-muted-foreground'
	);
</script>

<span
	class="llampart-keyboard-shortcut-info pointer-events-none inline-flex items-center gap-1 opacity-0 transition-opacity select-none {colorClass} {className}"
	aria-hidden="true"
>
	{#each keys as key, index (index)}
		{#if key === 'shift'}
			<ArrowBigUp class="h-5 w-5 stroke-[1.75]" />
		{:else if key === 'cmd'}
			<span class="inline-flex h-5 min-w-5 items-center justify-center text-xl leading-none">⌘</span
			>
		{:else}
			<span class="inline-flex h-5 min-w-5 items-center justify-center text-xl leading-none">
				{key.toUpperCase()}
			</span>
		{/if}

		{#if index < keys.length - 1}
			<span class="sr-only">+</span>
		{/if}
	{/each}
</span>
