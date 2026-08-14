import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from '$lib/utils/uuid';

describe('uuid', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('uses crypto.randomUUID when available', () => {
		const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000');
		const getRandomValues = vi.fn();
		vi.stubGlobal('crypto', { randomUUID, getRandomValues });

		expect(uuid()).toBe('123e4567-e89b-42d3-a456-426614174000');
		expect(randomUUID).toHaveBeenCalledOnce();
		expect(getRandomValues).not.toHaveBeenCalled();
	});

	it('creates an RFC 4122 UUIDv4 with crypto.getRandomValues as fallback', () => {
		const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0));
		vi.stubGlobal('crypto', { getRandomValues });

		expect(uuid()).toBe('00000000-0000-4000-8000-000000000000');
		expect(getRandomValues).toHaveBeenCalledOnce();
		expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
	});

	it('throws when Web Crypto is unavailable instead of using Math.random', () => {
		const mathRandomSpy = vi.spyOn(Math, 'random');
		vi.stubGlobal('crypto', undefined);

		expect(() => uuid()).toThrow('Web Crypto API is required to generate UUIDs');
		expect(mathRandomSpy).not.toHaveBeenCalled();
	});
});
