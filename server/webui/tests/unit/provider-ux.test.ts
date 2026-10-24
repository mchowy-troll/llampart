import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { t, INTERFACE_LANGUAGES } from '$lib/i18n';
import { SETTING_CONFIG_INFO } from '$lib/constants/settings-config';
import { connectionErrorMessage } from '$lib/utils/connection-error-message';
import {
	parseSettingsConfig,
	parseSettingsStorage,
	validateSettingsPatch
} from '$lib/utils/settings-schema';
import { getApiProviderCapabilities } from '$lib/services/providers';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import { modelsStore } from '$lib/stores/models.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';

const original = { ...settingsStore.config };
afterEach(() => {
	settingsStore.updateMultipleConfig(original);
	modelsStore.clear();
	vi.unstubAllGlobals();
});

describe('localized connection UX', () => {
	const closes = {
		en: 'Close',
		pl: 'Zamknij',
		de: 'Schließen',
		fr: 'Fermer',
		it: 'Chiudi',
		es: 'Cerrar'
	};
	it.each(INTERFACE_LANGUAGES)(
		'uses translated controls and safe discovery errors in %s',
		(language) => {
			if (language in closes)
				expect(t('common.close', language)).toBe(closes[language as keyof typeof closes]);
			else {
				expect(t('common.close', language).trim()).not.toBe('');
				expect(t('common.close', language)).not.toBe(closes.en);
			}
			for (const status of [401, 403, 404, 502]) {
				const message = connectionErrorMessage(`Model discovery failed (${status})`, language);
				expect(message).toBe(`${t('server.modelDiscoveryFailed', language)} (HTTP ${status})`);
				expect(message).not.toContain('Model discovery failed');
			}
			expect(connectionErrorMessage('Invalid /v1/models response', language)).toBe(
				t('server.invalidModelDiscovery', language)
			);
			expect(
				connectionErrorMessage('Authorization: Bearer secret\r\nX-Secret: private', language)
			).not.toMatch(/secret|private|Authorization/);
			for (const key of [
				'server.modelDiscoveryFailed',
				'server.invalidModelDiscovery',
				'server.connectionFailedSafe',
				'messages.statsClientApproximate',
				'settings.info.apiProvider',
				'settings.info.apiKey',
				'settings.info.serverBaseUrl'
			])
				expect(t(key, language)).not.toBe(key);
		}
	);
	it('uses common descriptions for every provider without changing connection keys', () => {
		for (const prefix of ['llamaServer', 'openAiCompatible', 'vllm']) {
			expect(SETTING_CONFIG_INFO[`${prefix}BaseUrl`]).toBe('settings.info.serverBaseUrl');
			expect(SETTING_CONFIG_INFO[`${prefix}ApiKey`]).toBe('settings.info.apiKey');
		}
		expect(t('settings.info.apiProvider', 'pl')).toBe('Wybierz dostawcę API.');
		expect(t('settings.info.serverBaseUrl', 'pl')).toBe(
			'Adres serwera, z którym chcesz się połączyć.'
		);
		expect(t('settings.info.apiKey', 'pl')).toBe('Klucz API, jeśli jest wymagany przez serwer.');
	});
});

describe('removed tools compatibility setting', () => {
	it.each([true, false, 'obsolete', { invalid: true }])(
		'ignores legacy values %j without hiding tools',
		(value) => {
			expect(parseSettingsConfig({ disableOpenAiCompatibleTools: value })).not.toHaveProperty(
				'disableOpenAiCompatibleTools'
			);
			expect(
				parseSettingsStorage(JSON.stringify({ disableOpenAiCompatibleTools: value }))
			).not.toHaveProperty('disableOpenAiCompatibleTools');
			expect(validateSettingsPatch({ disableOpenAiCompatibleTools: value })).toEqual({});
			for (const provider of ['openai-compatible', 'vllm', 'llama-server'])
				expect(getApiProviderCapabilities(provider).supportsOpenAiToolCalls).toBe(true);
		}
	);
});

