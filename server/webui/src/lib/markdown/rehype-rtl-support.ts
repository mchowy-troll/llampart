/**
 * Rehype plugin to provide comprehensive RTL support by adding dir="auto"
 * to all text-containing elements.
 *
 * This operates directly on the HAST tree, ensuring that all elements
 * (including those not in a predefined list) receive the attribute.
 */

import type { Plugin } from 'unified';
import type { Root, Element } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

/**
 * Rehype plugin to add dir="auto" to all elements that have children.
 * This provides bidirectional text support for mixed RTL/LTR content.
 */

function hasClassName(node: Element, className: string): boolean {
	const classNameValue = node.properties?.className;

	if (Array.isArray(classNameValue)) {
		return classNameValue.includes(className);
	}

	if (typeof classNameValue === 'string') {
		return classNameValue.split(/\s+/).includes(className);
	}

	return false;
}

function isKatexElement(node: Element): boolean {
	return (
		hasClassName(node, 'katex') ||
		hasClassName(node, 'katex-display') ||
		hasClassName(node, 'katex-mathml') ||
		hasClassName(node, 'katex-html')
	);
}

export const rehypeRtlSupport: Plugin<[], Root> = () => {
	return (tree: Root) => {
		visit(tree, 'element', (node: Element) => {
			if (isKatexElement(node)) {
				return SKIP;
			}

			if (node.children && node.children.length > 0) {
				node.properties = {
					...node.properties,
					dir: 'auto'
				};
			}
		});
	};
};
