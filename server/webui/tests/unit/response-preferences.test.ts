import { describe, expect, it } from 'vitest';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { parseSettingsConfig, validateSettingsPatch } from '$lib/utils/settings-schema';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions,
	withResponsePreferences,
	withChatInstructions
} from '$lib/utils/response-preferences';
import type { ApiChatMessageData } from '$lib/types/api';

const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));

describe('response preferences contract', () => {
	it('defaults preferences off and preserves existing settings on upgrade', () => {
		const upgraded = parseSettingsConfig({ systemMessage: 'Manual', temperature: 0.4 });
		for (const { key } of RESPONSE_PREFERENCES) {
			expect(SETTING_CONFIG_DEFAULT[key]).toBe(false);
			expect(upgraded[key]).toBe(false);
		}
		expect(upgraded).toMatchObject({ systemMessage: 'Manual', temperature: 0.4 });
	});

	it.each(RESPONSE_PREFERENCES)('enables only $key', ({ key, instruction }) => {
		const settings = parseSettingsConfig({ [key]: true });
		expect(
			RESPONSE_PREFERENCES.filter((pref) => settings[pref.key]).map((pref) => pref.key)
		).toEqual([key]);
		const text = buildResponsePreferenceInstructions(settings);
		for (const pref of RESPONSE_PREFERENCES)
			expect(text.includes(pref.instruction)).toBe(pref.instruction === instruction);
	});

	it('rejects non-boolean preferences and safely loads invalid saved values', () => {
		for (const invalid of ['true', 1, null]) {
			expect(() => validateSettingsPatch({ responsePrefConcise: invalid })).toThrow(
				'responsePrefConcise'
			);
			expect(parseSettingsConfig({ responsePrefConcise: invalid, temperature: 0.4 })).toMatchObject(
				{
					responsePrefConcise: false,
					temperature: 0.4
				}
			);
		}
	});

	it('does not add text or empty messages when disabled', () => {
		const messages: ApiChatMessageData[] = [{ role: 'user', content: 'Hi' }];
		expect(buildResponsePreferenceInstructions({})).toBe('');
		expect(withResponsePreferences(messages, {})).toBe(messages);
		expect(withResponsePreferences([], {})).toEqual([]);
	});

	it('composes request-only instructions once, replaces preferences and preserves manual history', () => {
		const history: ApiChatMessageData[] = [
			{ role: 'system', content: 'Manual system prompt' },
			{ role: 'user', content: 'Saved question' },
			{ role: 'assistant', content: 'Saved answer' }
		];
		const before = structuredClone(history);
		history.forEach(Object.freeze);
		Object.freeze(history);
		const result = withChatInstructions(history, all);
		const text = String(result[0].content);
		for (const instruction of [
			CHART_INSTRUCTIONS,
			MERMAID_INSTRUCTIONS,
			...RESPONSE_PREFERENCES.map((pref) => pref.instruction)
		])
			expect(text.split(instruction)).toHaveLength(2);
		expect(text.endsWith('\n\n' + history[0].content)).toBe(true);
		expect(result.slice(1)).toEqual(history.slice(1));
		expect(withChatInstructions(result, all)).toEqual(result);
		const changed = { responsePrefDiagrams: true };
		expect(withChatInstructions(result, changed)).toEqual(withChatInstructions(history, changed));
		const disabled = withChatInstructions(result, {});
		expect(disabled).toEqual(withChatInstructions(history, {}));
		for (const instruction of [CHART_INSTRUCTIONS, MERMAID_INSTRUCTIONS])
			expect(String(disabled[0].content).split(instruction)).toHaveLength(2);
		expect(history).toEqual(before);
	});

	it('creates a system message without changing user history and removes its own preference prefix', () => {
		const original: ApiChatMessageData[] = [{ role: 'user', content: 'Hi' }];
		const result = withChatInstructions(original, all);
		expect(result).toHaveLength(2);
		expect(result[0].role).toBe('system');
		expect(result.slice(1)).toEqual(original);
		expect(withChatInstructions(result, {})).toEqual(withChatInstructions(original, {}));
		expect(withResponsePreferences(withResponsePreferences(original, all), {})).toEqual(original);
		expect(original).toEqual([{ role: 'user', content: 'Hi' }]);
	});

	it.each([
		{
			messages: [
				{
					role: 'system',
					content: `Keep these exact words.\n${CHART_INSTRUCTIONS}\nAnd this ending.`
				}
			]
		},
		{
			messages: [
				{ role: 'system', content: 'First manual system message.' },
				{ role: 'system', content: CHART_INSTRUCTIONS }
			]
		}
	] satisfies { messages: ApiChatMessageData[] }[])(
		'never truncates manual prompts quoting a chart contract: %j',
		({ messages }) => {
			const original = structuredClone(messages);
			const result = withChatInstructions(messages, { responsePrefDiagrams: true });
			expect(String(result[0].content).endsWith(String(messages[0].content))).toBe(true);
			expect(result.slice(1)).toEqual(messages.slice(1));
			expect(withChatInstructions(result, { responsePrefDiagrams: true })).toEqual(result);
			expect(messages).toEqual(original);
		}
	);

	it('does not change request instructions with the interface language', () => {
		expect(
			buildResponsePreferenceInstructions(parseSettingsConfig({ ...all, interfaceLanguage: 'pl' }))
		).toBe(buildResponsePreferenceInstructions(all));
	});
});
