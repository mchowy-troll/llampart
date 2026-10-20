export const MINDMAP_LAYOUT = 'llampart-mindmap';

export interface MindmapBox {
	id: string;
	width: number;
	height: number;
}
export interface MindmapLink {
	start: string;
	end: string;
}
export interface MindmapPosition extends MindmapBox {
	x: number;
	y: number;
	side: number;
}

/** Stable two-sided tree packing over Mermaid's measured native node boxes.
 * Each subtree owns a disjoint vertical interval, not merely its first node. */
export function mindmapLayout(boxes: MindmapBox[], links: MindmapLink[], size: number) {
	const nodes = new Map(boxes.map((n) => [n.id, n]));
	const children = new Map(boxes.map((n) => [n.id, [] as string[]]));
	const parent = new Set<string>();
	for (const e of links) {
		if (!nodes.has(e.start) || !nodes.has(e.end) || parent.has(e.end))
			throw new Error('Invalid Mindmap tree');
		children.get(e.start)!.push(e.end);
		parent.add(e.end);
	}
	const roots = boxes.filter((n) => !parent.has(n.id));
	if (roots.length !== 1) throw new Error('Invalid Mindmap root');
	const gapY = Math.max(18, size * 1.5),
		gapX = Math.max(40, size * 4);
	const extents = new Map<string, number>(),
		active = new Set<string>();
	function extent(id: string): number {
		if (active.has(id)) throw new Error('Mindmap cycle');
		active.add(id);
		const descendants = children.get(id)!;
		const height = Math.max(
			nodes.get(id)!.height,
			descendants.reduce((h, c) => h + extent(c), 0) + Math.max(0, descendants.length - 1) * gapY
		);
		active.delete(id);
		extents.set(id, height);
		return height;
	}
	const root = roots[0];
	extent(root.id);
	if (extents.size !== boxes.length) throw new Error('Disconnected Mindmap');
	const sides = [[] as string[], [] as string[]],
		heights = [0, 0];
	const firstLevel = children.get(root.id)!;
	// Pack largest subtrees first, then restore source order within each side.
	for (const id of [...firstLevel].sort((a, b) => extents.get(b)! - extents.get(a)!)) {
		const side = heights[0] <= heights[1] ? 0 : 1;
		sides[side].push(id);
		heights[side] += extents.get(id)! + (sides[side].length > 1 ? gapY : 0);
	}
	for (const side of sides) side.sort((a, b) => firstLevel.indexOf(a) - firstLevel.indexOf(b));
	const positions = new Map<string, MindmapPosition>([[root.id, { ...root, x: 0, y: 0, side: 0 }]]);
	function place(id: string, x: number, top: number, side: number) {
		const node = nodes.get(id)!,
			height = extents.get(id)!,
			y = top + height / 2;
		positions.set(id, { ...node, x, y, side });
		const list = children.get(id)!;
		const total =
			list.reduce((sum, c) => sum + extents.get(c)!, 0) + Math.max(0, list.length - 1) * gapY;
		let cursor = y - total / 2;
		for (const child of list) {
			place(child, x + side * (node.width / 2 + gapX + nodes.get(child)!.width / 2), cursor, side);
			cursor += extents.get(child)! + gapY;
		}
	}
	for (const [i, list] of sides.entries()) {
		const side = i === 0 ? 1 : -1;
		let top = -heights[i] / 2;
		for (const id of list) {
			place(id, side * (root.width / 2 + gapX + nodes.get(id)!.width / 2), top, side);
			top += extents.get(id)! + gapY;
		}
	}
	return positions;
}

export function mindmapCurve(a: { x: number; y: number }, b: { x: number; y: number }): string {
	const bend = (b.x - a.x) / 2;
	return `M${a.x},${a.y}C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`;
}
