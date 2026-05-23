/**
 * Favicon utility functions for extracting favicons from URLs.
 */

import { getProxiedUrlString } from './cors-proxy';
import {
	GOOGLE_FAVICON_BASE_URL,
	DEFAULT_FAVICON_SIZE,
	DOMAIN_SEPARATOR,
	ROOT_DOMAIN_MIN_PARTS
} from '$lib/constants';

/**
 * Returns true if hostname looks like an IPv4 address.
 */
function isIpv4Hostname(hostname: string): boolean {
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Returns true for local-only hostnames where Google favicon fallback is not useful.
 */
function isLocalHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname.endsWith('.localhost') || isIpv4Hostname(hostname);
}

/**
 * Gets a favicon URL for a given URL using Google's favicon service.
 * Returns null if the URL is invalid or if the hostname is local-only.
 *
 * @param urlString - The URL to get the favicon for
 * @returns The favicon URL or null if invalid
 */
export function getFaviconUrl(urlString: string, useProxy = true): string | null {
	try {
		const url = new URL(urlString);
		const hostname = url.hostname;

		// Do not use Google's favicon service for localhost / local IPs.
		// It is not useful and can destabilize the dev proxy flow.
		if (isLocalHostname(hostname)) {
			return null;
		}

		const hostnameParts = hostname.split(DOMAIN_SEPARATOR);
		const rootDomain =
			hostnameParts.length >= ROOT_DOMAIN_MIN_PARTS
				? hostnameParts.slice(-ROOT_DOMAIN_MIN_PARTS).join(DOMAIN_SEPARATOR)
				: hostname;

		const googleFaviconUrl = `${GOOGLE_FAVICON_BASE_URL}?domain=${rootDomain}&sz=${DEFAULT_FAVICON_SIZE}`;
		return useProxy ? getProxiedUrlString(googleFaviconUrl) : googleFaviconUrl;
	} catch {
		return null;
	}
}
