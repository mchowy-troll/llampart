import { beforeEach, describe, expect, it } from 'vitest';
import { modelsStore } from '$lib/stores/models.svelte';
import type { ModelOption } from '$lib/types/models';

const models: ModelOption[] = [
	{
		id: 'id-a',
		model: 'org/model-a',
		name: 'Model A',
		capabilities: [],
		aliases: ['alpha', 'shared', 'id-b']
	},
	{
		id: 'id-b',
		model: 'org/model-b',
		name: 'Model B',
		capabilities: [],
		aliases: ['beta', 'shared', 'org/model-a']
	}
];

describe('model reference resolver', () => {
	beforeEach(() => {
		modelsStore.clear();
		modelsStore.models = models;
	});

	it('prefers an exact model name over aliases', () => {
		expect(modelsStore.resolveModelReference('org/model-a')).toEqual({
			status: 'resolved',
			model: models[0]
		});
	});

	it('prefers an exact id over aliases', () => {
		expect(modelsStore.resolveModelReference('id-b')).toEqual({
			status: 'resolved',
			model: models[1]
		});
	});

	it('resolves an exact unique alias', () => {
		expect(modelsStore.resolveModelReference('alpha')).toEqual({
			status: 'resolved',
			model: models[0]
		});
	});

	it('reports colliding aliases as ambiguous', () => {
		expect(modelsStore.resolveModelReference('shared')).toEqual({
			status: 'ambiguous',
			model: null
		});
	});

	it('does not use partial, fuzzy, or case-insensitive matching', () => {
		expect(modelsStore.resolveModelReference('model-a').status).toBe('not-found');
		expect(modelsStore.resolveModelReference('ALPHA').status).toBe('not-found');
		expect(modelsStore.resolveModelReference('unknown').status).toBe('not-found');
	});
});
