import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants';
import { parseSettingsStorage, serializeSettingsStorage } from '$lib/utils/settings-schema';
import { en } from '$lib/i18n/locales/en';
import { pl } from '$lib/i18n/locales/pl';
import { de } from '$lib/i18n/locales/de';
import { fr } from '$lib/i18n/locales/fr';
import { it as italian } from '$lib/i18n/locales/it';
import { es } from '$lib/i18n/locales/es';
import type { TranslationDictionary } from '$lib/i18n/types';

function text(locale: TranslationDictionary, section: string, key: string): string {
	const group = locale[section];
	if (typeof group !== 'object' || typeof group[key] !== 'string')
		throw new Error('Missing translation');
	return group[key];
}

describe('UI polish contracts', () => {
	it('keeps one fallback paragraph, both source actions and the source dialog without dead copy', () => {
		const source = readFileSync(
			new URL('../../src/lib/components/app/content/VisualizationFallback.svelte', import.meta.url),
			'utf8'
		);
		const message = source.match(
			/<div role="status" class="fallback-message">([\s\S]*?)<\/div>/
		)![1];
		expect(message.match(/<p>/g)).toHaveLength(1);
		expect(message).toContain("kind === 'diagram' ? 'diagrams.invalid' : 'charts.invalid'");
		expect(source).not.toContain('inspectDefinition');
		expect(source).not.toContain('.fallback-message p + p');
		expect(source).toContain("t('common.showCode')");
		expect(source).toContain("t('common.copyCode')");
		expect(source).toContain('copyCodeToClipboard(');
		expect(source).toContain('code={source}');
		expect(source).toContain('sourceOnly');
	});

	it('uses 75 only when no milkiness preference was saved', () => {
		expect(SETTING_CONFIG_DEFAULT.frostedGlassMilkiness).toBe(75);
		for (const source of [null, '{}'])
			expect(parseSettingsStorage(source).frostedGlassMilkiness).toBe(75);
		for (const value of [0, 23, 50, 75, 100]) {
			const config = parseSettingsStorage(JSON.stringify({ frostedGlassMilkiness: value }));
			expect(config.frostedGlassMilkiness).toBe(value);
			expect(parseSettingsStorage(serializeSettingsStorage(config)).frostedGlassMilkiness).toBe(
				value
			);
		}
	});
	it.each([en, pl, de, fr, italian, es])(
		'offers safe actionable visualization errors in every locale',
		(locale) => {
			expect(text(locale, 'charts', 'invalid')).toContain('llampart-chart');
			expect(text(locale, 'diagrams', 'invalid')).toContain('llampart-diagram');
			expect(locale.charts).not.toHaveProperty('inspectDefinition');
			expect(locale.diagrams).not.toHaveProperty('inspectDefinition');
			expect(text(locale, 'common', 'showCode').length).toBeGreaterThan(0);
			expect(text(locale, 'common', 'copyCode').length).toBeGreaterThan(0);
			for (const section of ['charts', 'diagrams']) {
				expect(text(locale, section, 'invalid')).not.toContain(text(locale, 'common', 'showCode'));
			}
			expect(text(locale, 'server', 'connectionUnavailableHelp').length).toBeGreaterThan(30);
		}
	);
	it('uses the exact requested Polish copy', () => {
		expect(text(pl, 'server', 'connectionUnavailableHelp')).toBe(
			'Odśwież stronę po przywróceniu połączenia lub sprawdź ustawienia serwera.'
		);
		expect(text(pl, 'charts', 'invalid')).toBe(
			'Nie udało się wyświetlić wykresu. Możliwe przyczyny to nieprawidłowy format llampart-chart lub przekroczenie obsługiwanych limitów danych.'
		);
		expect(text(pl, 'diagrams', 'invalid')).toBe(
			'Nie udało się wyświetlić diagramu. Możliwe przyczyny to nieprawidłowy format llampart-diagram lub przekroczenie dopuszczalnej liczby elementów.'
		);
	});
});
