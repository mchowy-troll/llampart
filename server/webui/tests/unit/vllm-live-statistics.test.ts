import { afterEach, describe, expect, it, vi } from 'vitest';
import { VllmLiveStatistics } from '$lib/utils/vllm-live-statistics';
import { getProviderStatistics } from '$lib/utils/provider-statistics';
import { getApiProvider } from '$lib/services/providers';
import { ChatService } from '$lib/services/chat.service';
import { settingsStore } from '$lib/stores/settings.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import type { ChatMessageTimings } from '$lib/types/chat';

const original = { ...settingsStore.config };
afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.updateMultipleConfig(original);
	modelsStore.clear();
	vi.unstubAllGlobals();
});
const usage = (completionTokens: number) => ({ usage: { completionTokens } });

describe('request-scoped vLLM live rate', () => {
	it('uses cumulative counters after prefill, including reasoning, without summing snapshots', () => {
		const tracker = new VllmLiveStatistics();
		expect(tracker.observe(usage(0), 0)).toBeUndefined();
		expect(tracker.observe(usage(1), 10000)).toBeUndefined();
		expect(tracker.observe(usage(11), 11000)?.value).toBe(10);
		expect(tracker.observe(usage(11), 11500)?.value).toBe(10);
		expect(
			tracker.observe({ usage: { completionTokens: 31, reasoningTokens: 25 } }, 12000)
		).toMatchObject({ value: 15, source: 'browser', name: 'liveTokensPerSecond' });
	});
	it.each([undefined, 0, 100])(
		'does not invent a rate from missing or a single terminal counter %s',
		(count) => {
			const tracker = new VllmLiveStatistics();
			tracker.observe({ content: 'lots of visible text' }, 0);
			expect(tracker.observe({ usage: { completionTokens: count } }, 10000)).toBeUndefined();
		}
	);
	it.each([0, 1.5, NaN])(
		'invalidates unreliable counter %s rather than producing fake speed',
		(count) => {
			const tracker = new VllmLiveStatistics();
			tracker.observe(usage(1), 100);
			tracker.observe(usage(11), 1100);
			expect(tracker.observe(usage(count), 1200)).toBeUndefined();
			expect(tracker.observe(usage(100), 2200)).toBeUndefined();
		}
	);
	it('requires positive observation time and rejects a backwards clock', () => {
		const tracker = new VllmLiveStatistics();
		tracker.observe(usage(1), 100);
		expect(tracker.observe(usage(2), 100)).toBeUndefined();
		expect(tracker.observe(usage(4), 99)).toBeUndefined();
	});
	it('prefers the final backend rate and marks only the live measurement approximate', () => {
		const live = new VllmLiveStatistics();
		live.observe(usage(1), 0);
		const metric = live.observe(usage(11), 1000)!;
		expect(
			getProviderStatistics({ usage: { completionTokens: 11 }, metrics: [metric] }, 'generation')
		).toMatchObject({ tokens: 11, tokensPerSecond: 10, approximate: true });
		expect(
			getProviderStatistics(
				{
					metrics: [
						metric,
						{
							name: 'tokensPerSecond',
							source: 'backend',
							unit: 'tokens/s',
							available: true,
							value: 20
						}
					]
				},
				'generation'
			)
		).toMatchObject({ tokensPerSecond: 20 });
		expect(getProviderStatistics({ metrics: [metric] }, 'reading').tokensPerSecond).toBeUndefined();
	});
	it('adds continuous usage only to streaming vLLM Chat and protects stream_options', () => {
		const input = {
			serverBaseUrl: 'http://localhost:8000',
			apiKey: '',
			messages: [{ role: 'user' as const, content: 'hi' }],
			options: { model: 'exact', stream: true }
		};
		const body = (id: string, stream: boolean) =>
			JSON.parse(
				String(
					getApiProvider(id).buildChatCompletionRequest({
						...input,
						options: { ...input.options, stream }
					}).init.body
				)
			);
		expect(body('vllm', true).stream_options).toEqual({
			include_usage: true,
			continuous_usage_stats: true
		});
		expect(body('openai-compatible', true).stream_options).toEqual({ include_usage: true });
		expect(body('vllm', false)).not.toHaveProperty('stream_options');
		expect(() =>
			getApiProvider('vllm').buildChatCompletionRequest({
				...input,
				options: { ...input.options, custom: '{"stream_options":{"continuous_usage_stats":false}}' }
			})
		).toThrow('protected');
	});
});

