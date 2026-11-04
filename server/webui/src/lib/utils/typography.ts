import {
	FONT_CATALOG,
	FONT_WEIGHT_LABELS,
	RETIRED_FONT_IDS,
	type FontFamilyId,
	type FontFamilySetting
} from '$lib/constants/typography';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';

export const FONT_SIZES = ['12', '13', '14', '15', '16', '17', '18', '19', '20'] as const;

export function normalizeFontSize(value: unknown): string {
	return FONT_SIZES.some((size) => size === value) ? String(value) : 'default';
}

export function normalizeFontFamily(family: unknown): FontFamilySetting {
	if (RETIRED_FONT_IDS.some((id) => id === family)) return 'merriweather';
	return typeof family === 'string' && Object.hasOwn(FONT_CATALOG, family)
		? (family as FontFamilyId)
		: 'default';
}

/** Keep the persisted sentinel, resolving it only at the typography boundary. */
export function resolveFontFamily(family: unknown): FontFamilyId {
	const normalized = normalizeFontFamily(family);
	return normalized === 'default' ? SETTING_CONFIG_DEFAULT.fontFamily : normalized;
}

export function resolveFontSize(size: unknown): string {
	const normalized = normalizeFontSize(size);
	return normalized === 'default' ? SETTING_CONFIG_DEFAULT.fontSize : normalized;
}

export function getFontVariants(family: unknown) {
	return FONT_CATALOG[resolveFontFamily(family)].weights.map((weight) => ({
		value: String(weight),
		label: FONT_WEIGHT_LABELS[weight]
	}));
}

export function normalizeFontVariant(family: unknown, variant: unknown): string {
	if (normalizeFontFamily(family) === 'default' || variant === 'default')
		return SETTING_CONFIG_DEFAULT.fontVariant;
	return getFontVariants(family).some((item) => item.value === variant) ? String(variant) : '400';
}

export function normalizeUiScalePreset(value: unknown): string {
	const preset = String(value ?? '100');
	return ['90', '95', '100', '105', '110'].includes(preset) ? preset : '100';
}

export function applyTypography(root: HTMLElement, config: SettingsConfigType): () => void {
	const familyId = resolveFontFamily(config.fontFamily);
	const family = FONT_CATALOG[familyId];
	const variant = normalizeFontVariant(config.fontFamily, config.fontVariant);
	const weight = Number.parseInt(variant, 10);
	const size = resolveFontSize(config.fontSize);
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
		const variable = family.variable;
		const realWeight = (target: number) => {
			const weights = getFontVariants(familyId).map((item) => Number(item.value));
			return weights.find((value) => value >= target) ?? weights[weights.length - 1];
		};
		const medium = variable
			? Math.min(family.maxWeight, Math.max(500, weight + 50))
			: realWeight(Math.max(500, weight + 50));
		const semibold = variable
			? Math.min(family.maxWeight, Math.max(600, weight + 100))
			: realWeight(Math.max(600, weight + 100));
		const bold = variable
			? Math.min(family.maxWeight, Math.max(700, weight + 200))
			: realWeight(Math.max(700, weight + 200));
		root.dataset.llampartFont = familyId;
		root.style.setProperty(
			'--llampart-font-family',
			family.families.map((name) => `"${name}"`).join(', ')
		);
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
