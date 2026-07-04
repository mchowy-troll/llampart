#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const files = {
	chatSettings: resolve(ROOT, 'src/lib/components/app/chat/ChatSettings/ChatSettings.svelte'),
	fieldsRenderer: resolve(
		ROOT,
		'src/lib/components/app/chat/ChatSettings/ChatSettingsFields.svelte'
	),
	settingsTypes: resolve(ROOT, 'src/lib/types/settings.d.ts')
};

function read(path) {
	return readFileSync(path, 'utf8');
}

function extractUnionValues(source, typeName) {
	const match = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`));
	return new Set(match?.[1]?.match(/'([^']+)'/g)?.map((value) => value.slice(1, -1)) ?? []);
}

function findMatching(source, startIndex, openChar, closeChar) {
	let depth = 0;
	let quote = '';
	let escaped = false;

	for (let index = startIndex; index < source.length; index += 1) {
		const char = source[index];

		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === quote) {
				quote = '';
			}
			continue;
		}

		if (char === "'" || char === '"' || char === '`') {
			quote = char;
		} else if (char === openChar) {
			depth += 1;
		} else if (char === closeChar) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}

	throw new Error(`No matching ${closeChar} found`);
}

function lineNumberFromIndex(source, index) {
	return source.slice(0, index).split('\n').length;
}

function getStringProperty(block, name) {
	return block.match(new RegExp(`\\b${name}\\s*:\\s*'([^']+)'`))?.[1];
}

function hasTrueProperty(block, name) {
	return new RegExp(`\\b${name}\\s*:\\s*true\\b`).test(block);
}

