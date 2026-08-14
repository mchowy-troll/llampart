import { t } from '$lib/i18n';
import { PropsService } from '$lib/services/props.service';
import { ServerRole } from '$lib/enums';
import { getApiProvider } from '$lib/services/providers';
import { config } from '$lib/stores/settings.svelte';
import type { ProviderConnectionContext } from '$lib/types/provider';

/**
 * serverStore - Server connection state, configuration, and role detection
 *
 * This store manages the server connection state and properties fetched from `/props`.
 * It provides reactive state for server configuration and role detection.
 *
 * **Architecture & Relationships:**
 * - **PropsService**: Stateless service for fetching `/props` data
 * - **serverStore** (this class): Reactive store for server state
 * - **modelsStore**: Independent store for model management (uses PropsService directly)
 *
 * **Key Features:**
 * - **Server State**: Connection status, loading, error handling
 * - **Role Detection**: MODEL (single model) vs ROUTER (multi-model)
 * - **Default Params**: Server-wide generation defaults
 */
class ServerStore {
	/**
	 *
	 *
	 * State
	 *
	 *
	 */

	props = $state<ApiLlamaCppServerProps | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);
	role = $state<ServerRole | null>(null);
	private fetchPromise: Promise<void> | null = null;
	private requestGeneration = 0;

	/**
	 *
	 *
	 * Getters
	 *
	 *
	 */

	get defaultParams(): ApiLlamaCppServerProps['default_generation_settings']['params'] | null {
		return this.props?.default_generation_settings?.params || null;
	}

	get contextSize(): number | null {
		const nCtx = this.props?.default_generation_settings?.n_ctx;

		return typeof nCtx === 'number' ? nCtx : null;
	}

	get webuiSettings(): Record<string, string | number | boolean> | undefined {
		return this.props?.ui_settings ?? this.props?.webui_settings;
	}

	get isRouterMode(): boolean {
		return this.role === ServerRole.ROUTER;
	}

	get isModelMode(): boolean {
		return this.role === ServerRole.MODEL;
	}

	/**
	 *
	 *
	 * Data Handling
	 *
	 *
	 */

	private currentRequestContext(): ProviderConnectionContext {
		const currentConfig = config();

		return Object.freeze({
			providerId: getApiProvider(String(currentConfig.apiProvider ?? '')).id,
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? '')
		});
	}

	fetch(context: ProviderConnectionContext = this.currentRequestContext()): Promise<void> {
		if (this.fetchPromise) return this.fetchPromise;

		const requestContext = Object.freeze({ ...context });
		const generation = ++this.requestGeneration;
		this.loading = true;
		this.error = null;

		const request: { promise: Promise<void> | null } = { promise: null };
		const fetchPromise = (async () => {
			try {
				const props = await PropsService.fetch(requestContext);
				if (generation !== this.requestGeneration) return;

				this.props = props;
				this.error = null;
				this.detectRole(props);
			} catch (error) {
				if (generation !== this.requestGeneration) return;

				this.error = this.getErrorMessage(error);
				console.error('Error fetching server properties:', error);
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

	private getErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			const message = error.message || '';

			if (error.name === 'TypeError' && message.includes('fetch')) {
				return t('server.notRunningOrUnreachable');
			} else if (message.includes('ECONNREFUSED')) {
				return t('server.connectionRefusedMaybeOffline');
			} else if (message.includes('ENOTFOUND')) {
				return t('server.serverNotFoundCheckAddress');
			} else if (message.includes('ETIMEDOUT')) {
				return t('server.requestTimedOut');
			} else if (message.includes('503')) {
				return t('server.temporarilyUnavailable');
			} else if (message.includes('500')) {
				return t('server.serverErrorCheckLogs');
			} else if (message.includes('404')) {
				return t('server.endpointNotFound');
			} else if (message.includes('403') || message.includes('401')) {
				return t('server.accessDenied');
			}
		}

		return t('server.failedToConnect');
	}

	clear(): void {
		this.requestGeneration++;
		this.props = null;
		this.error = null;
		this.loading = false;
		this.role = null;
		this.fetchPromise = null;
	}

	/**
	 *
	 *
	 * Utilities
	 *
	 *
	 */

	private detectRole(props: ApiLlamaCppServerProps): void {
		const newRole = props?.role === ServerRole.ROUTER ? ServerRole.ROUTER : ServerRole.MODEL;
		if (this.role !== newRole) {
			this.role = newRole;
			console.info(`Server running in ${newRole === ServerRole.ROUTER ? 'ROUTER' : 'MODEL'} mode`);
		}
	}
}

export const serverStore = new ServerStore();

export const serverProps = () => serverStore.props;
export const serverLoading = () => serverStore.loading;
export const serverError = () => serverStore.error;
export const serverRole = () => serverStore.role;
export const defaultParams = () => serverStore.defaultParams;
export const contextSize = () => serverStore.contextSize;
export const isRouterMode = () => serverStore.isRouterMode;
export const isModelMode = () => serverStore.isModelMode;
