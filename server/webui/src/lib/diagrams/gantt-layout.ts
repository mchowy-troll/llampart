import type { DiagramTypography } from './mermaid-presentation';

/** Gantt-only readability exception to the shared donut label size. */
export const GANTT_LABEL_SIZE_INCREMENT = 1;

export interface ScheduleTask {
	task: string;
	section: string;
	startTime: Date;
	endTime: Date;
}

/** Presentation only. Dates/durations/dependencies are resolved by Mermaid's
 * own parser, never by a second schedule engine. Reserve space before layout,
 * including enough room for native outside-bar labels at the end of the axis. */
export function ganttLayout(
	tasks: ScheduleTask[],
	font: DiagramTypography,
	measure: (text: string) => number
) {
	const label = Math.max(font.size * 8, ...tasks.map((task) => measure(task.task.trim())));
	const section = Math.max(font.size * 6, ...tasks.map((task) => measure(task.section)));
	const left = Math.ceil(section + font.size * 3);
	const right = Math.ceil(label + font.size * 3);
	const timeline = Math.max(1200, font.size * 80);
	const start = Math.min(...tasks.map((task) => +task.startTime));
	const end = Math.max(...tasks.map((task) => +task.endTime));
	const span = Math.max(1, end - start);
	const day = 86400000;
	const format =
		span < 2 * day
			? '%d.%m %H:%M'
			: span < 100 * day
				? '%d.%m'
				: span < 3 * 365 * day
					? '%m.%Y'
					: '%Y';
	const examples = span < 2 * day ? ['30.12 23:59'] : span < 100 * day ? ['30.12'] : ['12.2026'];
	const tickWidth = Math.max(...examples.map(measure)) + font.size * 3;
	const count = Math.max(2, Math.floor(timeline / tickWidth));
	const candidates: [number, string][] = [
		[60000, 'minute'],
		[3600000, 'hour'],
		[day, 'day'],
		[7 * day, 'week'],
		[30 * day, 'month']
	];
	const minimum = span >= 100 * day ? 30 * day : span >= 2 * day ? day : 60000;
	const eligible = candidates.filter(([duration]) => duration >= minimum);
	const [duration, unit] =
		[...eligible].reverse().find(([duration]) => span / count >= duration) || eligible[0];
	const rawEvery = Math.max(1, Math.ceil(span / count / duration));
	// A year-only format must not repeat the same year on multiple month ticks.
	const every = span >= 3 * 365 * day ? Math.ceil(rawEvery / 12) * 12 : rawEvery;
	const width = Math.ceil(left + timeline + right);
	if (!Number.isFinite(width) || width > 12000 || !Number.isFinite(start) || !Number.isFinite(end))
		throw new Error('Schedule layout limit');
	return { left, right, width, format, interval: `${every}${unit}` };
}

/** Override presentation directives in a render-local copy only. The original
 * Markdown (including task names, dates, milestones and dependencies) is intact. */
export function ganttPresentationSource(
	source: string,
	plan: ReturnType<typeof ganttLayout>
): string {
	return (
		source.replace(
			/^[\t ]*(?:axisFormat|tickInterval|todayMarker|title)[\t ]+[^\r\n]*(?:\r?\n|$)/gm,
			''
		) + `\naxisFormat ${plan.format}\ntickInterval ${plan.interval}\ntodayMarker off\n`
	);
}

/** Keep the first/last calendar ticks and only interior labels that actually fit.
 * Inputs are measured SVG text boxes, not estimates based on date duration. */
export function ganttTickIndices(boxes: { left: number; right: number }[], gap: number): number[] {
	if (boxes.length < 2) return boxes.map((_, i) => i);
	const last = boxes.length - 1;
	const kept = [0];
	for (let i = 1; i < last; i++) {
		if (
			boxes[i].left >= boxes[kept[kept.length - 1]].right + gap &&
			boxes[i].right + gap <= boxes[last].left
		)
			kept.push(i);
	}
	// An extremely narrow axis cannot display both endpoints without overlap.
	if (boxes[last].left >= boxes[0].right + gap) kept.push(last);
	return kept;
}

/** All task names use the existing outside-label style and one typographic gap.
 * The pre-layout right margin accommodates the longest name, including a task
 * ending on the final date. Native dates, bars and row assignments are intact. */
export function spaceGanttLabels(svg: SVGSVGElement, fontSize: number, availableWidth?: number) {
	for (const text of svg.querySelectorAll<SVGTextElement>('text[id$="-text"]')) {
		const bar = svg.getElementById(text.id.replace(/-text$/, '')) as SVGGraphicsElement | null;
		const matrix = text.getScreenCTM();
		if (!bar || !matrix) continue;
		const a = bar.getBoundingClientRect();
		const scale = Math.hypot(matrix.a, matrix.b);
		const position = new DOMPoint(a.right + fontSize * scale * 0.6, a.y).matrixTransform(
			matrix.inverse()
		);
		text.setAttribute('x', String(position.x));
		text.setAttribute('dx', '0');
		text.setAttribute('text-anchor', 'start');
		// Keep Mermaid's role-specific outside ink rather than bar-contrast ink.
		text.setAttribute('class', 'taskTextOutsideRight');
	}

	for (const axis of svg.querySelectorAll<SVGGElement>('g.grid')) {
		const ticks = [...axis.querySelectorAll<SVGGElement>('.tick')];
		const texts = ticks.map((tick) => tick.querySelector('text'));
		if (texts.some((text) => !text)) continue;
		const scale = Math.hypot(svg.getScreenCTM()?.a || 1, svg.getScreenCTM()?.b || 0);
		// The engine measures offscreen at native size. Reserve a readable gap
		// after the SVG is fitted into the actual message container as well.
		const fit =
			availableWidth && availableWidth > 0
				? Math.min(1, availableWidth / svg.viewBox.baseVal.width)
				: 1;
		const kept = new Set(
			ganttTickIndices(
				texts.map((text) => text!.getBoundingClientRect()),
				(fontSize * scale * 0.6) / fit
			)
		);
		for (let i = 0; i < ticks.length; i++) {
			if (!kept.has(i)) ticks[i].remove();
			else texts[i]!.setAttribute('dy', `${fontSize * 1.2}`);
		}
	}
}
