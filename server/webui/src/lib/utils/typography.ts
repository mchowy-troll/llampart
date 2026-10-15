export const FONT_FAMILIES = {
	default: null,
	merriweather: 'Llampart Merriweather',
	'frank-ruhl-libre': 'Llampart Frank Ruhl Libre',
	'dm-serif-display': 'Llampart DM Serif Display'
} as const;

// Both variable families contain all of these real upright weights.
const VARIABLE_VARIANTS = [
	{ value: '400', label: 'Regular — 400' },
	{ value: '500', label: 'Medium — 500' },
	{ value: '600', label: 'SemiBold — 600' },
	{ value: '700', label: 'Bold — 700' }
];

const DISPLAY_VARIANTS = [{ value: '400', label: 'Regular — 400' }];

export function normalizeFontFamily(family: unknown): keyof typeof FONT_FAMILIES {
	return typeof family === 'string' && Object.hasOwn(FONT_FAMILIES, family)
		? (family as keyof typeof FONT_FAMILIES)
		: 'default';
}

export function getFontVariants(family: unknown) {
	return family === 'dm-serif-display'
		? DISPLAY_VARIANTS
		: family === 'merriweather' || family === 'frank-ruhl-libre'
			? VARIABLE_VARIANTS
			: [];
}

export function normalizeFontVariant(family: unknown, variant: unknown): string {
	if (family === 'default' && VARIABLE_VARIANTS.some((item) => item.value === variant))
		return String(variant);
	return getFontVariants(family).some((item) => item.value === variant) ? String(variant) : '400';
}

export function normalizeUiScalePreset(value: unknown): string {
	const preset = String(value ?? '100');
	return ['90', '95', '100', '105', '110'].includes(preset) ? preset : '100';
}

export function applyTypography(root: HTMLElement, config: SettingsConfigType): () => void {
	const family = FONT_FAMILIES[config.fontFamily as keyof typeof FONT_FAMILIES];
	const variant = normalizeFontVariant(config.fontFamily, config.fontVariant);
	const weight = Number.parseInt(variant, 10);
	if (family) {
		const display = config.fontFamily === 'dm-serif-display';
		const medium = display ? 400 : Math.max(500, weight + 50);
		const semibold = display ? 400 : Math.max(600, weight + 100);
		const bold = display ? 400 : Math.max(700, weight + 200);
		root.dataset.llampartFont = String(config.fontFamily);
		root.style.setProperty('--llampart-font-family', `"${family}"`);
		root.style.setProperty('--llampart-font-weight', String(weight));
		root.style.setProperty('--llampart-font-style', 'normal');
		root.style.setProperty('--llampart-font-medium', String(medium));
		root.style.setProperty('--llampart-font-semibold', String(semibold));
		root.style.setProperty('--llampart-font-bold', String(bold));
	}
	return () => {
		delete root.dataset.llampartFont;
		for (const name of ['family', 'weight', 'style', 'medium', 'semibold', 'bold'])
			root.style.removeProperty(`--llampart-font-${name}`);
	};
}
