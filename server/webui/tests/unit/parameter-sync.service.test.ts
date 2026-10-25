import { describe, it, expect } from 'vitest';
import { ParameterSyncService } from '$lib/services/parameter-sync.service';

describe('ParameterSyncService', () => {
	it('normalizes backend precision and samplers while preserving integers and omission sentinels', () => {
		const result = ParameterSyncService.extractServerDefaults({
			top_p: 0.949999988079071,
			min_p: 0.009999999776482582,
			temperature: 0.800000011920929,
			top_k: 40,
			samplers: ['top_k', 'typ_p', 'top_p', 'min_p', 'temperature'],
			max_tokens: -1
		} as ApiLlamaCppServerProps['default_generation_settings']['params']);

		expect(result.top_p).toBe(0.95);
		expect(result.min_p).toBe(0.01);
		expect(result.temperature).toBe(0.8);
		expect(result.top_k).toBe(40);
		expect(result.samplers).toBe('top_k;typ_p;top_p;min_p;temperature');
		expect(result.max_tokens).toBe(-1);
	});

	it('extracts typed webui settings without importing an unsupported theme', () => {
		const result = ParameterSyncService.extractServerDefaults(null, {
			pasteLongTextToFileLen: 0,
			pdfAsImage: true,
			renderUserContentAsMarkdown: false,
			renderReasoningContentAsMarkdown: true,
			showSystemMessage: false,
			theme: 'dark'
		});

		expect(result.pasteLongTextToFileLen).toBe(0);
		expect(result.pdfAsImage).toBe(true);
		expect(result.renderUserContentAsMarkdown).toBe(false);
		expect(result.renderReasoningContentAsMarkdown).toBe(true);
		expect(result.theme).toBeUndefined();
		expect(result.showSystemMessage).toBe(false);
		expect(ParameterSyncService.canSyncParameter('showSystemMessage')).toBe(true);
		expect(ParameterSyncService.validateServerParameter('showSystemMessage', false)).toBe(true);
		expect(ParameterSyncService.validateServerParameter('showSystemMessage', 'false')).toBe(false);
	});
});
