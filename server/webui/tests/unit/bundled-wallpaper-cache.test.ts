import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (id: number) => `/wallpapers/frosted-glass/frosted-glass-0${id}.jpg`;
const image = () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }));
let stored: Map<string, Response>;
let cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
let fetchImage: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetModules();
	stored = new Map();
	cache = {
		match: vi.fn(async (key: string) => stored.get(key)?.clone()),
		put: vi.fn(async (key: string, response: Response) => {
			stored.set(key, response.clone());
		})
	};
	fetchImage = vi.fn(async () => image());
	vi.stubGlobal('window', {});
	vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
	vi.stubGlobal('fetch', fetchImage);
	vi.stubGlobal('dispatchEvent', vi.fn());
	vi.stubGlobal('localStorage', {
		getItem: vi.fn(() => 'user-image'),
		setItem: vi.fn(() => {
			throw new Error('localStorage full');
		}),
		removeItem: vi.fn()
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function ready(
	module: typeof import('$lib/themes/frosted-glass/bundled-wallpaper-cache'),
	id: number
) {
	await vi.waitFor(() => expect(module.resolveBundledWallpaperSrc(source(id))).toMatch(/^blob:/));
	return module.resolveBundledWallpaperSrc(source(id));
}

describe('independent single-entry bundled wallpaper cache', () => {
	it('resolves every gallery thumbnail without fetching or replacing the full-size cache', async () => {
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		await ready(module, 3);
		const { FROSTED_GLASS_WALLPAPERS, getFrostedGlassWallpaperThumbnailSrc } =
			await import('$lib/themes/frosted-glass/wallpapers');
		fetchImage.mockClear();
		cache.put.mockClear();
		vi.stubGlobal('caches', undefined);
		for (const wallpaper of FROSTED_GLASS_WALLPAPERS)
			expect(getFrostedGlassWallpaperThumbnailSrc(wallpaper.src)).toMatch(
				/\/thumbnails\/frosted-glass-0[1-5]\.webp$/
			);
		expect(fetchImage).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
		expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Source')).toBe(
			source(3)
		);
	});
	it('deduplicates, replaces one independent entry and reopens without a network request', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		expect(module.resolveBundledWallpaperSrc(source(3))).toBe('');
		module.resolveBundledWallpaperSrc(source(3));
		const original = await ready(module, 3);
		expect(fetchImage).toHaveBeenCalledExactlyOnceWith(
			`${source(3)}?v=${module.BUNDLED_WALLPAPER_CACHE_VERSION}`
		);
		expect(stored.size).toBe(1);
		await ready(module, 2);
		expect(revoke).toHaveBeenCalledExactlyOnceWith(original);
		expect(stored.size).toBe(1);
		expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Source')).toBe(
			source(2)
		);
		expect(localStorage.getItem).not.toHaveBeenCalled();
		expect(localStorage.setItem).not.toHaveBeenCalled();
		expect(localStorage.removeItem).not.toHaveBeenCalled();
		vi.resetModules();
		fetchImage.mockClear();
		const reopened = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		expect(reopened.resolveBundledWallpaperSrc(source(2))).toBe('');
		await ready(reopened, 2);
		expect(fetchImage).not.toHaveBeenCalled();
	});

	it('keeps the committed image through preview/Cancel and persists only on Save', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		const original = await ready(module, 3);
		const draft = module.beginBundledWallpaperPreview();
		const cancelled = await ready(module, 4);
		expect(revoke).not.toHaveBeenCalled();
		expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Source')).toBe(
			source(3)
		);
		draft.cancel();
		expect(revoke).toHaveBeenCalledExactlyOnceWith(cancelled);
		expect(module.resolveBundledWallpaperSrc(source(3))).toBe(original);
		const next = module.beginBundledWallpaperPreview();
		const saved = await ready(module, 5);
		next.commit();
		expect(revoke).toHaveBeenCalledTimes(2);
		expect(revoke).toHaveBeenLastCalledWith(original);
		expect(module.resolveBundledWallpaperSrc(source(5))).toBe(saved);
		await vi.waitFor(() =>
			expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Source')).toBe(
				source(5)
			)
		);
	});

	it('rolls back a failed custom image Save, preserves bundled storage and allows retry', async () => {
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		const original = await ready(module, 3);
		const wallpapers = await import('$lib/themes/frosted-glass/wallpapers');
		let saved: string | null = 'data:image/png;base64,b2xk';
		vi.mocked(localStorage.getItem).mockImplementation(() => saved);
		vi.mocked(localStorage.removeItem).mockImplementation(() => {
			saved = null;
		});
		const preview = wallpapers.beginWallpaperSettingsPreview();
		wallpapers.setCustomFrostedGlassWallpaperSrc('data:image/png;base64,bmV3');
		await ready(module, 4);
		expect(saved).toBe('data:image/png;base64,b2xk');
		expect(
			preview.commit({
				frostedGlassWallpaper: wallpapers.CUSTOM_FROSTED_GLASS_WALLPAPER_ID
			} as SettingsConfigType)
		).toMatchObject({
			ok: false,
			configPatch: { frostedGlassWallpaper: wallpapers.DEFAULT_FROSTED_GLASS_WALLPAPER_ID }
		});
		expect(saved).toBeNull();
		expect(wallpapers.getCustomFrostedGlassWallpaperSrc()).toBeUndefined();
		expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Source')).toBe(
			source(3)
		);
		preview.cancel();
		expect(module.resolveBundledWallpaperSrc(source(3))).toBe(original);
		vi.mocked(localStorage.setItem).mockImplementation((_key, value) => {
			saved = value;
		});
		const retry = wallpapers.beginWallpaperSettingsPreview();
		wallpapers.setCustomFrostedGlassWallpaperSrc('data:image/png;base64,bmV3');
		expect(retry.commit({} as SettingsConfigType)).toEqual({ ok: true });
		expect(saved).toBe('data:image/png;base64,bmV3');
	});

	it('displays the image even when Cache Storage quota is exceeded', async () => {
		cache.put.mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		await ready(module, 4);
		expect(stored.size).toBe(0);
		expect(localStorage.setItem).not.toHaveBeenCalled();
	});

	it('returns a versioned URL when Cache Storage is unavailable', async () => {
		vi.stubGlobal('caches', undefined);
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		expect(module.resolveBundledWallpaperSrc(source(1))).toBe(
			`${source(1)}?v=${module.BUNDLED_WALLPAPER_CACHE_VERSION}`
		);
		expect(fetchImage).not.toHaveBeenCalled();
		expect(cache.match).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
	});

	it('falls back to the server URL if cache access is denied', async () => {
		vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('denied')) });
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		module.resolveBundledWallpaperSrc(source(1));
		await vi.waitFor(() =>
			expect(module.resolveBundledWallpaperSrc(source(1))).toBe(
				`${source(1)}?v=${module.BUNDLED_WALLPAPER_CACHE_VERSION}`
			)
		);
	});

	it('invalidates stale graphic versions and bypasses their HTTP cache URL', async () => {
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		stored.set(
			module.BUNDLED_WALLPAPER_CACHE_KEY,
			new Response('old', {
				headers: { 'X-LLAMPART-Source': source(3), 'X-LLAMPART-Version': 'old' }
			})
		);
		await ready(module, 3);
		expect(fetchImage).toHaveBeenCalledExactlyOnceWith(
			`${source(3)}?v=${module.BUNDLED_WALLPAPER_CACHE_VERSION}`
		);
		expect(stored.size).toBe(1);
		expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Version')).toBe(
			module.BUNDLED_WALLPAPER_CACHE_VERSION
		);
	});

	it('ignores a slow obsolete download', async () => {
		const create = vi.spyOn(URL, 'createObjectURL');
		let finish!: (response: Response) => void;
		fetchImage.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				})
		);
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		module.resolveBundledWallpaperSrc(source(1));
		await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(1));
		await ready(module, 2);
		create.mockClear();
		const obsolete = image();
		const read = vi.spyOn(obsolete, 'blob');
		finish(obsolete);
		await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(create).not.toHaveBeenCalled();
		expect(cache.put).toHaveBeenCalledTimes(1);
		expect(stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)?.headers.get('X-LLAMPART-Source')).toBe(
			source(2)
		);
	});

	it('does not apply the upload limit to the original bundled JPGs', async () => {
		fetchImage.mockResolvedValue(
			new Response(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' }))
		);
		const module = await import('$lib/themes/frosted-glass/bundled-wallpaper-cache');
		await ready(module, 5);
		expect((await stored.get(module.BUNDLED_WALLPAPER_CACHE_KEY)!.blob()).size).toBe(
			2 * 1024 * 1024
		);
	});

	it('renders a maximum-size custom Data URL through a short, reusable Blob URL', async () => {
		const { resolveCustomWallpaperDisplaySrc, CUSTOM_FROSTED_GLASS_WALLPAPER_MAX_SIZE_BYTES } =
			await import('$lib/themes/frosted-glass/wallpapers');
		expect(CUSTOM_FROSTED_GLASS_WALLPAPER_MAX_SIZE_BYTES).toBe(1_572_864);
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:custom');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const source = `data:image/png;base64,${Buffer.alloc(1_572_864).toString('base64')}`;
		expect(source.length).toBeGreaterThan(2 * 1024 * 1024);
		expect(resolveCustomWallpaperDisplaySrc(source)).toBe('blob:custom');
		expect(resolveCustomWallpaperDisplaySrc(source)).toBe('blob:custom');
		expect(create).toHaveBeenCalledTimes(1);
		const blob = create.mock.calls[0][0] as Blob;
		expect(blob.size).toBe(1_572_864);
		expect(blob.type).toBe('image/png');
		resolveCustomWallpaperDisplaySrc('data:image/jpeg;base64,bmV3');
		expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:custom');
		expect(localStorage.setItem).not.toHaveBeenCalled();
	});

	it('does not preload a server JPG before the runtime can check persistent storage', () => {
		const html = readFileSync(new URL('../../src/app.html', import.meta.url), 'utf8');
		const tokens = readFileSync(
			new URL('../../src/lib/themes/frosted-glass/tokens.css', import.meta.url),
			'utf8'
		);
		expect(html).not.toContain('/wallpapers/frosted-glass/');
		expect(tokens).toContain('--llampart-theme-wallpaper: none;');
	});
});
