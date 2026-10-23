/** Discover the active local faces from CSSOM; no second font registry. */
export async function embeddedSvgFonts(families: string, source: HTMLElement): Promise<string> {
	const weightNumber = (weight: string) =>
		weight === 'normal' ? 400 : weight === 'bold' ? 700 : Number(weight);
	const names = families.split(',').map((name) => name.trim().replace(/^["']|["']$/g, ''));
	const nodes: Element[] = [source, ...Array.from(source.querySelectorAll('*'))];
	// Diagram text lives in open shadow roots; include its actual bold/italic
	// faces too, without a second font registry or new embedding limits.
	for (const node of nodes) {
		if (node.shadowRoot) nodes.push(...Array.from(node.shadowRoot.querySelectorAll('*')));
	}
	const used = nodes.map((node) => {
		const style = getComputedStyle(node);
		return { weight: weightNumber(style.fontWeight), style: style.fontStyle };
	});
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
	// A static family has separate files per weight. Keep the existing limits,
	// but do not let unused italic faces displace the actual upright chart faces.
	const needed = rules.filter((rule) => {
		const weights = rule.style.fontWeight.split(/\s+/).map(weightNumber);
		return used.some(
			(face) =>
				face.style === rule.style.fontStyle &&
				face.weight >= weights[0] &&
				face.weight <= (weights[1] ?? weights[0])
		);
	});
	if (needed.length > 12) throw new Error('Font face embedding limit');
	for (const rule of needed) {
		const copy = rule.style.cssText;
		const match = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue('src'));
		if (!match) continue;
		// Vite inlines smaller local fonts (including KaTeX) in production.
		if (/^data:font\/(?:woff2?|ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(match[1])) {
			totalBytes += match[1].length;
			if (totalBytes > 4 * 1024 * 1024) throw new Error('Font embedding limit');
			embedded.push(`@font-face{${copy}}`);
			continue;
		}
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
