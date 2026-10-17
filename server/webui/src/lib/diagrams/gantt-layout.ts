import type { DiagramTypography } from './mermaid-presentation';

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

/** Native Gantt has a fixed 5px outside-label gap, even for rotated milestones.
 * Enforce one measured typographic clearance, only when that gap is too small.
 * Dates, bars, rows and milestone geometry remain entirely native. */
export function spaceGanttLabels(svg: SVGSVGElement, fontSize: number) {
	for (const text of svg.querySelectorAll<SVGTextElement>(
		'text.taskTextOutsideLeft,text.taskTextOutsideRight'
	)) {
		const bar = svg.getElementById(text.id.replace(/-text$/, '')) as SVGGraphicsElement | null;
		const matrix = text.getScreenCTM();
		if (!bar || !matrix) continue;
		const a = bar.getBoundingClientRect(),
			b = text.getBoundingClientRect();
		const right = text.classList.contains('taskTextOutsideRight');
		const scale = Math.hypot(matrix.a, matrix.b);
		const missing = fontSize * scale * 0.6 - (right ? b.left - a.right : a.left - b.right);
		if (missing <= 0) continue;
		text.setAttribute('dx', String((right ? missing : -missing) / scale));
	}
}
