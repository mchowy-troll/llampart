import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import StatisticTooltip from '../fixtures/StatisticTooltip.svelte';

describe('statistic tooltip shared trigger', () => {
	it.each(['native', 'provider'] as const)(
		'renders single triggers throughout %s statistics',
		(statistics) => {
			const { body } = render(StatisticTooltip, { props: { statistics } });
			expect(body.match(/<button\b/g)).toHaveLength(5);
			const tags = body.match(/<\/?button\b[^>]*>/g) ?? [];
			let depth = 0;
			for (const tag of tags) {
				depth += tag.startsWith('</') ? -1 : 1;
				expect(depth).toBeGreaterThanOrEqual(0);
				expect(depth).toBeLessThanOrEqual(1);
			}
			expect(depth).toBe(0);
		}
	);
	it.each([undefined, 'Generation speed'])(
		'renders one badge button with tooltip %s',
		(tooltipLabel) => {
			const { body } = render(StatisticTooltip, { props: { tooltipLabel } });
			expect(body.match(/<button\b/g)).toHaveLength(1);
			expect(body).toContain('12 t/s');
			expect(body).toContain('gap-1 rounded-sm');
			if (tooltipLabel) expect(body).toContain('data-tooltip-trigger');
		}
	);
});
