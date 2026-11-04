function familyNames(families: string): string[] {
	return families.split(',').map((name) => name.trim().replace(/^["']|["']$/g, ''));
}

function covers(rule: CSSFontFaceRule, codepoint: number): boolean {
	const range = rule.style.getPropertyValue('unicode-range');
	if (!range) return true;
	return range.split(',').some((part) => {
		const value = part.trim().replace(/^U\+/i, '');
		const [start, end = start] = value.includes('?')
			? [value.replaceAll('?', '0'), value.replaceAll('?', 'F')]
			: value.split('-');
		return codepoint >= parseInt(start, 16) && codepoint <= parseInt(end, 16);
	});
}

const weightNumber = (weight: string) =>
	weight === 'normal' ? 400 : weight === 'bold' ? 700 : Number(weight);

/** CSS Fonts weight matching, including static fallbacks of a variable family. */
function weightRank(rule: CSSFontFaceRule, target: number): number {
	const [min, max = min] = rule.style.fontWeight.split(/\s+/).map(weightNumber);
	if (target >= min && target <= max) return 0;
	const weight = target < min ? min : max;
	if (target >= 400 && target <= 500) {
		if (weight >= target && weight <= 500) return weight - target;
		return weight < target ? 1000 + target - weight : 2000 + weight - target;
	}
	return (target < 400 ? weight <= target : weight >= target)
		? Math.abs(weight - target)
		: 1000 + Math.abs(weight - target);
}

/** Discover used local faces from CSSOM and actual text; no second font registry. */
export async function embeddedSvgFonts(
	families: string,
	source: HTMLElement,
	textSources: Element[] = [source]
): Promise<string> {
	const names = familyNames(families);
	const nodes: Element[] = textSources.flatMap((node) => [
		node,
		...Array.from(node.querySelectorAll('*'))
	]);
	// Diagram text lives in open shadow roots; include its actual bold/italic
	// faces too, without a second font registry or new embedding limits.
	for (const node of nodes) {
		if (node.shadowRoot) nodes.push(...Array.from(node.shadowRoot.querySelectorAll('*')));
	}
	const used = nodes.flatMap((node) => {
		if (['STYLE', 'SCRIPT', 'style', 'script'].includes(node.nodeName)) return [];
		const text = Array.from(node.childNodes)
			.filter((child) => child.nodeType === 3)
			.map((child) => child.textContent ?? '')
			.join('');
		if (!text.trim()) return [];
		const style = getComputedStyle(node);
		return [
			{
				weight: weightNumber(style.fontWeight),
				style: style.fontStyle,
				families: familyNames(style.fontFamily),
				text
			}
		];
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
	const needed = new Set<CSSFontFaceRule>();
	for (const face of used) {
		for (const char of new Set(face.text)) {
			const codepoint = char.codePointAt(0)!;
			for (const family of face.families) {
				const familyRules = rules.filter(
					(rule) => familyNames(rule.style.fontFamily)[0] === family
				);
				const matchedStyle = familyRules.some((rule) => rule.style.fontStyle === face.style)
					? face.style
					: 'normal';
				const candidates = familyRules.filter(
					(rule) => rule.style.fontStyle === matchedStyle && covers(rule, codepoint)
				);
				// Later same-range declarations win, as in CSS. Never embed unrelated
				// Cyrillic/Greek styles just because they share the selected family.
				candidates
					.reverse()
					.sort((a, b) => weightRank(a, face.weight) - weightRank(b, face.weight));
				if (candidates[0]) {
					needed.add(candidates[0]);
					break;
				}
			}
		}
	}
	if (needed.size > 12) throw new Error('Font face embedding limit');
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
