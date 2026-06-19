import type { Element, ElementContent, Root, RootContent } from 'hast';
import {
	TABLE_ACTIONS_CLASS,
	TABLE_BLOCK_CLASS,
	TABLE_CELL_CONTENT_CLASS,
	TABLE_PREVIEW_BUTTON_CLASS,
	TABLE_WRAPPER_CLASS
} from '$lib/markdown/markdown-presentation';

function isElement(
	node: ElementContent | RootContent | Element | Root | undefined
): node is Element {
	return Boolean(node && node.type === 'element');
}

function hasClassName(node: Element, className: string): boolean {
	const value = node.properties?.className;

	if (Array.isArray(value)) {
		return value.includes(className);
	}

	return value === className;
}

function isTableCell(node: Element) {
	return node.tagName === 'th' || node.tagName === 'td';
}

function isTableCellContent(node: ElementContent | undefined) {
	return isElement(node) && node.tagName === 'span' && hasClassName(node, TABLE_CELL_CONTENT_CLASS);
}

function wrapTableCellContent(cell: Element) {
	if (cell.children.length === 1 && isTableCellContent(cell.children[0])) {
		return;
	}

	cell.children = [
		{
			type: 'element',
			tagName: 'span',
			properties: { className: [TABLE_CELL_CONTENT_CLASS] },
			children: cell.children
		} satisfies Element
	];
}

function createPreviewIcon(): Element {
	return {
		type: 'element',
		tagName: 'svg',
		properties: {
			xmlns: 'http://www.w3.org/2000/svg',
			width: '16',
			height: '16',
			viewBox: '0 0 24 24',
			fill: 'none',
			stroke: 'currentColor',
			strokeWidth: '2',
			strokeLinecap: 'round',
			strokeLinejoin: 'round',
			className: ['lucide', 'lucide-eye-icon', 'lucide-eye'],
			ariaHidden: 'true'
		},
		children: [
			{
				type: 'element',
				tagName: 'path',
				properties: {
					d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'
				},
				children: []
			},
			{
				type: 'element',
				tagName: 'circle',
				properties: { cx: '12', cy: '12', r: '3' },
				children: []
			}
		]
	};
}

function createTablePreviewButton(): Element {
	return {
		type: 'element',
		tagName: 'button',
		properties: {
			type: 'button',
			className: [TABLE_PREVIEW_BUTTON_CLASS],
			dataTablePreview: 'true',
			title: '',
			ariaLabel: ''
		},
		children: [createPreviewIcon()]
	};
}

function createTableBlock(table: Element): Element {
	return {
		type: 'element',
		tagName: 'div',
		properties: { className: [TABLE_BLOCK_CLASS] },
		children: [
			{
				type: 'element',
				tagName: 'div',
				properties: { className: [TABLE_ACTIONS_CLASS] },
				children: [createTablePreviewButton()]
			},
			{
				type: 'element',
				tagName: 'div',
				properties: { className: [TABLE_WRAPPER_CLASS] },
				children: [table]
			}
		]
	};
}

function wrapTablesInChildren(parent: Root | Element, insideTableWrapper = false) {
	const children = parent.children;

	for (let index = 0; index < children.length; index++) {
		const child = children[index];

		if (!isElement(child)) continue;

		if (isTableCell(child)) {
			wrapTableCellContent(child);
			continue;
		}

		if (child.tagName === 'table') {
			wrapTablesInChildren(child, false);

			if (!insideTableWrapper) {
				children[index] = createTableBlock(child);
			}

			continue;
		}

		if (child.tagName === 'div' && hasClassName(child, TABLE_BLOCK_CLASS)) {
			wrapTablesInChildren(child, false);
			continue;
		}

		if (child.tagName === 'div' && hasClassName(child, TABLE_WRAPPER_CLASS)) {
			wrapTablesInChildren(child, true);
			continue;
		}

		wrapTablesInChildren(child, false);
	}
}

/**
 * Wraps markdown tables in a scroll container without modifying the table itself.
 *
 * The plugin adds a small table preview button and wraps cell content in a span
 * so CSS can cap readable cell content width reliably without relying on
 * max-width behavior of table cells. It is intentionally idempotent for tables
 * and cells that are already wrapped.
 */
export function rehypeWrapTables() {
	return (tree: Root) => {
		wrapTablesInChildren(tree);
	};
}
