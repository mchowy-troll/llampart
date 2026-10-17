import type { MermaidConfig } from 'mermaid';
import { chartPalette } from '$lib/themes/frosted-glass/chart-palette';
import { MAX_DIAGRAM_EDGES, MAX_DIAGRAM_SOURCE } from './mermaid-policy';

export interface DiagramTypography {
	family: string;
	size: number;
	weight: string;
	style: string;
	color: string;
}

export function diagramTypography(element: HTMLElement): DiagramTypography {
	const css = getComputedStyle(element);
	return {
		family: css.fontFamily,
		size: parseFloat(css.fontSize),
		weight: css.fontWeight,
		style: css.fontStyle,
		color: css.color
	};
}

/** Opaque, gently softened data fills keep contrast independent of wallpaper.
 * These are derived from the shared palette, not a second set of data colors. */
export function diagramFill(color: string, white = 0.16): string {
	return (
		'#' +
		[1, 3, 5]
			.map((i) =>
				Math.round(parseInt(color.slice(i, i + 2), 16) * (1 - white) + 255 * white)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}
export function diagramLuminance(color: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const value = parseInt(color.slice(i, i + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function diagramInk(fill: string): string {
	const lightness = diagramLuminance(fill);
	if (1.05 / (lightness + 0.05) >= 4.5) return '#ffffff';
	return (lightness + 0.05) / (diagramLuminance('#111111') + 0.05) >= 4.5 ? '#111111' : '#000000';
}

/** No wallpaper-derived data colors and no second palette. Color families are
 * assigned to semantic groups by Mermaid (branches/sections), never numeric ranks.
 */
export function diagramConfig(
	font: DiagramTypography,
	curve: 'rounded' | 'basis' = 'rounded'
): MermaidConfig {
	const colors = chartPalette();
	const fill = (i: number) => diagramFill(colors[i]);
	const ink = (i: number) => diagramInk(fill(i));
	const unit = (multiple: number) => Math.ceil(font.size * multiple);
	const variables: Record<string, string | number> = {
		THEME_COLOR_LIMIT: colors.length,
		fontFamily: font.family,
		fontSize: `${font.size}px`,
		textColor: font.color,
		titleColor: font.color,
		primaryColor: colors[0],
		primaryBorderColor: colors[0],
		primaryTextColor: diagramInk(colors[0]),
		secondaryColor: fill(1),
		secondaryBorderColor: colors[1],
		secondaryTextColor: ink(1),
		tertiaryColor: fill(2),
		tertiaryBorderColor: colors[2],
		tertiaryTextColor: ink(2),
		lineColor: font.color,
		background: 'transparent',
		mainBkg: colors[0],
		nodeBorder: colors[0],
		clusterBkg: colors[1] + '12',
		clusterBorder: colors[1] + '66',
		compositeBackground: '#f5f6f5',
		altBackground: '#f5f6f5',
		compositeTitleBackground: colors[0],
		edgeLabelBackground: 'transparent',
		noteBkgColor: fill(3),
		noteBorderColor: colors[3],
		noteTextColor: ink(3),
		taskBkgColor: fill(0),
		taskBorderColor: colors[0],
		taskTextColor: ink(0),
		taskTextLightColor: ink(5),
		taskTextDarkColor: ink(2),
		taskTextOutsideColor: font.color,
		activeTaskBkgColor: fill(1),
		activeTaskBorderColor: colors[1],
		doneTaskBkgColor: fill(2),
		doneTaskBorderColor: colors[2],
		critBkgColor: fill(5),
		critBorderColor: colors[5],
		gridColor: colors[8] + '22',
		sectionBkgColor: colors[8] + '08',
		altSectionBkgColor: 'transparent',
		sectionBkgColor2: colors[8] + '08',
		labelColor: font.color
	};
	colors.forEach((color, i) => {
		variables[`cScale${i}`] = diagramFill(color);
		variables[`cScaleLabel${i}`] = diagramInk(diagramFill(color));
		variables[`cScaleInv${i}`] = color;
	});
	return {
		startOnLoad: false,
		securityLevel: 'strict',
		suppressErrorRendering: true,
		htmlLabels: false,
		layout: 'elk',
		elk: {
			mergeEdges: false,
			nodePlacementStrategy: 'NETWORK_SIMPLEX',
			straightenEdges: true,
			keepEntryNodeOnTop: true
		},
		look: 'classic',
		theme: 'base',
		fontFamily: font.family,
		fontSize: font.size,
		maxTextSize: MAX_DIAGRAM_SOURCE,
		maxEdges: MAX_DIAGRAM_EDGES,
		secure: [
			'securityLevel',
			'startOnLoad',
			'maxTextSize',
			'maxEdges',
			'theme',
			'themeVariables',
			'themeCSS',
			'htmlLabels',
			'fontFamily'
		],
		themeVariables: variables,
		themeCSS: `text,tspan,.nodeLabel,.label{font-family:${font.family}!important;font-size:${font.size}px!important;font-weight:${font.weight}!important;font-style:${font.style}!important;font-synthesis:none;text-shadow:none}
		.node rect{rx:8px;ry:8px;stroke-width:1px}
		.node polygon,.node circle{stroke-width:1px}
		.section-root rect,.section-root path{fill:${colors[0]}!important;stroke:none}
		.section-root text,.section-root tspan{fill:${diagramInk(colors[0])}!important}
		.edge[class*="edge-depth-"]{stroke-width:${Math.max(4.5, font.size * 0.3)}px;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
		.flowchart-link,.transition{stroke-width:1.5px;stroke-linecap:round;stroke-linejoin:round}
		.edgeLabel .label rect.background,.edgeLabel .labelBkg,.edgeLabel rect{fill:transparent!important;stroke:none!important;opacity:0!important}
		.edgeLabel text,.edgeLabel tspan{stroke:none!important;fill:${font.color}}
		.grid .tick line{stroke:${font.color};stroke-opacity:.1} .grid path{stroke-width:0}
		.task{rx:5px;ry:5px;stroke-width:0}
		.taskText{dominant-baseline:auto}
		${colors
			.map(
				(
					color,
					i
				) => `.task${i},.active${i},.done${i},.crit${i},.doneCrit${i},.activeCrit${i}{fill:${color}!important;stroke:${color}!important}
		.taskText${i},.activeText${i},.doneText${i},.critText${i},.doneCritText${i},.activeCritText${i}{fill:${diagramInk(color)}!important}
		.section${i}{fill:${color};fill-opacity:.045}
		.sectionTitle${i}{fill:${font.color}}`
			)
			.join('\n')}
		[class*="taskTextOutside"]{fill:${font.color}!important}
		.sectionTitle{font-weight:${font.weight}!important}`,
		flowchart: {
			htmlLabels: false,
			curve,
			padding: unit(1.4),
			diagramPadding: unit(1.5),
			nodeSpacing: unit(3.5),
			rankSpacing: unit(6),
			wrappingWidth: unit(15),
			useMaxWidth: false
		},
		gantt: {
			useMaxWidth: false,
			displayMode: '',
			numberSectionStyles: colors.length,
			fontSize: font.size,
			sectionFontSize: font.size,
			barHeight: unit(2.2),
			barGap: unit(1.1),
			topPadding: unit(4),
			leftPadding: Math.ceil(font.size * 12),
			rightPadding: Math.ceil(font.size * 8)
		},
		state: {
			useMaxWidth: false,
			minNodeWidth: Math.max(120, unit(7)),
			padding: unit(1.4),
			nodeSpacing: unit(5),
			rankSpacing: unit(6),
			noteMargin: unit(1.5),
			radius: 8,
			wrappingWidth: unit(15)
		},
		mindmap: { useMaxWidth: false, padding: unit(1.7) }
	};
}

/** Render-local presentation only; the stored Markdown remains untouched.
 * Mermaid's native rounded root is measured before layout, not swapped in SVG. */
export function mindmapPresentationSource(source: string): string {
	let header = false,
		root = false;
	return source
		.split('\n')
		.map((line) => {
			if (root) return line;
			if (!line.trim() || /^\s*%%/.test(line)) return line;
			if (!header) {
				header = true;
				return line;
			}
			if (header) {
				root = true;
				// Stop after the root, even if its declaration needs no change.
				const shaped =
					/^(\s*[^()[\]{}]*?)(\(\(|\)\)|\(-|\{\{|\[|\()(.*?)(\)\)|\(\(|-\)|\}\}|\]|\))\s*$/.exec(
						line
					);
				return shaped ? `${shaped[1]}(${shaped[3]})` : `(${line.trim()})`;
			}
			return line;
		})
		.join('\n');
}

/** Native state edges support explicit line breaks. Insert one balanced break
 * only into plain transition labels, before Mermaid measures and routes them.
 * User HTML is still rejected by the source boundary. */
export function statePresentationSource(source: string, measure: (text: string) => number): string {
	return source.replace(
		/^([^\r\n:]*-->[^\r\n:]*:[\t ]*)([^\r\n]+)$/gm,
		(line, prefix: string, label: string) => {
			if (/[;"`<>]/.test(label)) return line;
			const words = label.trim().split(/\s+/);
			if (words.length < 2 || words.length > 12) return line;
			let split = 1,
				best = Infinity;
			for (let i = 1; i < words.length; i++) {
				const score = Math.max(
					measure(words.slice(0, i).join(' ')),
					measure(words.slice(i).join(' '))
				);
				if (score < best) {
					best = score;
					split = i;
				}
			}
			return prefix + words.slice(0, split).join(' ') + '<br/>' + words.slice(split).join(' ');
		}
	);
}

/** Correct the native minimum-width State label offset using real text metrics.
 * No node/edge coordinates, state shapes or marker ports are changed. */
export function centerStateLabels(svg: SVGSVGElement) {
	for (const node of svg.querySelectorAll<SVGGElement>('g.node.statediagram-state')) {
		const shape = node.querySelector<SVGGraphicsElement>(':scope > rect.basic');
		const label = node.querySelector<SVGGElement>(':scope > g.label');
		const text = label?.querySelector('text');
		const inverse = node.getScreenCTM()?.inverse();
		if (!shape || !label || !text || !inverse) continue;
		const a = shape.getBoundingClientRect(),
			b = text.getBoundingClientRect();
		const target = new DOMPoint(a.x + a.width / 2, a.y + a.height / 2).matrixTransform(inverse);
		const actual = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(inverse);
		label.setAttribute(
			'transform',
			`translate(${target.x - actual.x},${target.y - actual.y}) ${label.getAttribute('transform') || ''}`
		);
	}
}

/** Mindmap hardcodes basis and exposes no curve option. Keep native layout and
 * endpoints, replacing each branch's late elbow with one continuous cubic arc.
 * Control points remain inside the endpoint bounds, so the viewport is intact. */
export function softenMindmapBranches(svg: SVGSVGElement) {
	// Mermaid's default rectangular node adds a separate decorative underline.
	// Remove only that accent, retaining the rounded shape and all branch paths.
	for (const line of svg.querySelectorAll('.mindmap-node > line.node-line-')) line.remove();
	for (const path of svg.querySelectorAll<SVGPathElement>('path.edge[class*="edge-depth-"]')) {
		const a = path.getPointAtLength(0),
			b = path.getPointAtLength(path.getTotalLength());
		const dx = b.x - a.x,
			dy = b.y - a.y;
		path.setAttribute(
			'd',
			`M${a.x},${a.y}C${a.x + dx * 0.15},${a.y + dy * 0.55} ${b.x - dx * 0.15},${b.y - dy * 0.55} ${b.x},${b.y}`
		);
	}
}
