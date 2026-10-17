interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}
interface Point {
	x: number;
	y: number;
}
const overlaps = (a: Box, b: Box, gap = 0) =>
	a.x < b.x + b.width + gap &&
	a.x + a.width + gap > b.x &&
	a.y < b.y + b.height + gap &&
	a.y + a.height + gap > b.y;

/** Does a polyline segment enter a label's interior? Boundary-inclusive clipping
 * avoids missed crossings between sample points (including almost vertical edges). */
function intersects(a: Point, b: Point, box: Box) {
	let low = 0,
		high = 1;
	const dx = b.x - a.x,
		dy = b.y - a.y;
	for (const [p, q] of [
		[-dx, a.x - box.x],
		[dx, box.x + box.width - a.x],
		[-dy, a.y - box.y],
		[dy, box.y + box.height - a.y]
	]) {
		if (p === 0) {
			if (q < 0) return false;
		} else if (p < 0) low = Math.max(low, q / p);
		else high = Math.min(high, q / p);
		if (low > high) return false;
	}
	return true;
}

/** Mermaid currently hardcodes inline edge labels for ELK and exposes no option
 * to turn it off. Keep native routing intact and place labels in measured free
 * space next to their own position. No white masks, rewritten paths or source
 * edits. Works on verified SVG attached to the hidden font-measurement host.
 * Search is bounded; unresolved labels are counted, never silently hidden. */
