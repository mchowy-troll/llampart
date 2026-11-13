import { describe, expect, it } from 'vitest';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';
import { parseSettingsConfig, validateSettingsPatch } from '$lib/utils/settings-schema';
import { CHART_INSTRUCTIONS } from '$lib/markdown/chart-instructions';
import { MERMAID_INSTRUCTIONS } from '$lib/markdown/mermaid-instructions';
import { TABLE_INSTRUCTIONS } from '$lib/markdown/table-instructions';
import {
	RESPONSE_PREFERENCES,
	buildResponsePreferenceInstructions,
	withResponsePreferences,
	withChatInstructions
} from '$lib/utils/response-preferences';
import type { ApiChatMessageData } from '$lib/types/api';

const all = Object.fromEntries(RESPONSE_PREFERENCES.map(({ key }) => [key, true]));

describe('response preferences contract', () => {
	it.each(
		[false, true].flatMap((chartsEnabled) =>
			[false, true].map((diagramsEnabled) => ({ chartsEnabled, diagramsEnabled }))
		)
	)('gates independent format instructions and encouragement: %j', (flags) => {
		for (const preference of [false, true]) {
			const settings = {
				...flags,
				responsePrefCharts: preference,
				responsePrefDiagrams: preference
			};
			const history: ApiChatMessageData[] = [{ role: 'user', content: 'Question' }];
			const request = withChatInstructions(history, settings);
			const text = String(request.find((m) => m.role === 'system')?.content ?? '');
			expect(text.includes(CHART_INSTRUCTIONS)).toBe(flags.chartsEnabled);
			expect(text.includes(MERMAID_INSTRUCTIONS)).toBe(flags.diagramsEnabled);
			for (const pref of RESPONSE_PREFERENCES.filter(({ name }) =>
				['Charts', 'Diagrams'].includes(name)
			))
				expect(text.includes(pref.instruction)).toBe(
					preference && (pref.name === 'Charts' ? flags.chartsEnabled : flags.diagramsEnabled)
				);
			expect(withChatInstructions(request, settings)).toEqual(request);
			expect(
				withChatInstructions(request, { chartsEnabled: false, diagramsEnabled: false })
			).toEqual([
				{
					role: 'system',
					content: `<llampart-chat-instructions>\n${TABLE_INSTRUCTIONS}\n</llampart-chat-instructions>`
				},
				...history
			]);
		}
	});
	it.each([CHART_INSTRUCTIONS, MERMAID_INSTRUCTIONS, CHART_INSTRUCTIONS + '\n\nManual ending'])(
		'preserves manual leading format text exactly',
		(manual) => {
			const history: ApiChatMessageData[] = [{ role: 'system', content: manual }];
			const request = withChatInstructions(history, { responsePrefCharts: true });
			expect(String(request[0].content).endsWith('\n\n' + manual)).toBe(true);
			expect(
				withChatInstructions(request, { chartsEnabled: false, diagramsEnabled: false })
			).toEqual([
				{
					role: 'system',
					content: `<llampart-chat-instructions>\n${TABLE_INSTRUCTIONS}\n</llampart-chat-instructions>\n\n${manual}`
				}
			]);
			expect(history).toEqual([{ role: 'system', content: manual }]);
		}
	);
	it('preserves a manually entered complete composer envelope through policy changes', () => {
		const manual = `<llampart-chat-instructions>\n${CHART_INSTRUCTIONS}\n\nUser-owned text\n</llampart-chat-instructions>\n\nManual ending`;
		const history: ApiChatMessageData[] = [
			{ role: 'system', content: manual },
			{ role: 'user', content: 'Question' }
		];
		const before = structuredClone(history);
		for (const chartsEnabled of [false, true])
			for (const diagramsEnabled of [false, true]) {
				const policy = { chartsEnabled, diagramsEnabled };
				const request = withChatInstructions(history, policy);
				expect(String(request[0].content).endsWith(manual)).toBe(true);
				expect(withChatInstructions(request, policy)).toBe(request);
				expect(
					withChatInstructions(request, { chartsEnabled: false, diagramsEnabled: false })
				).toEqual([
					{
						role: 'system',
						content: `<llampart-chat-instructions>\n${TABLE_INSTRUCTIONS}\n</llampart-chat-instructions>\n\n${manual}`
					},
					...history.slice(1)
				]);
			}
		expect(history).toEqual(before);
	});
	it('does not claim copied, serialized or edited composer messages as application-owned', () => {
		const generated = withChatInstructions([{ role: 'user', content: 'Question' }], all);
		const off = { chartsEnabled: false, diagramsEnabled: false };
		for (const unowned of [
			generated.map((message) => ({ ...message })),
			JSON.parse(JSON.stringify(generated)) as ApiChatMessageData[]
		]) {
			const before = structuredClone(unowned);
			const originalSystem = unowned[0];
			unowned.forEach(Object.freeze);
			Object.freeze(unowned);
			const request = withChatInstructions(unowned, off);
			expect(request).not.toBe(unowned);
			expect(request).toEqual([
				{
					...originalSystem,
					content: `<llampart-chat-instructions>\n${TABLE_INSTRUCTIONS}\n</llampart-chat-instructions>\n\n${originalSystem.content}`
				},
				...unowned.slice(1)
			]);
			expect(unowned[0]).toBe(originalSystem);
			expect(unowned).toEqual(before);
			expect(request[1]).toBe(unowned[1]);
		}
		expect(JSON.stringify(generated[0])).toBe(
			JSON.stringify({ role: 'system', content: generated[0].content })
		);
		generated[0].content += '\nUser edit';
		const before = structuredClone(generated);
		const originalSystem = generated[0];
		generated.forEach(Object.freeze);
		Object.freeze(generated);
		const request = withChatInstructions(generated, off);
		expect(request).not.toBe(generated);
		expect(request).toEqual([
			{
				...originalSystem,
				content: `<llampart-chat-instructions>\n${TABLE_INSTRUCTIONS}\n</llampart-chat-instructions>\n\n${originalSystem.content}`
			},
			...generated.slice(1)
		]);
		expect(generated[0]).toBe(originalSystem);
		expect(generated).toEqual(before);
		expect(request[1]).toBe(generated[1]);
	});
	it('defaults preferences off and preserves existing settings on upgrade', () => {
		const upgraded = parseSettingsConfig({ systemMessage: 'Manual', temperature: 0.4 });
		for (const { key } of RESPONSE_PREFERENCES) {
			expect(SETTING_CONFIG_DEFAULT[key]).toBe(false);
			expect(upgraded[key]).toBe(false);
		}
		expect(upgraded).toMatchObject({ systemMessage: 'Manual', temperature: 0.4 });
	});

	it.each(RESPONSE_PREFERENCES)('enables only $key', ({ key, instruction }) => {
		const settings = parseSettingsConfig({
			[key]: true,
			interactiveFormsEnabled: key === 'responsePrefForms'
		});
		expect(
			RESPONSE_PREFERENCES.filter((pref) => settings[pref.key]).map((pref) => pref.key)
		).toEqual([key]);
		const text = buildResponsePreferenceInstructions(settings);
		for (const pref of RESPONSE_PREFERENCES)
			expect(text.includes(pref.instruction)).toBe(pref.instruction === instruction);
		if (key === 'responsePrefForms') {
			const disabled = { ...settings, interactiveFormsEnabled: false };
			expect(buildResponsePreferenceInstructions(disabled)).toBe('');
			expect(withChatInstructions([], disabled)).toEqual(
				withChatInstructions([], { interactiveFormsEnabled: false })
			);
		}
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
		const settings = { ...all, interactiveFormsEnabled: true };
		const history: ApiChatMessageData[] = [
			{ role: 'system', content: 'Manual system prompt' },
			{ role: 'user', content: 'Saved question' },
			{ role: 'assistant', content: 'Saved answer' }
		];
		const before = structuredClone(history);
		history.forEach(Object.freeze);
		Object.freeze(history);
		const result = withChatInstructions(history, settings);
		const text = String(result[0].content);
		for (const instruction of [
			CHART_INSTRUCTIONS,
			MERMAID_INSTRUCTIONS,
			TABLE_INSTRUCTIONS,
			...RESPONSE_PREFERENCES.map((pref) => pref.instruction)
		])
			expect(text.split(instruction)).toHaveLength(2);
		expect(text.endsWith('\n\n' + history[0].content)).toBe(true);
		expect(result.slice(1)).toEqual(history.slice(1));
		expect(withChatInstructions(result, settings)).toEqual(result);
		const changed = { responsePrefDiagrams: true };
		expect(withChatInstructions(result, changed)).toEqual(withChatInstructions(history, changed));
		const disabled = withChatInstructions(result, {});
		expect(disabled).toEqual(withChatInstructions(history, {}));
		for (const instruction of [CHART_INSTRUCTIONS, MERMAID_INSTRUCTIONS, TABLE_INSTRUCTIONS])
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
