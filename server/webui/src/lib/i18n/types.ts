export const INTERFACE_LANGUAGES = ['en', 'pl', 'de', 'fr', 'it', 'es'] as const;

export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];

export type TranslationLeaf = string;

export interface TranslationTree {
	[key: string]: TranslationLeaf | TranslationTree;
}

export type TranslationDictionary = TranslationTree;
