import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM_LIMITS, formBytes } from '$lib/forms/form-limits';
import { FORM_PROPOSAL, readFormProposal, recoverFormProposal } from '$lib/forms/form-protocol';
import { buildFormCatalogInstructions } from '$lib/forms/form-catalog';
import {
	formAnswerText,
	formDefaults,
	parseFormValues,
	validateFormSpec,
	validateFormValues,
	validateInteractiveForm
} from '$lib/services/interactive-forms';
import { hiddenFormResultIds } from '$lib/utils/form-result-presentation';
import type { DatabaseMessage } from '$lib/types/database';
import type { InteractiveForm, InteractiveFormSpec } from '$lib/types/interactive-forms';
import { INTERFACE_LANGUAGES, type TranslationDictionary } from '$lib/i18n/types';

function specification(fields = 80, groups = 4): InteractiveFormSpec {
	const elements: InteractiveFormSpec['elements'] = {
		root: { type: 'Container', props: { columns: 1 }, children: [] },
		submit: {
			type: 'SubmitButton',
			props: { label: 'MODEL CAPTION MUST NEVER APPEAR' },
			children: [],
			on: { press: { action: 'submit' } }
		}
	};
	for (let i = 0; i < groups; i++) {
		const id = `group_${i}`;
		elements[id] = { type: 'Group', props: { title: id, columns: 2 }, children: [] };
		elements.root.children.push(id);
	}
	for (let i = 0; i < fields; i++) {
		const id = `field_${i}`;
		elements[id] = {
			type: 'Textarea',
			props: { field: id, label: id, required: true, help: 'h'.repeat(500) },
			children: []
		};
		elements[groups ? `group_${i % groups}` : 'root'].children.push(id);
	}
	elements.root.children.push('submit');
	return { root: 'root', elements };
}

function owned(spec = validateFormSpec(specification(1, 0))) {
	const owner: DatabaseMessage = {
		id: 'owner',
		convId: 'conversation',
		role: 'assistant',
		type: 'text',
		content: 'Form introduction',
		parent: null,
		children: ['result'],
		timestamp: 1
	};
	const values = Object.fromEntries(Object.keys(formDefaults(spec)).map((id) => [id, 'Answer']));
	const content = formAnswerText(spec, values);
	const form: InteractiveForm = {
		id: 'form',
		messageId: owner.id,
		conversationId: owner.convId,
		sourceContent: owner.content,
		spec,
		values,
		revision: 1,
		status: 'submitted',
		result: { values, content, messageId: 'result' }
	};
	owner.interactiveForm = form;
	const result: DatabaseMessage = {
		id: 'result',
		convId: owner.convId,
		role: 'user',
		type: 'text',
		content,
		parent: owner.id,
		children: [],
		timestamp: 2
	};
	return { owner, result, form };
}

describe('form result presentation ownership', () => {
	it('hides the durable owned result during pending/retry and completion, including reload', () => {
		const { owner, result } = owned();
		const manual = { ...result, id: 'manual', parent: result.id };
		result.children.push(manual.id);
		const messages = JSON.parse(JSON.stringify([owner, result, manual]));
		for (const status of ['draft', 'submitted']) {
			messages[0].interactiveForm.status = status;
			expect([...hiddenFormResultIds(messages, new Map([['owner', 'form']]))]).toEqual(['result']);
		}
		expect(messages).toHaveLength(3);
		expect(messages[1].content).toBe(result.content);
	});
	it('fails open for absent, unavailable, invalid, edited, foreign and off-branch ownership', () => {
		for (const mutate of [
			(o: DatabaseMessage) => {
				o.interactiveForm!.status = 'draft';
				o.interactiveForm!.result = undefined;
			},
			(o: DatabaseMessage) => {
				o.content = 'edited';
			},
			(o: DatabaseMessage) => {
				o.interactiveForm!.messageId = 'other';
			},
			(o: DatabaseMessage) => {
				o.interactiveForm!.result!.messageId = 'other';
			},
			(o: DatabaseMessage) => {
				o.interactiveForm!.result!.content = 'changed';
			},
			(o: DatabaseMessage, r: DatabaseMessage) => {
				r.convId = 'foreign';
			},
			(o: DatabaseMessage, r: DatabaseMessage) => {
				r.parent = 'sibling';
			},
			(o: DatabaseMessage, r: DatabaseMessage) => {
				r.content = 'manually edited';
			},
			(o: DatabaseMessage) => {
				o.children = [];
			}
		]) {
			const { owner, result } = owned();
			mutate(owner, result);
			expect(hiddenFormResultIds([owner, result], new Map([['owner', 'form']])).size).toBe(0);
		}
		const { owner, result } = owned();
		expect(hiddenFormResultIds([owner, result], new Map()).size).toBe(0);
		expect(hiddenFormResultIds([result], new Map([['owner', 'form']])).size).toBe(0);
	});
});