function parseFields(groupBlock, groupStartLine) {
	const fieldsMatch = groupBlock.match(/\bfields\s*:\s*\[/);
	if (!fieldsMatch || fieldsMatch.index === undefined) return [];

	const arrayStart = groupBlock.indexOf('[', fieldsMatch.index);
	const arrayEnd = findMatching(groupBlock, arrayStart, '[', ']');
	const arraySource = groupBlock.slice(arrayStart + 1, arrayEnd);
	const fields = [];

	let index = 0;
	while (index < arraySource.length) {
		const objectStart = arraySource.indexOf('{', index);
		if (objectStart === -1) break;

		const objectEnd = findMatching(arraySource, objectStart, '{', '}');
		const block = arraySource.slice(objectStart, objectEnd + 1);
		const key = block.match(/\bkey\s*:\s*SETTINGS_KEYS\.([A-Z0-9_]+)/)?.[1];

		if (key) {
			const beforeFieldsLineOffset = groupBlock.slice(0, fieldsMatch.index).split('\n').length - 1;
			const fieldLineOffset = arraySource.slice(0, objectStart).split('\n').length;
			fields.push({
				key,
				line: groupStartLine + beforeFieldsLineOffset + fieldLineOffset,
				type: block.match(/\btype\s*:\s*SettingsFieldType\.([A-Z0-9_]+)/)?.[1],
				layout: getStringProperty(block, 'layout'),
				order: Number(block.match(/\border\s*:\s*(\d+)/)?.[1]),
				column: getStringProperty(block, 'column'),
				cluster: getStringProperty(block, 'cluster'),
				hideHelp: hasTrueProperty(block, 'hideHelp')
			});
		}

		index = objectEnd + 1;
	}

	return fields;
}

function parseGroups(source) {
	const groups = [];
	const idPattern = /\bid\s*:\s*'([^']+)'/g;

	for (const idMatch of source.matchAll(idPattern)) {
		const id = idMatch[1];
		const idIndex = idMatch.index ?? 0;
		const nextChunk = source.slice(idIndex, idIndex + 6000);

		if (!/\bfields\s*:\s*\[/.test(nextChunk)) continue;

		const objectStart = source.lastIndexOf('{', idIndex);
		if (objectStart === -1) continue;

		const objectEnd = findMatching(source, objectStart, '{', '}');
		const block = source.slice(objectStart, objectEnd + 1);

		if (!/\bfields\s*:\s*\[/.test(block)) continue;

		const beforeFields = block.split('fields', 1)[0];
		const groupStartLine = lineNumberFromIndex(source, objectStart);

		groups.push({
			id,
			line: lineNumberFromIndex(source, idIndex),
			layout: getStringProperty(beforeFields, 'layout') ?? 'default',
			fullWidth: hasTrueProperty(beforeFields, 'fullWidth'),
			halfWidth: hasTrueProperty(beforeFields, 'halfWidth'),
			framed: hasTrueProperty(beforeFields, 'framed'),
			fields: parseFields(block, groupStartLine)
		});
	}

	const seen = new Set();
	return groups.filter((group) => {
		const key = `${group.id}:${group.line}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

const chatSettingsSource = read(files.chatSettings);
const settingsTypesSource = read(files.settingsTypes);

const groupLayouts = extractUnionValues(settingsTypesSource, 'SettingsFieldGroupLayout');
const fieldLayouts = extractUnionValues(settingsTypesSource, 'SettingsFieldLayout');
const clusters = extractUnionValues(settingsTypesSource, 'SettingsFieldCluster');

const groups = parseGroups(chatSettingsSource);
const clusterCapableLayouts = new Set(['sidebar']);

const errors = [];
const warnings = [];
const groupIds = new Map();

for (const group of groups) {
	groupIds.set(group.id, [...(groupIds.get(group.id) ?? []), group.line]);

	if (!groupLayouts.has(group.layout)) {
		errors.push(`${group.id}:${group.line} uses unknown group layout "${group.layout}".`);
	}

	if (group.fullWidth && group.halfWidth) {
		errors.push(`${group.id}:${group.line} has both fullWidth and halfWidth.`);
	}

	const hasClusterFields = group.fields.some((field) => field.cluster);

	if (group.fields.length > 0) {
		const orders = group.fields.map((field) => field.order);
		const invalidOrders = group.fields.filter(
			(field) => !Number.isInteger(field.order) || field.order < 1
		);
		if (invalidOrders.length > 0) {
			const invalidOrderKeys = invalidOrders.map((field) => field.key).join(', ');
			errors.push(
				`${group.id}:${group.line} has fields without valid positive integer order: ${invalidOrderKeys}.`
			);
		}

		const uniqueOrders = new Set(orders);
		if (uniqueOrders.size !== orders.length) {
			errors.push(`${group.id}:${group.line} has duplicate field order values.`);
		}

		for (let expectedOrder = 1; expectedOrder <= group.fields.length; expectedOrder += 1) {
			if (!uniqueOrders.has(expectedOrder)) {
				errors.push(
					`${group.id}:${group.line} has non-continuous field order; missing order ${expectedOrder}.`
				);
			}
		}
	}

	if (hasClusterFields && !clusterCapableLayouts.has(group.layout)) {
		errors.push(
			`${group.id}:${group.line} has field cluster metadata but layout "${group.layout}" is not cluster-capable.`
		);
	}

	for (const field of group.fields) {
		if (field.layout && !fieldLayouts.has(field.layout)) {
			errors.push(
				`${group.id}:${field.line} field ${field.key} uses unknown field layout "${field.layout}".`
			);
		}

		if (field.column) {
			errors.push(
				`${group.id}:${field.line} field ${field.key} uses obsolete column metadata. Use order instead.`
			);
		}

		if (field.cluster && !clusters.has(field.cluster)) {
			errors.push(
				`${group.id}:${field.line} field ${field.key} uses unknown cluster "${field.cluster}".`
			);
		}

		if (field.cluster === 'sidebar-timestamp' && group.layout !== 'sidebar') {
			errors.push(
				`${group.id}:${field.line} field ${field.key} uses sidebar-timestamp outside sidebar layout.`
			);
		}
	}
}

for (const [groupId, lines] of groupIds) {
	if (lines.length > 1) {
		errors.push(`Duplicate Settings group id "${groupId}" on lines ${lines.join(', ')}.`);
	}
}

if (groups.length === 0) {
	errors.push('No Settings groups were parsed from ChatSettings.svelte.');
}

console.log('Settings metadata validation');
console.log(`- Groups parsed: ${groups.length}`);
console.log('- Explicit order metadata: required for every field');
console.log(`- Files:`);
for (const path of Object.values(files)) {
	console.log(`  - ${relative(ROOT, path)}`);
}

if (warnings.length > 0) {
	console.warn('\nWarnings:');
	for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length > 0) {
	console.error('\nErrors:');
	for (const error of errors) console.error(`- ${error}`);
	process.exitCode = 1;
} else {
	console.log('\nOK: Settings metadata is valid.');
}
