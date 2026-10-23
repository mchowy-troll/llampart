import { chartPalette } from '$lib/themes/frosted-glass/chart-palette';
import { diagramInk } from './mermaid-presentation';

export interface GroupNode {
	id: string;
	domId?: string;
	parentId?: string;
	isGroup?: boolean;
	shape?: string;
}

/** Explicit parser groups determine colors; diamonds use the adjacent palette
 * slot to distinguish decisions. Ungrouped steps keep the first color.
 * No guesses from labels or error names. */
export function diagramGroupColors(nodes: GroupNode[], order?: string[]): Map<string, string> {
	const palette = chartPalette();
	const groups = nodes.filter((node) => node.isGroup);
	if (order) groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
	const colors = new Map(groups.map((node, i) => [node.id, palette[i % palette.length]]));
	const result = new Map(
		nodes
			.filter((node) => !node.isGroup && node.domId && (node.parentId || node.shape === 'diamond'))
			.map((node) => {
				const group = colors.get(node.parentId || '') || palette[0];
				return [
					node.domId!,
					node.shape === 'diamond' ? palette[(palette.indexOf(group) + 1) % palette.length] : group
				];
			})
	);
	for (const group of groups) result.set(group.domId || group.id, colors.get(group.id)!);
	return result;
}

/** Change paint only, not paths, labels, positions or graph relationships.
 * IDs are matched as strings, never interpolated into selectors or CSS. */
export function paintDiagramGroups(
	svg: SVGSVGElement,
	renderId: string,
	colors: Map<string, string>
) {
	for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
		const color = colors.get(node.id.slice(renderId.length + 1));
		if (!color) continue;
		if (node.id.includes('-state-') && !node.classList.contains('statediagram-state')) continue;
		for (const shape of node.querySelectorAll<SVGElement>(
			':scope > rect,:scope > polygon,:scope > circle,:scope > ellipse,:scope > path,:scope > .basic'
		)) {
			shape.style.setProperty('fill', color);
			shape.style.setProperty('stroke', color);
		}
		for (const text of node.querySelectorAll<SVGElement>('text,tspan'))
			text.style.setProperty('fill', diagramInk(color), 'important');
	}
	for (const group of svg.querySelectorAll<SVGGElement>('g.cluster,g.statediagram-cluster')) {
		const color = colors.get(group.id.slice(renderId.length + 1));
		if (!color) continue;
		if (group.classList.contains('statediagram-cluster')) {
			// One translucent surface, like flowchart groups; no separate title strip.
			// Scope to this composite so nested groups and state nodes keep their paint.
			for (const rect of group.querySelectorAll<SVGRectElement>(
				':scope > g > rect.outer,:scope > rect.inner'
			)) {
				const inner = rect.classList.contains('inner');
				rect.style.fill = inner ? 'none' : color + '0C';
				rect.style.stroke = inner ? 'none' : color + '66';
			}
		} else {
			for (const rect of group.querySelectorAll<SVGRectElement>('rect')) {
				rect.style.fill = rect.classList.contains('inner') ? '#f5f6f5' : color + '0C';
				rect.style.stroke = color + '66';
			}
		}
	}
}
