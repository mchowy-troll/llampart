import { verifiedDiagramSvg } from './mermaid-policy';

/** Isolate engine CSS and SVG ids from Markdown, other diagrams and the preview.
 * No raw HTML insertion; only verified SVG nodes cross this boundary.
 */
export function mountDiagram(
	node: HTMLElement,
	options: { svg: string; preview?: boolean; label: string }
) {
	const root = node.attachShadow({ mode: 'open' });
	function update(value: typeof options) {
		const svg = verifiedDiagramSvg(value.svg);
		const box = svg.viewBox.baseVal;
		svg.setAttribute('width', String(Math.ceil(box.width)));
		svg.setAttribute('height', String(Math.ceil(box.height)));
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', value.label);
		svg.style.cssText = value.preview
			? 'display:block;max-width:none;height:auto;margin:auto'
			: 'display:block;max-width:100%;height:auto;margin:auto';
		root.replaceChildren(svg);
	}
	update(options);
	return {
		update,
		destroy() {
			root.replaceChildren();
		}
	};
}
