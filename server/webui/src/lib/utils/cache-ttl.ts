import { DEFAULT_CACHE_TTL_MS, DEFAULT_CACHE_MAX_ENTRIES } from '$lib/constants';

/**
 * TTL Cache - Time-To-Live cache implementation for memory optimization
 *
 * Expires entries on access or explicit pruning; evicts least-recently-accessed
 * entries when the capacity is reached. No background timer is created.
 *
 * @example
 * ```ts
 * const cache = new TTLCache<string, ApiData>({ ttlMs: 5 * 60 * 1000 }); // 5 minutes
 * cache.set('key', data);
 * const value = cache.get('key'); // null if expired
 * ```
 */

export interface TTLCacheOptions {
	/** Time-to-live in milliseconds. Default: 5 minutes */
	ttlMs?: number;
	/** Maximum number of entries; evicts the least recently accessed. Default: 100 */
	maxEntries?: number;
	/** Called on expiry, capacity eviction, explicit deletion, and clearing. */
	onEvict?: (key: string, value: unknown) => void;
}

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
	lastAccessed: number;
}

export class TTLCache<K extends string, V> {
	private cache = new Map<K, CacheEntry<V>>();
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly onEvict?: (key: string, value: unknown) => void;

	constructor(options: TTLCacheOptions = {}) {
		this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
		this.maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
		this.onEvict = options.onEvict;
	}

	/**
	 * Get a value from cache. Returns null if expired or not found.
	 */
	get(key: K): V | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		if (Date.now() > entry.expiresAt) {
			this.delete(key);
			return null;
		}

		entry.lastAccessed = Date.now();
		return entry.value;
	}

	set(key: K, value: V, customTtlMs?: number): void {
		if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
			this.evictOldest();
		}

		const ttl = customTtlMs ?? this.ttlMs;
		const now = Date.now();

		this.cache.set(key, {
			value,
			expiresAt: now + ttl,
			lastAccessed: now
		});
	}

	/**
	 * Check if key exists and is not expired.
	 */
	has(key: K): boolean {
		const entry = this.cache.get(key);
		if (!entry) return false;

		if (Date.now() > entry.expiresAt) {
			this.delete(key);
			return false;
		}

		return true;
	}

	delete(key: K): boolean {
		const entry = this.cache.get(key);
		if (entry && this.onEvict) {
			this.onEvict(key, entry.value);
		}
		return this.cache.delete(key);
	}

	clear(): void {
		if (this.onEvict) {
			for (const [key, entry] of this.cache) {
				this.onEvict(key, entry.value);
			}
		}
		this.cache.clear();
	}

	/**
	 * Get the number of entries (including potentially expired ones).
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Remove all expired entries from cache.
	 * Call periodically for proactive cleanup.
	 */
	prune(): number {
		const now = Date.now();
		let pruned = 0;

		for (const [key, entry] of this.cache) {
			if (now > entry.expiresAt) {
				this.delete(key);
				pruned++;
			}
		}

		return pruned;
	}

	/**
	 * Get all valid (non-expired) keys.
	 */
	keys(): K[] {
		const now = Date.now();
		const validKeys: K[] = [];

		for (const [key, entry] of this.cache) {
			if (now <= entry.expiresAt) {
				validKeys.push(key);
			}
		}

		return validKeys;
	}

	/**
	 * Evict the oldest (least recently accessed) entry.
	 */
	private evictOldest(): void {
		let oldestKey: K | null = null;
		let oldestTime = Infinity;

		for (const [key, entry] of this.cache) {
			if (entry.lastAccessed < oldestTime) {
				oldestTime = entry.lastAccessed;
				oldestKey = key;
			}
		}

		if (oldestKey !== null) {
			this.delete(oldestKey);
		}
	}

	/**
	 * Refresh TTL for an existing entry without changing the value.
	 */
	touch(key: K): boolean {
		const entry = this.cache.get(key);
		if (!entry) return false;

		const now = Date.now();
		if (now > entry.expiresAt) {
			this.delete(key);
			return false;
		}

		entry.expiresAt = now + this.ttlMs;
		entry.lastAccessed = now;
		return true;
	}
}
