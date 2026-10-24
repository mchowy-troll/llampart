export const INTERFACE_LANGUAGES = [
	'en',
	'pl',
	'de',
	'fr',
	'it',
	'es',
	'bg',
	'hr',
	'cs',
	'da',
	'et',
	'fi',
	'el',
	'ga',
	'csb',
	'lt',
	'lv',
	'mt',
	'nl',
	'pt',
	'ro',
	'sk',
	'sl',
	'sv',
	'hu'
] as const;

export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];

export const INTERFACE_LANGUAGE_NAMES: Record<InterfaceLanguage, string> = {
	en: 'English',
	pl: 'Polski',
	de: 'Deutsch',
	fr: 'Français',
	it: 'Italiano',
	es: 'Español',
	bg: 'Български',
	hr: 'Hrvatski',
	cs: 'Čeština',
	da: 'Dansk',
	et: 'Eesti',
	fi: 'Suomi',
	el: 'Ελληνικά',
	ga: 'Gaeilge',
	csb: 'Kaszëbsczi',
	lt: 'Lietuvių',
	lv: 'Latviešu',
	mt: 'Malti',
	nl: 'Nederlands',
	pt: 'Português',
	ro: 'Română',
	sk: 'Slovenčina',
	sl: 'Slovenščina',
	sv: 'Svenska',
	hu: 'Magyar'
};

export type TranslationLeaf = string;

export interface TranslationTree {
	[key: string]: TranslationLeaf | TranslationTree;
}

export type TranslationDictionary = TranslationTree;
