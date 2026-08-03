import { getApiProvider } from '$lib/services/providers';
import { config } from '$lib/stores/settings.svelte';

export type ProviderConnectionStatus = 'idle' | 'checking' | 'connected' | 'disconnected';

export interface ProviderConnectionSource {
	providerId: string;
	serverBaseUrl: string;
	apiKey: string;
}

function sourceKey(source: ProviderConnectionSource): string {
	return JSON.stringify([source.providerId, source.serverBaseUrl, source.apiKey]);
}

export class ProviderConnectionStore {
	status = $state<ProviderConnectionStatus>('idle');
	errorMessage = $state('');
	hasDisconnected = $state(false);

	private activeKey: string | null = null;
	private pending: { source: ProviderConnectionSource; fetchImpl: typeof fetch } | null = null;
	private running: Promise<boolean> | null = null;

	private currentSource(): ProviderConnectionSource {
		const currentConfig = config();

		return {
			providerId: String(currentConfig.apiProvider ?? ''),
			serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
			apiKey: String(currentConfig.apiKey ?? '')
		};
	}

	check(
		source: ProviderConnectionSource = this.currentSource(),
		fetchImpl: typeof fetch = globalThis.fetch
	): Promise<boolean> {
		const key = sourceKey(source);
		if (this.running && this.activeKey === key) return this.running;

		this.pending = { source, fetchImpl };
		if (this.running) return this.running;

		this.running = this.runPendingChecks();
		return this.running;
	}

	private async runPendingChecks(): Promise<boolean> {
		let connected = false;

		try {
			while (this.pending) {
				const request = this.pending;
				this.pending = null;
				this.activeKey = sourceKey(request.source);
				this.status = 'checking';

				const provider = getApiProvider(request.source.providerId);
				const result = await provider.validateConnection(
					{
						serverBaseUrl: request.source.serverBaseUrl,
						apiKey: request.source.apiKey
					},
					request.fetchImpl
				);

				if (this.pending) continue;

				connected = result.ok;
				if (result.ok) {
					this.status = 'connected';
					this.errorMessage = '';
					this.hasDisconnected = false;
				} else {
					this.status = 'disconnected';
					this.errorMessage = result.errorMessage ?? '';
					this.hasDisconnected = true;
				}
			}

			return connected;
		} finally {
			this.activeKey = null;
			this.running = null;
		}
	}
}

export const providerConnectionStore = new ProviderConnectionStore();
export const providerConnectionStatus = () => providerConnectionStore.status;
export const providerConnectionError = () => providerConnectionStore.errorMessage;
export const providerConnectionDisconnected = () => providerConnectionStore.hasDisconnected;
