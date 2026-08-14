#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webuiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webuiRoot, '../..');
const documentationRoots = [repoRoot, resolve(repoRoot, 'docs'), resolve(webuiRoot, 'docs')];
const forbidden = [
	[/\b(?:loadTheme|saveTheme|updateTheme|resetTheme)\s*\(/, 'removed theme store method'],
	[/\bwaitForModelStatus\s*\(/, 'removed model status method'],
	[/Node\.js 20\.19\+ or 22\.12\+/, 'obsolete Node.js range'],
	[/installer[^\n]*\b--status\b|\b--status\b[^\n]*installer/i, 'removed installer --status mode'],
	[/theme[^\n]*\b(?:auto|light|dark)\b/i, 'obsolete theme ID']
];

function markdownFiles(root, recursive) {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) return recursive ? markdownFiles(path, true) : [];
		return extname(entry.name) === '.md' ? [path] : [];
	});
}

const files = [
	...markdownFiles(documentationRoots[0], false),
	...markdownFiles(documentationRoots[1], true),
	...markdownFiles(documentationRoots[2], true)
];
const violations = [];

for (const file of files) {
	const lines = readFileSync(file, 'utf-8').split('\n');
	for (const [index, line] of lines.entries()) {
		for (const [pattern, label] of forbidden) {
			if (pattern.test(line)) {
				violations.push(`${relative(repoRoot, file)}:${index + 1}: ${label}`);
			}
		}
	}
}

if (violations.length > 0) {
	console.error(`Documentation validation failed:\n${violations.join('\n')}`);
	process.exit(1);
}

console.log(`Documentation validation passed (${files.length} files).`);
