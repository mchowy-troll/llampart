import { describe, it, expect } from 'vitest';
import { LEGACY_AGENTIC_REGEX } from '$lib/constants/agentic';

/**
 * Tests for legacy marker stripping (used in migration).
 * The new system does not embed markers in content - these tests verify
 * the legacy regex patterns still work for the migration code.
 */

// Mirror the legacy stripping logic used during migration
function stripLegacyContextMarkers(content: string): string {
	return content
		.replace(new RegExp(LEGACY_AGENTIC_REGEX.REASONING_BLOCK.source, 'g'), '')
		.replace(LEGACY_AGENTIC_REGEX.REASONING_OPEN, '')
		.replace(new RegExp(LEGACY_AGENTIC_REGEX.AGENTIC_TOOL_CALL_BLOCK.source, 'g'), '')
		.replace(LEGACY_AGENTIC_REGEX.AGENTIC_TOOL_CALL_OPEN, '');
}

// A realistic complete tool call block as stored in old message.content
const COMPLETE_BLOCK =
	'\n\n<<<AGENTIC_TOOL_CALL_START>>>\n' +
	'<<<TOOL_NAME:bash_tool>>>\n' +
	'<<<TOOL_ARGS_START>>>\n' +
	'{"command":"ls /tmp","description":"list tmp"}\n' +
	'<<<TOOL_ARGS_END>>>\n' +
	'file1.txt\nfile2.txt\n' +
	'<<<AGENTIC_TOOL_CALL_END>>>\n';

// Partial block: streaming was cut before END arrived.
const OPEN_BLOCK =
	'\n\n<<<AGENTIC_TOOL_CALL_START>>>\n' +
	'<<<TOOL_NAME:bash_tool>>>\n' +
	'<<<TOOL_ARGS_START>>>\n' +
	'{"command":"ls /tmp","description":"list tmp"}\n' +
	'<<<TOOL_ARGS_END>>>\n' +
	'partial output...';

describe('legacy agentic marker stripping (for migration)', () => {
	it('strips complete tool call blocks, preserving all surrounding text', () => {
		const input = 'Before.' + COMPLETE_BLOCK + 'Between.' + COMPLETE_BLOCK + 'After.';
		expect(stripLegacyContextMarkers(input)).toBe('Before.\nBetween.\nAfter.');
	});

	it('strips an open/partial tool call block (no END marker)', () => {
		const input = 'Lead text.' + OPEN_BLOCK;
		const result = stripLegacyContextMarkers(input);
		expect(result).toBe('Lead text.');
	});

	it('does not alter marker-free or empty content', () => {
		const input = 'Just a normal assistant response.';
		expect(stripLegacyContextMarkers(input)).toBe(input);
		expect(stripLegacyContextMarkers('')).toBe('');
	});

	it('strips reasoning independently and together with tool call blocks', () => {
		const input = '<<<reasoning_content_start>>>think hard<<<reasoning_content_end>>>Answer.';
		expect(stripLegacyContextMarkers(input)).toBe('Answer.');
		expect(stripLegacyContextMarkers(input + COMPLETE_BLOCK)).toBe('Answer.\n');
	});

	it('detects legacy markers', () => {
		expect(LEGACY_AGENTIC_REGEX.HAS_LEGACY_MARKERS.test('normal text')).toBe(false);
		expect(
			LEGACY_AGENTIC_REGEX.HAS_LEGACY_MARKERS.test('text<<<AGENTIC_TOOL_CALL_START>>>more')
		).toBe(true);
		expect(LEGACY_AGENTIC_REGEX.HAS_LEGACY_MARKERS.test('<<<reasoning_content_start>>>think')).toBe(
			true
		);
	});
});
