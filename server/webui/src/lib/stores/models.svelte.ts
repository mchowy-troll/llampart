import { browser } from '$app/environment';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';
import { ServerModelStatus, ModelModality } from '$lib/enums';
import { ModelsService } from '$lib/services/models.service';
import { PropsService } from '$lib/services/props.service';
import { getApiProvider } from '$lib/services/providers';
import { API_PROVIDER_IDS, isApiProviderId } from '$lib/constants/api-providers';
import { config } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { TTLCache } from '$lib/utils/cache-ttl';
import {
	detectThinkingSupport,
	detectThinkingSupportWithReason
} from '$lib/utils/chat-template-thinking-detector';
import { throwIfAborted } from '$lib/utils/abort';
import { sleepWithAbort } from '$lib/utils/retry';
import { t } from '$lib/i18n';
import type { ModelReferenceResolution } from '$lib/types/models';
import type { ProviderConnectionContext } from '$lib/types/provider';
import {
	MODEL_PROPS_CACHE_TTL_MS,
	MODEL_PROPS_CACHE_MAX_ENTRIES,
	FAVORITE_MODELS_LOCALSTORAGE_KEY
} from '$lib/constants';

function uniqueStringList(values: string[] | undefined): string[] {
	return [...new Set(values ?? [])];
}

function normalizeModelModalities(props?: ApiLlamaCppServerProps | null): ModelModalities {
	return {
		vision: props?.modalities?.vision ?? false,
		audio: props?.modalities?.audio ?? false,
		video: props?.modalities?.video ?? false
	};
}

/**
 * modelsStore - Reactive store for model management in both MODEL and ROUTER modes
 *
 * This store manages:
 * - Available models list
 * - Selected model for new conversations
 * - Loaded models tracking (ROUTER mode)
 * - Model usage tracking per conversation
 * - Automatic unloading of unused models
 *
 * **Architecture & Relationships:**
 * - **ModelsService**: Stateless service for model API communication
 * - **PropsService**: Stateless service for props/modalities fetching
 * - **modelsStore** (this class): Reactive store for model state
 * - **conversationsStore**: Tracks which conversations use which models
 *
 * **API Inconsistency Workaround:**
 * In MODEL mode, `/props` returns modalities for the single model.
 * In ROUTER mode, `/props` has no modalities - must use `/props?model=<id>` per model.
 * This store normalizes this behavior so consumers don't need to know the server mode.
 *
 * **Key Features:**
 * - **MODEL mode**: Single model, always loaded
 * - **ROUTER mode**: Multi-model with load/unload capability
 * - **Auto-unload**: Automatically unloads models not used by any conversation
 * - **Lazy loading**: ensureModelLoaded() loads models on demand
 */
class ModelsStore {
	/**
	 *
	 *
	 * State
	 *
	 *
	 */

	models = $state<ModelOption[]>([]);
	routerModels = $state<ApiModelDataEntry[]>([]);
	loading = $state(false);
	updating = $state(false);
	error = $state<string | null>(null);
	selectedModelId = $state<string | null>(null);
	selectedModelName = $state<string | null>(null);

	private selectedModelsBySourceKey = $state<Record<string, { id: string; model: string }>>({});

	private modelUsage = $state<Map<string, SvelteSet<string>>>(new Map());
	private modelLoadingStates = new SvelteMap<string, boolean>();

	favoriteModelIds = $state<Set<string>>(this.loadFavoritesFromStorage());
	private loadedModelListSourceKey: string | null = null;
	private fetchPromise: Promise<void> | null = null;
	private requestGeneration = 0;
	private routerMetadataSourceKey: string | null = null;
	private routerMetadataPromise: Promise<void> | null = null;
	private routerMetadataPendingSourceKey: string | null = null;
	private operationControllers = new Map<string, AbortController>();
	private readonly sourceKeySalt = (() => {
		const bytes = new Uint32Array(2);
		crypto.getRandomValues(bytes);
		return `${bytes[0].toString(16)}${bytes[1].toString(16)}`;
	})();

	/**
	 * Model-specific props cache with TTL
	 * Key: modelId, Value: props data including modalities
	 * TTL: 10 minutes - props don't change frequently
	 */
	private modelPropsCache = new TTLCache<string, ApiLlamaCppServerProps>({
		ttlMs: MODEL_PROPS_CACHE_TTL_MS,
		maxEntries: MODEL_PROPS_CACHE_MAX_ENTRIES
	});
	private modelPropsRequests = new Map<string, Promise<ApiLlamaCppServerProps | null>>();