export function spaceEdgeLabels(svg: SVGSVGElement, fontSize: number): number {
	const inverse = svg.getScreenCTM()?.inverse();
	if (!inverse) return 0;
	function boxOf(element: SVGGraphicsElement): Box {
		const rect = element.getBoundingClientRect();
		const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
		const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
		return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
	}
	const labels = [...svg.querySelectorAll<SVGGElement>('g.edgeLabel')].filter(
		(label) => label.textContent?.trim() && !label.closest('.node')
	);
	const boxes = labels.map((label) =>
		boxOf(label.querySelector<SVGGraphicsElement>('text') || label)
	);
	const nodes = [...svg.querySelectorAll<SVGGraphicsElement>('g.node')].map(boxOf);
	for (const title of svg.querySelectorAll<SVGGraphicsElement>('.cluster-label'))
		nodes.push(boxOf(title));
	const paths = [
		...svg.querySelectorAll<SVGPathElement>('.edgePaths path,path.flowchart-link,path.transition')
	];
	let samples = 0;
	const lines = paths.map((path) => {
		const length = path.getTotalLength();
		const matrix = path.getScreenCTM();
		const count = Math.max(1, Math.ceil(length / Math.max(4, fontSize / 3)));
		samples += count;
		if (!matrix || samples > 100000) throw new Error('Edge label measurement limit');
		const points = Array.from({ length: count + 1 }, (_, i) => {
			const p = path.getPointAtLength((length * i) / count);
			return new DOMPoint(p.x, p.y).matrixTransform(matrix).matrixTransform(inverse);
		});
		const extent = points.reduce(
			(box, p) => ({
				left: Math.min(box.left, p.x),
				right: Math.max(box.right, p.x),
				top: Math.min(box.top, p.y),
				bottom: Math.max(box.bottom, p.y)
			}),
			{ left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
		);
		return {
			id: path.id,
			points,
			bounds: {
				x: extent.left,
				y: extent.top,
				width: extent.right - extent.left + 0.01,
				height: extent.bottom - extent.top + 0.01
			}
		};
	});
	// Group borders are obstacles, not opaque background masks. A composite's
	// title band is reserved for its own title, never for a transition label.
	for (const rect of svg.querySelectorAll<SVGRectElement>(
		'g.cluster > rect,.statediagram-cluster rect.outer,.statediagram-cluster rect.inner'
	)) {
		const bounds = boxOf(rect);
		const { x, y, width, height } = bounds;
		lines.push({
			id: '',
			bounds,
			points: [
				new DOMPoint(x, y),
				new DOMPoint(x + width, y),
				new DOMPoint(x + width, y + height),
				new DOMPoint(x, y + height),
				new DOMPoint(x, y)
			]
		});
		if (rect.classList.contains('outer')) {
			const inner = rect
				.closest('.statediagram-cluster')
				?.querySelector<SVGRectElement>('rect.inner');
			if (inner) nodes.push({ x, y, width, height: Math.max(fontSize, boxOf(inner).y - y) });
		}
	}
	let checks = 0;
	const hitsLine = (box: Box) =>
		lines.some(({ points, bounds }) => {
			if (!overlaps(box, bounds)) return false;
			for (let i = 1; i < points.length; i++) {
				if (++checks > 5000000) throw new Error('Edge label search limit');
				if (intersects(points[i - 1], points[i], box)) return true;
			}
			return false;
		});
	let unresolved = 0;
	const bounds = svg.viewBox.baseVal;
	const pending = labels.map((_, index) => ({ index, retry: false }));
	for (const { index, retry } of pending) {
		const original = boxes[index];
		const edgeId = labels[index].querySelector('[data-id]')?.getAttribute('data-id');
		const own = edgeId && lines.find((line) => line.id.endsWith('-' + edgeId));
		const free = (box: Box) =>
			box.x >= bounds.x &&
			box.y >= bounds.y &&
			box.x + box.width <= bounds.x + bounds.width &&
			box.y + box.height <= bounds.y + bounds.height &&
			!nodes.some((node) => overlaps(box, node, fontSize * 0.35)) &&
			!boxes.some((other, i) => i !== index && overlaps(box, other, fontSize * 0.35)) &&
			!hitsLine({
				x: box.x - fontSize * 0.25,
				y: box.y - fontSize * 0.25,
				width: box.width + fontSize * 0.5,
				height: box.height + fontSize * 0.5
			});
		let chosen: Box | undefined;
		// A single optical gap, measured normal to the label's own route. Search
		// along that route instead of arbitrary outward rings (which produced
		// inconsistent distances and could suggest a different relationship).
		if (own) {
			const cx = original.x + original.width / 2,
				cy = original.y + original.height / 2;
			const candidates: { box: Box; score: number }[] = [];
			for (let i = 1; i < own.points.length - 1; i++) {
				const p = own.points[i],
					a = own.points[i - 1],
					b = own.points[i + 1];
				if (Math.hypot(p.x - cx, p.y - cy) > fontSize * 8 + original.width / 2) continue;
				const length = Math.hypot(b.x - a.x, b.y - a.y);
				if (!length) continue;
				const nx = -(b.y - a.y) / length,
					ny = (b.x - a.x) / length;
				const offset =
					(Math.abs(nx) * original.width) / 2 +
					(Math.abs(ny) * original.height) / 2 +
					fontSize * 0.55;
				for (const side of [-1, 1]) {
					const box = {
						...original,
						x: p.x + nx * offset * side - original.width / 2,
						y: p.y + ny * offset * side - original.height / 2
					};
					candidates.push({ box, score: Math.hypot(box.x - original.x, box.y - original.y) });
				}
			}
			if (candidates.length > 100000) throw new Error('Edge label candidate limit');
			candidates.sort((a, b) => a.score - b.score);
			chosen = candidates.find(({ box }) => free(box))?.box;
		} else if (free(original)) chosen = original;
		if (!chosen) {
			// Later labels may release the native position that currently blocks
			// this one. Retry failed labels once, after that space is available.
			if (!retry) {
				pending.push({ index, retry: true });
				continue;
			}
			labels[index].dataset.layoutCollision = 'true';
			unresolved++;
			continue;
		}
		const label = labels[index];
		const parent = (label.parentNode as SVGGraphicsElement).getScreenCTM()?.inverse();
		const root = svg.getScreenCTM();
		if (!parent || !root) {
			unresolved++;
			continue;
		}
		const a = new DOMPoint(0, 0).matrixTransform(root).matrixTransform(parent);
		const b = new DOMPoint(chosen.x - original.x, chosen.y - original.y)
			.matrixTransform(root)
			.matrixTransform(parent);
		label.setAttribute(
			'transform',
			`translate(${b.x - a.x},${b.y - a.y}) ${label.getAttribute('transform') || ''}`
		);
		boxes[index] = chosen;
	}
	return unresolved;
}
