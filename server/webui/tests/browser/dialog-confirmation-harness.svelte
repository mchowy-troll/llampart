<script lang="ts">
	import DialogConfirmation from '$lib/components/app/dialogs/DialogConfirmation.svelte';
	let { confirm = () => {} }: { confirm?: () => void } = $props();
	let open = $state(false);
	let pending = $state(false);
	let confirmDisabled = $state(false);
	let confirmOnEnter = $state(true);
	let hold = false;
	let confirms = 0;
	let cancels = 0;
	export function reset(
		options: { pending?: boolean; disabled?: boolean; enter?: boolean; hold?: boolean } = {}
	) {
		pending = options.pending ?? false;
		confirmDisabled = options.disabled ?? false;
		confirmOnEnter = options.enter ?? true;
		hold = options.hold ?? false;
		confirms = cancels = 0;
		open = true;
	}
	export function inspect() {
		return { open, pending, confirms, cancels };
	}
</script>

<DialogConfirmation
	bind:open
	title="Synthetic deletion"
	description="Delete only synthetic data"
	variant="destructive"
	confirmText="Delete"
	cancelText="Cancel"
	{pending}
	{confirmDisabled}
	{confirmOnEnter}
	onConfirm={() => {
		confirms++;
		confirm();
		if (hold) pending = true;
		else open = false;
	}}
	onCancel={() => {
		cancels++;
		open = false;
	}}
>
	<input aria-label="Child input" />
	<input aria-label="Child checkbox" type="checkbox" />
	<textarea aria-label="Child textarea"></textarea>
	<button onkeydown={(event) => event.preventDefault()}>Handled child</button>
</DialogConfirmation>
