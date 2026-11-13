<script lang="ts">
	import { tick } from 'svelte';
	import { Calendar, mergeProps } from 'bits-ui';
	import { parseDate, today, getLocalTimeZone, type DateValue } from '@internationalized/date';
	import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import * as Popover from '$lib/components/ui/popover';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { ConversationTimestampFormat } from '$lib/utils/conversation-timestamp';
	let {
		id,
		value,
		label,
		locale,
		dateFormat,
		inputPlaceholder,
		openLabel,
		previousLabel,
		nextLabel,
		min,
		max,
		disabled,
		required,
		invalid,
		describedby,
		invalidMessage,
		onValueChange
	}: {
		id: string;
		value: string;
		label: string;
		locale: string;
		dateFormat: ConversationTimestampFormat;
		inputPlaceholder: string;
		openLabel: string;
		previousLabel: string;
		nextLabel: string;
		min?: string;
		max?: string;
		disabled: boolean;
		required: boolean;
		invalid: boolean;
		describedby: string;
		invalidMessage: string;
		onValueChange: (value: string) => unknown;
	} = $props();
	let open = $state(false);
	let input: HTMLInputElement;
	let content = $state<HTMLDivElement | null>(null);
	let draft = $state('');
	let lastValue: string | undefined;
	let lastFormat: ConversationTimestampFormat | undefined;
	function date(text?: string) {
		try {
			return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? parseDate(text) : undefined;
		} catch {
			return undefined;
		}
	}
	function display(text: string, format: ConversationTimestampFormat) {
		if (!date(text)) return text === 'invalid' ? '' : text;
		const [year, month, day] = text.split('-');
		return (format === 'mmddyyyy12' ? [month, day, year] : [day, month, year]).join('-');
	}
	function canonical(text: string) {
		if (!text) return '';
		const parts = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
		if (!parts) return 'invalid';
		const [, first, second, year] = parts;
		const iso = `${year}-${dateFormat === 'mmddyyyy12' ? first : second}-${dateFormat === 'mmddyyyy12' ? second : first}`;
		return date(iso) ? iso : 'invalid';
	}
	$effect(() => {
		if (value !== lastValue || dateFormat !== lastFormat) {
			// Echoes of edits must not replace partial text or move the caret.
			// A format change only reformats a real ISO date, never interprets a draft.
			if (value !== lastValue || date(value)) draft = display(value, dateFormat);
			lastValue = value;
			lastFormat = dateFormat;
		}
	});
	function inputDate(text: string) {
		draft = text;
		const next = canonical(text);
		lastValue = next;
		// Partial/invalid edits use the existing invalid sentinel, not a fabricated date.
		if (onValueChange(next) === false) {
			lastValue = value;
			draft = display(value, dateFormat);
		}
	}
	const selected = $derived(date(value));
	const minValue = $derived(date(min));
	const maxValue = $derived(date(max));
	let placeholder = $state<DateValue>(today(getLocalTimeZone()));
	const monthFormatter = $derived(
		new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
	);
	const previousMonth = $derived(
		monthFormatter.format(placeholder.subtract({ months: 1 }).toDate('UTC'))
	);
	const nextMonth = $derived(monthFormatter.format(placeholder.add({ months: 1 }).toDate('UTC')));
	$effect(() => {
		if (disabled) open = false;
	});
	$effect(() => {
		const outside =
			selected &&
			((minValue && selected.compare(minValue) < 0) ||
				(maxValue && selected.compare(maxValue) > 0));
		input?.setCustomValidity(value && (!selected || outside) ? invalidMessage : '');
	});
	function opening(next: boolean) {
		if (next) {
			let start = selected ?? today(getLocalTimeZone());
			if (minValue && start.compare(minValue) < 0) start = minValue;
			if (maxValue && start.compare(maxValue) > 0) start = maxValue;
			placeholder = start;
		}
		open = next;
	}
</script>

