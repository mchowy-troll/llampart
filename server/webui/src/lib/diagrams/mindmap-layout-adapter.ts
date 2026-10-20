import type { LayoutAlgorithm } from 'mermaid/dist/rendering-util/render.js';
import type { NonClusterNode } from 'mermaid/dist/rendering-util/types.js';
import { mindmapLayout, mindmapCurve } from './mindmap-layout';

/** Mermaid layout-loader adapter, not a replacement parser or shape renderer.
 * Native insertNode owns every box, label, fill and shape intersection. */
export const render: LayoutAlgorithm['render'] = async (data, svg, helpers) => {
	const layer = svg.select('g');
	const edges = layer.append('g').attr('class', 'edgePaths');
	const nodes = layer.append('g').attr('class', 'nodes');
	const measured = [];
	const elements = new Map<string, Awaited<ReturnType<typeof helpers.insertNode>>>();
	for (const raw of data.nodes) {
		const node = raw as NonClusterNode;
		const element = await helpers.insertNode(nodes, node, { config: data.config, dir: 'TB' });
		const bounds = element.node()!.getBBox();
		node.width = bounds.width;
		node.height = bounds.height;
		measured.push({ id: node.id, width: bounds.width, height: bounds.height });
		elements.set(node.id, element);
	}
	const links = data.edges.map((e) => ({ start: e.start!, end: e.end! }));
	const positions = mindmapLayout(measured, links, Number(data.config.fontSize) || 16);
	const model = new Map(data.nodes.map((n) => [n.id, n]));
	for (const [id, p] of positions) {
		const node = model.get(id)!;
		node.x = p.x;
		node.y = p.y;
		elements.get(id)!.attr('transform', `translate(${p.x},${p.y})`);
	}
	for (const edge of data.edges) {
		const source = model.get(edge.start!)!,
			target = model.get(edge.end!)!;
		const side = positions.get(target.id)!.side;
		const a = source.intersect!({ x: source.x! + side * source.width!, y: source.y! });
		const b = target.intersect!({ x: target.x! - side * target.width!, y: target.y! });
		edge.points = [a, b];
		edges
			.append('path')
			.attr('id', edge.id)
			.attr('class', edge.classes || 'edge')
			.attr('d', mindmapCurve(a, b))
			.attr('fill', 'none')
			.attr('stroke-width', 3)
			.attr('stroke-linecap', 'round')
			.attr('stroke-linejoin', 'round');
	}
};
