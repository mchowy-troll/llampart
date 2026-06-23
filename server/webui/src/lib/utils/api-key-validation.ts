import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { getApiProvider } from '$lib/services/providers';
import { config } from '$lib/stores/settings.svelte';

/**
 * Validates the configured provider connection.
 * Throws SvelteKit errors for authentication failures; non-auth connection
 * failures are logged because transient provider availability should not
 * immediately break the UI shell.
 */
export async function validateApiKey(fetch: typeof globalThis.fetch): Promise<void> {
	if (!browser) {
		return;
	}

	try {
		const currentConfig = config();
		const provider = getApiProvider(String(currentConfig.apiProvider ?? ''));

		const result = await provider.validateConnection(
			{
				serverBaseUrl: String(currentConfig.serverBaseUrl ?? ''),
				apiKey: String(currentConfig.apiKey ?? '')
			},
			fetch
		);

		if (result.ok) {
			return;
		}

		if (result.status === 401 || result.status === 403) {
			throw error(401, 'Access denied');
		}

		console.warn(result.errorMessage || 'Provider connection validation failed');
	} catch (err) {
		// If it's already a SvelteKit error, re-throw it
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		// Network or other errors
		console.warn('Cannot connect to provider for API key validation:', err);
	}
}
