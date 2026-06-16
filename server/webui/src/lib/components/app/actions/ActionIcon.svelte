<script lang="ts">
	import { Button, type ButtonSize, type ButtonVariant } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { Component } from 'svelte';

	interface Props {
		icon: Component;
		tooltip: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		iconSize?: string;
		class?: string;
		disabled?: boolean;
		onclick: (e?: MouseEvent) => void;
		'aria-label'?: string;
	}

	let {
		icon,
		tooltip,
		variant = 'bare-icon',
		size = 'sm',
		class: className = '',
		disabled = false,
		iconSize = 'h-3 w-3',
		onclick,
		'aria-label': ariaLabel
	}: Props = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<Button
			{variant}
			{size}
			{disabled}
			{onclick}
			class="llampart-bare-icon-action h-6 w-6 p-0 {className} flex"
			aria-label={ariaLabel || tooltip}
		>
			{@const IconComponent = icon}

			<IconComponent class={iconSize} />
		</Button>
	</Tooltip.Trigger>

	<Tooltip.Content>
		<p>{tooltip}</p>
	</Tooltip.Content>
</Tooltip.Root>
