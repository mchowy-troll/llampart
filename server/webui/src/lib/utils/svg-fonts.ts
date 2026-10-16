/** Discover the active local faces from CSSOM; no second font registry. */
export async function embeddedSvgFonts(families: string): Promise<string> {
	const names = families.split(',').map((name) => name.trim().replace(/^["']|["']$/g, ''));
	const rules: CSSFontFaceRule[] = [];
	function collect(list: CSSRuleList) {
		for (const rule of Array.from(list)) {
			if (
				rule instanceof CSSFontFaceRule &&
				names.includes(rule.style.fontFamily.replace(/^["']|["']$/g, ''))
			)
				rules.push(rule);
			else if ('cssRules' in rule) collect((rule as CSSGroupingRule).cssRules);
		}
	}
	for (const sheet of Array.from(document.styleSheets)) {
		try {
			collect(sheet.cssRules);
		} catch {
			/* External sheets cannot be embedded. */
		}
	}
	let totalBytes = 0;
	const embedded = [];
	for (const rule of rules.slice(0, 12)) {
		const copy = rule.style.cssText;
		const match = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
		if (!match) continue;
		const url = new URL(match[1], rule.parentStyleSheet?.href || document.baseURI);
		if (url.origin !== location.origin || !/\.(woff2?|ttf|otf)$/i.test(url.pathname)) continue;
		const response = await fetch(url);
		if (!response.ok) throw new Error('Font embedding failed');
		const bytes = new Uint8Array(await response.arrayBuffer());
		totalBytes += bytes.byteLength;
		if (totalBytes > 4 * 1024 * 1024) throw new Error('Font embedding limit');
		let binary = '';
		for (let offset = 0; offset < bytes.length; offset += 8192)
			binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
		const mime = url.pathname.endsWith('.woff2')
			? 'font/woff2'
			: url.pathname.endsWith('.woff')
				? 'font/woff'
				: 'font/ttf';
		embedded.push(
			`@font-face{${copy.replace(/url\([^)]+\)/, `url("data:${mime};base64,${btoa(binary)}")`)}}`
		);
	}
	return embedded.join('\n');
}
