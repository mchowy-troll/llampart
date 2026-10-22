<script lang="ts">
	import { t } from '$lib/i18n';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { Component, Snippet } from 'svelte';
	import { KeyboardKey } from '$lib/enums';

	interface Props {
		open: boolean;
		title: string;
		description: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'default' | 'destructive';
		icon?: Component;
		onConfirm: () => void;
		onCancel: () => void;
		onKeydown?: (event: KeyboardEvent) => void;
		children?: Snippet;
		/** Disable content-wide Enter when a child input handles submission. */
		confirmOnEnter?: boolean;
		pending?: boolean;
		confirmDisabled?: boolean;
	}

	let {
		open = $bindable(),
		title,
		description,
		confirmText = t('common.confirm'),
		cancelText = t('common.cancel'),
		variant = 'default',
		icon,
		onConfirm,
		onCancel,
		onKeydown,
		children,
		confirmOnEnter = true,
		pending = false,
		confirmDisabled = false
	}: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (confirmOnEnter && event.key === KeyboardKey.ENTER) {
			event.preventDefault();
			if (!pending && !confirmDisabled) onConfirm();
		}
		onKeydown?.(event);
	}

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen && !pending) {
			onCancel();
		}
	}
</script>

<AlertDialog.Root {open} onOpenChange={handleOpenChange}>
	<AlertDialog.Content
		onkeydown={handleKeydown}
		onEscapeKeydown={(event) => {
			if (pending) event.preventDefault();
		}}
	>
		<AlertDialog.Header>
			<AlertDialog.Title class="flex items-center gap-2">
				{#if icon}
					{@const IconComponent = icon}
					<IconComponent class="h-5 w-5 {variant === 'destructive' ? 'text-destructive' : ''}" />
				{/if}
				{title}
			</AlertDialog.Title>

			<AlertDialog.Description>
				{description}
			</AlertDialog.Description>
		</AlertDialog.Header>

		{#if children}
			{@render children()}
		{/if}

		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={pending} onclick={onCancel}>
				{#snippet child({ props })}
					<!-- Bits UI guards cancellation but does not forward disabled to this button. -->
					<button {...props} disabled={pending}>{cancelText}</button>
				{/snippet}
			</AlertDialog.Cancel>
			<AlertDialog.Action
				disabled={pending || confirmDisabled}
				aria-busy={pending}
				onclick={onConfirm}
				class={variant === 'destructive' ? 'bg-[#e7000b] text-white hover:bg-[#d6000a]' : ''}
			>
				{confirmText}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