describe('realistic vLLM SSE fixture through ChatService', () => {
	it.each(['missing', 'final-only', 'decreasing', 'broken', 'aborted'] as const)(
		'handles %s counters/stream without a fabricated terminal success',
		async (mode) => {
			settingsStore.updateMultipleConfig({
				apiProvider: 'vllm',
				serverBaseUrl: 'http://localhost:8000',
				apiKey: ''
			});
			const controller = new AbortController();
			const complete = vi.fn();
			const timings = vi.fn(() => {
				if (mode === 'aborted') controller.abort();
			});
			const chunk = (count?: number) => ({
				choices: [{ index: 0, delta: { content: 'x' } }],
				...(count === undefined
					? {}
					: { usage: { prompt_tokens: 10, completion_tokens: count, total_tokens: 10 + count } })
			});
			const records =
				mode === 'missing' || mode === 'final-only' ? [chunk(), chunk()] : [chunk(10), chunk(5)];
			if (mode === 'final-only')
				records.push({
					choices: [],
					usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
				});
			const text =
				records.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('') +
				(mode === 'broken'
					? 'data: {"error":{"message":"generation failed"}}\n\n'
					: 'data: [DONE]\n\n');
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text)));
			const expectedLog = [
				'Error in sendMessage:',
				'StreamProtocolError',
				'Failed to parse provider stream data'
			];
			const originalError = console.error;
			const errorLog =
				mode === 'broken'
					? vi.spyOn(console, 'error').mockImplementation((...args) => {
							if (
								args.length !== expectedLog.length ||
								args.some((arg, i) => arg !== expectedLog[i])
							)
								originalError(...args);
						})
					: undefined;
			const pending = ChatService.sendMessage(
				[{ role: 'user', content: 'hi' }],
				{ model: 'exact', stream: true, onComplete: complete, onTimings: timings },
				undefined,
				controller.signal
			);
			if (mode === 'broken') {
				await expect(pending).rejects.toMatchObject({
					name: 'StreamProtocolError',
					message: 'Failed to parse provider stream data'
				});
				expect(errorLog).toHaveBeenCalledExactlyOnceWith(...expectedLog);
			} else await pending;
			if (mode === 'broken' || mode === 'aborted') expect(complete).not.toHaveBeenCalled();
			else expect(complete).toHaveBeenCalledTimes(1);
			if (mode === 'aborted') expect(timings).toHaveBeenCalledTimes(1);
			for (const [value] of timings.mock.calls as unknown as [ChatMessageTimings][])
				expect(
					value.provider?.metrics?.some((metric) => metric.name === 'liveTokensPerSecond')
				).not.toBe(true);
		}
	);
	it('updates existing timings before completion, then uses final backend metrics', async () => {
		settingsStore.updateMultipleConfig({
			apiProvider: 'vllm',
			serverBaseUrl: 'http://localhost:8000',
			apiKey: ''
		});
		let now = 0;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({
			start(value) {
				controller = value;
			}
		});
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
			);
		vi.stubGlobal('fetch', fetch);
		const complete = vi.fn();
		const timings = vi.fn();
		const pending = ChatService.sendMessage([{ role: 'user', content: 'hi' }], {
			model: 'exact',
			stream: true,
			onComplete: complete,
			onTimings: timings
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		const emit = async (count: number, time: number, metrics?: Record<string, number>) => {
			now = time;
			const previous = timings.mock.calls.length;
			controller.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ id: 'chatcmpl-live', model: 'exact', choices: metrics ? [] : [{ index: 0, delta: { reasoning: count ? 'thought' : '' }, finish_reason: null }], usage: { prompt_tokens: 120, completion_tokens: count, total_tokens: 120 + count }, ...(metrics ? { metrics } : {}) })}\n\n`
				)
			);
			await vi.waitFor(() => expect(timings.mock.calls.length).toBeGreaterThan(previous));
		};
		await emit(0, 5000);
		await emit(1, 10000);
		await emit(11, 11000);
		await emit(11, 11500);
		await emit(31, 12000);
		expect(complete).not.toHaveBeenCalled();
		const live: ChatMessageTimings = timings.mock.calls.at(-1)![0];
		expect(getProviderStatistics(live.provider!, 'generation')).toMatchObject({
			tokens: 31,
			tokensPerSecond: 15,
			approximate: true
		});
		await emit(31, 12100, { tokens_per_second: 17.5, generation_time_ms: 1800 });
		controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
		controller.close();
		await pending;
		expect(complete).toHaveBeenCalledTimes(1);
		expect(getProviderStatistics(complete.mock.calls[0][2].provider, 'generation')).toEqual({
			tokens: 31,
			timeMs: 1800,
			tokensPerSecond: 17.5
		});
	});
	it('surfaces a continuous-usage rejection without a second POST', async () => {
		const expectedLog = [
			'Error in sendMessage:',
			'ServerError',
			'continuous_usage_stats is unsupported'
		];
		const originalError = console.error;
		const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => {
			if (args.length !== expectedLog.length || args.some((arg, i) => arg !== expectedLog[i]))
				originalError(...args);
		});
		settingsStore.updateMultipleConfig({
			apiProvider: 'vllm',
			serverBaseUrl: 'http://localhost:8000',
			apiKey: ''
		});
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: 'continuous_usage_stats is unsupported' } }),
					{ status: 400 }
				)
			);
		vi.stubGlobal('fetch', fetch);
		const complete = vi.fn();
		await expect(
			ChatService.sendMessage([{ role: 'user', content: 'hi' }], {
				model: 'exact',
				stream: true,
				onComplete: complete
			})
		).rejects.toMatchObject({
			name: 'ServerError',
			message: 'continuous_usage_stats is unsupported'
		});
		expect(errorLog).toHaveBeenCalledExactlyOnceWith(...expectedLog);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(complete).not.toHaveBeenCalled();
	});
});
