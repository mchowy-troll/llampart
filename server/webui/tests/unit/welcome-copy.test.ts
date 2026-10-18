import { describe, expect, it } from 'vitest';
import { en } from '$lib/i18n/locales/en';
import { pl } from '$lib/i18n/locales/pl';
import { de } from '$lib/i18n/locales/de';
import { fr } from '$lib/i18n/locales/fr';
import { it as italian } from '$lib/i18n/locales/it';
import { es } from '$lib/i18n/locales/es';
import type { TranslationDictionary } from '$lib/i18n/types';
import approved from '../fixtures/welcome-approved-copy.json';

const dictionaries = { en, pl, de, fr, it: italian, es };
const keys = [
	'aboutLlampartAboutProgramBodyOne',
	'aboutLlampartAboutProgramBodyTwo',
	'aboutLlampartAboutProgramBodyThree',
	'aboutLlampartAboutProgramBodyFour'
] as const;

function dialogs(dictionary: TranslationDictionary) {
	const value = dictionary.dialogs;
	if (!value || typeof value === 'string') throw new Error('Missing dialogs dictionary');
	return value;
}

function text(dictionary: TranslationDictionary, key: string): string {
	const value = dialogs(dictionary)[key];
	if (typeof value !== 'string') throw new Error(`Missing dialog translation: ${key}`);
	return value;
}

describe('Welcome / About program copy', () => {
	it.each(['en', 'pl'] as const)('preserves the approved %s copy verbatim', (language) => {
		expect(keys.map((key) => text(dictionaries[language], key))).toEqual(approved[language]);
	});

	it.each(Object.entries(dictionaries))(
		'provides four complete plain-text paragraphs in %s',
		(_, dictionary) => {
			const paragraphs = keys.map((key) => text(dictionary, key));
			expect(
				Object.keys(dialogs(dictionary)).filter((key) =>
					key.startsWith('aboutLlampartAboutProgramBody')
				)
			).toEqual(keys);
			for (const paragraph of paragraphs) {
				expect(typeof paragraph).toBe('string');
				expect(paragraph.length).toBeGreaterThan(250);
				expect(paragraph).not.toMatch(/<[^>]+>|\n|dialogs\./);
			}
			for (const technology of [
				'llampart',
				'llama-server',
				'vLLM',
				'OpenAI',
				'Markdown',
				'Mermaid',
				'MCP',
				'Frosted Glass',
				'llama-ui',
				'llama.cpp'
			]) {
				expect(paragraphs.join(' ')).toContain(technology);
			}
			expect(text(dictionary, 'aboutLlampartSpecialThanksLlamaUiBody')).toContain('llama.cpp');
			expect(text(dictionary, 'aboutLlampartSpecialThanksLlamaUiBody')).toContain('llama-ui');
			expect(text(dictionary, 'aboutLlampartLicenseBody')).toContain('MIT');
		}
	);
});
