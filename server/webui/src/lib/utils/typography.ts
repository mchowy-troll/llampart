export const FONT_FAMILIES = {
	default: null,
	merriweather: 'Llampart Merriweather',
	'frank-ruhl-libre': 'Llampart Frank Ruhl Libre',
	'crimson-text': 'Llampart Crimson Text',
	'libre-caslon-condensed': 'Llampart Libre Caslon Condensed',
	'fira-sans': 'Llampart Fira Sans'
} as const;

// Offered weights must exist in the local upright faces (not necessarily variable).
const VARIABLE_VARIANTS = [
	{ value: '400', label: 'Regular — 400' },
	{ value: '500', label: 'Medium — 500' },
	{ value: '600', label: 'SemiBold — 600' },
	{ value: '700', label: 'Bold — 700' }
];

export const FONT_SIZES = ['12', '13', '14', '15', '16', '17', '18', '19', '20'] as const;

export function normalizeFontSize(value: unknown): string {
	return FONT_SIZES.some((size) => size === value) ? String(value) : 'default';
}

export function normalizeFontFamily(family: unknown): keyof typeof FONT_FAMILIES {
	return typeof family === 'string' && Object.hasOwn(FONT_FAMILIES, family)
		? (family as keyof typeof FONT_FAMILIES)
		: 'default';
}

export function getFontVariants(family: unknown) {
	if (family === 'crimson-text') return VARIABLE_VARIANTS.filter((item) => item.value !== '500');
	return normalizeFontFamily(family) !== 'default' ? VARIABLE_VARIANTS : [];
}

export function normalizeFontVariant(family: unknown, variant: unknown): string {
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
	const size = normalizeFontSize(config.fontSize);
	if (size !== 'default') root.style.setProperty('--llampart-text-unit', `${size}px`);
	let stopPixelSizeUpdates = () => {};
	if (size !== 'default' && typeof window !== 'undefined') {
		// Small existing px badges also follow text size, without scaling their boxes.
		// Track UI Scale as well as viewport changes: rem remains the untouched baseline.
		void config.uiScale;
		const syncPixelSizes = () =>
			root.style.setProperty(
				'--llampart-fixed-text-scale',
				String(Number(size) / parseFloat(getComputedStyle(root).fontSize))
			);
		syncPixelSizes();
		window.addEventListener('resize', syncPixelSizes);
		stopPixelSizeUpdates = () => window.removeEventListener('resize', syncPixelSizes);
	}
	if (family) {
		const variable =
			config.fontFamily === 'merriweather' || config.fontFamily === 'frank-ruhl-libre';
		const realWeight = (target: number) => {
			const weights = getFontVariants(config.fontFamily).map((item) => Number(item.value));
			return weights.find((value) => value >= target) ?? weights[weights.length - 1];
		};
		const medium = variable ? Math.max(500, weight + 50) : realWeight(Math.max(500, weight + 50));
		const semibold = variable
			? Math.max(600, weight + 100)
			: realWeight(Math.max(600, weight + 100));
		const bold = variable ? Math.max(700, weight + 200) : realWeight(Math.max(700, weight + 200));
		root.dataset.llampartFont = String(config.fontFamily);
		root.style.setProperty('--llampart-font-family', `"${family}"`);
		root.style.setProperty('--llampart-font-weight', String(weight));
		root.style.setProperty('--llampart-font-style', 'normal');
		root.style.setProperty('--llampart-font-medium', String(medium));
		root.style.setProperty('--llampart-font-semibold', String(semibold));
		root.style.setProperty('--llampart-font-bold', String(bold));
	}
	return () => {
		stopPixelSizeUpdates();
		root.style.removeProperty('--llampart-fixed-text-scale');
		root.style.removeProperty('--llampart-text-unit');
		delete root.dataset.llampartFont;
		for (const name of ['family', 'weight', 'style', 'medium', 'semibold', 'bold'])
			root.style.removeProperty(`--llampart-font-${name}`);
	};
}
