/**
 * Header utilities for parsing and serializing HTTP headers.
 * Generic utilities not specific to MCP.
 */

import { parseMcpHeaders } from './mcp-config';

/**
 * Parses a JSON string of headers into an array of key-value pairs.
 * Returns empty array if the JSON is invalid or empty.
 */
export function parseHeadersToArray(headersJson: string): { key: string; value: string }[] {
	return Object.entries(parseMcpHeaders(headersJson) ?? {}).map(([key, value]) => ({ key, value }));
}

/**
 * Serializes an array of header key-value pairs to a JSON string.
 * Filters out pairs with empty keys and returns empty string if no valid pairs.
 */
export function serializeHeaders(pairs: { key: string; value: string }[]): string {
	const validPairs = pairs.filter((p) => p.key.trim());

	if (validPairs.length === 0) return '';

	const obj: Record<string, string> = {};

	for (const pair of validPairs) {
		obj[pair.key.trim()] = pair.value;
	}

	return JSON.stringify(obj);
}
