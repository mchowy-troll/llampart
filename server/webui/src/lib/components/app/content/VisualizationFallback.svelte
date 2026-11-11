<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import DialogCodePreview from '$lib/components/app/dialogs/DialogCodePreview.svelte';
	import { copyCodeToClipboard } from '$lib/utils/clipboard';
	import { t } from '$lib/i18n';
	import { diagnosticMessage, type VisualizationDiagnostic } from '$lib/visualizations/diagnostics';
	import { getAllContexts, getContext, onDestroy } from 'svelte';
	import { Loader2 } from '@lucide/svelte';
	import { ChatService } from '$lib/services/chat.service';
	import { modelsStore } from '$lib/stores/models.svelte';
	import type { VisualizationRepairExpectation } from '$lib/services/visualization-repair';
	import {
		canRepairVisualization,
		repairDiagnostic,
		VISUALIZATION_REPAIR_CONTEXT,
		type RepairStage,
		type RepairCategory,
		type VisualizationRepairContext
	} from '$lib/visualizations/repair-context';

	let {
		source,
		title,
		kind,
		disabled = false,
		problem
	}: {
		source: string;
		title: string;
		kind: 'diagram' | 'chart';
		disabled?: boolean;
		problem?: VisualizationDiagnostic;
	} = $props();
	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	let frame: HTMLDivElement;
	let repairing = $state(false);
	let repairFailed = $state(false);
	let sourceVerified = $state(false);
	let controller: AbortController | undefined;
	let disposed = false;
	const owner = getContext<VisualizationRepairContext | undefined>(VISUALIZATION_REPAIR_CONTEXT);
	const rendererContext = getAllContexts();
	let repairEligible = $derived(!disabled && canRepairVisualization(problem) && owner?.available());
	let repairAvailable = $derived(repairEligible && sourceVerified);

	// No chat-store subscriptions here: older messages do not react to streaming state.
	$effect(() => {
		const originalSource = source;
		const originalKind = kind;
		const code = problem?.code;
		const eligible = repairEligible;
		sourceVerified = false;
		repairFailed = false;
		let cancelled = false;
		// Only eligible, mounted fallbacks are resolved, after Markdown has settled.
		// No global indices, observers, or subscriptions to conversation streaming.
		const timer =
			eligible && owner
				? setTimeout(() => {
						void owner
							.resolve(frame)
							.then((descriptor) => {
								if (!cancelled && !disposed) {
									sourceVerified =
										!!descriptor &&
										descriptor.source === originalSource &&
										descriptor.kind === originalKind &&
										owner.owns(descriptor);
									if (import.meta.env.DEV && !sourceVerified && code)
										repairDiagnostic('source', originalKind, code, 'source-unavailable');
								}
							})
							.catch(() => {
								if (import.meta.env.DEV && !cancelled && !disposed && code)
									repairDiagnostic('source', originalKind, code, 'source-verification-failed');
							});
					}, 0)
				: undefined;
		return () => {
			cancelled = true;
			clearTimeout(timer);
			controller?.abort();
		};
	});
	onDestroy(() => {
		disposed = true;
		controller?.abort();
	});

	async function repair() {
		if (repairing || !repairAvailable || !owner || !problem) return;
		const failure = problem;
		const originalSource = source;
		controller = new AbortController();
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
		repairing = true;
		repairFailed = false;
		let stage: RepairStage = 'idle-model';
		let category: RepairCategory = 'context-changed';
		let delegated = false;
		try {
			// Read selection only on click, before the first await; never in an effect.
			const context = ChatService.createProviderRequestContext();
			const expectedRequest: VisualizationRepairExpectation = Object.freeze({
				context,
				selectedModelId: modelsStore.selectedModelId,
				selectedModelName: modelsStore.selectedModelName,
				model: ChatService.resolveEffectiveModel(context)
			});
			stage = 'source';
			category = 'source-unavailable';
			const descriptor = await owner.resolve(frame);
			if (
				!descriptor ||
				signal.aborted ||
				descriptor.source !== originalSource ||
				descriptor.kind !== kind ||
				!owner.owns(descriptor)
			)
				throw new Error('Source unavailable');
			stage = 'request';
			category = 'module-load';
			const [{ repairVisualization }, { validateRepairRenderer }] = await Promise.all([
				import('$lib/services/visualization-repair'),
				import('$lib/visualizations/repair-renderer')
			]);
			delegated = true;
			await repairVisualization({
				source: descriptor,
				problem: failure,
				expectedRequest,
				signal,
				isCurrent: async () => {
					if (
						disposed ||
						signal.aborted ||
						source !== originalSource ||
						problem?.code !== failure.code
					)
						return false;
					const live = await owner.resolve(frame);
					return (
						!!live &&
						live.source === originalSource &&
						live.kind === descriptor.kind &&
						owner.owns(live) &&
						live.originalContent === descriptor.originalContent &&
						live.rawStart === descriptor.rawStart &&
						live.rawEnd === descriptor.rawEnd &&
						live.messageId === descriptor.messageId &&
						live.conversationId === descriptor.conversationId
					);
				},
				validateRenderer: (candidate) =>
					validateRepairRenderer(candidate, frame, signal, rendererContext)
			});
		} catch {
			// Never expose provider/renderer exception text or mutate the original on failure.
			// Service failures are reported there, avoiding a second misleading entry here.
			if (import.meta.env.DEV && !delegated) {
				if (signal.aborted)
					category =
						signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
							? 'timeout'
							: 'aborted';
				repairDiagnostic(stage, kind, failure.code, category);
			}
			if (!disposed) repairFailed = true;
		} finally {
			if (!disposed) repairing = false;
		}
	}
