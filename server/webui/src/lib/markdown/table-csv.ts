import { serializeCsv } from '$lib/utils/csv';

/** Read semantic line breaks, not CSS wrapping or list markers. Never parse cell HTML. */
function cellText(node: Node): string {
	if (node.nodeType === 3) return node.textContent ?? '';
	if (node.nodeType !== 1) return '';
	const element = node as Element;
	if (element.tagName === 'BR') return '\n';
	const children = Array.from(element.childNodes);
	return children
		.map((child, index) => {
			const separator =
				index > 0 &&
				child.nodeType === 1 &&
				(child as Element).tagName === 'LI' &&
				children[index - 1].nodeType === 1 &&
				(children[index - 1] as Element).tagName === 'LI'
					? '\n'
					: '';
			return separator + cellText(child);
		})
		.join('');
}

/** The caller supplies the live, selected table; surrounding action chrome is never read. */
export function tableCsv(table: HTMLTableElement): string {
	return serializeCsv(
		Array.from(table.rows, (row) => Array.from(row.cells, (cell) => cellText(cell))),
		true
	);
}

export function tableCsvFilename(index: number): string {
	return `table-${Number.isSafeInteger(index) && index > 0 ? index : 1}.csv`;
}
