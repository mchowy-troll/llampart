import { embeddedSvgFonts } from '$lib/utils/svg-fonts';
import { downloadChartBlob, chartFilename } from '$lib/charts/chart-csv';
import { SVG_NS, verifiedDiagramSvg } from './mermaid-policy';

export function pngDimensions(width: number, height: number) {
	if (![width, height].every((v) => Number.isFinite(v) && v > 0))
		throw new Error('Invalid export size');
	const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale))
	};
}

export async function diagramSvg(source: string, frame: HTMLElement): Promise<string> {
	const svg = verifiedDiagramSvg(source);
	const { width, height } = svg.viewBox.baseVal;
	svg.setAttribute('width', String(Math.ceil(width)));
	svg.setAttribute('height', String(Math.ceil(height)));
	svg.style.maxWidth = 'none';
	// Keep native marks/fills, but never add a whole-document backdrop.
	// Use the existing CSSOM font registry, not a Mermaid-specific font list.
	const fonts = await embeddedSvgFonts(getComputedStyle(frame).fontFamily, frame);
	const withoutFonts = fonts.replace(
		/url\("data:font\/(?:woff2?|ttf);base64,[A-Za-z0-9+/=]+"\)/g,
		''
	);
	if (/url\s*\(|@import|<|>/i.test(withoutFonts)) throw new Error('Unsafe embedded font');
	const style = document.createElementNS(SVG_NS, 'style');
	style.textContent = fonts;
	svg.prepend(style);
	const serialized = new XMLSerializer().serializeToString(svg);
	verifiedDiagramSvg(serialized, true);
	return serialized;
}

export async function exportDiagram(
	source: string,
	frame: HTMLElement,
	format: 'png' | 'svg',
	title: string,
	signal?: AbortSignal
) {
	signal?.throwIfAborted();
	const svg = await diagramSvg(source, frame);
	signal?.throwIfAborted();
	const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
	const filename = chartFilename(title);
	if (format === 'svg') return downloadChartBlob(blob, `${filename}.svg`);
	const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
	const size = pngDimensions(
		Number(parsed.getAttribute('width')),
		Number(parsed.getAttribute('height'))
	);
	const url = URL.createObjectURL(blob);
	const canvas = document.createElement('canvas');
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		signal?.throwIfAborted();
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
		signal?.throwIfAborted();
		downloadChartBlob(png, `${filename}.png`);
	} finally {
		URL.revokeObjectURL(url);
		canvas.width = canvas.height = 0;
	}
}
