import { t, type InterfaceLanguage } from '$lib/i18n';

/** UI-only mapping: do not display upstream bodies, URLs or credentialed errors. */
export function connectionErrorMessage(
	message?: string,
	language?: InterfaceLanguage,
	status?: number
): string {
	const discovery = /^Model discovery failed \(([1-5]\d{2})\)$/.exec(message ?? '');
	if (discovery) return `${t('server.modelDiscoveryFailed', language)} (HTTP ${discovery[1]})`;
	if (
		message === 'Invalid /v1/models response' ||
		message === 'Invalid model discovery response: expected JSON'
	)
		return t('server.invalidModelDiscovery', language);
	const suffix =
		status && Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : '';
	for (const key of [
		'settings.openAiCompatibleServerAddressRequired',
		'settings.invalidServerConnectionSettings',
		'server.addressMustStartWithHttp',
		'server.invalidApiKeyCheckTryAgain',
		'server.invalidPropsJsonResponse',
		'server.serverReturnedInvalidJson',
		'server.invalidPropsResponse',
		'server.cannotConnectCheckAddressRunning',
		'server.connectionErrorTryAgain'
	])
		if (message === t(key, language)) return t(key, language) + suffix;
	return t('server.connectionFailedSafe', language) + suffix;
}
