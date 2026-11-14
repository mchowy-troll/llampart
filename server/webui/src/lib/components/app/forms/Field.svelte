<script lang="ts">
	import { getContext } from 'svelte';
	import { getStateContext, type BaseComponentProps } from '@json-render/svelte';
	import { FORM_HOST, type FormHost } from '$lib/forms/form-host';
	import type { FormFieldProps, FormValues } from '$lib/types/interactive-forms';
	import { formBytes } from '$lib/services/interactive-forms';
	import { FORM_LIMITS } from '$lib/forms/form-limits';
	import { t, getInterfaceLanguage } from '$lib/i18n';
	import { config } from '$lib/stores/settings.svelte';
	import SelectionControl from '$lib/components/ui/selection-control/selection-control.svelte';
	import Range from '$lib/components/ui/range/range.svelte';
	import DatePicker from '$lib/components/ui/date-picker/date-picker.svelte';
	import FormSelect from './FormSelect.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { ChevronUp, ChevronDown } from '@lucide/svelte';
	import { mergeProps } from 'bits-ui';
	let { kind, props: p }: BaseComponentProps<FormFieldProps> & { kind: string } = $props();
	const formState = getStateContext();
	const host = getContext<FormHost>(FORM_HOST);
	const value = $derived((formState.state.values as Record<string, unknown>)?.[p.field]);
	const error = $derived((formState.state.errors as Record<string, string>)?.[p.field]);
	const id = $derived(`${host.id}-${p.field}`);
	const disabled = $derived(!host.enabled || !host.editable);
	const tooltipError = $derived(error || host.validationErrors[p.field]);
	let actionHovered = $state(false);
	let tooltipOpen = $state(false);
	const tooltipDisabled = $derived(disabled || !tooltipError || actionHovered);
	$effect(() => {
		if (tooltipDisabled) tooltipOpen = false;
	});
	let numberElement = $state<HTMLInputElement>();
	const dateFormat = $derived(config().conversationTimestampFormat);
	const datePlaceholder = $derived(
		(dateFormat === 'mmddyyyy12'
			? [t('interactiveForms.dateMonth'), t('interactiveForms.dateDay')]
			: [t('interactiveForms.dateDay'), t('interactiveForms.dateMonth')]
		)
			.concat(t('interactiveForms.dateYear'))
			.join('-')
	);
	function change(next: FormValues[string]) {
		if (disabled) return false;
		const values = {
			...(formState.getSnapshot().values as Record<string, unknown>),
			[p.field]: next
		};
		if (formBytes(values) > FORM_LIMITS.valuesBytes) {
			formState.set(`/errors/${p.field}`, 'limit');
			return false;
		}
		formState.set(`/values/${p.field}`, next);
		formState.set(`/errors/${p.field}`, '');
		return true;
	}
	function toggleOption(option: string, checked: boolean) {
		const current = (formState.getSnapshot().values as FormValues)[p.field];
		const selected = Array.isArray(current) ? current : [];
		change(
			p
				.options!.filter((o) => (o.value === option ? checked : selected.includes(o.value)))
				.map((o) => o.value)
		);
	}
	function textInput(target: HTMLInputElement | HTMLTextAreaElement) {
		if (!change(target.value)) target.value = String(value ?? '');
	}
	function numberInput(target: HTMLInputElement) {
		const n = target.valueAsNumber;
		change(
			Number.isFinite(n) && Math.abs(n) <= 1e12
				? n
				: target.validity.badInput || target.value !== ''
					? 'invalid'
					: ''
		);
	}
	function stepNumber(direction: number) {
		if (disabled || !numberElement) return;
		const previous = numberElement.value;
		if (numberElement.step === 'any') {
			const current = Number.isFinite(numberElement.valueAsNumber)
				? numberElement.valueAsNumber
				: 0;
			const [mantissa, exponent = '0'] = String(current).toLowerCase().split('e');
			const decimals = Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
			const next = Number((current + direction).toFixed(Math.min(100, decimals)));
			numberElement.valueAsNumber = Math.min(
				Number(p.max ?? 1e12),
				Math.max(Number(p.min ?? -1e12), next)
			);
		} else {
			numberElement.stepUp(direction);
		}
		if (numberElement.value !== previous) numberInput(numberElement);
		numberElement.focus();
	}