describe('composer capability boundaries', () => {
	it.each(['supported', 'unsupported', 'unknown'] as const)(
		'respects %s runtime evidence',
		async (state) => {
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				serverBaseUrl: 'http://localhost:8000',
				apiKey: ''
			});
			const evidence =
				state === 'unknown'
					? {}
					: { vision: state === 'supported', audio: state === 'supported', video: true };
			vi.stubGlobal(
				'fetch',
				vi
					.fn()
					.mockResolvedValue(
						new Response(
							JSON.stringify({ object: 'list', data: [{ id: 'model', capabilities: evidence }] }),
							{ headers: { 'content-type': 'application/json' } }
						)
					)
			);
			await modelsStore.fetch(true);
			await modelsStore.refreshCapabilities(
				{
					providerId: 'vllm',
					serverBaseUrl: 'http://localhost:8000',
					apiKey: '',
					sourceGeneration: 0
				},
				'model'
			);
			expect(modelsStore.modelSupportsVision('model')).toBe(state !== 'unsupported');
			expect(modelsStore.modelSupportsAudio('model')).toBe(state !== 'unsupported');
			expect(modelsStore.modelSupportsVideo('model')).toBe(false);
			settingsStore.updateMultipleConfig({ serverBaseUrl: 'http://other:9000' });
			expect(modelsStore.modelSupportsVision('model')).toBe(true);
		}
	);
	it('uses only explicit text-only server evidence, not a model name or architecture', async () => {
		const ctx = {
			providerId: 'vllm' as const,
			serverBaseUrl: 'http://localhost:8000',
			apiKey: '',
			sourceGeneration: 0
		};
		const snapshot = await createCapabilitySnapshot(ctx, 'Multimodal-Vision', {
			capabilities: { vision: true, audio: true, language_model_only: true }
		});
		for (const name of ['vision', 'audio', 'video'])
			expect(snapshot.features[name]).toEqual({ state: 'unsupported', source: 'server-metadata' });
		expect((await createCapabilitySnapshot(ctx, 'Multimodal-Vision')).features.vision.state).toBe(
			'unknown'
		);
	});
	it.each([false, true])(
		'respects Responses input-format limits with text-only=%s',
		async (textOnly) => {
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				serverBaseUrl: 'http://localhost:8000',
				apiKey: ''
			});
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							object: 'list',
							data: [
								{
									id: 'model',
									capabilities: {
										required_protocol: 'responses',
										vision: true,
										audio: true,
										video: true,
										language_model_only: textOnly
									}
								}
							]
						}),
						{ headers: { 'content-type': 'application/json' } }
					)
				)
			);
			await modelsStore.fetch(true);
			await modelsStore.refreshCapabilities(
				{
					providerId: 'vllm',
					serverBaseUrl: 'http://localhost:8000',
					apiKey: '',
					sourceGeneration: 0
				},
				'model'
			);
			expect(modelsStore.modelSupportsVision('model')).toBe(!textOnly);
			expect(modelsStore.modelSupportsAudio('model')).toBe(false);
			expect(modelsStore.modelSupportsVideo('model')).toBe(false);
		}
	);
	it('does not show modality hints or the flask and leaves text/PDF actions independent', () => {
		const source = readFileSync(
			'src/lib/components/app/chat/ChatForm/ChatFormActions/ChatFormActionAttachmentsDropdown.svelte',
			'utf8'
		);
		expect(source).not.toMatch(
			/FlaskConical|visionIsExperimental|imageProcessingRequires|audioFilesRequire|videoFilesRequire|pdfsConvertedToTextHint/
		);
		for (const modality of ['Vision', 'Audio', 'Video'])
			expect(source).toContain(`disabled={!has${modality}Modality}`);
		expect(source).toContain("t('attachments.textFiles')");
		expect(source).toContain("t('attachments.pdfFiles')");
	});
});
