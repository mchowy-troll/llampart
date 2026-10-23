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

	// Bits UI can request closing and invoke Cancel during the same DOM event.
	let handled = false;
	function runOnce(callback: () => void) {
		if (handled || pending) return;
		handled = true;
		queueMicrotask(() => (handled = false));
		callback();
	}

	function handleConfirm() {
		if (!confirmDisabled) runOnce(onConfirm);
	}

	function handleCancel() {
		runOnce(onCancel);
	}

	function handleKeydown(event: KeyboardEvent) {
		onKeydown?.(event);
		if (event.defaultPrevented || event.key !== KeyboardKey.ENTER) return;
		if (event.isComposing || event.repeat) {
			// Suppress native repeated button activation, not editing in child fields.
			if (event.target instanceof Element && event.target.closest('button')) {
				event.preventDefault();
			}
			return;
		}
		// Child controls own their keyboard semantics (including native button clicks).
		if (confirmOnEnter && event.target === event.currentTarget) {
			event.preventDefault();
			handleConfirm();
		}
	}

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen && !pending) {
			handleCancel();
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
			<AlertDialog.Cancel disabled={pending} onclick={handleCancel}>
				{#snippet child({ props })}
					<!-- Bits UI guards cancellation but does not forward disabled to this button. -->
					<button {...props} disabled={pending}>{cancelText}</button>
				{/snippet}
			</AlertDialog.Cancel>
			<AlertDialog.Action
				disabled={pending || confirmDisabled}
				aria-busy={pending}
				onclick={handleConfirm}
				class={variant === 'destructive' ? 'bg-[#e7000b] text-white hover:bg-[#d6000a]' : ''}
			>
				{confirmText}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
