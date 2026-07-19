import { ColorMode } from '$lib/enums/ui';
import { frostedGlassTheme } from './frosted-glass';
import type { ThemeDefinition } from './types';

export const DEFAULT_THEME_ID = ColorMode.FROSTED_GLASS;

export const THEME_REGISTRY = {
	[ColorMode.FROSTED_GLASS]: frostedGlassTheme
} as const satisfies Record<ColorMode, ThemeDefinition>;

export const THEME_CONFIG_DEFAULTS = Object.assign(
	{},
	...Object.values(THEME_REGISTRY).map((theme) => theme.configDefaults)
);

export const THEME_CONFIG_INFO = Object.assign(
	{},
	...Object.values(THEME_REGISTRY).map((theme) => theme.configInfo)
);

export function normalizeThemeId(value: unknown): ColorMode {
	return typeof value === 'string' && Object.hasOwn(THEME_REGISTRY, value)
		? (value as ColorMode)
		: DEFAULT_THEME_ID;
}

export function getThemeDefinition(value: unknown): ThemeDefinition {
	return THEME_REGISTRY[normalizeThemeId(value)];
}

export function getThemeOptions() {
	return Object.values(THEME_REGISTRY).map(({ id, labelKey, icon }) => ({
		value: id,
		labelKey,
		icon
	}));
}
