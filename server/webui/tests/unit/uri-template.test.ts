import { describe, it, expect } from 'vitest';
import {
	extractTemplateVariables,
	expandTemplate,
	isTemplateComplete,
	normalizeResourceUri
} from '../../src/lib/utils/uri-template';
import { URI_TEMPLATE_OPERATORS } from '../../src/lib/constants/uri-template';

describe('extractTemplateVariables', () => {
	it('extracts unique variables and their operators across expressions and variable lists', () => {
		expect(extractTemplateVariables('db://{schema}/{table,field}/{schema}{+path}')).toEqual([
			{ name: 'schema', operator: '' },
			{ name: 'table', operator: '' },
			{ name: 'field', operator: '' },
			{ name: 'path', operator: URI_TEMPLATE_OPERATORS.RESERVED }
		]);
	});

	it('strips explode and prefix modifiers from variable names', () => {
		expect(extractTemplateVariables('{list*,value:5}')).toEqual([
			{ name: 'list', operator: '' },
			{ name: 'value', operator: '' }
		]);
	});
});

describe('expandTemplate', () => {
	it('encodes simple variables but preserves reserved path separators', () => {
		expect(expandTemplate('file:///{path}', { path: 'src/main.rs' })).toBe('file:///src%2Fmain.rs');
		expect(expandTemplate('file:///{+path}', { path: 'src/main.rs' })).toBe('file:///src/main.rs');
	});

	it('leaves empty for missing variables', () => {
		expect(expandTemplate('{missing}', {})).toBe('');
	});

	it('expands fragment', () => {
		expect(expandTemplate('http://example.com/page{#section}', { section: 'intro' })).toBe(
			'http://example.com/page#intro'
		);
	});

	it('expands path segments', () => {
		expect(expandTemplate('http://example.com{/path}', { path: 'docs' })).toBe(
			'http://example.com/docs'
		);
	});

	it('encodes query parameter values', () => {
		expect(expandTemplate('http://example.com{?q}', { q: 'search term' })).toBe(
			'http://example.com?q=search%20term'
		);
	});

	it('keeps static parts unchanged', () => {
		expect(expandTemplate('http://example.com/static', {})).toBe('http://example.com/static');
	});
});

describe('isTemplateComplete', () => {
	it('requires all variables to be filled', () => {
		expect(isTemplateComplete('db://{schema}/{table}', { schema: 'public', table: 'users' })).toBe(
			true
		);
		expect(isTemplateComplete('db://{schema}/{table}', { schema: 'public' })).toBe(false);
	});

	it('rejects empty and whitespace-only values', () => {
		expect(isTemplateComplete('file:///{path}', { path: '' })).toBe(false);
		expect(isTemplateComplete('file:///{path}', { path: '   ' })).toBe(false);
	});
});

describe('normalizeResourceUri', () => {
	it('normalizes extra slashes from path-style expansion for resource comparison', () => {
		expect(normalizeResourceUri('svelte:///svelte/$effect.md')).toBe('svelte://svelte/$effect.md');
	});

	it('leaves normal URIs and non-URI strings unchanged', () => {
		expect(normalizeResourceUri('svelte://svelte/$effect.md')).toBe('svelte://svelte/$effect.md');
		expect(normalizeResourceUri('not-a-uri')).toBe('not-a-uri');
	});
});
