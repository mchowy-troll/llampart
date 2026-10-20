import type { ThemeSettingsPreview } from '../types';

export const DEFAULT_FROSTED_GLASS_WALLPAPER_ID = 'frosted-glass-03';
export const CUSTOM_FROSTED_GLASS_WALLPAPER_ID = 'frosted-glass-user';
export const CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY =
	'llampart:frosted-glass:user-wallpaper';
const LLAMPART_LEGACY_CUSTOM_WALLPAPER_LOCALSTORAGE_KEYS = [
	'llamaCppWebui.backgroundImage'
] as const;
export const CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT = 'llampart:frosted-glass:user-wallpaper-change';
export const CUSTOM_FROSTED_GLASS_WALLPAPER_MAX_SIZE_BYTES = 3 * 1024 * 1024;
export const CUSTOM_FROSTED_GLASS_WALLPAPER_ACCEPT = 'image/png,image/jpeg';

const CUSTOM_FROSTED_GLASS_WALLPAPER_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg);base64,/i;

export type FrostedGlassWallpaper = Readonly<{
	id: string;
	labelKey: string;
	src: string;
	isCustom?: boolean;
}>;

export const FROSTED_GLASS_WALLPAPERS = [
	{
		id: 'frosted-glass-01',
		labelKey: 'settings.frostedGlassWallpaper01',
		src: '/wallpapers/frosted-glass/frosted-glass-01.jpg'
	},
	{
		id: 'frosted-glass-02',
		labelKey: 'settings.frostedGlassWallpaper02',
		src: '/wallpapers/frosted-glass/frosted-glass-02.jpg'
	},
	{
		id: 'frosted-glass-03',
		labelKey: 'settings.frostedGlassWallpaper03',
		src: '/wallpapers/frosted-glass/frosted-glass-03.jpg'
	},
	{
		id: 'frosted-glass-04',
		labelKey: 'settings.frostedGlassWallpaper04',
		src: '/wallpapers/frosted-glass/frosted-glass-04.jpg'
	},
	{
		id: 'frosted-glass-05',
		labelKey: 'settings.frostedGlassWallpaper05',
		src: '/wallpapers/frosted-glass/frosted-glass-05.jpg'
	}
] as const satisfies readonly FrostedGlassWallpaper[];

export function isAcceptedCustomFrostedGlassWallpaperType(type: string): boolean {
	return type === 'image/png' || type === 'image/jpeg';
}

export function normalizeCustomFrostedGlassWallpaperSrc(src: unknown): string | undefined {
	if (typeof src !== 'string') return undefined;

	const trimmed = src.trim();
	if (!CUSTOM_FROSTED_GLASS_WALLPAPER_DATA_URL_PATTERN.test(trimmed)) return undefined;

	return trimmed;
}

let wallpaperPreview: { src: string | undefined; changed: boolean } | undefined;

export function getCustomWallpaperPreviewSession(): unknown {
	return wallpaperPreview;
}

export function beginWallpaperSettingsPreview(): ThemeSettingsPreview {
	const draft = { src: getCustomFrostedGlassWallpaperSrc(), changed: false };
	wallpaperPreview = draft;
	return {
		commit: (committedConfig) => {
			if (wallpaperPreview !== draft) {
				return {
					ok: false,
					messageKey: 'settings.frostedGlassWallpaperSaveError',
					configPatch: {}
				};
			}
			wallpaperPreview = undefined;
			if (!draft.changed) return { ok: true };
			const saved = draft.src
				? setCustomFrostedGlassWallpaperSrc(draft.src)
				: clearCustomFrostedGlassWallpaperSrc();
			if (saved) return { ok: true };

			// Delete-before-write is intentional: do not retain an old image for rollback.
			// A failed image must not remain visible as if it had been saved. Keep the
			// session usable for another upload, with only the actual stored resource.
			draft.src = getCustomFrostedGlassWallpaperSrc();
			draft.changed = false;
			wallpaperPreview = draft;
			notifyCustomFrostedGlassWallpaperChange();
			return {
				ok: false,
				messageKey: 'settings.frostedGlassWallpaperSaveError',
				configPatch: {
					frostedGlassWallpaper:
						committedConfig.frostedGlassWallpaper === CUSTOM_FROSTED_GLASS_WALLPAPER_ID &&
						!draft.src
							? DEFAULT_FROSTED_GLASS_WALLPAPER_ID
							: committedConfig.frostedGlassWallpaper
				}
			};
		},
		cancel: () => {
			if (wallpaperPreview !== draft) return;
			wallpaperPreview = undefined;
			notifyCustomFrostedGlassWallpaperChange();
		}
	};
}

