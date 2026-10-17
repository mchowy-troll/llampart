export const MAX_DIAGRAM_SOURCE = 48 * 1024;
export const MAX_DIAGRAM_LINES = 1200;
export const MAX_DIAGRAM_EDGES = 600;
export const DIAGRAM_TYPES = ['flowchart', 'stateDiagram-v2', 'gantt', 'mindmap'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

/** Reject model configuration, active content and styling before loading the engine.
 * Comments are retained: forbidden directives must not be hidden in a comment.
 * Ordinary syntax (including Gantt dates and Unicode) is left to Mermaid.
 */
export function diagramType(source: string): DiagramType {
	if (
		!source.trim() ||
		source.length > MAX_DIAGRAM_SOURCE ||
		new TextEncoder().encode(source).byteLength > MAX_DIAGRAM_SOURCE ||
		source.split('\n').length > MAX_DIAGRAM_LINES
	)
		throw new Error('Diagram source limit');
	const inspected = source.replace(/<<(?:choice|fork|join)>>/g, '');
	if (
		/%%\s*\{|^\s*---|<\/?[a-z!?]|(?:https?|ftp|file|data|javascript|vbscript):|\/\/[^\s]|(?:^|[;\r\n])\s*(?:click|classDef|linkStyle|style|links?)\s|(?:^|[;\r\n])\s*(?:rect|box)\s+(?:rgba?\s*\(|#[\da-f])|:::|::icon|\b(?:img|image|icon)\s*:/im.test(
			inspected
		)
	)
		throw new Error('Unsafe diagram source');
	// Mermaid supports numeric/named HTML entities. Prevent them concealing active markup/URLs.
	if (/&(?:#|[a-z]+;)|#(?:\d+|[a-z]+);/i.test(source))
		throw new Error('Encoded markup is not supported');
	const body = source.replace(/^\s*%%[^\n]*(?:\n|$)/gm, '').trimStart();
	const token = /^(flowchart|graph|stateDiagram-v2|gantt|mindmap)(?=\s|$)/.exec(body)?.[1];
	if (!token) throw new Error('Unsupported diagram type');
	return token === 'graph' ? 'flowchart' : (token as DiagramType);
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(
	'svg g defs style title desc path rect circle ellipse line polyline polygon text tspan textPath marker pattern clipPath mask linearGradient radialGradient stop use switch symbol filter feDropShadow'.split(
		' '
	)
);

/** SVG-only, no HTML, scripts, navigation, events, external resources or CSS imports.
 * Reject rather than repair unexpected engine output. Also called at export time.
 */
export function verifiedDiagramSvg(source: string, embeddedFonts = false): SVGSVGElement {
	if (
		source.length > (embeddedFonts ? 12 : 6) * 1024 * 1024 ||
		/<!DOCTYPE|<!ENTITY|<\?/i.test(source)
	)
		throw new Error('Invalid SVG');
	const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
	const svg = doc.documentElement;
	if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error('Invalid SVG');
	const nodes = [svg, ...svg.querySelectorAll('*')];
	if (nodes.length > 24000) throw new Error('SVG complexity limit');
	for (const node of nodes) {
		if (node.namespaceURI !== SVG_NS || !ELEMENTS.has(node.localName))
			throw new Error('Unsafe SVG element');
		for (const attr of Array.from(node.attributes)) {
			// xml:base could turn an otherwise local #reference into a resource
			// request. The engine has no reason to emit a base URI.
			if (/^on|^(?:src|tabindex|base)$/i.test(attr.localName))
				throw new Error('Active SVG attribute');
			if (attr.localName === 'href' && !/^#[\w-]+$/.test(attr.value))
				throw new Error('External SVG reference');
			if (attr.localName !== 'xmlns' && attr.name !== 'xmlns:xlink') verifyCssValue(attr.value);
		}
		if (node.localName === 'style') {
			let css = node.textContent || '';
			if (embeddedFonts)
				css = css.replace(/@font-face\s*\{[^{}]*\}/g, (rule) => {
					const declarations = rule.replace(/@font-face\s*\{/, '').replace(/\}$/, '');
					const stripped = declarations.replace(
						/url\("data:font\/(?:woff2?|ttf);base64,[A-Za-z0-9+/=]+"\)/g,
						''
					);
					if (/url\s*\(/i.test(stripped)) throw new Error('External export font');
					verifyCssValue(stripped);
					return '';
				});
			// Mermaid emits its own edge keyframes even for static diagrams. No
			// other at-rule (imports, fonts, namespaces, etc.) is accepted here.
			verifyCssValue(css.replace(/@keyframes\s+[\w-]+\s*\{/g, '{'));
		}
	}
	const box = svg
		.getAttribute('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (
		!box ||
		box.length !== 4 ||
		box.some((n) => !Number.isFinite(n)) ||
		box[2] <= 0 ||
		box[3] <= 0 ||
		box[2] > 100000 ||
		box[3] > 100000
	)
		throw new Error('Invalid SVG dimensions');
	return document.importNode(svg, true) as unknown as SVGSVGElement;
}

function verifyCssValue(value: string) {
	// Backslash escapes and comments can conceal url()/@import. Engine CSS needs neither.
	if (/[\\@]|\/\*|(?:javascript|data|https?|file):|expression\s*\(|image-set\s*\(/i.test(value))
		throw new Error('Unsafe SVG CSS');
	for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi))
		if (!/^\s*['"]?#[\w-]+['"]?\s*$/.test(match[1])) throw new Error('External SVG CSS resource');
}
