import { DEFAULT_FROSTED_GLASS_WALLPAPER_ID } from './wallpapers';

export const FROSTED_GLASS_SETTINGS_KEYS = {
	WALLPAPER: 'frostedGlassWallpaper',
	WALLPAPER_MILKY: 'frostedGlassWallpaperMilky'
} as const;

export const FROSTED_GLASS_CONFIG_DEFAULT = {
	frostedGlassWallpaper: DEFAULT_FROSTED_GLASS_WALLPAPER_ID,
	frostedGlassWallpaperMilky: true
} as const;

export const FROSTED_GLASS_CONFIG_INFO = {
	frostedGlassWallpaper: 'settings.info.frostedGlassWallpaper',
	frostedGlassWallpaperMilky: 'settings.info.frostedGlassWallpaperMilk'
} as const;
