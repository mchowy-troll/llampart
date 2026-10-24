import { describe, expect, it } from 'vitest';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { parseSettingsConfig, validateSettingsPatch } from '$lib/utils/settings-schema';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions,
	withResponsePreferences,
	withChatInstructions,
	type ResponsePreferences
} from '$lib/utils/response-preferences';
import type { ApiChatMessageData } from '$lib/types/api';
import { getDictionary, INTERFACE_LANGUAGES } from '$lib/i18n';

const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));

describe('response preferences contract', () => {
	it('restricts diagram preferences to the four supported families', () => {
		const instruction = buildResponsePreferenceInstructions({ responsePrefDiagrams: true });
		expect(instruction).toContain('you MUST include a valid fenced mermaid diagram');
		expect(instruction).toContain('Use only flowchart, stateDiagram-v2, mindmap, or gantt.');
		expect(instruction).toContain('without inventing steps or relationships.');
		expect(instruction).not.toMatch(/sequence|entity relationships?|\ber\b|erDiagram/i);
		expect(instruction).not.toContain('llampart-diagram');
	});
	it.each([
		{
			key: 'responsePrefCharts',
			fragments: [
				'valid fenced llampart-chart JSON block whenever a compliant chart can be produced',
				'You MUST follow the llampart chart format instructions',
				'required JSON schema, supported chart types, accurate data, and all technical limits',
				'Check JSON syntax, schema compliance, data accuracy, and limits before responding.',
				'Simplify the visualization when necessary without inventing or distorting data.',
				'If a compliant chart cannot be created, use a Markdown table or clear text instead.',
				'Never output an invalid llampart-chart block.'
			]
		},
		{
			key: 'responsePrefDiagrams',
			fragments: [
				'valid fenced mermaid diagram whenever a compliant diagram can be produced',
				'You MUST follow the llampart diagram format instructions',
				'supported diagram families, valid Mermaid syntax, safety restrictions, and all technical size and complexity limits',
				'Check Mermaid syntax, safety, and limits before responding.',
				'Simplify overly complex diagrams without inventing steps or relationships.',
				'If a compliant diagram cannot be created, use a clear Markdown or text explanation instead.',
				'Never output invalid Mermaid code.'
			]
		}
	] as const)(
		'requires technical compliance, preflight and a safe alternative for $key',
		({ key, fragments }) => {
			const text = buildResponsePreferenceInstructions({ [key]: true });
			for (const fragment of fragments) expect(text).toContain(fragment);
			// Numeric limits remain exclusively in the independent technical contracts.
			expect(text).not.toMatch(/\b\d+\s*(?:KiB|bytes|lines|edges|rows|series|diagrams|charts)\b/i);
		}
	);
	it.each([
		{ responsePrefCharts: false, responsePrefDiagrams: false },
		{ responsePrefCharts: true, responsePrefDiagrams: false },
		{ responsePrefCharts: false, responsePrefDiagrams: true },
		{ responsePrefCharts: true, responsePrefDiagrams: true }
	])(
		'keeps both visualization preferences independent and technical contracts exactly once: %j',
		(settings) => {
			const manual = 'Manual system: explain in plain text and preserve this exact message.';
			const history: ApiChatMessageData[] = [
				{ role: 'system', content: manual },
				{ role: 'user', content: 'Saved question' },
				{ role: 'assistant', content: 'Saved answer' }
			];
			const before = structuredClone(history);
			const result = withChatInstructions(history, settings);
			const text = String(result[0].content);
			const enabled: ResponsePreferences = settings;
			expect(text.split(CHART_INSTRUCTIONS)).toHaveLength(2);
			expect(text.split(MERMAID_INSTRUCTIONS)).toHaveLength(2);
			for (const { key, instruction } of RESPONSE_PREFERENCES)
				expect(text.split(instruction)).toHaveLength(enabled[key] ? 2 : 1);
			expect(text).toBe(
				[
					CHART_INSTRUCTIONS,
					MERMAID_INSTRUCTIONS,
					buildResponsePreferenceInstructions(settings),
					manual
				]
					.filter(Boolean)
					.join('\n\n')
			);
			expect(withChatInstructions(result, settings)).toEqual(result);
			expect(withChatInstructions(result, {})).toEqual(withChatInstructions(history, {}));
			expect(history).toEqual(before);
			expect(result.slice(1)).toEqual(history.slice(1));
		}
	);
	it('defaults all nine off and preserves existing settings on upgrade', () => {
		expect(RESPONSE_PREFERENCES).toHaveLength(9);
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
			expect(text.split(MERMAID_INSTRUCTIONS)).toHaveLength(2);
			expect(text.includes(RESPONSE_PREFERENCES[2].instruction)).toBe(responsePrefCharts);
			expect(text).not.toMatch(/\bpie\b/i);
			expect(text).toContain('Supported types: line, area, bar, donut.');
		}
		expect(CHART_INSTRUCTIONS).toContain('otherwise optional');
		expect(RESPONSE_PREFERENCES[2].instruction).toContain('MUST include');
		expect(RESPONSE_PREFERENCES[2].instruction).not.toContain('"type"');
	});
	it('keeps the independent technical Mermaid contract before preferences and the manual prompt', () => {
		for (const responsePrefDiagrams of [true, false]) {
			const original: ApiChatMessageData[] = [
				{ role: 'system', content: 'Manual' },
				{ role: 'user', content: 'Hi' }
			];
			const settings = { responsePrefDiagrams };
			const result = withChatInstructions(original, settings);
			expect(result[0].content).toBe(
				[
					CHART_INSTRUCTIONS,
					MERMAID_INSTRUCTIONS,
					buildResponsePreferenceInstructions(settings),
					'Manual'
				]
					.filter(Boolean)
					.join('\n\n')
			);
			expect(withChatInstructions(result, settings)).toEqual(result);
			expect(original[0].content).toBe('Manual');
		}
	});
	it('scopes tables to structured facts and numbered steps to procedures', () => {
		const text = buildResponsePreferenceInstructions({
			responsePrefTables: true,
			responsePrefSteps: true
		});
		expect(text).toContain('Do not force tables for single sentences, procedures');
		expect(text).toContain('For procedures and how-to tasks, you MUST provide numbered steps');
	});
	it('never truncates manual prompts quoting a chart contract outside the generated prefix', () => {
		for (const messages of [
			[
				{
					role: 'system',
					content: `Keep these exact words.\n${CHART_INSTRUCTIONS}\nAnd this ending.`
				}
			],
			[
				{ role: 'system', content: 'First manual system message.' },
				{ role: 'system', content: CHART_INSTRUCTIONS }
			]
		] as ApiChatMessageData[][]) {
			const original = structuredClone(messages);
			const result = withChatInstructions(messages, { responsePrefDiagrams: true });
			expect(String(result[0].content).endsWith(String(messages[0].content))).toBe(true);
			expect(withChatInstructions(result, { responsePrefDiagrams: true })).toEqual(result);
			expect(messages).toEqual(original);
		}
	});
	it.each(INTERFACE_LANGUAGES)(
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
