import assert from 'node:assert/strict';

/** Inspect actual downloaded bytes in Chromium, not file-name/source heuristics.
 * Both formats must rasterize with alpha=0 at all four canvas corners while
 * retaining visible artwork. SVG additionally has no full-document paint rect. */
export async function assertTransparentExport(page, bytes, format) {
	format = format.toLowerCase();
	assert(['png', 'svg'].includes(format));
	if (format === 'png') assert.equal(bytes[25], 6, 'PNG must have an RGBA IHDR color type');
	const result = await page.evaluate(
		async ({ base64, format }) => {
			let backdrop = false;
			if (format === 'svg') {
				const xml = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
				const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
				if (doc.querySelector('parsererror')) throw new Error('Invalid export XML');
				const svg = doc.documentElement;
				const box = svg.viewBox.baseVal;
				backdrop = [...svg.children].some((el) => {
					if (el.localName !== 'rect') return false;
					const width = el.getAttribute('width'),
						height = el.getAttribute('height');
					return (
						(width === '100%' && height === '100%') ||
						(Number(el.getAttribute('x') || 0) <= box.x &&
							Number(el.getAttribute('y') || 0) <= box.y &&
							Number(width) >= box.width &&
							Number(height) >= box.height)
					);
				});
			}
			const image = new Image();
			image.src = `data:image/${format === 'svg' ? 'svg+xml' : 'png'};base64,${base64}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = Math.min(512, image.naturalWidth);
			canvas.height = Math.min(512, image.naturalHeight);
			const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
			context.drawImage(image, 0, 0, canvas.width, canvas.height);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			const corners = [
				[0, 0],
				[canvas.width - 1, 0],
				[0, canvas.height - 1],
				[canvas.width - 1, canvas.height - 1]
			];
			const alpha = corners.map(([x, y]) => pixels[(y * canvas.width + x) * 4 + 3]);
			let painted = 0,
				transparent = 0;
			for (let i = 3; i < pixels.length; i += 4) {
				if (pixels[i] === 0) transparent++;
				else painted++;
			}
			return {
				format,
				width: image.naturalWidth,
				height: image.naturalHeight,
				backdrop,
				alpha,
				painted,
				transparent
			};
		},
		{ base64: bytes.toString('base64'), format }
	);
	assert(!result.backdrop, 'SVG must not contain a whole-document background rectangle');
	assert.deepEqual(
		result.alpha,
		[0, 0, 0, 0],
		`${format.toUpperCase()} canvas corners must be fully transparent`
	);
	assert(
		result.transparent > result.painted * 0.05,
		'Export must retain genuinely transparent background pixels'
	);
	assert(result.painted > 20, 'Transparency must not be achieved by dropping the visualization');
	return result;
}
