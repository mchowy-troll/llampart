<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { BadgeModality, ActionIconCopyToClipboard } from '$lib/components/app';
	import { ChevronDown } from '@lucide/svelte';
	import { serverStore } from '$lib/stores/server.svelte';
	import { modelsStore, modelOptions, modelsLoading } from '$lib/stores/models.svelte';
	import { formatFileSize, formatParameters, formatNumber } from '$lib/utils';
	import type { ApiLlamaCppServerProps } from '$lib/types';
	import { t } from '$lib/i18n';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		// when set, fetch props from the child process (router mode)
		modelId?: string | null;
	}

	let { open = $bindable(), onOpenChange, modelId = null }: Props = $props();

	let isRouter = $derived(serverStore.isRouterMode);

	// per-model props fetched from the child process
	let routerModelProps = $state<ApiLlamaCppServerProps | null>(null);
	let isLoadingRouterProps = $state(false);

	// in router mode use per-model props, otherwise use global props
	let serverProps = $derived(isRouter && modelId ? routerModelProps : serverStore.props);

	let modelName = $derived(isRouter && modelId ? modelId : modelsStore.singleModelName);
	let models = $derived(modelOptions());
	let isLoadingModels = $derived(modelsLoading());

	// in router mode, find the model option matching modelId
	// in single mode, use the first model as before
	let firstModel = $derived.by(() => {
		if (isRouter && modelId) {
			return models.find((m) => m.model === modelId) ?? null;
		}
		return models[0] ?? null;
	});

	// Get modalities from modelStore using the model ID from the first model
	let modalities = $derived.by(() => {
		if (!firstModel?.id) return [];
		return modelsStore.getModelModalitiesArray(firstModel.id);
	});

	// Ensure models are fetched when dialog opens
	$effect(() => {
		if (open && models.length === 0) {
			modelsStore.fetch();
		}
	});

	// fetch per-model props from child process when dialog opens in router mode
	$effect(() => {
		if (open && isRouter && modelId) {
			isLoadingRouterProps = true;
			modelsStore
				.fetchModelProps(modelId)
				.then((props) => {
					routerModelProps = props;
				})
				.catch(() => {
					routerModelProps = null;
				})
				.finally(() => {
					isLoadingRouterProps = false;
				});
		}
		if (!open) {
			routerModelProps = null;
		}
	});
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content
		class="llampart-model-info-dialog @container z-9999 flex !max-h-[80dvh] !w-[50vw] !max-w-[50vw] flex-col overflow-hidden"
	>
		<style>
			@container (max-width: 56rem) {
				.resizable-text-container {
					max-width: calc(100vw - var(--threshold));
				}
			}

			.llampart-model-info-scroll-viewport {
				flex: 1 1 auto;
				min-height: 0;
				width: 100%;
				max-height: calc(80dvh - 5.25rem);
				overflow: auto;
			}

			/* llampart-model-info-single-column-layout */
			.llampart-model-info-grid {
				display: grid;
				grid-template-columns: minmax(0, 1fr);
				gap: 1rem;
				align-items: start;
			}

			.llampart-model-info-details,
			.llampart-model-info-template-panel {
				min-width: 0;
			}

			.llampart-model-info-template-panel {
				min-width: 0;
				overflow: hidden;
				border: 1px solid var(--llampart-model-info-template-border, hsl(var(--border)));
				border-radius: 0.75rem;
				background: var(--llampart-model-info-template-background, hsl(var(--muted) / 0.45));
			}

			.llampart-model-info-template-title {
				display: flex;
				cursor: pointer;
				align-items: center;
				justify-content: space-between;
				gap: 0.75rem;
				padding: 0.75rem 1rem;
				font-size: 0.875rem;
				font-weight: 600;
				list-style: none;
			}

			.llampart-model-info-template-title::-webkit-details-marker {
				display: none;
			}

			.llampart-model-info-template-chevron {
				transition: transform 160ms ease;
			}

			.llampart-model-info-template-panel[open] .llampart-model-info-template-chevron {
				transform: rotate(180deg);
			}

			.llampart-model-info-template-body {
				max-height: min(32rem, calc(80dvh - 13rem));
				overflow: auto;
				border-top: 1px solid var(--llampart-model-info-template-border, hsl(var(--border)));
				padding: 1rem;
			}
		</style>

		<Dialog.Header>
			<Dialog.Title>{t('dialogs.modelInformationTitle')}</Dialog.Title>

			<Dialog.Description>{t('dialogs.modelInformationDescription')}</Dialog.Description>
		</Dialog.Header>

		<div class="llampart-model-info-scroll-viewport">
			<div class="llampart-model-info-body space-y-6 py-4">
				{#if isLoadingModels || isLoadingRouterProps}
					<div class="flex items-center justify-center py-8">
						<div class="text-sm text-muted-foreground">{t('dialogs.loadingModelInformation')}</div>
					</div>
				{:else if firstModel}
					{@const modelMeta = firstModel.meta}

					{#if serverProps}
						<div class="llampart-model-info-grid">
							<div class="llampart-model-info-details">
								<Table.Root>
									<Table.Header>
										<Table.Row>
											<Table.Head class="w-[10rem]">{t('dialogs.modelLabel')}</Table.Head>

											<Table.Head>
												<div class="inline-flex items-center gap-2">
													<span
														class="resizable-text-container min-w-0 flex-1 truncate"
														style:--threshold="12rem"
													>
														{modelName}
													</span>

													<ActionIconCopyToClipboard
														text={modelName || ''}
														canCopy={!!modelName}
														ariaLabel={t('dialogs.copyModelNameToClipboard')}
													/>
												</div>
											</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										<!-- Model Path -->
										<Table.Row>
											<Table.Cell class="h-10 align-middle font-medium"
												>{t('dialogs.filePathLabel')}</Table.Cell
											>

											<Table.Cell
												class="inline-flex h-10 items-center gap-2 align-middle font-mono text-xs"
											>
												<span
													class="resizable-text-container min-w-0 flex-1 truncate"
													style:--threshold="14rem"
												>
													{serverProps.model_path}
												</span>

												<ActionIconCopyToClipboard
													text={serverProps.model_path}
													ariaLabel={t('dialogs.copyModelPathToClipboard')}
												/>
											</Table.Cell>
										</Table.Row>

										<!-- Context Size -->
										{#if serverProps?.default_generation_settings?.n_ctx}
											<Table.Row>
												<Table.Cell class="h-10 align-middle font-medium"
													>{t('dialogs.contextSizeLabel')}</Table.Cell
												>

												<Table.Cell
													>{formatNumber(serverProps.default_generation_settings.n_ctx)} tokens</Table.Cell
												>
											</Table.Row>
										{:else}
											<Table.Row>
												<Table.Cell class="h-10 align-middle font-medium text-red-500"
													>Context Size</Table.Cell
												>

												<Table.Cell class="text-red-500">{t('common.notAvailable')}</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Training Context -->
										{#if modelMeta?.n_ctx_train}
											<Table.Row>
												<Table.Cell class="h-10 align-middle font-medium"
													>{t('dialogs.trainingContextLabel')}</Table.Cell
												>

												<Table.Cell>{formatNumber(modelMeta.n_ctx_train)} tokens</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Model Size -->
										{#if modelMeta?.size}
											<Table.Row>
												<Table.Cell class="h-10 align-middle font-medium"
													>{t('dialogs.modelSizeLabel')}</Table.Cell
												>

												<Table.Cell>{formatFileSize(modelMeta.size)}</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Parameters -->
										{#if modelMeta?.n_params}
											<Table.Row>
												<Table.Cell class="h-10 align-middle font-medium"
													>{t('dialogs.parametersLabel')}</Table.Cell
												>

												<Table.Cell>{formatParameters(modelMeta.n_params)}</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Embedding Size -->
										{#if modelMeta?.n_embd}
											<Table.Row>
												<Table.Cell class="align-middle font-medium"
													>{t('dialogs.embeddingSizeLabel')}</Table.Cell
												>

												<Table.Cell>{formatNumber(modelMeta.n_embd)}</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Vocabulary Size -->
										{#if modelMeta?.n_vocab}
											<Table.Row>
												<Table.Cell class="align-middle font-medium"
													>{t('dialogs.vocabularySizeLabel')}</Table.Cell
												>

												<Table.Cell>{formatNumber(modelMeta.n_vocab)} tokens</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Vocabulary Type -->
										{#if modelMeta?.vocab_type}
											<Table.Row>
												<Table.Cell class="align-middle font-medium"
													>{t('dialogs.vocabularyTypeLabel')}</Table.Cell
												>
												<Table.Cell class="align-middle capitalize"
													>{modelMeta.vocab_type}</Table.Cell
												>
											</Table.Row>
										{/if}

										<!-- Total Slots -->
										<Table.Row>
											<Table.Cell class="align-middle font-medium"
												>{t('dialogs.parallelSlotsLabel')}</Table.Cell
											>

											<Table.Cell>{serverProps.total_slots}</Table.Cell>
										</Table.Row>

										<!-- Modalities -->
										{#if modalities.length > 0}
											<Table.Row>
												<Table.Cell class="align-middle font-medium"
													>{t('dialogs.modalitiesLabel')}</Table.Cell
												>

												<Table.Cell>
													<div class="flex flex-wrap gap-1">
														<BadgeModality {modalities} />
													</div>
												</Table.Cell>
											</Table.Row>
										{/if}

										<!-- Build Info -->
										<Table.Row>
											<Table.Cell class="align-middle font-medium"
												>{t('dialogs.buildInfoLabel')}</Table.Cell
											>

											<Table.Cell class="align-middle font-mono text-xs"
												>{serverProps.build_info}</Table.Cell
											>
										</Table.Row>
									</Table.Body>
								</Table.Root>
							</div>

							{#if serverProps.chat_template}
								<details class="llampart-model-info-template-panel">
									<summary class="llampart-model-info-template-title">
										<span>{t('dialogs.chatTemplateLabel')}</span>

										<ChevronDown class="llampart-model-info-template-chevron h-4 w-4" />
									</summary>

									<div class="llampart-model-info-template-body">
										<pre
											class="font-mono text-xs whitespace-pre-wrap">{serverProps.chat_template}</pre>
									</div>
								</details>
							{/if}
						</div>
					{/if}
				{:else if !isLoadingModels}
					<div class="flex items-center justify-center py-8">
						<div class="text-sm text-muted-foreground">
							{t('dialogs.noModelInformationAvailable')}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
