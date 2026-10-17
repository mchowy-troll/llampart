import { describe, expect, it } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import { createMarkdownProcessor } from '$lib/markdown/markdown-runtime';
import { tableCsv, tableCsvFilename } from '$lib/markdown/table-csv';

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
				'| | | |\n| Koniec | -1,25 | <ul><li>A</li><li>B<br>C</li></ul> |'
		);
		expect(result).toHaveLength(2);
		expect(tableCsv(result[0])).toBe('\uFEFFIgnore\r\nFIRST\r\n');
		expect(tableCsv(result[1])).toBe(
			'\uFEFFNazwa,Cena (zł),Uwagi\r\n' +
				'Mleko,"4,50",Zwykłe\r\n' +
				'"Ser ""żółty""","24,90","Produkt, nabiał"\r\n' +
				'Łódź 東京 😀,-1.25,"pierwszy\ndrugi"\r\n' +
				',,\r\nKoniec,"-1,25","A\nB\nC"\r\n'
		);
	});
	it.each(['=', '+', '-', '@'])(
		'neutralizes %s after whitespace/control/invisible prefixes',
		async (sign) => {
			for (const prefix of [
				'',
				' ',
				'\t',
				'\u0000',
				'\u200B',
				'\uFEFF',
				'\u2066',
				'\u034F',
				'\uFE0F',
				'\u3164',
				' \t\u0001\u200B'
			]) {
				const value = `${prefix}${sign}SUM(A1)`;
				const table = {
					rows: [{ cells: [dom({ type: 'text', value })] }]
				} as unknown as HTMLTableElement;
				expect(tableCsv(table)).toBe(`\uFEFF'${value}\r\n`);
			}
		}
	);
	it.each(['-12', '-1.25', '-1,25', '-001.2500', '-1.25e-3'])(
		'preserves numeric text %s exactly',
		async (value) => {
			const [table] = await tables(`| Number |\n|---|\n| ${value} |`);
			expect(tableCsv(table)).toBe(
				`\uFEFFNumber\r\n${value.includes(',') ? `"${value}"` : value}\r\n`
			);
		}
	);
	it('quotes newlines and quotes without normalizing original text', () => {
		const table = {
			rows: [{ cells: [dom({ type: 'text', value: '  a,"b"\r\nc  ' })] }]
		} as unknown as HTMLTableElement;
		expect(tableCsv(table)).toBe('\uFEFF"  a,""b""\r\nc  "\r\n');
	});
	it.each([1, 2, 100, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'uses bounded numeric-only filenames (%s)',
		(index) => {
			expect(tableCsvFilename(index)).toBe(
				`table-${Number.isSafeInteger(index) && index > 0 ? index : 1}.csv`
			);
			expect(tableCsvFilename(index)).toMatch(/^table-\d+\.csv$/);
		}
	);
});
