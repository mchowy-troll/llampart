import { embeddedSvgFonts } from '$lib/utils/svg-fonts';
import { downloadChartBlob } from '$lib/charts/chart-csv';
import { pngDimensions } from '$lib/diagrams/diagram-export';

const NS = 'http://www.w3.org/2000/svg';
// Fixed opaque sRGB ink remains legible on a document page, even when the
// message uses light/translucent ink. Never bake a page/chat surface into it.
const EXPORT_INK = '#111111';

function svgNode(name: string, attributes: Record<string, string | number>) {
	const node = document.createElementNS(NS, name);
	for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
	return node;
}

/** Translate KaTeX's laid-out glyphs, rules and stretchy paths into native SVG.
 * No foreignObject, bitmap, external CSS, reparsing or chat/toolbar background.
 * A detached-from-chat measuring clone also includes content outside the scrollport.
 */
export async function mathSvg(display: HTMLElement): Promise<string> {
	await document.fonts.ready;
	const original = display.querySelector<HTMLElement>('.katex');
	if (!original) throw new Error('Math is not ready');
	const typography = getComputedStyle(original);
	const stage = document.createElement('div');
	stage.style.cssText =
		'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-1';
	stage.setAttribute('aria-hidden', 'true');
	const clone = original.cloneNode(true) as HTMLElement;
	clone.querySelector('.katex-mathml')?.remove();
	clone.style.font = typography.font;
	clone.style.color = EXPORT_INK;
	clone.style.display = 'inline-block';
	clone.style.width = 'max-content';
	clone.style.textAlign = 'left';
	stage.append(clone);
	document.body.append(stage);
	try {
		const html = clone.querySelector<HTMLElement>('.katex-html')!;
		const origin = html.getBoundingClientRect();
		const padding = Math.ceil(parseFloat(typography.fontSize) * 0.125);
		const svg = svgNode('svg', { xmlns: NS });
		const fonts = svgNode('style', {});
		const families = new Set(
			[clone, ...clone.querySelectorAll('*')].map((node) => getComputedStyle(node).fontFamily)
		);
		fonts.textContent = await embeddedSvgFonts([...families].join(','), clone);
		svg.append(fonts);
		let right = origin.right;
		let bottom = origin.bottom;
		let left = origin.left;
		let top = origin.top;
		const group = svgNode('g', {});
		svg.append(group);
		function bounds(rect: DOMRect) {
			left = Math.min(left, rect.left);
			top = Math.min(top, rect.top);
			right = Math.max(right, rect.right);
			bottom = Math.max(bottom, rect.bottom);
		}
		for (const element of [html, ...html.querySelectorAll<HTMLElement>('*')]) {
			if (element.closest('svg')) continue;
			const css = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			// Fractions, over/underlines, array rules and boxed expressions.
			for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
				const thickness = parseFloat(css.getPropertyValue(`border-${side.toLowerCase()}-width`));
				if (!thickness) continue;
				bounds(rect);
				const horizontal = side === 'Top' || side === 'Bottom';
				group.append(
					svgNode('rect', {
						x: side === 'Right' ? rect.right - thickness : rect.left,
						y: side === 'Bottom' ? rect.bottom - thickness : rect.top,
						width: horizontal ? rect.width : thickness,
						height: horizontal ? thickness : rect.height,
						fill: EXPORT_INK
					})
				);
			}
		}
		for (const source of html.querySelectorAll('svg')) {
			const rect = source.getBoundingClientRect();
			// KaTeX draws stretchy radicals/arrows on very wide SVG canvases and
			// crops their tails in HTML. Preserve that viewport, not the hidden ink.
			let clipLeft = rect.left;
			let clipTop = rect.top;
			let clipRight = rect.right;
			let clipBottom = rect.bottom;
			for (
				let parent = source.parentElement;
				parent && parent !== clone;
				parent = parent.parentElement
			) {
				const css = getComputedStyle(parent);
				const box = parent.getBoundingClientRect();
				if (css.overflowX === 'hidden' || css.overflowX === 'clip') {
					clipLeft = Math.max(clipLeft, box.left);
					clipRight = Math.min(clipRight, box.right);
				}
				if (css.overflowY === 'hidden' || css.overflowY === 'clip') {
					clipTop = Math.max(clipTop, box.top);
					clipBottom = Math.min(clipBottom, box.bottom);
				}
			}
			bounds(new DOMRect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop));
			const path = source.cloneNode(true) as SVGSVGElement;
			path.setAttribute('x', String(rect.left));
			path.setAttribute('y', String(rect.top));
			path.setAttribute('width', String(rect.width));
			path.setAttribute('height', String(rect.height));
			path.style.cssText = `color:${EXPORT_INK};fill:${EXPORT_INK};opacity:1`;
			for (const mark of path.querySelectorAll<SVGElement>('*')) {
				mark.style.color = EXPORT_INK;
				mark.style.opacity = '1';
				for (const paint of ['fill', 'stroke']) {
					if (mark.hasAttribute(paint) && mark.getAttribute(paint) !== 'none')
						mark.setAttribute(paint, EXPORT_INK);
				}
			}
			const clipId = `math-clip-${svg.querySelectorAll('clipPath').length}`;
			const clip = svgNode('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
			clip.append(
				svgNode('rect', {
					x: clipLeft,
					y: clipTop,
					width: Math.max(0, clipRight - clipLeft),
					height: Math.max(0, clipBottom - clipTop)
				})
			);
			const clipped = svgNode('g', { 'clip-path': `url(#${clipId})` });
			clipped.append(path);
			group.append(clip, clipped);
		}
		const walker = document.createTreeWalker(html, NodeFilter.SHOW_TEXT);
		const texts: Text[] = [];
		while (walker.nextNode()) texts.push(walker.currentNode as Text);
		for (const text of texts) {
			if (!text.textContent?.trim() || text.parentElement?.closest('svg')) continue;
			const css = getComputedStyle(text.parentElement!);
			const range = document.createRange();
			range.selectNodeContents(text);
			const rect = range.getBoundingClientRect();
			bounds(rect);
			// A zero-height inline baseline probe uses the browser's actual font metrics,
			// including KaTeX's nested vlists, instead of guessing ascent from font size.
			const probe = document.createElement('span');
			probe.style.cssText =
				'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
			text.before(probe);
			const baseline = probe.getBoundingClientRect().top;
			probe.remove();
			const glyph = svgNode('text', {
				x: rect.left,
				y: baseline,
				fill: EXPORT_INK,
				'font-family': css.fontFamily,
				'font-size': css.fontSize,
				'font-weight': css.fontWeight,
				'font-style': css.fontStyle,
				'xml:space': 'preserve'
			});
			glyph.textContent = text.textContent;
			group.append(glyph);
		}
		const width = Math.ceil(right - left + padding * 2);
		const height = Math.ceil(bottom - top + padding * 2);
		// Native SVG size is 200%; viewBox stays in message-sized coordinates.
		svg.setAttribute('width', String(width * 2));
		svg.setAttribute('height', String(height * 2));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		group.setAttribute('transform', `translate(${padding - left} ${padding - top})`);
		return new XMLSerializer().serializeToString(svg);
	} finally {
		stage.remove();
	}
}

export async function exportMath(display: HTMLElement, format: 'png' | 'svg', signal: AbortSignal) {
	signal.throwIfAborted();
	const svg = await mathSvg(display);
	signal.throwIfAborted();
	const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
	if (format === 'svg') return downloadChartBlob(blob, 'latex.svg');
	const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
	const size = pngDimensions(
		Number(root.getAttribute('width')) / 2,
		Number(root.getAttribute('height')) / 2
	);
	// Do not silently downscale a requested 2× bitmap at the existing safety cap.
	if (
		size.width !== Number(root.getAttribute('width')) ||
		size.height !== Number(root.getAttribute('height'))
	)
		throw new Error('Math export exceeds the 2× bitmap size limit');
	const url = URL.createObjectURL(blob);
	const canvas = document.createElement('canvas');
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		signal.throwIfAborted();
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) throw new Error('Canvas unavailable');
		context.drawImage(image, 0, 0, size.width, size.height);
		const png = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
				'image/png'
			)
		);
		signal.throwIfAborted();
		downloadChartBlob(png, 'latex.png');
	} finally {
		URL.revokeObjectURL(url);
		canvas.width = canvas.height = 0;
	}
}
