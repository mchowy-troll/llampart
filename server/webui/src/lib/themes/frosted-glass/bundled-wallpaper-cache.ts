// Bump this version after replacing any bundled JPG (also busts the HTTP cache).
export const BUNDLED_WALLPAPER_CACHE_VERSION = '1';
export const BUNDLED_WALLPAPER_CACHE_NAME = 'llampart:frosted-glass:bundled-wallpaper';
export const BUNDLED_WALLPAPER_CACHE_KEY = '/wallpapers/frosted-glass/__selected__';
export const BUNDLED_WALLPAPER_CACHE_EVENT = 'llampart:frosted-glass:bundled-wallpaper-change';

type Entry = { source: string; src: string; blob?: Blob };
let current: Entry | undefined;
let preview: { original: Entry | undefined } | undefined;
let writes = Promise.resolve();

function notify(): void {
	if (typeof globalThis.dispatchEvent !== 'function') return;
	globalThis.dispatchEvent(new CustomEvent(BUNDLED_WALLPAPER_CACHE_EVENT));
}

function persist(entry: Entry): Promise<void> {
	// Serialize replacements; a slow, obsolete selection must never win a race.
	writes = writes.then(async () => {
		if (preview || current !== entry || !entry.blob) return;
		try {
			const cache = await globalThis.caches.open(BUNDLED_WALLPAPER_CACHE_NAME);
			if (preview || current !== entry) return;
			await cache.put(
				BUNDLED_WALLPAPER_CACHE_KEY,
				new Response(entry.blob, {
					headers: {
						'Content-Type': 'image/jpeg',
						'X-LLAMPART-Source': entry.source,
						'X-LLAMPART-Version': BUNDLED_WALLPAPER_CACHE_VERSION
					}
				})
			);
		} catch {
			// Quota/security failures never touch settings or the user's localStorage image.
		}
	});
	return writes;
}

async function load(entry: Entry): Promise<void> {
	try {
		const cache = await globalThis.caches.open(BUNDLED_WALLPAPER_CACHE_NAME);
		const cached = await cache.match(BUNDLED_WALLPAPER_CACHE_KEY);
		if (current !== entry && preview?.original !== entry) return;
		const hit =
			cached?.headers.get('X-LLAMPART-Source') === entry.source &&
			cached.headers.get('X-LLAMPART-Version') === BUNDLED_WALLPAPER_CACHE_VERSION;
		const response = hit
			? cached
			: await fetch(`${entry.source}?v=${BUNDLED_WALLPAPER_CACHE_VERSION}`);
		if (!response.ok) throw new Error('Wallpaper request failed.');
		const blob = await response.blob();
		if (!blob.size || blob.type !== 'image/jpeg') throw new Error('Invalid wallpaper response.');
		if (current !== entry && preview?.original !== entry) return;
		entry.blob = blob;
		entry.src = URL.createObjectURL(blob);
		if (!hit) await persist(entry);
	} catch {
		// Cache Storage is optional (e.g. insecure origins, private mode, full storage).
		entry.src = `${entry.source}?v=${BUNDLED_WALLPAPER_CACHE_VERSION}`;
	}
	if (current === entry) notify();
}

function release(entry: Entry | undefined): void {
	if (entry?.src.startsWith('blob:')) URL.revokeObjectURL(entry.src);
}

export function resolveBundledWallpaperSrc(source: string): string {
	if (typeof window === 'undefined') return source;
	if (!globalThis.caches) return `${source}?v=${BUNDLED_WALLPAPER_CACHE_VERSION}`;
	if (current?.source !== source) {
		if (current !== preview?.original) release(current);
		if (preview?.original?.source === source) current = preview.original;
		else {
			current = { source, src: '' };
			void load(current);
		}
	}
	// Do not expose the server URL while checking storage: reopening must not fetch again.
	return current.src;
}

// Thumbnails must not start cache replacements for all five images.
export function getBundledWallpaperPreviewSrc(source: string): string {
	if (current?.source === source) return current.src;
	if (preview?.original?.source === source) return preview.original.src;
	return `${source}?v=${BUNDLED_WALLPAPER_CACHE_VERSION}`;
}

export function beginBundledWallpaperPreview(): { commit: () => void; cancel: () => void } {
	const draft = { original: current };
	preview = draft;
	return {
		commit: () => {
			if (preview !== draft) return;
			preview = undefined;
			if (draft.original !== current) release(draft.original);
			if (current) void persist(current);
		},
		cancel: () => {
			if (preview !== draft) return;
			preview = undefined;
			if (current !== draft.original) release(current);
			current = draft.original;
			if (current) void persist(current);
			notify();
		}
	};
}
