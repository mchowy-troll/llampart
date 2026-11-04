import { diagramType, verifiedDiagramSvg } from './mermaid-policy';
import {
	diagramConfig,
	centerStateLabels,
	mindmapPresentationSource,
	statePresentationSource,
	finishMindmapPresentation,
	flowchartSectionPresentation,
	stateSectionPresentation,
	edgeLabelTypography,
	type DiagramTypography
} from './mermaid-presentation';
import {
	ganttLayout,
	GANTT_LABEL_SIZE_INCREMENT,
	ganttPresentationSource,
	spaceGanttLabels,
	type ScheduleTask
} from './gantt-layout';
import { diagramGroupColors, paintDiagramGroups, type GroupNode } from './diagram-groups';
import { spaceEdgeLabels } from './edge-label-layout';
import { MINDMAP_LAYOUT } from './mindmap-layout';

let engine: Promise<typeof import('mermaid')> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let serial = 0;

/** Mermaid has global mutable configuration. Serialize config + layout together;
 * queued cancelled jobs never load/render, active stale jobs never reach the UI.
 */
export function renderDiagram(
	source: string,
	typography: DiagramTypography,
	signal: AbortSignal,
	curve: 'rounded' | 'basis' = 'rounded',
	availableWidth?: number
): Promise<string> {
	const type = diagramType(source);
	const font =
		type === 'gantt'
			? {
					...typography,
					labelSize: typography.labelSize ?? typography.size,
					size: (typography.labelSize ?? typography.size) + GANTT_LABEL_SIZE_INCREMENT
				}
			: typography;
	const job = queue.then(async () => {
		signal.throwIfAborted();
		engine ??= import('mermaid');
		const { default: mermaid } = await engine;
		signal.throwIfAborted();
		await document.fonts.load(`${font.style} ${font.weight} ${font.size}px ${font.family}`, source);
		if (type === 'flowchart')
			await document.fonts.load(`${font.style} 700 ${font.size}px ${font.family}`, source);
		await document.fonts.ready;
		signal.throwIfAborted();
		const host = document.createElement('div');
		host.style.cssText =
			'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
		host.style.fontFamily = font.family;
		host.style.fontWeight = font.weight;
		host.style.fontStyle = font.style;
		host.style.fontSize = `${font.size}px`;
		// Gantt reads its parent width while laying out the time axis. A hidden
		// shrink-to-fit host otherwise collapses its dates into a narrow strip.
		host.style.width = `${Math.max(1200, font.size * 80)}px`;
		host.setAttribute('aria-hidden', 'true');
		document.body.append(host);
		try {
			const config = diagramConfig(font, curve);
			// Native shared ports give terminal transitions a single aligned entry;
			// ELK retains every edge/arrow. Flowchart routing is unchanged.
			if (type === 'stateDiagram-v2') config.elk!.mergeEdges = true;
			if (type === 'gantt') config.layout = 'dagre';
			if (type === 'mindmap') {
				mermaid.registerLayoutLoaders([
					{ name: MINDMAP_LAYOUT, loader: () => import('./mindmap-layout-adapter') }
				]);
				config.layout = MINDMAP_LAYOUT;
			}
			mermaid.initialize(config);
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Font measurement unavailable');
			context.font = `${font.style} ${font.weight} ${font.size}px ${font.family}`;
			const measure = (text: string) => context.measureText(text).width;
			let input =
				type === 'mindmap'
					? mindmapPresentationSource(source)
					: type === 'stateDiagram-v2'
						? statePresentationSource(source, measure)
						: source;
			let groupColors = new Map<string, string>();
			{
				// Validate original syntax before any render-local presentation edits.
				const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
				if (type === 'gantt') {
					const db = diagram.db as unknown as { getTasks(): ScheduleTask[] };
					const plan = ganttLayout(db.getTasks(), font, measure);
					host.style.width = `${plan.width}px`;
					Object.assign(config.gantt!, {
						leftPadding: plan.left,
						rightPadding: plan.right,
						axisFormat: plan.format,
						tickInterval: plan.interval
					});
					input = ganttPresentationSource(source, plan);
					mermaid.initialize(config);
				} else if (type === 'flowchart') {
					const db = diagram.db as unknown as {
						getData(): { nodes: GroupNode[] };
						getSubGraphs(): { id: string }[];
					};
					const order = db.getSubGraphs().map((group) => group.id);
					groupColors = diagramGroupColors(db.getData().nodes, order);
				} else if (type === 'stateDiagram-v2') {
					const db = diagram.db as unknown as {
						extract(doc: unknown): void;
						getRootDocV2(): unknown;
						getData(): { nodes: GroupNode[] };
					};
					db.extract(db.getRootDocV2());
					groupColors = diagramGroupColors(db.getData().nodes);
				}
			}
			signal.throwIfAborted();
			const id = `llampart-diagram-${++serial}`;
			const { svg } = await mermaid.render(id, input, host);
			signal.throwIfAborted();
			const safe = verifiedDiagramSvg(svg);
			if (groupColors.size) paintDiagramGroups(safe, id, groupColors);
			host.replaceChildren(safe);
			if (type === 'flowchart') flowchartSectionPresentation(safe, font);
			if (type === 'mindmap') finishMindmapPresentation(safe);
			if (type === 'gantt') spaceGanttLabels(safe, font.size, availableWidth);
			if (type === 'stateDiagram-v2') {
				await document.fonts.load(`${font.style} 700 ${font.size}px ${font.family}`, source);
				signal.throwIfAborted();
				centerStateLabels(safe);
				stateSectionPresentation(safe, font);
			}
			if (type === 'flowchart' || type === 'stateDiagram-v2') {
				safe
					.querySelector('style')
					?.append(document.createTextNode(edgeLabelTypography(id, font.labelSize ?? font.size)));
				// Give labels room beyond outer return channels too; this changes the
				// canvas margin only, never any path or node coordinates.
				const box = safe.viewBox.baseVal;
				const margin = font.size * 4;
				safe.setAttribute(
					'viewBox',
					`${box.x - margin} ${box.y - margin} ${box.width + margin * 2} ${box.height + margin * 2}`
				);
				host.replaceChildren(safe);
				const unresolved = spaceEdgeLabels(safe, font.size);
				safe.setAttribute('data-unresolved-labels', String(unresolved));
				if (unresolved) console.warn(`Mermaid: ${unresolved} edge labels could not be separated`);
			}
			const result = new XMLSerializer().serializeToString(safe);
			verifiedDiagramSvg(result);
			return result;
		} finally {
			host.remove();
		}
	});
	queue = job.catch(() => {});
	return job;
}
