import { Sparkles } from '@lucide/svelte';
import { ColorMode } from '$lib/enums/ui';
import type { ThemeDefinition } from '../types';
import { FROSTED_GLASS_CONFIG_DEFAULT, FROSTED_GLASS_CONFIG_INFO } from './config';
import {
	beginWallpaperSettingsPreview,
	CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT,
	getFrostedGlassWallpaper,
	resolveCustomWallpaperDisplaySrc
} from './wallpapers';
import { GLASS_STYLE_PROPERTIES, resolveGlassMaterials } from './materials';
import {
	FALLBACK_WALLPAPER_ACCENT,
	resolveWallpaperAccent,
	WALLPAPER_ACCENT_EVENT
} from './wallpaper-accent';
import { CHART_STYLE_PROPERTIES, resolveChartPalette } from './chart-palette';
import {
	BUNDLED_WALLPAPER_CACHE_EVENT,
	resolveBundledWallpaperSrc
} from './bundled-wallpaper-cache';

export const frostedGlassTheme = {
	id: ColorMode.FROSTED_GLASS,
	labelKey: 'settings.themeFrostedGlass',
	icon: Sparkles,
	colorScheme: 'light',
	rootClass: 'has-frosted-glass-theme',
	ownedClasses: [
		'has-frosted-glass-theme',
		'has-frosted-glass-wallpaper-milk',
		'has-frosted-glass-opaque'
	],
	ownedStyleProperties: [
		'--llampart-theme-wallpaper',
		'--llampart-frosted-glass-accent',
		...CHART_STYLE_PROPERTIES,
		...GLASS_STYLE_PROPERTIES
	],
	runtimeRefreshEvents: [
		CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT,
		WALLPAPER_ACCENT_EVENT,
		BUNDLED_WALLPAPER_CACHE_EVENT
	],
	beginSettingsPreview: beginWallpaperSettingsPreview,
	motion: {
		messageEntry: false,
		screenTransitions: false
	},
	configDefaults: FROSTED_GLASS_CONFIG_DEFAULT,
	configInfo: FROSTED_GLASS_CONFIG_INFO,
	resolveRuntime: (config, revision) => {
		const selected = getFrostedGlassWallpaper(config.frostedGlassWallpaper, revision);
		const wallpaper = {
			...selected,
			src: selected.isCustom
				? resolveCustomWallpaperDisplaySrc(selected.src)
				: resolveBundledWallpaperSrc(selected.src)
		};
		const accent = wallpaper.src ? resolveWallpaperAccent(wallpaper) : FALLBACK_WALLPAPER_ACCENT;

		return {
			// This legacy class now enables ONLY the protected composer fade layers.
			// global.css renders the unmodified wallpaper with no milk overlay.
			classes: [
				'has-frosted-glass-wallpaper-milk',
				...(config.frostedGlassOpaque ? ['has-frosted-glass-opaque'] : [])
			],
			styles: {
				...resolveChartPalette(),
				...resolveGlassMaterials(config),
				'--llampart-frosted-glass-accent': accent,
				'--llampart-theme-wallpaper': wallpaper.src ? `url("${wallpaper.src}")` : 'none'
			}
		};
	}
} as const satisfies ThemeDefinition;

export * from './wallpapers';
