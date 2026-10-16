import { describe, expect, it } from 'vitest';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { parseSettingsConfig, validateSettingsPatch } from '$lib/utils/settings-schema';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions,
	withResponsePreferences,
	withChatInstructions
} from '$lib/utils/response-preferences';
import type { ApiChatMessageData } from '$lib/types/api';
import { getDictionary } from '$lib/i18n';

const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));

describe('response preferences contract', () => {
	it('defaults all eight off and preserves existing settings on upgrade', () => {
		expect(RESPONSE_PREFERENCES).toHaveLength(8);
		const upgraded = parseSettingsConfig({
			systemMessage: 'Manual',
			fontSize: '20',
			temperature: 0.4
		});
		for (const { key } of RESPONSE_PREFERENCES) {
			expect(SETTING_CONFIG_DEFAULT[key]).toBe(false);
			expect(upgraded[key]).toBe(false);
		}
		expect(upgraded).toMatchObject({ systemMessage: 'Manual', fontSize: '20', temperature: 0.4 });
	});
	it.each(RESPONSE_PREFERENCES)(
		'enables $key independently and validates strict booleans',
		({ key, instruction }) => {
			const settings = parseSettingsConfig({ [key]: true });
			expect(RESPONSE_PREFERENCES.filter((pref) => settings[pref.key])).toHaveLength(1);
			expect(buildResponsePreferenceInstructions(settings)).toContain(instruction);
			for (const invalid of ['true', 1, null, [], {}]) {
				expect(() => validateSettingsPatch({ [key]: invalid })).toThrow(key);
				expect(parseSettingsConfig({ [key]: invalid })[key]).toBe(false);
			}
		}
	);
	it('does not add text or empty messages when disabled', () => {
		const messages: ApiChatMessageData[] = [{ role: 'user', content: 'Hi' }];
		expect(buildResponsePreferenceInstructions({})).toBe('');
		expect(withResponsePreferences(messages, {})).toBe(messages);
		expect(withResponsePreferences([], {})).toEqual([]);
	});
	it('uses stable order and exactly one copy of each active instruction', () => {
		const text = buildResponsePreferenceInstructions(all);
		let previous = -1;
		for (const { instruction } of RESPONSE_PREFERENCES) {
			const index = text.indexOf(instruction);
			expect(index).toBeGreaterThan(previous);
			expect(text.split(instruction)).toHaveLength(2);
			previous = index;
		}
	});
	it.each(['', 'Manual: answer in French, use headings.'])(
		'composes with manual prompt %j without mutating input',
		(manual) => {
			const original: ApiChatMessageData[] = [
				{ role: 'system', content: manual },
				{ role: 'user', content: 'Hi' }
			];
			const copy = structuredClone(original);
			original.forEach(Object.freeze);
			Object.freeze(original);
			const result = withChatInstructions(original, all);
			const text = String(result[0].content);
			expect(original).toEqual(copy);
			expect(text.startsWith(CHART_INSTRUCTIONS + '\n\n')).toBe(true);
			expect(text).toContain(buildResponsePreferenceInstructions(all));
			if (manual) expect(text.endsWith('\n\n' + manual)).toBe(true);
			expect(text).toContain('manual system message below, take precedence');
			expect(withChatInstructions(result, all)).toEqual(result);
		}
	);
	it('creates request-only system message and can replace or disable its own prefix', () => {
		const original: ApiChatMessageData[] = [{ role: 'user', content: 'Hi' }];
		const result = withChatInstructions(original, all);
		expect(result).toHaveLength(2);
		expect(withChatInstructions(result, {})).toEqual(withChatInstructions(original, {}));
		expect(withChatInstructions(result, { responsePrefSteps: true })).toEqual(
			withChatInstructions(original, { responsePrefSteps: true })
		);
		expect(withResponsePreferences(withResponsePreferences(original, all), {})).toEqual(original);
	});
	it('keeps one technical chart schema whether chart preference is on or off', () => {
		for (const responsePrefCharts of [false, true]) {
			const text = String(withChatInstructions([], { responsePrefCharts })[0].content);
			expect(text.split(CHART_INSTRUCTIONS)).toHaveLength(2);
			expect(text.includes(RESPONSE_PREFERENCES[2].instruction)).toBe(responsePrefCharts);
			expect(text).not.toMatch(/\bpie\b/i);
			expect(text).toContain('Supported types: line, area, bar, donut.');
		}
		expect(CHART_INSTRUCTIONS).toContain('otherwise optional');
		expect(RESPONSE_PREFERENCES[2].instruction).toContain('MUST include');
		expect(RESPONSE_PREFERENCES[2].instruction).not.toContain('"type"');
	});
	it('scopes tables to structured facts and numbered steps to procedures', () => {
		const text = buildResponsePreferenceInstructions({
			responsePrefTables: true,
			responsePrefSteps: true
		});
		expect(text).toContain('Do not force tables for single sentences, procedures');
		expect(text).toContain('For procedures and how-to tasks, you MUST provide numbered steps');
	});
	it.each(['en', 'pl', 'de', 'fr', 'it', 'es'] as const)(
		'has translated UI in %s but a language-independent English contract',
		(language) => {
			const settings = parseSettingsConfig({ ...all, interfaceLanguage: language });
			expect(buildResponsePreferenceInstructions(settings)).toBe(
				buildResponsePreferenceInstructions(all)
			);
			const dictionary = getDictionary(language).settings as Record<string, unknown>;
			for (const { name } of RESPONSE_PREFERENCES) {
				expect(dictionary[`responsePref${name}`]).toBeTypeOf('string');
				expect(dictionary[`responsePref${name}Help`]).toBeTypeOf('string');
			}
		}
	);
});
