import { Sparkles } from '@lucide/svelte';
import { ColorMode } from '$lib/enums/ui';
import type { ThemeDefinition } from '../types';
import { FROSTED_GLASS_CONFIG_DEFAULT, FROSTED_GLASS_CONFIG_INFO } from './config';
import { CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT, getFrostedGlassWallpaper } from './wallpapers';

export const frostedGlassTheme = {
	id: ColorMode.FROSTED_GLASS,
	labelKey: 'settings.themeFrostedGlass',
	icon: Sparkles,
	colorScheme: 'light',
	rootClass: 'has-frosted-glass-theme',
	ownedClasses: ['has-frosted-glass-theme', 'has-frosted-glass-wallpaper-milk'],
	ownedStyleProperties: ['--llampart-theme-wallpaper'],
	runtimeRefreshEvents: [CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT],
	motion: {
		messageEntry: false,
		screenTransitions: false
	},
	configDefaults: FROSTED_GLASS_CONFIG_DEFAULT,
	configInfo: FROSTED_GLASS_CONFIG_INFO,
	resolveRuntime: (config, revision) => {
		const wallpaper = getFrostedGlassWallpaper(config.frostedGlassWallpaper, revision);

		return {
			classes: config.frostedGlassWallpaperMilky ? ['has-frosted-glass-wallpaper-milk'] : [],
			styles: {
				'--llampart-theme-wallpaper': `url("${wallpaper.src}")`
			}
		};
	}
} as const satisfies ThemeDefinition;

export * from './wallpapers';
