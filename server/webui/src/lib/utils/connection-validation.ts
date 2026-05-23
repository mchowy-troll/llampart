import { t } from '$lib/i18n';

export interface ConnectionValidationResult {
	ok: boolean;
	status?: number;
	errorMessage?: string;
}

export function normalizeServerBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

export function buildPropsUrl(serverBaseUrl: string): string {
	const normalizedBaseUrl = normalizeServerBaseUrl(serverBaseUrl);

	if (!normalizedBaseUrl) {
		return `${window.location.origin}/props`;
	}

	return `${normalizedBaseUrl}/props`;
}

function looksLikeLlamaServerProps(data: unknown): boolean {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const record = data as Record<string, unknown>;

	return 'default_generation_settings' in record && 'build_info' in record;
}

export async function validateConnectionSettings(
	serverBaseUrl: string,
	apiKey: string
): Promise<ConnectionValidationResult> {
	const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl);
	const normalizedApiKey = apiKey.trim();

	if (normalizedServerBaseUrl && !isAbsoluteHttpUrl(normalizedServerBaseUrl)) {
		return {
			ok: false,
			errorMessage: t('server.addressMustStartWithHttp')
		};
	}

	const headers: Record<string, string> = {
		Accept: 'application/json'
	};

	if (normalizedApiKey) {
		headers.Authorization = `Bearer ${normalizedApiKey}`;
	}

	try {
		const response = await fetch(buildPropsUrl(normalizedServerBaseUrl), {
			headers
		});

		if (response.status === 401 || response.status === 403) {
			return {
				ok: false,
				status: response.status,
				errorMessage: t('server.invalidApiKeyCheckTryAgain')
			};
		}

		if (!response.ok) {
			return {
				ok: false,
				status: response.status,
				errorMessage: `${t('server.connectionFailed')} (${response.status})`
			};
		}

		const contentType = response.headers.get('content-type') || '';
		if (!contentType.toLowerCase().includes('application/json')) {
			return {
				ok: false,
				status: response.status,
				errorMessage: t('server.invalidPropsJsonResponse')
			};
		}

		let data: unknown;
		try {
			data = await response.json();
		} catch {
			return {
				ok: false,
				status: response.status,
				errorMessage: t('server.serverReturnedInvalidJson')
			};
		}

		if (!looksLikeLlamaServerProps(data)) {
			return {
				ok: false,
				status: response.status,
				errorMessage: t('server.invalidPropsResponse')
			};
		}

		return { ok: true, status: response.status };
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes('fetch')) {
				return {
					ok: false,
					errorMessage: t('server.cannotConnectCheckAddressRunning')
				};
			}

			return { ok: false, errorMessage: error.message };
		}

		return { ok: false, errorMessage: t('server.connectionErrorTryAgain') };
	}
}
