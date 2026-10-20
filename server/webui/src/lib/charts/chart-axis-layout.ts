export interface AxisMetrics {
	size: number;
	category: number;
	number: number;
}

type Measure = (text: string) => number;

/** Full text first, then a word-boundary split; ellipsis is the last resort. */
export function axisLabelLines(text: string, width: number, measure: Measure): string[] {
	if (measure(text) <= width) return [text];
	const words = text.trim().split(/\s+/);
	let best: string[] | undefined;
	let score = Infinity;
	for (let i = 1; i < words.length; i++) {
		const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
		const widest = Math.max(...pair.map(measure));
		if (widest <= width && widest < score) {
			best = pair;
			score = widest;
		}
	}
	if (best) return best;
	return [];
}

function ellipsize(text: string, width: number, measure: Measure): string {
	if (measure(text) <= width) return text;
	let result = '';
	for (const char of text) {
		if (measure(result + char + '…') > width) break;
		result += char;
	}
	return result + '…';
}

function shortenedLines(text: string, width: number, measure: Measure): string[] {
	const words = text.trim().split(/\s+/);
	let first = '';
	let index = 0;
	while (
		index < words.length &&
		measure([first, words[index]].filter(Boolean).join(' ')) <= width
	) {
		first = [first, words[index++]].filter(Boolean).join(' ');
	}
	return first && index < words.length
		? [first, ellipsize(words.slice(index).join(' '), width, measure)]
		: [ellipsize(text, width, measure)];
}

export function twoLineWidth(text: string, measure: Measure): number {
	const words = text.trim().split(/\s+/);
	return Math.min(
		measure(text),
		...words
			.slice(1)
			.map((_, i) =>
				Math.max(measure(words.slice(0, i + 1).join(' ')), measure(words.slice(i + 1).join(' ')))
			)
	);
}

interface CategoryScale {
	(value: unknown): number;
	domain(): unknown[];
	bandwidth?(): number;
}

/** Public Axis ticks/format adapter: use actual native scale positions, not a
 * character ceiling or a second data scale. Only tick visibility changes. */
export function categoryAxis(
	width: number,
	horizontal: boolean,
	padding: { left: number; right: number },
	gutter: number,
	size: number,
	measure: Measure
) {
	let labels = new Map<unknown, string>();
	return {
		ticks(scale: unknown): unknown[] {
			const s = scale as CategoryScale,
				domain = s.domain();
			const position = (v: unknown) => s(v) + (s.bandwidth?.() ?? 0) / 2;
			const gap = Math.ceil(size * 0.6);
			for (let stride = 1; stride <= Math.max(1, domain.length); stride++) {
				const values = domain.filter((_, i) => i % stride === 0 || i === domain.length - 1);
				const plan = new Map<unknown, string>();
				let fits = true;
				values.forEach((v, i) => {
					const p = position(v);
					const neighbor = Math.min(
						i ? Math.abs(p - position(values[i - 1])) : Infinity,
						i + 1 < values.length ? Math.abs(position(values[i + 1]) - p) : Infinity
					);
					const budget = horizontal
						? gutter
						: Math.max(
								1,
								Math.min(
									neighbor - gap,
									2 * (padding.left + p - gap),
									2 * (width - padding.left - p - gap)
								)
							);
					const lines = axisLabelLines(String(v), budget, measure);
					if (!lines.length || (horizontal && neighbor < lines.length * size * 1.5 + gap))
						fits = false;
					plan.set(
						v,
						(lines.length ? lines : shortenedLines(String(v), budget, measure)).join('\n')
					);
				});
				labels = plan;
				if (fits || values.length <= 2) return values;
			}
			return domain;
		},
		format: (value: unknown) => labels.get(value) ?? String(value)
	};
}

/** Cartesian label budgets in measured plot-font pixels. Reserve bounded gutters
 * and thin ticks, rather than prematurely truncating text or removing limits. */
export function chartAxisLayout(
	width: number,
	horizontal: boolean,
	metrics: AxisMetrics,
	xTitle = false,
	yTitle = false,
	labels: string[] = [],
	measure: Measure = () => 0,
	rows = 1
) {
	const gap = Math.ceil(metrics.size * 0.6);
	const needed = labels.length
		? Math.max(...labels.map((s) => twoLineWidth(s, measure)))
		: metrics.category;
	const categoryWidth = Math.min(needed + gap * 2, width * 0.4);
	// Native "nice" domain ticks may be one digit wider than the input extrema.
	const numberWidth = metrics.number + metrics.size;
	const xTickWidth = horizontal ? numberWidth : categoryWidth;
	const yTickWidth = horizontal ? categoryWidth : numberWidth;
	const padding = {
		left: Math.ceil(
			Math.max(
				yTickWidth + gap + metrics.size * (yTitle ? 2.5 : 0.6),
				horizontal
					? 0
					: Math.min(width * 0.25, (labels[0] ? twoLineWidth(labels[0], measure) : 0) / 2 + gap)
			)
		),
		bottom: Math.ceil(metrics.size * (rows * 1.5 + (xTitle ? 3 : 1)) + gap),
		top: Math.ceil(metrics.size * 1.5),
		right: Math.ceil(xTickWidth / 2 + gap)
	};
	return {
		gap,
		categoryWidth,
		numberWidth,
		xTickWidth,
		yTickWidth,
		padding,
		ticks: Math.max(
			2,
			Math.min(
				6,
				Math.floor((width - padding.left - padding.right) / Math.max(1, xTickWidth + gap * 2))
			)
		)
	};
}
