<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { t } from '$lib/i18n';

	let {
		open = $bindable(false),
		display,
		trigger
	}: { open?: boolean; display: HTMLElement; trigger?: HTMLButtonElement } = $props();
	let zoom = $state(100);
	let width = $state(0);
	let height = $state(0);
	let scale = $derived((zoom / 100) * 2);
	const zoomId = $props.id();
	$effect(() => {
		if (open) zoom = 100;
	});

	function mountFormula(node: HTMLElement) {
		const original = display.querySelector<HTMLElement>('.katex')!;
		const formula = original.cloneNode(true) as HTMLElement;
		// Clone trusted KaTeX, not a screenshot or a fresh parse with different macros.
		formula.style.fontSize = getComputedStyle(original).fontSize;
		formula.style.display = 'inline-block';
		formula.style.textAlign = 'left';
		node.append(formula);
		let disposed = false;
		const measure = () => {
			if (disposed) return;
			width = formula.offsetWidth;
			height = formula.offsetHeight;
		};
		measure();
		void document.fonts.ready.then(measure);
		return { destroy: () => (disposed = true) };
	}
</script>

<Dialog.Root bind:open onOpenChange={() => (zoom = 100)}>
	<Dialog.Content
		class="table-preview-dialog-content math-preview-dialog z-[999999] flex !max-h-[80dvh] !w-[80vw] !max-w-[80vw] flex-col gap-0 overflow-hidden p-0"
		onCloseAutoFocus={(event) => {
			if (trigger?.isConnected) {
				event.preventDefault();
				trigger.focus();
			}
		}}
	>
		<div class="math-preview-header"><Dialog.Title>{t('math.preview')}</Dialog.Title></div>
		<div class="math-preview-body">
			<!-- A named scroll region is focusable so arrow/Page keys can scroll the formula. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="math-preview-scroll" tabindex="0" role="region" aria-label={t('math.preview')}>
				<!-- Center when it fits; let the stage grow from the scroll origin otherwise. -->
				<div class="math-preview-stage">
					<div
						class="math-preview-bounds"
						style:width="{width * scale}px"
						style:height="{height * scale}px"
					>
						<div
							class="math-preview-formula"
							style:transform="scale({scale})"
							use:mountFormula
						></div>
					</div>
				</div>
			</div>
			<div class="math-preview-zoom">
				<output for={zoomId}>{zoom}%</output>
				<input
					id={zoomId}
					type="range"
					min="50"
					max="300"
					step="10"
					bind:value={zoom}
					aria-label={t('math.zoom')}
					aria-valuetext={`${zoom}%`}
				/>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	.math-preview-header {
		padding: 1rem 3rem 1rem 1.25rem;
		border-bottom: 1px solid var(--border);
	}
	.math-preview-body {
		display: flex;
		min-height: 0;
		height: min(28rem, calc(80dvh - 4rem));
		gap: 0.75rem;
		padding: 1rem;
	}
	.math-preview-scroll {
		flex: 1;
		min-width: 0;
		overflow: auto;
	}
	.math-preview-stage {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		width: max-content;
		min-width: 100%;
		min-height: 100%;
		padding: 1em;
	}
	.math-preview-bounds {
		position: relative;
	}
	.math-preview-formula {
		position: absolute;
		top: 0;
		left: 0;
		width: max-content;
		transform-origin: top left;
		white-space: nowrap;
	}
	.math-preview-zoom {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		border: 1px solid color-mix(in oklch, var(--border) 50%, transparent);
		border-radius: 0.75rem;
		background: rgb(255 255 255 / 0.11);
		backdrop-filter: blur(10px) saturate(104%);
	}
	.math-preview-zoom output {
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}
	.math-preview-zoom input {
		writing-mode: vertical-lr;
		direction: rtl;
		flex: 1;
		min-height: 0;
		width: 1.5rem;
		accent-color: var(--foreground);
		cursor: pointer;
	}
	.math-preview-zoom input:focus-visible,
	.math-preview-scroll:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}
</style>
