import type { FrostedGlassWallpaper } from './wallpapers';

export const WALLPAPER_ACCENT_EVENT = 'llampart:frosted-glass:wallpaper-accent-change';
export const FALLBACK_WALLPAPER_ACCENT = '#899492';

// Alpha-weighted, 5–95% winsorized channel means limit isolated highlights/dark pixels.
// The caller samples just 32×32 pixels; the shared material palette mixes this
// representative color into a near-white, low-saturation tint independently of alpha.
export function averageWallpaperColor(pixels: Uint8ClampedArray): string {
	const histograms = Array.from({ length: 3 }, () => new Float64Array(256));
	let total = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const alpha = pixels[i + 3] / 255;
		for (let channel = 0; channel < 3; channel++) histograms[channel][pixels[i + channel]] += alpha;
		total += alpha;
	}
	if (total === 0) return FALLBACK_WALLPAPER_ACCENT;
	const channels = histograms.map((histogram) => {
		const quantile = (fraction: number) => {
			let count = 0;
			for (let value = 0; value < 256; value++) {
				count += histogram[value];
				if (count >= total * fraction) return value;
			}
			return 255;
		};
		const low = quantile(0.05),
			high = quantile(0.95);
		let sum = 0;
		for (let value = 0; value < 256; value++)
			sum += Math.max(low, Math.min(high, value)) * histogram[value];
		return Math.round(sum / total)
			.toString(16)
			.padStart(2, '0');
	});
	return `#${channels.join('')}`;
}

// One entry per wallpaper ID: replacing a custom image does not retain its data URL.
const cache = new Map<string, { src: string; color: string }>();

export function resolveWallpaperAccent(wallpaper: FrostedGlassWallpaper): string {
	const cached = cache.get(wallpaper.id);
	if (cached?.src === wallpaper.src) return cached.color;
	if (typeof document === 'undefined' || typeof Image === 'undefined')
		return FALLBACK_WALLPAPER_ACCENT;
	const entry = { src: wallpaper.src, color: FALLBACK_WALLPAPER_ACCENT };
	cache.set(wallpaper.id, entry);
	const image = new Image();
	const release = () => {
		image.onload = image.onerror = null;
	};
	image.onerror = release;
	image.onload = () => {
		release();
		if (cache.get(wallpaper.id) !== entry) return;
		let canvas: HTMLCanvasElement | undefined;
		try {
			canvas = document.createElement('canvas');
			canvas.width = canvas.height = 32;
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) return;
			context.drawImage(image, 0, 0, 32, 32);
			entry.color = averageWallpaperColor(context.getImageData(0, 0, 32, 32).data);
			globalThis.dispatchEvent(new CustomEvent(WALLPAPER_ACCENT_EVENT));
		} catch {
			// Decode/canvas access failures keep the safe neutral fallback.
		} finally {
			if (canvas) canvas.width = canvas.height = 0;
		}
	};
	image.src = wallpaper.src;
	return entry.color;
}
