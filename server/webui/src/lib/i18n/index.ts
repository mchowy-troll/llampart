import { config } from '$lib/stores/settings.svelte';
import { getThemeTranslations } from '$lib/themes/translations';
import type { InterfaceLanguage, TranslationDictionary, TranslationTree } from './types';
import { INTERFACE_LANGUAGES } from './types';
import { en } from './locales/en';
import { pl } from './locales/pl';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { es } from './locales/es';

const FALLBACK_LANGUAGE: InterfaceLanguage = 'en';

function isRecord(value: unknown): value is TranslationTree {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeDictionaries(
	base: TranslationDictionary,
	extension: TranslationDictionary
): TranslationDictionary {
	const merged: TranslationDictionary = { ...base };

	for (const [key, value] of Object.entries(extension)) {
		const baseValue = base[key];
		merged[key] =
			isRecord(baseValue) && isRecord(value) ? mergeDictionaries(baseValue, value) : value;
	}

	return merged;
}

const dictionaries: Record<InterfaceLanguage, TranslationDictionary> = {
	en: mergeDictionaries(en, getThemeTranslations('en')),
	pl: mergeDictionaries(pl, getThemeTranslations('pl')),
	de: mergeDictionaries(de, getThemeTranslations('de')),
	fr: mergeDictionaries(fr, getThemeTranslations('fr')),
	it: mergeDictionaries(it, getThemeTranslations('it')),
	es: mergeDictionaries(es, getThemeTranslations('es'))
};

function getNestedValue(dictionary: TranslationDictionary, key: string): string | undefined {
	const parts = key.split('.');
	let current: unknown = dictionary;

	for (const part of parts) {
		if (!isRecord(current) || !(part in current)) {
			return undefined;
		}
		current = current[part];
	}

	return typeof current === 'string' ? current : undefined;
}

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
	return typeof value === 'string' && INTERFACE_LANGUAGES.includes(value as InterfaceLanguage);
}

export function getInterfaceLanguage(): InterfaceLanguage {
	const value = config().interfaceLanguage;

	return isInterfaceLanguage(value) ? value : FALLBACK_LANGUAGE;
}

export function getDictionary(language?: InterfaceLanguage): TranslationDictionary {
	return dictionaries[language ?? getInterfaceLanguage()] ?? dictionaries[FALLBACK_LANGUAGE];
}

export function t(key: string, language?: InterfaceLanguage): string {
	const activeLanguage = language ?? getInterfaceLanguage();

	const localized =
		getNestedValue(dictionaries[activeLanguage] ?? dictionaries[FALLBACK_LANGUAGE], key) ??
		getNestedValue(dictionaries[FALLBACK_LANGUAGE], key);

	return localized ?? key;
}

export type { InterfaceLanguage, TranslationDictionary } from './types';
export { INTERFACE_LANGUAGES };
