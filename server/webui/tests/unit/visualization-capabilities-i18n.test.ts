import { describe, expect, it } from 'vitest';
import { INTERFACE_LANGUAGES, type TranslationDictionary } from '$lib/i18n/types';

const modules = import.meta.glob<{ [key: string]: TranslationDictionary }>(
	'/src/lib/i18n/locales/*.ts',
	{ eager: true }
);
const dictionaries = Object.fromEntries(
	Object.entries(modules).map(([path, module]) => {
		const id = path.split('/').at(-1)!.replace('.ts', '');
		return [id, module[id]];
	})
);
const keys = [
	'charts.disabled',
	'diagrams.disabled',
	'settings.groupVisualizations',
	'settings.fieldChartsEnabled',
	'settings.fieldDiagramsEnabled',
	'settings.info.chartsEnabled',
	'settings.info.diagramsEnabled'
];
function leaves(tree: TranslationDictionary, prefix = ''): Record<string, string> {
	return Object.fromEntries(
		Object.entries(tree).flatMap(([key, value]) => {
			const path = prefix ? `${prefix}.${key}` : key;
			return typeof value === 'string' ? [[path, value]] : Object.entries(leaves(value, path));
		})
	);
}

describe('visualization capability localization', () => {
	it('uses natural German capability labels and leaves the technology in the help', () => {
		const de = leaves(dictionaries.de);
		expect(de['settings.fieldChartsEnabled']).toBe('Datendiagramme aktivieren');
		expect(de['settings.fieldDiagramsEnabled']).toBe('Diagramme aktivieren');
		expect(de['settings.info.diagramsEnabled']).toContain('Mermaid');
		expect(de['charts.disabled']).toContain('Datendiagrammen');
		expect(de['diagrams.disabled']).not.toContain('Datendiagrammen');
	});
	it('uses exactly the 25 registered locale files', () => {
		expect(INTERFACE_LANGUAGES).toHaveLength(25);
		expect(Object.keys(dictionaries).sort()).toEqual([...INTERFACE_LANGUAGES].sort());
	});
	it.each(INTERFACE_LANGUAGES)(
		'%s has all seven strings, matching key/type contracts, without English fallbacks',
		(id) => {
			const translated = leaves(dictionaries[id]);
			const english = leaves(dictionaries.en);
			// Plural categories legitimately differ by language (e.g. Polish few/many).
			const semanticKeys = (values: Record<string, string>) =>
				[
					...new Set(
						Object.keys(values).map((key) => key.replace(/\.(zero|one|two|few|many|other)$/, ''))
					)
				].sort();
			expect(semanticKeys(translated)).toEqual(semanticKeys(english));
			for (const key of keys) {
				expect(typeof translated[key]).toBe('string');
				expect(translated[key].trim().length).toBeGreaterThan(0);
				if (id !== 'en') expect(translated[key]).not.toBe(english[key]);
			}
			expect(translated['charts.disabled']).not.toBe(translated['charts.invalid']);
			expect(translated['diagrams.disabled']).not.toBe(translated['diagrams.invalid']);
			expect(translated['settings.fieldChartsEnabled']).not.toContain('Mermaid');
			expect(translated['settings.fieldDiagramsEnabled']).not.toContain('Mermaid');
		}
	);
});