export function getCustomFrostedGlassWallpaperSrc(): string | undefined {
	if (wallpaperPreview) return wallpaperPreview.src;
	try {
		if (typeof globalThis.localStorage === 'undefined') return undefined;

		return normalizeCustomFrostedGlassWallpaperSrc(
			globalThis.localStorage.getItem(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY)
		);
	} catch {
		return undefined;
	}
}

export function clearStoredCustomWallpaperData(): void {
	if (typeof globalThis.localStorage === 'undefined') return;

	globalThis.localStorage.removeItem(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY);

	for (const key of LLAMPART_LEGACY_CUSTOM_WALLPAPER_LOCALSTORAGE_KEYS) {
		globalThis.localStorage.removeItem(key);
	}
}

function notifyCustomFrostedGlassWallpaperChange(): void {
	if (typeof globalThis.dispatchEvent !== 'function') return;

	globalThis.dispatchEvent(new CustomEvent(CUSTOM_FROSTED_GLASS_WALLPAPER_EVENT));
}

export function setCustomFrostedGlassWallpaperSrc(src: string): boolean {
	const normalized = normalizeCustomFrostedGlassWallpaperSrc(src);
	if (!normalized) return false;
	if (wallpaperPreview) {
		wallpaperPreview.src = normalized;
		wallpaperPreview.changed = true;
		notifyCustomFrostedGlassWallpaperChange();
		return true;
	}

	try {
		if (typeof globalThis.localStorage === 'undefined') return false;

		clearStoredCustomWallpaperData();
		globalThis.localStorage.setItem(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY, normalized);

		if (
			globalThis.localStorage.getItem(CUSTOM_FROSTED_GLASS_WALLPAPER_LOCALSTORAGE_KEY) !==
			normalized
		) {
			throw new Error('Custom wallpaper localStorage verification failed.');
		}

		notifyCustomFrostedGlassWallpaperChange();
		return true;
	} catch {
		try {
			clearStoredCustomWallpaperData();
		} catch {
			// Ignore cleanup errors.
		}

		notifyCustomFrostedGlassWallpaperChange();
		return false;
	}
}

export function clearCustomFrostedGlassWallpaperSrc(): boolean {
	if (wallpaperPreview) {
		wallpaperPreview.src = undefined;
		wallpaperPreview.changed = true;
		notifyCustomFrostedGlassWallpaperChange();
		return true;
	}
	try {
		clearStoredCustomWallpaperData();
		if (getCustomFrostedGlassWallpaperSrc() !== undefined) return false;
	} catch {
		notifyCustomFrostedGlassWallpaperChange();
		return false;
	}

	notifyCustomFrostedGlassWallpaperChange();
	return true;
}

export function getFrostedGlassWallpaper(
	wallpaperId: unknown,
	customWallpaperRevision?: unknown
): FrostedGlassWallpaper {
	void customWallpaperRevision;

	if (wallpaperId === CUSTOM_FROSTED_GLASS_WALLPAPER_ID) {
		const customSrc = getCustomFrostedGlassWallpaperSrc();

		if (customSrc) {
			return {
				id: CUSTOM_FROSTED_GLASS_WALLPAPER_ID,
				labelKey: 'settings.frostedGlassWallpaperUser',
				src: customSrc,
				isCustom: true
			};
		}
	}

	if (typeof wallpaperId === 'string') {
		const wallpaper = FROSTED_GLASS_WALLPAPERS.find((item) => item.id === wallpaperId);

		if (wallpaper) return wallpaper;
	}

	return (
		FROSTED_GLASS_WALLPAPERS.find(
			(wallpaper) => wallpaper.id === DEFAULT_FROSTED_GLASS_WALLPAPER_ID
		) ?? FROSTED_GLASS_WALLPAPERS[0]
	);
}
