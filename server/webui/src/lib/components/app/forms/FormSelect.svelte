<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { t } from '$lib/i18n';
	let {
		id,
		value,
		options,
		disabled,
		required,
		invalid,
		describedby,
		onChange
	}: {
		id: string;
		value: string;
		options: { value: string; label: string }[];
		disabled: boolean;
		required: boolean;
		invalid: boolean;
		describedby: string;
		onChange: (value: string) => unknown;
	} = $props();
</script>

<Select.Root
	type="single"
	{value}
	{disabled}
	{required}
	onValueChange={(next) => {
		onChange(next);
	}}
>
	<Select.Trigger
		{id}
		class="llampart-control llampart-form-control llampart-form-select-trigger"
		aria-invalid={invalid}
		aria-describedby={describedby}
	>
		<span
			>{options.find((option) => option.value === value)?.label ??
				t('interactiveForms.choose')}</span
		>
	</Select.Trigger>
	<Select.Content class="llampart-control-popup llampart-form-select-content">
		{#each options as option (option.value)}
			<Select.Item value={option.value} label={option.label} />
		{/each}
	</Select.Content>
</Select.Root>
