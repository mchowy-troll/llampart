/**
 * Rehype plugin to validate link destinations and add security attributes.
 *
 * Unsafe anchors retain their children but lose navigation attributes.
 */

import type { Plugin } from 'unified';
import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeHref(href: unknown): boolean {
	if (typeof href !== 'string' || !href.trim()) return false;
	try {
		return ALLOWED_PROTOCOLS.has(new URL(href, 'https://llampart.invalid/').protocol);
	} catch {
		return false;
	}
}

/**
 * Validate every anchor href, preserving safe destinations unchanged and adding:
 * - target="_blank"
 * - rel="noopener noreferrer"
 */
export const rehypeEnhanceLinks: Plugin<[], Root> = () => {
	return (tree: Root) => {
		visit(tree, 'element', (node: Element) => {
			if (node.tagName !== 'a') return;

			const props = (node.properties ??= {});
			if (!isSafeHref(props.href)) {
				delete props.href;
				delete props.target;
				delete props.rel;
				return;
			}

			props.target = '_blank';
			props.rel = 'noopener noreferrer';
		});
	};
};
