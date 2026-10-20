import { DEFAULT_FROSTED_GLASS_WALLPAPER_ID } from './wallpapers';

export const FROSTED_GLASS_SETTINGS_KEYS = {
	WALLPAPER: 'frostedGlassWallpaper',
	MILKINESS: 'frostedGlassMilkiness',
	OPAQUE: 'frostedGlassOpaque'
} as const;

export const FROSTED_GLASS_CONFIG_DEFAULT = {
	frostedGlassWallpaper: DEFAULT_FROSTED_GLASS_WALLPAPER_ID,
	frostedGlassMilkiness: 75,
	frostedGlassOpaque: false
} as const;

export const FROSTED_GLASS_CONFIG_INFO = {
	frostedGlassWallpaper: 'settings.info.frostedGlassWallpaper',
	frostedGlassMilkiness: 'settings.info.frostedGlassMilkiness',
	frostedGlassOpaque: 'settings.info.frostedGlassOpaque'
} as const;