</script>

<div
	bind:this={frame}
	aria-busy={repairing}
	class="llampart-visualization-frame llampart-visualization-fallback llampart-{kind}-fallback"
	data-problem-code={disabled ? undefined : problem?.code}
	data-problem-category={disabled ? undefined : problem?.category}
>
	<div class="fallback-title">{title}</div>
	<div role="status" class="fallback-message">
		<p>
			{!disabled && problem
				? diagnosticMessage(problem, t)
				: t(
						kind === 'diagram'
							? disabled
								? 'diagrams.disabled'
								: 'diagrams.invalid'
							: disabled
								? 'charts.disabled'
								: 'charts.invalid'
					)}
		</p>
	</div>
	{#if repairing}
		<div class="repair-progress" role="status">
			<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
			{t(kind === 'chart' ? 'charts.preparing' : 'diagrams.preparing')}
		</div>
	{:else if repairFailed}
		<p class="repair-error" role="alert">{t('visualizationRepair.failed')}</p>
	{/if}
	<div class="fallback-actions">
		{#if repairAvailable}
			<Button variant="outline" size="sm" disabled={repairing} onclick={repair}>
				{t('visualizationRepair.repair')}
			</Button>
		{/if}
		<Button bind:ref={trigger} variant="outline" size="sm" onclick={() => (open = true)}
			>{t('common.showCode')}</Button
		>
		<Button
			variant="outline"
			size="sm"
			onclick={() =>
				copyCodeToClipboard(
					source,
					t('common.codeCopiedToClipboard'),
					t('common.failedToCopyCode')
				)}>{t('common.copyCode')}</Button
		>
	</div>
</div>

<DialogCodePreview
	bind:open
	code={source}
	language={kind === 'diagram' ? 'mermaid' : 'json'}
	sourceOnly
	returnFocus={trigger}
/>

<style>
	.llampart-visualization-fallback {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		overflow-wrap: anywhere;
		padding: 1rem;
		font-size: 0.875em;
	}
	.fallback-title {
		font-weight: var(--llampart-font-semibold, 600);
		margin-bottom: 0.25rem;
		max-height: 3.5em;
		overflow: auto;
	}
	.fallback-message p {
		margin: 0;
	}
	.fallback-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.repair-progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.repair-error {
		margin-top: 0.75rem;
	}
	.fallback-actions :global(button) {
		max-width: 100%;
		white-space: normal;
	}
</style>
