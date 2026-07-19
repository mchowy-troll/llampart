import type { InterfaceLanguage, TranslationDictionary } from '$lib/i18n/types';
import { FROSTED_GLASS_TRANSLATIONS } from './frosted-glass/translations';

export function getThemeTranslations(language: InterfaceLanguage): TranslationDictionary {
	return FROSTED_GLASS_TRANSLATIONS[language];
}
