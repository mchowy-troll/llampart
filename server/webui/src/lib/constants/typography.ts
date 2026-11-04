/** The only selectable font catalog. Internal fallbacks are not Settings options. */
export const FONT_CATALOG = {
	merriweather: {
		label: 'Merriweather',
		families: ['Llampart Merriweather', 'Llampart Tinos'],
		weights: [400, 500, 600, 700],
		variable: true,
		maxWeight: 900
	},
	'google-sans': {
		label: 'Google Sans',
		families: ['Google Sans'],
		weights: [400, 500, 600, 700],
		variable: true,
		maxWeight: 700
	},
	barlow: {
		label: 'Barlow',
		families: ['Llampart Barlow', 'Llampart Inter'],
		weights: [400, 500, 600, 700],
		variable: false,
		maxWeight: 700
	},
	inter: {
		label: 'Inter',
		families: ['Llampart Inter'],
		weights: [400, 500, 600, 700],
		variable: true,
		maxWeight: 900
	},
	'fira-sans': {
		label: 'Fira Sans',
		families: ['Llampart Fira Sans'],
		weights: [400, 500, 600, 700],
		variable: false,
		maxWeight: 700
	},
	literata: {
		label: 'Literata',
		families: ['Literata'],
		weights: [400, 500, 600, 700],
		variable: true,
		maxWeight: 900
	},
	domine: {
		label: 'Domine',
		families: ['Domine', 'Literata'],
		weights: [400, 500, 600, 700],
		variable: true,
		maxWeight: 700
	}
} as const;

export type FontFamilyId = keyof typeof FONT_CATALOG;
export type FontFamilySetting = FontFamilyId | 'default';

/** Retired IDs are accepted only at the settings migration boundary. */
export const RETIRED_FONT_IDS = [
	'frank-ruhl-libre',
	'crimson-text',
	'libre-caslon-condensed'
] as const;

export const FONT_WEIGHT_LABELS = {
	400: 'Regular — 400',
	500: 'Medium — 500',
	600: 'SemiBold — 600',
	700: 'Bold — 700'
} as const;