describe('expanded strict form capacity', () => {
	it('accepts a >64-node, >32 KiB form, 24 choices and >8 KiB saved answers end to end', () => {
		const candidate = specification();
		candidate.elements.field_0.type = 'CheckboxGroup';
		candidate.elements.field_0.props.options = Array.from({ length: 24 }, (_, i) => ({
			value: `o${i}`,
			label: `Option ${i}`
		}));
		const spec = validateFormSpec(candidate);
		expect(Object.keys(spec.elements).length).toBeGreaterThan(64);
		expect(formBytes(spec)).toBeGreaterThan(32768);
		const { owner, form } = owned(spec);
		form.values = Object.fromEntries(
			Object.keys(form.values).map((id) => [
				id,
				id === 'field_0' ? Array.from({ length: 24 }, (_, i) => `o${i}`) : '界'.repeat(100)
			])
		);
		const checked = validateFormValues(spec, form.values);
		expect(checked.valid).toBe(true);
		expect(formBytes(checked.values)).toBeGreaterThan(8192);
		form.result = {
			messageId: 'result',
			values: checked.values,
			content: formAnswerText(spec, checked.values)
		};
		expect(validateInteractiveForm(JSON.parse(JSON.stringify(form)), owner).result).toEqual(
			form.result
		);
	});
	it('enforces exact UTF-8 specification, value, proposal and question boundaries', () => {
		const spec = validateFormSpec(specification());
		const json = JSON.stringify(spec);
		const atLimit = json + ' '.repeat(FORM_LIMITS.specBytes - formBytes(json));
		expect(() => validateFormSpec(atLimit)).not.toThrow();
		expect(() => validateFormSpec(atLimit + ' ')).toThrow();
		const values = formDefaults(spec);
		for (let i = 0; i < 16; i++) values[`field_${i}`] = 'v'.repeat(1900);
		values.field_16 = 'v'.repeat(FORM_LIMITS.valuesBytes - formBytes(values));
		expect(formBytes(values)).toBe(FORM_LIMITS.valuesBytes);
		expect(() => parseFormValues(spec, values)).not.toThrow();
		values.field_16 += '界';
		expect(() => parseFormValues(spec, values)).toThrow();
		const proposal = FORM_PROPOSAL + JSON.stringify({ questions: 'q'.repeat(20000) });
		expect(readFormProposal(proposal)?.questions).toHaveLength(20000);
		expect(
			readFormProposal(FORM_PROPOSAL + JSON.stringify({ questions: 'q'.repeat(20001) }))
		).toBeNull();
		const envelope = proposal + ' '.repeat(FORM_LIMITS.proposalBytes - formBytes(proposal));
		expect(readFormProposal(envelope)).not.toBeNull();
		expect(recoverFormProposal(envelope + ' ')).toBeNull();
		expect(
			recoverFormProposal(FORM_PROPOSAL + JSON.stringify({ questions: Array(128).fill('q') }))
		).not.toBeNull();
		expect(
			recoverFormProposal(FORM_PROPOSAL + JSON.stringify({ questions: Array(129).fill('q') }))
		).toBeNull();
	});
	it('enforces node, child and choice bounds without relaxing other structure', () => {
		expect(() => validateFormSpec(specification(123, 3))).not.toThrow(); // 128 nodes
		expect(() => validateFormSpec(specification(124, 3))).toThrow();
		expect(() => validateFormSpec(specification(63, 0))).not.toThrow(); // 64 children
		expect(() => validateFormSpec(specification(64, 0))).toThrow();
		for (const type of ['Select', 'RadioGroup', 'CheckboxGroup'] as const) {
			const candidate = specification(1, 0);
			candidate.elements.field_0.type = type;
			candidate.elements.field_0.props.options = Array.from({ length: 25 }, (_, i) => ({
				value: `o${i}`,
				label: 'Option'
			}));
			expect(() => validateFormSpec(candidate)).toThrow();
		}
	});
	it('persists expanded choice-label summaries and worst-case escaped source text', () => {
		const candidate = specification(9, 0);
		for (let i = 0; i < 9; i++) {
			const node = candidate.elements[`field_${i}`];
			node.type = 'CheckboxGroup';
			node.props.help = '';
			node.props.options = Array.from({ length: 24 }, (_, j) => ({
				value: `o${j}`,
				label: '界'.repeat(120)
			}));
		}
		const spec = validateFormSpec(candidate);
		const { owner, form } = owned(spec);
		form.values = Object.fromEntries(
			Object.keys(form.values).map((id) => [id, Array.from({ length: 24 }, (_, i) => `o${i}`)])
		);
		form.result = {
			messageId: 'result',
			values: form.values,
			content: formAnswerText(spec, form.values)
		};
		expect(formBytes(form.result.content)).toBeGreaterThan(64 * 1024);
		form.sourceContent = '\u0000'.repeat(FORM_LIMITS.sourceBytes);
		owner.content = form.sourceContent;
		expect(formBytes(form)).toBeGreaterThan(384 * 1024);
		expect(formBytes(form)).toBeLessThan(FORM_LIMITS.recordBytes);
		expect(() => validateInteractiveForm(form, owner)).not.toThrow();
		form.sourceContent += 'x';
		expect(() => validateInteractiveForm(form, owner)).toThrow();
	});
});

describe('UI-owned submit caption', () => {
	const modules = import.meta.glob<{ [key: string]: TranslationDictionary }>(
		'/src/lib/i18n/locales/*.ts',
		{ eager: true }
	);
	it('has a Send equivalent and no submission-status keys in all registered locales', () => {
		for (const language of INTERFACE_LANGUAGES) {
			const dictionary = modules[`/src/lib/i18n/locales/${language}.ts`][language];
			expect((dictionary.common as Record<string, string>).send.trim()).not.toBe('');
			for (const key of ['submitted', 'pending', 'retry', 'failed', 'errors'])
				expect(dictionary.interactiveForms).not.toHaveProperty(key);
		}
		expect(modules['/src/lib/i18n/locales/pl.ts'].pl.common).toHaveProperty('send', 'Wyślij');
		expect(modules['/src/lib/i18n/locales/en.ts'].en.common).toHaveProperty('send', 'Send');
	});
	it('renders only reactive common.send and tells the model its legacy label is ignored', () => {
		const source = readFileSync('src/lib/components/app/forms/SubmitButton.svelte', 'utf8');
		expect(source).toContain("t('common.send')");
		expect(source).not.toMatch(/props\.label|host\.retry|interactiveForms\.(submitted|retry)/);
		expect(buildFormCatalogInstructions()).toContain('The UI ignores it');
	});
});
