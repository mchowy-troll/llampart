<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/components/ui/utils';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
				destructive:
					'bg-[#e7000b] text-white shadow-xs hover:bg-[#d6000a] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
				outline:
					'bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border',
				secondary:
					'dark:bg-secondary dark:text-secondary-foreground bg-background shadow-sm text-foreground hover:bg-muted-foreground/20',
				ghost: 'hover:text-accent-foreground hover:bg-muted-foreground/10 backdrop-blur-sm',
				'bare-icon':
					'llampart-button-bare-icon border-0 bg-transparent shadow-none outline-none ring-0 transition-none animate-none hover:bg-transparent hover:shadow-none focus:bg-transparent focus:outline-none focus:ring-0 focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0 active:bg-transparent active:shadow-none',
				link: 'text-primary underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-9 px-4 py-2 has-[>svg]:px-3',
				sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
				lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
				'icon-lg': 'size-10',
				icon: 'size-9',
				'icon-sm': 'size-5 rounded-sm'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}

<style>
	a,
	button {
		cursor: pointer;
	}

	/* Shared bare icon action primitive: no button surface, focus ring, or motion in any interaction state. */
	:global(.llampart-button-bare-icon),
	:global(.llampart-bare-icon-action),
	:global(.llampart-button-bare-icon:hover),
	:global(.llampart-bare-icon-action:hover),
	:global(.llampart-button-bare-icon:focus),
	:global(.llampart-bare-icon-action:focus),
	:global(.llampart-button-bare-icon:focus-visible),
	:global(.llampart-bare-icon-action:focus-visible),
	:global(.llampart-button-bare-icon:active),
	:global(.llampart-bare-icon-action:active) {
		background: transparent !important;
		background-color: transparent !important;
		background-image: none !important;
		border: 0 !important;
		border-color: transparent !important;
		box-shadow: none !important;
		outline: none !important;
		text-decoration: none !important;
		transform: none !important;
		transition: none !important;
		transition-property: none !important;
		transition-duration: 0s !important;
		animation: none !important;
		-webkit-backdrop-filter: none !important;
		backdrop-filter: none !important;
		--tw-ring-offset-shadow: 0 0 #0000 !important;
		--tw-ring-shadow: 0 0 #0000 !important;
		--tw-shadow: 0 0 #0000 !important;
		--tw-shadow-colored: 0 0 #0000 !important;
	}
</style>
