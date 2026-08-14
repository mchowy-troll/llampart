import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', '.svelte-kit', 'build', 'node_modules']);
const undiscovered = [];

async function walk(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) await walk(path);
		else if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(entry.name)) {
			const projectPath = relative(root, path).replaceAll('\\', '/');
			if (!projectPath.startsWith('tests/unit/')) undiscovered.push(projectPath);
		}
	}
}

await walk(root);
if (undiscovered.length > 0) {
	throw new Error(`Tests outside Vitest unit discovery:\n${undiscovered.join('\n')}`);
}
console.log('Test discovery validation passed');