<Popover.Root {open} onOpenChange={opening}>
	<div
		class="llampart-control llampart-date-input"
		aria-invalid={invalid}
		data-disabled={disabled || undefined}
	>
		<input
			bind:this={input}
			{id}
			type="text"
			value={draft}
			placeholder={inputPlaceholder}
			pattern={'[0-9]{2}-[0-9]{2}-[0-9]{4}'}
			maxlength="10"
			{disabled}
			{required}
			aria-invalid={invalid}
			aria-describedby={describedby}
			oninput={(event) => inputDate(event.currentTarget.value)}
			onkeydown={(event) => {
				if (event.altKey && event.key === 'ArrowDown' && !disabled) {
					event.preventDefault();
					opening(true);
				}
			}}
		/>
		<Popover.Trigger id={`${id}-calendar`} {disabled}>
			{#snippet child({ props: popoverProps })}
				<Tooltip.Root>
					<Tooltip.Trigger id={`${id}-calendar`}>
						{#snippet child({ props: tooltipProps })}
							<button
								{...mergeProps(popoverProps, tooltipProps)}
								class="llampart-date-trigger"
								{disabled}
								aria-label={`${openLabel}: ${label}`}
							>
								<CalendarDays aria-hidden="true" size={16} />
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content><p>{openLabel}</p></Tooltip.Content>
				</Tooltip.Root>
			{/snippet}
		</Popover.Trigger>
	</div>
	<Popover.Content
		bind:ref={content}
		class="llampart-control-popup llampart-date-popup"
		aria-label={label}
		align="start"
		sideOffset={6}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			void tick().then(() => {
				if (open) content?.querySelector<HTMLElement>('[data-calendar-day][tabindex="0"]')?.focus();
			});
		}}
	>
		<Calendar.Root
			type="single"
			{locale}
			{disabled}
			value={selected}
			{minValue}
			{maxValue}
			bind:placeholder
			calendarLabel={label}
			initialFocus
			preventDeselect
			onValueChange={(next) => {
				if (next && !disabled) {
					onValueChange(next.toString());
					open = false;
				}
			}}
		>
			{#snippet children({ months, weekdays })}
				<Calendar.Header class="llampart-calendar-header">
					<Calendar.PrevButton id={`${id}-previous-month`}>
						{#snippet child({ props })}
							<Tooltip.Root>
								<Tooltip.Trigger id={`${id}-previous-month`}>
									{#snippet child({ props: tooltipProps })}
										<button
											{...mergeProps(props, tooltipProps)}
											class="llampart-calendar-nav"
											aria-label={`${previousLabel}: ${previousMonth}`}
										>
											<ChevronLeft size={16} />
										</button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content><p>{previousLabel}</p></Tooltip.Content>
							</Tooltip.Root>
						{/snippet}
					</Calendar.PrevButton>
					<Calendar.Heading class="llampart-calendar-heading" />
					<Calendar.NextButton id={`${id}-next-month`}>
						{#snippet child({ props })}
							<Tooltip.Root>
								<Tooltip.Trigger id={`${id}-next-month`}>
									{#snippet child({ props: tooltipProps })}
										<button
											{...mergeProps(props, tooltipProps)}
											class="llampart-calendar-nav"
											aria-label={`${nextLabel}: ${nextMonth}`}
										>
											<ChevronRight size={16} />
										</button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content><p>{nextLabel}</p></Tooltip.Content>
							</Tooltip.Root>
						{/snippet}
					</Calendar.NextButton>
				</Calendar.Header>
				{#each months as month (month.value.toString())}
					<Calendar.Grid class="llampart-calendar-grid">
						<Calendar.GridHead
							><Calendar.GridRow>
								{#each weekdays as weekday, i (i)}<Calendar.HeadCell
										class="llampart-calendar-weekday">{weekday}</Calendar.HeadCell
									>{/each}
							</Calendar.GridRow></Calendar.GridHead
						>
						<Calendar.GridBody>
							{#each month.weeks as week, i (i)}<Calendar.GridRow>
									{#each week as day (day.toString())}
										<Calendar.Cell date={day} month={month.value}>
											<Calendar.Day class="llampart-calendar-day" />
										</Calendar.Cell>
									{/each}
								</Calendar.GridRow>{/each}
						</Calendar.GridBody>
					</Calendar.Grid>
				{/each}
			{/snippet}
		</Calendar.Root>
	</Popover.Content>
</Popover.Root>

<style>
	.llampart-date-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.5em;
		padding: 0.625rem 0.75rem;
	}
	.llampart-date-input input {
		width: 100%;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		outline: none;
		box-shadow: none;
	}
	:global(.llampart-date-trigger) {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		outline: none;
		box-shadow: none;
	}
	:global(.llampart-date-popup) {
		border-radius: 0.75rem;
		width: 23em;
		max-width: calc(100vw - 1rem);
		padding: 0.8em;
	}
	:global(.llampart-calendar-header) {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5em;
		margin-bottom: 0.4em;
	}
	:global(.llampart-calendar-heading) {
		text-align: center;
		font-weight: var(--llampart-font-semibold, 600);
	}
	:global(.llampart-calendar-grid) {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
	}
	:global(.llampart-calendar-weekday) {
		font-weight: inherit;
		color: var(--muted-foreground);
	}
	:global(.llampart-calendar-nav),
	:global(.llampart-calendar-day) {
		display: grid;
		place-items: center;
		width: 100%;
		height: 2.2em;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		outline: none;
		box-shadow: none;
		cursor: pointer;
	}
	:global(.llampart-calendar-nav) {
		width: 2.4em;
		height: 2.4em;
	}
	:global(.llampart-calendar-day[data-today]) {
		border-color: var(--llampart-control-accent);
	}
	:global(.llampart-calendar-nav:hover:not(:disabled)),
	:global(.llampart-calendar-day:hover:not([data-disabled]):not([data-selected])) {
		background: color-mix(in srgb, var(--llampart-control-accent) 20%, transparent);
	}
	:global(.llampart-calendar-day[data-selected]) {
		background: var(--llampart-control-accent);
		color: var(--llampart-control-selected-foreground);
	}
	:global(.llampart-calendar-nav:focus-visible),
	:global(.llampart-calendar-day:focus-visible) {
		border-color: var(--llampart-control-accent);
		background: color-mix(in srgb, var(--llampart-control-accent) 20%, transparent);
	}
	:global(.llampart-calendar-day[data-selected]:focus-visible) {
		background: color-mix(in srgb, var(--llampart-control-accent) 80%, var(--foreground));
	}
	:global(.llampart-calendar-day[data-outside-month]),
	:global(.llampart-calendar-weekday) {
		color: var(--muted-foreground);
	}
	:global(.llampart-calendar-day[data-disabled]),
	:global(.llampart-calendar-nav:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
