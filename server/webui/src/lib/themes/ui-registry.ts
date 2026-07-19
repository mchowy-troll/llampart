import type { Component } from 'svelte';
import { ColorMode } from '$lib/enums/ui';
import { normalizeThemeId } from './registry';
import FrostedGlassSettingsPanel from './frosted-glass/SettingsPanel.svelte';

type ThemeSettingsPanel = Component<{
	config: SettingsConfigType;
	onConfigChange: (key: string, value: string | boolean) => void;
}>;

const THEME_SETTINGS_PANELS: Partial<Record<ColorMode, ThemeSettingsPanel>> = {
	[ColorMode.FROSTED_GLASS]: FrostedGlassSettingsPanel
};

export function getThemeSettingsPanel(themeId: unknown): ThemeSettingsPanel | undefined {
	return THEME_SETTINGS_PANELS[normalizeThemeId(themeId)];
}
