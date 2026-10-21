import { describe, it, expect } from 'vitest';
import { createCapabilitySnapshot } from '$lib/services/providers/provider-capabilities';
import { getApiProvider } from '$lib/services/providers';
import { resolveReasoning } from '$lib/services/providers/reasoning';

// Explicit opt-in; normal unit suite never contacts a backend or runs inference.
const base = process.env.LLAMPART_LIVE_REASONING_URL;
describe.skipIf(!base)('isolated local llama-server reasoning contract (real backend)', () => {
	it('verifies current capabilities and accepts only a confirmed serialized control', async () => {
		const response = await fetch(`${base}/props`, { signal: AbortSignal.timeout(15000) });
		expect(response.ok).toBe(true);
		const props = await response.json();
		const capabilities = await createCapabilitySnapshot(
			{ providerId: 'llama-server', serverBaseUrl: base!, apiKey: '', sourceGeneration: 0 },
			null,
			props
		);
		const reasoning = capabilities.reasoning!;
		console.log('REAL BACKEND', props.build_info, props.model_alias, 'effort', reasoning.effort);
		const prompts = new Set<string>();
		let serialized: string | undefined;
		for (const value of (reasoning.effort.values ?? []).slice(0, 8)) {
			const request = getApiProvider('llama-server').buildChatCompletionRequest({
				serverBaseUrl: base!,
				apiKey: '',
				capabilities,
				messages: [{ role: 'user', content: 'Reply with OK.' }],
				options: { stream: false, max_tokens: 8, reasoning: { mode: 'effort', value } }
			});
			const body = String(request.init.body);
			expect(JSON.parse(body).chat_template_kwargs).toEqual(
				resolveReasoning(reasoning, { mode: 'effort', value }).parameters.chat_template_kwargs
			);
			const rendered = await fetch(`${base}/apply-template`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				signal: AbortSignal.timeout(15000)
			});
			expect(rendered.ok).toBe(true);
			prompts.add((await rendered.json()).prompt);
			serialized ??= body;
			console.log('REAL TEMPLATE', props.build_info, value, JSON.parse(body).chat_template_kwargs);
		}
		if (serialized) {
			expect(prompts.size).toBeGreaterThan(1); // 200 alone is not evidence of use.
			const invalid = await fetch(`${base}/apply-template`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					messages: [{ role: 'user', content: 'Reply with OK.' }],
					chat_template_kwargs: { reasoning_effort: '__llampart_invalid_effort__' }
				}),
				signal: AbortSignal.timeout(15000)
			});
			expect(invalid.ok).toBe(false);
		} else {
			expect(resolveReasoning(reasoning, { mode: 'effort', value: 'low' }).available).toBe(false);
			const intent = resolveReasoning(reasoning, { mode: 'off' }).available
				? { mode: 'off' as const }
				: { mode: 'default' as const };
			serialized = String(
				getApiProvider('llama-server').buildChatCompletionRequest({
					serverBaseUrl: base!,
					apiKey: '',
					capabilities,
					messages: [{ role: 'user', content: 'Reply with OK.' }],
					options: { stream: false, max_tokens: 8, reasoning: intent }
				}).init.body
			);
			console.log(
				'REAL EFFORT GENERATION NOT VERIFIED: current model does not publish discoverable levels; testing',
				intent
			);
		}
		const generated = await fetch(`${base}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: serialized,
			signal: AbortSignal.timeout(90000)
		});
		const result = await generated.json();
		expect(generated.ok, JSON.stringify(result)).toBe(true);
		expect(result.choices).toHaveLength(1);
		console.log(
			'REAL GENERATION accepted',
			JSON.parse(serialized!).chat_template_kwargs ?? 'Default/Auto',
			'tokens',
			result.usage?.completion_tokens
		);
	}, 120000);
});