</script>

{#snippet labelText()}
	{p.label}{#if p.required}<sup class="llampart-form-required">*</sup>{/if}
{/snippet}

<div
	class="llampart-form-field"
	data-field={p.field}
	data-full-width={p.fullWidth ?? kind === 'Textarea'}
>
	{#if kind === 'Checkbox'}
		<div class="llampart-form-field-label" aria-hidden="true"></div>
	{:else if kind === 'RadioGroup' || kind === 'CheckboxGroup'}
		<span class="llampart-form-field-label" id={`${id}-label`}>{@render labelText()}</span>
	{:else}
		<label for={id} class="llampart-form-field-label"
			>{@render labelText()}{#if kind === 'Slider'}
				<output class="ml-2" for={id}>{String(value)}</output>{/if}</label
		>
	{/if}
	<Tooltip.Root bind:open={tooltipOpen} disabled={tooltipDisabled}>
		<Tooltip.Trigger tabindex={-1}>
			{#snippet child({ props: tooltipProps })}
				<div
					{...mergeProps(tooltipProps, {
						onpointerover: (event: PointerEvent) => {
							actionHovered = !!(event.target as Element).closest(
								'.llampart-date-trigger, .llampart-form-number-stepper'
							);
						},
						onpointerleave: () => {
							actionHovered = false;
						},
						onfocusin: (event: FocusEvent) => {
							if (
								!(event.target as Element).closest(
									'.llampart-date-trigger, .llampart-form-number-stepper'
								)
							) {
								(tooltipProps.onfocus as ((event: FocusEvent) => void) | undefined)?.(event);
							}
						},
						onfocusout: tooltipProps.onblur as ((event: FocusEvent) => void) | undefined
					})}
					class="llampart-form-field-control"
				>
					{#if kind === 'RadioGroup' || kind === 'CheckboxGroup'}
						<fieldset
							class:llampart-form-checkbox-group={kind === 'CheckboxGroup'}
							role={kind === 'RadioGroup' ? 'radiogroup' : undefined}
							aria-labelledby={`${id}-label`}
							aria-required={kind === 'RadioGroup' ? p.required : undefined}
							aria-describedby={`${id}-help ${id}-error`}
							aria-invalid={!!error}
							{disabled}
						>
							<div class="llampart-form-choices">
								{#each p.options ?? [] as option (option.value)}
									<label class="flex items-center gap-2"
										><SelectionControl
											type={kind === 'RadioGroup' ? 'radio' : 'checkbox'}
											name={id}
											value={option.value}
											checked={kind === 'RadioGroup'
												? value === option.value
												: Array.isArray(value) && value.includes(option.value)}
											onchange={(e) =>
												kind === 'RadioGroup'
													? change(option.value)
													: toggleOption(option.value, e.currentTarget.checked)}
											required={kind === 'RadioGroup' && p.required}
											aria-invalid={!!error}
											aria-describedby={`${id}-help ${id}-error`}
										/><span>{option.label}</span></label
									>
								{/each}
							</div>
						</fieldset>
					{:else if kind === 'Checkbox'}
						<label class="llampart-form-boolean flex items-center gap-2" for={id}
							><SelectionControl
								{id}
								type="checkbox"
								checked={value === true}
								{disabled}
								required={p.required}
								aria-invalid={!!error}
								aria-describedby={`${id}-help ${id}-error`}
								onchange={(e) => change(e.currentTarget.checked)}
							/><span>{@render labelText()}</span></label
						>
					{:else}
						{#if kind === 'Textarea'}
							<textarea
								class="llampart-control llampart-form-control"
								{id}
								value={String(value ?? '')}
								{disabled}
								required={p.required}
								maxlength="2000"
								rows="3"
								aria-invalid={!!error}
								aria-describedby={`${id}-help ${id}-error`}
								oninput={(e) => textInput(e.currentTarget)}
							></textarea>
						{:else if kind === 'Select'}
							<FormSelect
								{id}
								value={String(value ?? '')}
								options={p.options ?? []}
								{disabled}
								required={p.required}
								invalid={!!error}
								describedby={`${id}-help ${id}-error`}
								onChange={change}
							/>
						{:else if kind === 'Number'}
							<div class="llampart-control llampart-form-number" aria-invalid={!!error}>
								<input
									bind:this={numberElement}
									class="llampart-control llampart-form-control"
									{id}
									type="number"
									value={typeof value === 'number' ? value : ''}
									min={p.min}
									max={p.max}
									step={p.step ?? 'any'}
									{disabled}
									required={p.required}
									aria-invalid={!!error}
									aria-describedby={`${id}-help ${id}-error`}
									oninput={(e) => numberInput(e.currentTarget)}
								/>
								<div class="llampart-form-number-stepper">
									<button
										type="button"
										tabindex="-1"
										{disabled}
										aria-label={`${t('interactiveForms.increaseValue')}: ${p.label}`}
										onclick={() => stepNumber(1)}><ChevronUp size={12} aria-hidden="true" /></button
									>
									<button
										type="button"
										tabindex="-1"
										{disabled}
										aria-label={`${t('interactiveForms.decreaseValue')}: ${p.label}`}
										onclick={() => stepNumber(-1)}
										><ChevronDown size={12} aria-hidden="true" /></button
									>
								</div>
							</div>
						{:else if kind === 'Date'}
							<DatePicker
								{id}
								value={String(value ?? '')}
								label={p.label}
								locale={getInterfaceLanguage()}
								{dateFormat}
								inputPlaceholder={datePlaceholder}
								openLabel={t('interactiveForms.openCalendar')}
								previousLabel={t('interactiveForms.previousMonth')}
								nextLabel={t('interactiveForms.nextMonth')}
								min={typeof p.min === 'string' ? p.min : undefined}
								max={typeof p.max === 'string' ? p.max : undefined}
								{disabled}
								required={p.required}
								invalid={!!error}
								describedby={`${id}-help ${id}-error`}
								invalidMessage={t('interactiveForms.value')}
								onValueChange={change}
							/>
						{:else if kind === 'Slider'}
							<Range
								class="llampart-form-slider"
								accent="var(--llampart-control-accent)"
								{id}
								min={p.min}
								max={p.max}
								step={p.step}
								value={Number(value)}
								{disabled}
								aria-invalid={!!error}
								aria-describedby={`${id}-help ${id}-error`}
								oninput={(e) => change(Number(e.currentTarget.value))}
							/>
						{:else}
							<input
								class="llampart-control llampart-form-control"
								{id}
								type={p.format === 'email' ? 'email' : 'text'}
								value={String(value ?? '')}
								{disabled}
								required={p.required}
								maxlength="240"
								aria-invalid={!!error}
								aria-describedby={`${id}-help ${id}-error`}
								oninput={(e) => textInput(e.currentTarget)}
							/>
						{/if}
					{/if}
				</div>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content
			><p>{tooltipError ? t(`interactiveForms.${tooltipError}`) : ''}</p></Tooltip.Content
		>
	</Tooltip.Root>
	<div class="llampart-form-field-meta">
		{#if p.help}<small id={`${id}-help`} class="llampart-form-help">{p.help}</small>{/if}
		<small id={`${id}-error`} class="llampart-form-error" aria-live="polite"
			>{error ? t(`interactiveForms.${error}`) : ''}</small
		>
	</div>
</div>
