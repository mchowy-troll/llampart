import { expect, it } from 'vitest';
import { mindmapLayout, type MindmapBox, type MindmapLink } from '$lib/diagrams/mindmap-layout';

function tree(parents: number[]) {
	const boxes: MindmapBox[] = Array.from({ length: parents.length + 1 }, (_, i) => ({
		id: String(i),
		width: 80 + (i % 3) * 20,
		height: 32
	}));
	const links: MindmapLink[] = parents.map((p, i) => ({ start: String(p), end: String(i + 1) }));
	return { boxes, links };
}
it('packs an uneven tree without overlaps, resizing native boxes or mutating input', () => {
	const { boxes, links } = tree([0, 0, 0, 0, 1, 1, 2, 7, 8]);
	boxes[1].width = 400;
	const original = structuredClone({ boxes, links });
	const plan = mindmapLayout(boxes, links, 12);
	expect(plan.size).toBe(boxes.length);
	for (const box of boxes) {
		const node = plan.get(box.id)!;
		expect(node).toMatchObject(box);
		expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
	}
	const nodes = [...plan.values()];
	for (const [i, a] of nodes.entries())
		for (const b of nodes.slice(i + 1))
			expect(
				Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
					Math.abs(a.y - b.y) >= (a.height + b.height) / 2
			).toBe(true);
	for (const edge of links) {
		const a = plan.get(edge.start)!,
			b = plan.get(edge.end)!;
		expect(b.side * (b.x - a.x)).toBeGreaterThan(0);
	}
	expect({ boxes, links }).toEqual(original);
});
it('rejects invalid or disconnected trees', () => {
	const { boxes } = tree([0, 0]);
	expect(() =>
		mindmapLayout(
			boxes,
			[
				{ start: '1', end: '2' },
				{ start: '2', end: '1' }
			],
			12
		)
	).toThrow('Disconnected');
});
