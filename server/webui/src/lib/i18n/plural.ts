import { getInterfaceLanguage, t } from './index';
import type { InterfaceLanguage } from './types';

type TranslationReplacement = string | number;

function replaceTranslationPlaceholders(
	template: string,
	replacements: Record<string, TranslationReplacement>
): string {
	return Object.entries(replacements).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template
	);
}

export function formatPluralizedTranslation(
	baseKey: string,
	count: number,
	replacements: Record<string, TranslationReplacement> = {},
	language?: InterfaceLanguage
): string {
	const activeLanguage = language ?? getInterfaceLanguage();
	// ICU may not include Kashubian. Only borrow Polish plural categories, never its texts.
	const pluralLanguage =
		activeLanguage === 'csb' && Intl.PluralRules.supportedLocalesOf('csb').length === 0
			? 'pl'
			: activeLanguage;
	const category = new Intl.PluralRules(pluralLanguage).select(count);
	const categoryKey = `${baseKey}.${category}`;
	const fallbackKey = `${baseKey}.other`;

	let template = t(categoryKey, activeLanguage);

	if (template === categoryKey) {
		template = t(fallbackKey, activeLanguage);
	}

	if (template === fallbackKey) {
		template = t(baseKey, activeLanguage);
	}

	return replaceTranslationPlaceholders(template, { count, ...replacements });
}
