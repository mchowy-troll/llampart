import { describe, expect, it } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { tableCsv } from '$lib/markdown/table-csv';

// Node project: a structural DOM double from the actual rendered HAST, not an HTML parser.
function dom(node: RootContent): Node {
	return {
		nodeType: node.type === 'text' ? 3 : 1,
		textContent: node.type === 'text' ? node.value : null,
		tagName: node.type === 'element' ? node.tagName.toUpperCase() : undefined,
		childNodes: node.type === 'element' ? node.children.map(dom) : []
	} as unknown as Node;
}

function elements(node: Root | Element, tag: string): Element[] {
	return node.children.flatMap((child) =>
		child.type !== 'element' ? [] : child.tagName === tag ? [child] : elements(child, tag)
	);
}

async function tables(markdown: string) {
	const processor = await createMarkdownProcessor({ disableMath: true });
	const root = (await processor.run(processor.parse(markdown))) as Root;
	return elements(root, 'table').map(
		(table) =>
			({
				rows: elements(table, 'tr').map((row) => ({
					cells: row.children
						.filter((cell) => cell.type === 'element' && ['th', 'td'].includes(cell.tagName))
						.map(dom)
				}))
			}) as unknown as HTMLTableElement
	);
}

describe('Markdown table CSV', () => {
	it('exports only the selected table, all headers/rows in order, BOM and CRLF', async () => {
		const result = await tables(
			'| Ignore |\n|---|\n| FIRST |\n\n' +
				'| Nazwa | Cena (zł) | Uwagi |\n|---|---|---|\n' +
				'| **Mleko** | 4,50 | Zwykłe |\n' +
				'| Ser "żółty" | 24,90 | Produkt, nabiał |\n' +
				'| *Łódź 東京 😀* | `-1.25` | pierwszy<br>drugi |\n' +
				'| | | |\n| Koniec | -1,25 | <ul><li>A</li><li>B<br>C</li></ul> |\n' +
				'| Liczby | -001.2500 | -1.25e-3 |'
		);
		expect(result).toHaveLength(2);
		expect(tableCsv(result[0])).toBe('\uFEFFIgnore\r\nFIRST\r\n');
		expect(tableCsv(result[1])).toBe(
			'\uFEFFNazwa,Cena (zł),Uwagi\r\n' +
				'Mleko,"4,50",Zwykłe\r\n' +
				'"Ser ""żółty""","24,90","Produkt, nabiał"\r\n' +
				'Łódź 東京 😀,-1.25,"pierwszy\ndrugi"\r\n' +
				',,\r\nKoniec,"-1,25","A\nB\nC"\r\n' +
				'Liczby,-001.2500,-1.25e-3\r\n'
		);
	});

	it('neutralizes formula signs and whitespace/control/invisible prefixes', () => {
		const values = [
			'=SUM(A1)',
			'+SUM(A1)',
			'-SUM(A1)',
			'@SUM(A1)',
			' =SUM(A1)',
			'\t=SUM(A1)',
			'\u0000=SUM(A1)',
			'\u200B=SUM(A1)',
			'\uFEFF=SUM(A1)',
			'\u2066=SUM(A1)',
			'\u034F=SUM(A1)',
			'\uFE0F=SUM(A1)',
			'\u3164=SUM(A1)',
			' \t\u0001\u200B=SUM(A1)'
		];
		const table = {
			rows: values.map((value) => ({ cells: [dom({ type: 'text', value })] }))
		} as unknown as HTMLTableElement;
		expect(tableCsv(table)).toBe('\uFEFF' + values.map((value) => `'${value}\r\n`).join(''));
	});

	it('quotes newlines and quotes without normalizing original text', () => {
		const table = {
			rows: [{ cells: [dom({ type: 'text', value: '  a,"b"\r\nc  ' })] }]
		} as unknown as HTMLTableElement;
		expect(tableCsv(table)).toBe('\uFEFF"  a,""b""\r\nc  "\r\n');
	});
});