	/**
	 * Version counter for props cache - used to trigger reactivity when props are updated
	 */
	propsCacheVersion = $state(0);

	/**
	 *
	 *
	 * Computed Getters
	 *
	 *
	 */

	private get currentProvider() {
		return getApiProvider(String(config().apiProvider ?? ''));
	}

	private get currentProviderId() {
		const providerId = config().apiProvider;

		return isApiProviderId(providerId) ? providerId : API_PROVIDER_IDS.LLAMA_SERVER;
	}

	private currentRequestContext(): ProviderConnectionContext {
		const currentConfig = config();

		return Object.freeze({
			providerId: getApiProvider(String(currentConfig.apiProvider ?? '')).id,
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? '')
		});
	}

	private getModelListSourceKey(context: ProviderConnectionContext): string {
		let hash = 2166136261;
		for (const character of `${this.sourceKeySalt}:${context.apiKey.trim()}`) {
			hash ^= character.charCodeAt(0);
			hash = Math.imul(hash, 16777619);
		}
		return [
			context.providerId,
			context.serverBaseUrl.trim(),
			`credential:${(hash >>> 0).toString(16)}`
		].join('|');
	}

	private getSourceModelKey(context: ProviderConnectionContext, modelId: string): string {
		return `${this.getModelListSourceKey(context)}\u0000${modelId}`;
	}

	private rememberSelection(sourceKey: string, selection: { id: string; model: string }): void {
		const entries = Object.entries(this.selectedModelsBySourceKey).filter(
			([key]) => key !== sourceKey
		);
		entries.push([sourceKey, selection]);
		this.selectedModelsBySourceKey = Object.fromEntries(entries.slice(-10));
	}

	private getFavoriteStorageKey(providerId = this.currentProviderId): string {
		return `${FAVORITE_MODELS_LOCALSTORAGE_KEY}.${providerId}`;
	}

	private saveCurrentSelectionForSource(): void {
		if (!this.loadedModelListSourceKey || !this.selectedModelId || !this.selectedModelName) return;

		this.rememberSelection(this.loadedModelListSourceKey, {
			id: this.selectedModelId,
			model: this.selectedModelName
		});
	}

	private restoreSelectionForSource(sourceKey: string): boolean {
		const cachedSelection = this.selectedModelsBySourceKey[sourceKey];
		if (!cachedSelection) return false;

		const option = this.models.find(
			(model) => model.id === cachedSelection.id || model.model === cachedSelection.model
		);

		if (!option) return false;

		this.selectedModelId = option.id;
		this.selectedModelName = option.model;

		return true;
	}

	get modelListSourceKey(): string {
		return this.getModelListSourceKey(this.currentRequestContext());
	}

	get hasRouterMetadataForCurrentSource(): boolean {
		return this.routerMetadataSourceKey === this.modelListSourceKey;
	}

	get rememberedSelectionSourceCount(): number {
		return Object.keys(this.selectedModelsBySourceKey).length;
	}

	get usesSelectableModelList(): boolean {
		return serverStore.isRouterMode || this.currentProvider.capabilities.requiresModelInChatRequest;
	}

	get supportsModelLoadUnload(): boolean {
		return this.currentProvider.capabilities.supportsModelLoadUnload && serverStore.isRouterMode;
	}

	get supportsModelProps(): boolean {
		return this.currentProvider.capabilities.supportsModelProps;
	}

	get selectedModel(): ModelOption | null {
		if (!this.selectedModelId) return null;
		return this.models.find((model) => model.id === this.selectedModelId) ?? null;
	}

	get loadedModelIds(): string[] {
		return this.routerModels
			.filter(
				(m) =>
					m.status.value === ServerModelStatus.LOADED ||
					m.status.value === ServerModelStatus.SLEEPING
			)
			.map((m) => m.id);
	}

	get loadingModelIds(): string[] {
		const sourcePrefix = `${this.modelListSourceKey}\u0000`;
		return Array.from(this.modelLoadingStates.entries())
			.filter(([key, loading]) => loading && key.startsWith(sourcePrefix))
			.map(([key]) => key.slice(sourcePrefix.length));
	}

	/**
	 * Get model name in MODEL mode (single model).
	 * Extracts from model_path or model_alias from server props.
	 * In ROUTER mode, returns null (model is per-conversation).
	 */
	get singleModelName(): string | null {
		if (this.currentProvider.capabilities.requiresModelInChatRequest) {
			return this.selectedModelName;
		}

		if (serverStore.isRouterMode) return null;

		const props = serverStore.props;
		if (props?.model_alias) return props.model_alias;
		if (!props?.model_path) return null;

		return props.model_path.split(/(\\|\/)/).pop() || null;
	}

	/**
	 *
	 *
	 * Modalities
	 *
	 *
	 */

	/**
	 * Get modalities for a specific model
	 * Returns cached modalities from model props
	 */
	getModelModalities(modelId: string): ModelModalities | null {
		const model = this.models.find((m) => m.model === modelId || m.id === modelId);
		if (model?.modalities) {
			return model.modalities;
		}

		const props = this.modelPropsCache.get(
			this.getSourceModelKey(this.currentRequestContext(), modelId)
		);
		if (props?.modalities) {
			return normalizeModelModalities(props);
		}

		return null;
	}

	/**
	 * Check if a model supports vision modality
	 */
	modelSupportsVision(modelId: string): boolean {
		return this.getModelModalities(modelId)?.vision ?? false;
	}

	/**
	 * Check if a model supports audio modality
	 */
	modelSupportsAudio(modelId: string): boolean {
		return this.getModelModalities(modelId)?.audio ?? false;
	}

	/**
	 * Check if a model supports video modality
	 */
	modelSupportsVideo(modelId: string): boolean {
		return this.getModelModalities(modelId)?.video ?? false;
	}

	/**
	 * Get model modalities as an array of ModelModality enum values
	 */
	getModelModalitiesArray(modelId: string): ModelModality[] {
		const modalities = this.getModelModalities(modelId);
		if (!modalities) return [];

		const result: ModelModality[] = [];

		if (modalities.vision) result.push(ModelModality.VISION);
		if (modalities.audio) result.push(ModelModality.AUDIO);
		if (modalities.video) result.push(ModelModality.VIDEO);

		return result;
	}

	/**
	 * Get props for a specific model (from cache)
	 */
	getModelProps(modelId: string): ApiLlamaCppServerProps | null {
		return this.modelPropsCache.get(this.getSourceModelKey(this.currentRequestContext(), modelId));
	}

	/**
	 * Get context size (n_ctx) for a specific model from cached props
	 */
	getModelContextSize(modelId: string): number | null {
		const props = this.getModelProps(modelId);
		const nCtx = props?.default_generation_settings?.n_ctx;

		return typeof nCtx === 'number' ? nCtx : null;
	}

	/**
	 * Get context size for the currently selected model or null if no model is selected
	 */
	get selectedModelContextSize(): number | null {
		if (!this.selectedModelName) return null;
		return this.getModelContextSize(this.selectedModelName);
	}

	/**
	 * Check if props are being fetched for a model
	 */
	isModelPropsFetching(modelId: string): boolean {
		return this.modelPropsRequests.has(
			this.getSourceModelKey(this.currentRequestContext(), modelId)
		);
	}

	//
	// Thinking Support Detection
	//

	/**
	 * Whether the selected model's chat template supports thinking/reasoning controls.
	 */
	get supportsThinking(): boolean {
		if (!serverStore.isRouterMode) {
			return detectThinkingSupport(serverStore.props?.chat_template ?? '');
		}

		const modelId = this.selectedModelName;
		if (!modelId) return false;

		if (this.supportsModelProps && serverStore.isRouterMode && !this.getModelProps(modelId)) {
			this.fetchModelProps(modelId);
		}

		const props = this.getModelProps(modelId);
		return detectThinkingSupport(props?.chat_template ?? '');
	}

	/**
	 * Checks whether a specific model supports thinking/reasoning controls.
	 */
	checkModelSupportsThinking(modelId: string): boolean {
		if (!serverStore.isRouterMode) {
			return detectThinkingSupport(serverStore.props?.chat_template ?? '');
		}

		if (!modelId) return false;

		if (this.supportsModelProps && serverStore.isRouterMode && !this.getModelProps(modelId)) {
			this.fetchModelProps(modelId);
		}

		const props = this.getModelProps(modelId);
		return detectThinkingSupport(props?.chat_template ?? '');
	}

	/**
	 * Detailed thinking support detection result for debugging/UI.
	 */
	get thinkingSupportDetails(): { supported: boolean; reason: string } {
		if (!serverStore.isRouterMode) {
			return detectThinkingSupportWithReason(serverStore.props?.chat_template ?? '');
		}

		const modelId = this.selectedModelName;
		if (!modelId) return { supported: false, reason: 'No model selected' };

		if (serverStore.isRouterMode && !this.getModelProps(modelId)) {
			this.fetchModelProps(modelId);
		}

		const props = this.getModelProps(modelId);
		return detectThinkingSupportWithReason(props?.chat_template ?? '');
	}

	/**
	 *
	 *
	 * Status Queries
	 *
	 *
	 */

	isModelLoaded(modelId: string): boolean {
		const model = this.routerModels.find((m) => m.id === modelId);
		return (
			model?.status.value === ServerModelStatus.LOADED ||
			model?.status.value === ServerModelStatus.SLEEPING ||
			false
		);
	}

	isModelOperationInProgress(modelId: string): boolean {
		return (
			this.modelLoadingStates.get(this.getSourceModelKey(this.currentRequestContext(), modelId)) ??
			false
		);
	}

	getModelStatus(modelId: string): ServerModelStatus | null {
		const model = this.routerModels.find((m) => m.id === modelId);
		return model?.status.value ?? null;
	}

	getModelUsage(modelId: string): SvelteSet<string> {
		return this.modelUsage.get(modelId) ?? new SvelteSet<string>();
	}

	isModelInUse(modelId: string): boolean {
		const usage = this.modelUsage.get(modelId);
		return usage !== undefined && usage.size > 0;
	}

	/**
	 *
	 *
	 * Data Fetching
	 *
	 *
	 */

	/**
	 * Fetch list of models from server and detect server role
	 * Also fetches modalities for MODEL mode (single model)
	 */
	fetch(force = false): Promise<void> {
		if (this.fetchPromise) return this.fetchPromise;

		const context = this.currentRequestContext();
		const provider = getApiProvider(context.providerId);
		const sourceKey = this.getModelListSourceKey(context);
		const sourceChanged = this.loadedModelListSourceKey !== sourceKey;

		if (sourceChanged) {
			this.saveCurrentSelectionForSource();
			this.models = [];
			this.routerModels = [];
			this.selectedModelId = null;
			this.selectedModelName = null;
			this.favoriteModelIds = new SvelteSet(this.loadFavoritesFromStorage(provider.id));
		}

		if (this.models.length > 0 && !force && !sourceChanged) return Promise.resolve();

		const generation = ++this.requestGeneration;
		this.loading = true;
		this.error = null;

		const request: { promise: Promise<void> | null } = { promise: null };
		const fetchPromise = (async () => {
			try {
				if (provider.capabilities.supportsServerProps && !serverStore.props) {
					await serverStore.fetch(context);
					if (generation !== this.requestGeneration) return;
				}

				const response = await ModelsService.list(context);
				if (generation !== this.requestGeneration) return;

				const models: ModelOption[] = response.data.map(
					(item: ApiModelDataEntry, index: number) => {
						const details = response.models?.[index];
						const rawCapabilities = Array.isArray(details?.capabilities)
							? details?.capabilities
							: [];
						const displayNameSource =
							details?.name && details.name.trim().length > 0 ? details.name : item.id;
						const displayName = this.toDisplayName(displayNameSource);
						const modelId = details?.model || item.id;

						return {
							id: item.id,
							name: displayName,
							model: modelId,
							description: details?.description,
							capabilities: rawCapabilities.filter((value: unknown): value is string =>
								Boolean(value)
							),
							details: details?.details,
							meta: item.meta ?? null,
							parsedId: ModelsService.parseModelId(modelId),
							aliases: uniqueStringList(item.aliases),
							tags: uniqueStringList(item.tags)
						} satisfies ModelOption;
					}
				);

				this.models = models;

				// WORKAROUND: In MODEL mode, /props returns modalities for the single model,
				// but /v1/models doesn't include modalities. We bridge this gap here.
				const serverProps = serverStore.props;
				if (
					provider.capabilities.supportsModelProps &&
					serverStore.isModelMode &&
					this.models.length > 0 &&
					serverProps?.modalities
				) {
					const modalities = normalizeModelModalities(serverProps);
					this.modelPropsCache.set(
						this.getSourceModelKey(context, this.models[0].model),
						serverProps
					);
					this.models = this.models.map((model, index) =>
						index === 0 ? { ...model, modalities } : model
					);
				}

				if (!this.selectedModelId) {
					this.restoreSelectionForSource(sourceKey);
				}

				if (
					provider.capabilities.requiresModelInChatRequest &&
					!this.selectedModelId &&
					this.models.length > 0
				) {
					this.selectedModelId = this.models[0].id;
					this.selectedModelName = this.models[0].model;
				}

				this.loadedModelListSourceKey = sourceKey;
			} catch (error) {
				if (generation !== this.requestGeneration) return;

				this.models = [];
				this.error = error instanceof Error ? error.message : 'Failed to load models';
				throw error;
			} finally {
				if (generation === this.requestGeneration && this.fetchPromise === request.promise) {
					this.loading = false;
					this.fetchPromise = null;
				}
			}
		})();

		request.promise = fetchPromise;
		this.fetchPromise = fetchPromise;
		return fetchPromise;
	}

	/**
	 * Fetch router models with full metadata (ROUTER mode only)
	 * This fetches the /models endpoint which returns status info for each model
	 */
	fetchRouterModels(
		context: ProviderConnectionContext = this.currentRequestContext(),
		signal?: AbortSignal
	): Promise<void> {
		if (!this.supportsModelLoadUnload) return Promise.resolve();
		const sourceKey = this.getModelListSourceKey(context);
		if (this.routerMetadataPromise && this.routerMetadataPendingSourceKey === sourceKey) {
			return this.routerMetadataPromise;
		}
		const generation = this.requestGeneration;
		const request: { promise: Promise<void> | null } = { promise: null };

		const promise = (async () => {
			try {
				const response = await ModelsService.listRouter(context, signal);
				if (generation !== this.requestGeneration || sourceKey !== this.modelListSourceKey) return;
				this.routerModels = response.data;
				this.routerMetadataSourceKey = sourceKey;
				await this.fetchModalitiesForLoadedModels();
				if (generation !== this.requestGeneration || sourceKey !== this.modelListSourceKey) return;

				const o = this.models.filter((option) => {
					const modelProps = this.getModelProps(option.model);

					return modelProps?.webui !== false;
				});

				if (o.length === 1 && this.isModelLoaded(o[0].model)) {
					await this.selectModelById(o[0].id);
				}
			} catch (error) {
				if (signal?.aborted || generation !== this.requestGeneration) return;
				console.warn('Failed to fetch router models:', error);
				this.routerModels = [];
			} finally {
				if (this.routerMetadataPromise === request.promise) {
					this.routerMetadataPromise = null;
					this.routerMetadataPendingSourceKey = null;
				}
			}
		})();
		request.promise = promise;
		this.routerMetadataPromise = promise;
		this.routerMetadataPendingSourceKey = sourceKey;
		return promise;
	}

	/**
	 * Fetch props for a specific model from /props endpoint
	 * Uses caching to avoid redundant requests
	 *
	 * In ROUTER mode, this will only fetch props if the model is loaded,
	 * since unloaded models return 400 from /props endpoint.
	 *
	 * @param modelId - Model identifier to fetch props for
	 * @returns Props data or null if fetch failed or model not loaded
	 */
	async fetchModelProps(modelId: string): Promise<ApiLlamaCppServerProps | null> {
		if (!this.supportsModelProps) return null;
		const context = this.currentRequestContext();
		const sourceKey = this.getModelListSourceKey(context);
		const cacheKey = this.getSourceModelKey(context, modelId);

		const cached = this.modelPropsCache.get(cacheKey);
		if (cached) return cached;

		if (serverStore.isRouterMode && !this.isModelLoaded(modelId)) {
			return null;
		}

		const existing = this.modelPropsRequests.get(cacheKey);
		if (existing) return existing;

		const holder: { promise: Promise<ApiLlamaCppServerProps | null> | null } = { promise: null };
		const request = (async () => {
			try {
				const props = await PropsService.fetchForModel(context, modelId);
				if (sourceKey !== this.modelListSourceKey) return null;
				this.modelPropsCache.set(cacheKey, props);
				return props;
			} catch (error) {
				console.warn(`Failed to fetch props for model ${modelId}:`, error);
				return null;
			} finally {
				if (this.modelPropsRequests.get(cacheKey) === holder.promise) {
					this.modelPropsRequests.delete(cacheKey);
				}
			}
		})();
		holder.promise = request;
		this.modelPropsRequests.set(cacheKey, request);
		return request;
	}

	/**
	 * Fetch modalities for all loaded models from /props endpoint
	 * This updates the modalities field in models array
	 */
	async fetchModalitiesForLoadedModels(): Promise<void> {
		if (!this.supportsModelProps) return;

		const loadedModelIds = this.loadedModelIds;
		if (loadedModelIds.length === 0) return;

		const propsPromises = loadedModelIds.map((modelId) => this.fetchModelProps(modelId));

		try {
			const results = await Promise.all(propsPromises);

			// Update models with modalities
			this.models = this.models.map((model) => {
				const modelIndex = loadedModelIds.indexOf(model.model);
				if (modelIndex === -1) return model;

				const props = results[modelIndex];
				if (!props?.modalities) return model;

				const modalities = normalizeModelModalities(props);

				return { ...model, modalities };
			});

			this.propsCacheVersion++;
		} catch (error) {
			console.warn('Failed to fetch modalities for loaded models:', error);
		}
	}

	/**
	 * Update modalities for a specific model
	 * Called when a model is loaded or when we need fresh modality data
	 */
	async updateModelModalities(modelId: string): Promise<void> {
		if (!this.supportsModelProps) return;

		try {
			const props = await this.fetchModelProps(modelId);
			if (!props?.modalities) return;

			const modalities = normalizeModelModalities(props);

			this.models = this.models.map((model) =>
				model.model === modelId ? { ...model, modalities } : model
			);

			this.propsCacheVersion++;
		} catch (error) {
			console.warn(`Failed to update modalities for model ${modelId}:`, error);
		}
	}

	/**
	 *
	 *
	 * Model Selection
	 *
	 *
	 */

	/**
	 * Select a model for new conversations
	 */
	async selectModelById(modelId: string): Promise<void> {
		if (!modelId || this.updating) return;
		if (this.selectedModelId === modelId) return;

		const option = this.models.find((model) => model.id === modelId);
		if (!option) throw new Error('Selected model is not available');

		this.updating = true;
		this.error = null;

		try {
			this.selectedModelId = option.id;
			this.selectedModelName = option.model;
			this.rememberSelection(this.modelListSourceKey, { id: option.id, model: option.model });
		} finally {
			this.updating = false;
		}
	}

	/**
	 * Select a model by its model name (used for syncing with conversation model)
	 * @param modelName - Model name to select (e.g., "ggml-org/GLM-4.7-Flash-GGUF")
	 */
	selectModelByName(modelName: string): void {
		const option = this.models.find((model) => model.model === modelName);
		if (option) {
			this.selectedModelId = option.id;
			this.selectedModelName = option.model;
			this.rememberSelection(this.modelListSourceKey, { id: option.id, model: option.model });
		}
	}

	clearSelection(): void {
		this.selectedModelId = null;
		this.selectedModelName = null;
	}

	findModelByName(modelName: string): ModelOption | null {
		return this.models.find((model) => model.model === modelName) ?? null;
	}

	resolveModelReference(reference: string): ModelReferenceResolution {
		const modelMatch = this.models.find((model) => model.model === reference);
		if (modelMatch) return { status: 'resolved', model: modelMatch };

		const idMatch = this.models.find((model) => model.id === reference);
		if (idMatch) return { status: 'resolved', model: idMatch };

		const aliasMatches = this.models.filter((model) => model.aliases?.includes(reference));
		if (aliasMatches.length === 1) return { status: 'resolved', model: aliasMatches[0] };
		if (aliasMatches.length > 1) return { status: 'ambiguous', model: null };

		return { status: 'not-found', model: null };
	}

	findModelById(modelId: string): ModelOption | null {
		return this.models.find((model) => model.id === modelId) ?? null;
	}

	hasModel(modelName: string): boolean {
		return this.models.some((model) => model.model === modelName);
	}

	/**
	 *
	 *
	 * Loading/Unloading Models
	 *
	 *
	 */

	/**
	 * WORKAROUND: Polling for model status after load/unload operations.
	 *
	 * Currently, the `/models/load` and `/models/unload` endpoints return success
	 * before the operation actually completes on the server. This means an immediate
	 * request to `/models` returns stale status (e.g., "loading" after load request,
	 * "loaded" after unload request).
	 *
	 * Keep this polling while llama-server can return success before a load or
	 * unload operation has fully settled. If the endpoints later wait for completion
	 * before returning success, this can be simplified to a single
	 * `fetchRouterModels()` call after the operation.
	 */

	/** Polling interval in ms for checking model status */
	private static readonly STATUS_POLL_INTERVAL = 500;

	/** Global timeout in ms for model load/unload polling */
	private static readonly STATUS_POLL_TIMEOUT = 180_000;

	/**
	 * Poll for expected model status after load/unload operation.
	 * Keeps polling until the model reaches the expected status, fails,
	 * or exceeds the global timeout.
	 *
	 * @param modelId - Model identifier to check
	 * @param expectedStatus - Expected status to wait for
	 * @throws Error if model reaches FAILED status or polling times out
	 */
	private async pollForModelStatus(
		context: ProviderConnectionContext,
		modelId: string,
		expectedStatus: ServerModelStatus,
		signal: AbortSignal
	): Promise<void> {
		const startedAt = Date.now();
		const sourceKey = this.getModelListSourceKey(context);

		while (true) {
			throwIfAborted(signal);
			if (sourceKey !== this.modelListSourceKey)
				throw new DOMException('Source changed', 'AbortError');
			await this.fetchRouterModels(context, signal);
			throwIfAborted(signal);

			const currentStatus = this.getModelStatus(modelId);
			if (currentStatus === expectedStatus) {
				return;
			}

			if (currentStatus === ServerModelStatus.FAILED) {
				throw new Error(
					expectedStatus === ServerModelStatus.LOADED
						? t('models.modelFailedToLoad')
						: t('models.modelFailedToUnload')
				);
			}

			if (Date.now() - startedAt >= ModelsStore.STATUS_POLL_TIMEOUT) {
				throw new Error(
					expectedStatus === ServerModelStatus.LOADED
						? t('models.modelLoadTimedOut')
						: t('models.modelUnloadTimedOut')
				);
			}

			if (!(await sleepWithAbort(ModelsStore.STATUS_POLL_INTERVAL, signal))) {
				throw new DOMException('Operation was aborted', 'AbortError');
			}
		}
	}

	/**
	 * Load a model (ROUTER mode)
	 * @param modelId - Model identifier to load
	 */
	async loadModel(modelId: string): Promise<void> {
		if (!this.supportsModelLoadUnload) return;

		if (this.isModelLoaded(modelId)) {
			return;
		}

		const context = this.currentRequestContext();
		const operationKey = this.getSourceModelKey(context, modelId);
		if (this.modelLoadingStates.get(operationKey)) return;
		const controller = new AbortController();
		this.operationControllers.set(operationKey, controller);

		this.modelLoadingStates.set(operationKey, true);
		this.error = null;

		try {
			await ModelsService.load(context, modelId, undefined, controller.signal);
			throwIfAborted(controller.signal);
			await this.pollForModelStatus(context, modelId, ServerModelStatus.LOADED, controller.signal);
			throwIfAborted(controller.signal);
			if (this.getModelListSourceKey(context) !== this.modelListSourceKey) {
				throw new DOMException('Source changed', 'AbortError');
			}

			await this.updateModelModalities(modelId);
			toast.success(t('models.modelLoaded'), {
				description: this.toDisplayName(modelId)
			});
		} catch (error) {
			if (controller.signal.aborted) throw new DOMException('Operation was aborted', 'AbortError');
			const message = error instanceof Error ? error.message : t('models.failedToLoadModel');
			this.error = message;
			toast.error(t('models.failedToLoadModel'), {
				description: `${this.toDisplayName(modelId)} — ${message}`
			});
			throw error;
		} finally {
			this.modelLoadingStates.delete(operationKey);
			if (this.operationControllers.get(operationKey) === controller) {
				this.operationControllers.delete(operationKey);
			}
		}
	}

	/**
	 * Unload a model (ROUTER mode)
	 * @param modelId - Model identifier to unload
	 */
	async unloadModel(modelId: string): Promise<void> {
		if (!this.supportsModelLoadUnload) return;

		if (!this.isModelLoaded(modelId)) {
			return;
		}

		const context = this.currentRequestContext();
		const operationKey = this.getSourceModelKey(context, modelId);
		if (this.modelLoadingStates.get(operationKey)) return;
		const controller = new AbortController();
		this.operationControllers.set(operationKey, controller);

		this.modelLoadingStates.set(operationKey, true);
		this.error = null;

		try {
			await ModelsService.unload(context, modelId, controller.signal);

			await this.pollForModelStatus(
				context,
				modelId,
				ServerModelStatus.UNLOADED,
				controller.signal
			);
			throwIfAborted(controller.signal);
			if (this.getModelListSourceKey(context) !== this.modelListSourceKey) {
				throw new DOMException('Source changed', 'AbortError');
			}
			toast.info(t('models.modelUnloaded'), {
				description: this.toDisplayName(modelId)
			});
		} catch (error) {
			if (controller.signal.aborted) throw new DOMException('Operation was aborted', 'AbortError');
			const message = error instanceof Error ? error.message : t('models.failedToUnloadModel');
			this.error = message;
			toast.error(t('models.failedToUnloadModel'), {
				description: `${this.toDisplayName(modelId)} — ${message}`
			});
			throw error;
		} finally {
			this.modelLoadingStates.delete(operationKey);
			if (this.operationControllers.get(operationKey) === controller) {
				this.operationControllers.delete(operationKey);
			}
		}
	}

	/**
	 * Ensure a model is loaded before use
	 * @param modelId - Model identifier to ensure is loaded
	 */
	async ensureModelLoaded(modelId: string): Promise<void> {
		if (!this.supportsModelLoadUnload) return;

		if (this.isModelLoaded(modelId)) {
			return;
		}

		await this.loadModel(modelId);
	}

	/**
	 *
	 *
	 * Favorites
	 *
	 *
	 */

	isFavorite(modelId: string): boolean {
		return this.favoriteModelIds.has(modelId);
	}

	toggleFavorite(modelId: string): void {
		const next = new SvelteSet(this.favoriteModelIds);

		if (next.has(modelId)) {
			next.delete(modelId);
		} else {
			next.add(modelId);
		}

		this.favoriteModelIds = next;

		try {
			if (!browser) return;

			localStorage.setItem(this.getFavoriteStorageKey(), JSON.stringify([...next]));
		} catch {
			toast.error('Failed to save favorite models to local storage');
		}
	}

	private loadFavoritesFromStorage(providerId = this.currentProviderId): Set<string> {
		try {
			if (!browser) return new Set();

			const providerKey = this.getFavoriteStorageKey(providerId);
			const raw = localStorage.getItem(providerKey);

			if (raw) return new Set(JSON.parse(raw) as string[]);

			// Migration: keep old favorites only for llama-server, so OpenAI-compatible
			// starts with its own provider-owned favorites list.
			if (providerId === API_PROVIDER_IDS.LLAMA_SERVER) {
				const legacyRaw = localStorage.getItem(FAVORITE_MODELS_LOCALSTORAGE_KEY);

				return legacyRaw ? new Set(JSON.parse(legacyRaw) as string[]) : new Set();
			}

			return new Set();
		} catch {
			toast.error('Failed to load favorite models from local storage');

			return new Set();
		}
	}

	/**
	 *
	 *
	 * Utilities
	 *
	 *
	 */

	private toDisplayName(id: string): string {
		const segments = id.split(/\\|\//);
		const candidate = segments.pop();

		return candidate && candidate.trim().length > 0 ? candidate : id;
	}

	clear(): void {
		this.saveCurrentSelectionForSource();
		this.requestGeneration++;
		for (const controller of this.operationControllers.values()) controller.abort();
		this.operationControllers.clear();
		this.models = [];
		this.routerModels = [];
		this.loading = false;
		this.updating = false;
		this.error = null;
		this.selectedModelId = null;
		this.selectedModelName = null;
		this.modelUsage.clear();
		this.modelLoadingStates.clear();
		this.loadedModelListSourceKey = null;
		this.routerMetadataSourceKey = null;
		this.routerMetadataPromise = null;
		this.routerMetadataPendingSourceKey = null;
		this.fetchPromise = null;
	}

	resetAllModelState(): void {
		this.clear();
		this.modelPropsCache.clear();
		this.modelPropsRequests.clear();
		this.selectedModelsBySourceKey = {};
	}

	/**
	 * Prune expired entries from caches.
	 * Call periodically for proactive memory cleanup.
	 */
	pruneExpiredCache(): number {
		return this.modelPropsCache.prune();
	}
}

export const modelsStore = new ModelsStore();

export const modelOptions = () => modelsStore.models;
export const routerModels = () => modelsStore.routerModels;
export const modelsLoading = () => modelsStore.loading;
export const modelsUpdating = () => modelsStore.updating;
export const modelsError = () => modelsStore.error;
export const selectedModelId = () => modelsStore.selectedModelId;
export const selectedModelName = () => modelsStore.selectedModelName;
export const selectedModelOption = () => modelsStore.selectedModel;
export const loadedModelIds = () => modelsStore.loadedModelIds;
export const loadingModelIds = () => modelsStore.loadingModelIds;
export const propsCacheVersion = () => modelsStore.propsCacheVersion;
export const singleModelName = () => modelsStore.singleModelName;
export const selectedModelContextSize = () => modelsStore.selectedModelContextSize;
export const supportsThinking = () => modelsStore.supportsThinking;
export const checkModelSupportsThinking = (modelId: string) =>
	modelsStore.checkModelSupportsThinking(modelId);
export const favoriteModelIds = () => modelsStore.favoriteModelIds;
