import type { Element, ElementContent, Root, RootContent } from 'hast';

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
	return isElement(node) && node.tagName === 'span' && hasClassName(node, 'table-cell-content');
}

function wrapTableCellContent(cell: Element) {
	if (cell.children.length === 1 && isTableCellContent(cell.children[0])) {
		return;
	}

	cell.children = [
		{
			type: 'element',
			tagName: 'span',
			properties: { className: ['table-cell-content'] },
			children: cell.children
		} satisfies Element
	];
}

function createTablePreviewButton(): Element {
	return {
		type: 'element',
		tagName: 'button',
		properties: {
			type: 'button',
			className: ['table-preview-button'],
			dataTablePreview: 'true',
			title: 'Preview table',
			ariaLabel: 'Preview table'
		},
		children: [{ type: 'text', value: '⛶' }]
	};
}

function createTableBlock(table: Element): Element {
	return {
		type: 'element',
		tagName: 'div',
		properties: { className: ['table-block'] },
		children: [
			{
				type: 'element',
				tagName: 'div',
				properties: { className: ['table-actions'] },
				children: [createTablePreviewButton()]
			},
			{
				type: 'element',
				tagName: 'div',
				properties: { className: ['table-wrapper'] },
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

		if (child.tagName === 'div' && hasClassName(child, 'table-block')) {
			wrapTablesInChildren(child, false);
			continue;
		}

		if (child.tagName === 'div' && hasClassName(child, 'table-wrapper')) {
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
