import { getChartSvgString } from 'layerchart/utils/download';
import { embeddedSvgFonts } from '$lib/utils/svg-fonts';
import { downloadChartBlob } from './chart-csv';

const NS = 'http://www.w3.org/2000/svg';

/** Export only trusted rendered SVG + native text, never an HTML screenshot/foreignObject. */
export async function chartSvg(frame: HTMLElement, plot: HTMLElement): Promise<string> {
	const source = getChartSvgString(plot);
	if (!source) throw new Error('Chart is not ready');
	const chart = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
	if (chart.nodeName !== 'svg') throw new Error('Invalid rendered SVG');
	chart.querySelectorAll('[class*="lc-highlight-"]').forEach((node) => node.remove());
	const width = Math.ceil(plot.clientWidth + 32);
	const style = getComputedStyle(frame);
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('xmlns', NS);
	svg.setAttribute(
		'lang',
		frame.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang
	);
	svg.style.fontFamily = style.fontFamily;
	svg.style.fontWeight = style.fontWeight;
	svg.style.fontStyle = style.fontStyle;
	svg.style.fontOpticalSizing = style.fontOpticalSizing;
	svg.style.setProperty('font-synthesis', 'none');
	const defs = document.createElementNS(NS, 'defs');
	const fonts = document.createElementNS(NS, 'style');
	// Only exported text participates: toolbar/tooltip faces must not consume
	// the unchanged 12-face limit or inflate the downloaded SVG.
	const textSources = [
		plot,
		...frame.querySelectorAll(
			'.chart-title, .chart-description, .chart-legend button[aria-pressed="true"]'
		)
	];
	fonts.textContent = await embeddedSvgFonts(style.fontFamily, frame, textSources);
	defs.append(fonts);
	svg.append(defs);
	// No document backdrop: only visualization marks, text and legend are exported.
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	let y = 24;
	function textLine(text: string, x: number, top: number, typography: CSSStyleDeclaration) {
		const node = document.createElementNS(NS, 'text');
		node.setAttribute('x', String(x));
		node.setAttribute('y', String(top));
		node.setAttribute('fill', typography.color);
		node.setAttribute('font-size', typography.fontSize);
		node.setAttribute('font-weight', typography.fontWeight);
		node.setAttribute('font-style', typography.fontStyle);
		node.setAttribute('font-family', typography.fontFamily);
		node.textContent = text;
		svg.append(node);
	}
	function paragraph(element: Element | null, x = 16) {
		if (!element) return;
		const typography = getComputedStyle(element);
		const fontSize = parseFloat(typography.fontSize);
		ctx.font = `${typography.fontStyle} ${typography.fontWeight} ${typography.fontSize} ${typography.fontFamily}`;
		let line = '';
		for (const char of element.textContent || '') {
			if (char === '\n' || ctx.measureText(line + char).width > width - x - 16) {
				textLine(line, x, y, typography);
				y += fontSize * 1.5;
				line = char === '\n' ? '' : char;
			} else line += char;
		}
		if (line) {
			textLine(line, x, y, typography);
			y += fontSize * 1.5;
		}
	}
	paragraph(frame.querySelector('.chart-title'));
	paragraph(frame.querySelector('.chart-description'));
	chart.setAttribute('x', '16');
	chart.setAttribute('y', String(y));
	chart.setAttribute('width', String(plot.clientWidth));
	chart.setAttribute('height', String(plot.clientHeight));
	if (!chart.hasAttribute('viewBox'))
		chart.setAttribute('viewBox', `0 0 ${plot.clientWidth} ${plot.clientHeight}`);
	// Computed inline styles take precedence; remove unresolved authored variable attributes.
	for (const node of [chart, ...chart.querySelectorAll('*')]) {
		if (node instanceof SVGElement) {
			for (const property of Array.from(node.style)) {
				if (node.style.getPropertyValue(property).includes('var('))
					node.style.removeProperty(property);
			}
		}
		for (const attribute of Array.from(node.attributes)) {
			if (attribute.name !== 'style' && attribute.value.includes('var('))
				node.removeAttribute(attribute.name);
		}
		// Browsers may serialize paint servers as absolute page URLs. Keep every
		// gradient reference local so the downloaded SVG has no page dependency.
		for (const attribute of Array.from(node.attributes)) {
			if (attribute.value.includes('url('))
				node.setAttribute(
					attribute.name,
					attribute.value.replace(/url\(["']?[^)"']*#([^"')]+)["']?\)/g, 'url(#$1)')
				);
		}
	}
	svg.append(chart);
	y += plot.clientHeight + 24;
	for (const button of frame.querySelectorAll<HTMLButtonElement>(
		'.chart-legend button[aria-pressed="true"]'
	)) {
		const swatch = button.querySelector<HTMLElement>('.chart-swatch');
		const rect = document.createElementNS(NS, 'rect');
		rect.setAttribute('x', '16');
		rect.setAttribute('y', String(y - 10));
		rect.setAttribute('width', '10');
		rect.setAttribute('height', '10');
		rect.setAttribute('fill', swatch ? getComputedStyle(swatch).backgroundColor : style.color);
		svg.append(rect);
		// Legend labels use their own row and wrap instead of truncating exported data labels.
		paragraph(button, 34);
	}
	svg.setAttribute('width', String(width));
	svg.setAttribute('height', String(Math.ceil(y + 10)));
	svg.setAttribute('viewBox', `0 0 ${width} ${Math.ceil(y + 10)}`);
	return new XMLSerializer().serializeToString(svg);
}

export async function exportChart(
	frame: HTMLElement,
	plot: HTMLElement,
	format: 'png' | 'svg',
	filename: string
): Promise<void> {
	const svg = await chartSvg(frame, plot);
	const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
	if (format === 'svg') {
		downloadChartBlob(blob, `${filename}.svg`);
		return;
	}
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth * 2;
		canvas.height = image.naturalHeight * 2;
		// A fresh alpha-enabled canvas preserves the SVG's transparent pixels.
		canvas.getContext('2d', { alpha: true })!.drawImage(image, 0, 0, canvas.width, canvas.height);
		const png = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(result) => (result ? resolve(result) : reject(new Error('PNG encoding failed'))),
				'image/png'
			)
		);
		downloadChartBlob(png, `${filename}.png`);
		canvas.width = canvas.height = 0;
	} finally {
		URL.revokeObjectURL(url);
	}
}
