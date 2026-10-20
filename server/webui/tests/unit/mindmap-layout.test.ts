import { expect, it } from 'vitest';
import {
	mindmapLayout,
	mindmapCurve,
	type MindmapBox,
	type MindmapLink
} from '$lib/diagrams/mindmap-layout';

function tree(parents: number[]) {
	const boxes: MindmapBox[] = Array.from({ length: parents.length + 1 }, (_, i) => ({
		id: String(i),
		width: 80 + (i % 3) * 20,
		height: 32
	}));
	const links: MindmapLink[] = parents.map((p, i) => ({ start: String(p), end: String(i + 1) }));
	return { boxes, links };
}
it.each(
	[
		[],
		[0],
		[0, 0],
		[0, 0, 0, 0, 1, 1, 2, 2],
		[0, 0, 0, 1, 4, 5, 6, 2],
		[0, 1, 2, 3, 4, 5, 6],
		Array<number>(40).fill(0)
	].map((parents) => ({ parents }))
)('packs deterministically without intersecting native boxes: $parents', ({ parents }) => {
	const { boxes, links } = tree(parents);
	const plan = mindmapLayout(boxes, links, 12);
	expect(plan).toEqual(mindmapLayout(boxes, links, 12));
	expect(plan.size).toBe(boxes.length);
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
	if (parents.filter((p) => p === 0).length >= 4) {
		const first = links.filter((e) => e.start === '0').map((e) => plan.get(e.end)!);
		expect(first.some((n) => n.y < 0)).toBe(true);
		expect(first.some((n) => n.y > 0)).toBe(true);
		expect(first.some((n) => n.x < 0)).toBe(true);
		expect(first.some((n) => n.x > 0)).toBe(true);
	}
});
it('keeps long native box dimensions intact', () => {
	const { boxes, links } = tree([0, 0, 0, 1, 1]);
	boxes[1].width = 400;
	const plan = mindmapLayout(boxes, links, 20);
	expect(plan.get('1')!.width).toBe(400);
});
it('uses one monotone cubic with horizontal end tangents, also on the left', () => {
	expect(mindmapCurve({ x: 0, y: 0 }, { x: 100, y: -60 })).toBe('M0,0C50,0 50,-60 100,-60');
	expect(mindmapCurve({ x: 0, y: 0 }, { x: -100, y: 0 })).toBe('M0,0C-50,0 -50,0 -100,0');
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
