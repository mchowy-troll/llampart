#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webuiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(webuiRoot, 'src/lib');
const extensions = new Set(['.js', '.ts', '.svelte']);
const domainRules = [
	{
		directory: resolve(sourceRoot, 'components/app'),
		barrels: new Set([
			'$lib/components/app',
			...readdirSync(resolve(sourceRoot, 'components/app'), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => `$lib/components/app/${entry.name}`)
		])
	},
	{ directory: resolve(sourceRoot, 'utils'), barrels: new Set(['$lib/utils']) },
	{ directory: resolve(sourceRoot, 'stores'), barrels: new Set(['$lib/stores']) },
	{ directory: resolve(sourceRoot, 'services'), barrels: new Set(['$lib/services']) }
];
const importPattern = /\b(?:import|export)\b\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const sourceExtensions = ['.ts', '.js', '.svelte'];
const maximumAllowedCycleSize = 10;

function sourceFiles(root) {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return extensions.has(extname(entry.name)) ? [path] : [];
	});
}

function isInside(path, directory) {
	return path === directory || path.startsWith(`${directory}${sep}`);
}

const violations = [];
const files = sourceFiles(sourceRoot);
const fileSet = new Set(files);
const graph = new Map(files.map((file) => [file, []]));

function resolveModule(file, specifier) {
	let base;
	if (specifier === '$lib') base = sourceRoot;
	else if (specifier.startsWith('$lib/')) base = resolve(sourceRoot, specifier.slice(5));
	else if (specifier.startsWith('.')) base = resolve(dirname(file), specifier);
	else return null;

	const candidates = [base, ...sourceExtensions.map((extension) => `${base}${extension}`)];
	if (existsSync(base) && statSync(base).isDirectory()) {
		candidates.push(...sourceExtensions.map((extension) => resolve(base, `index${extension}`)));
	}
	return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

for (const file of files) {
	const rule = domainRules.find(({ directory }) => isInside(file, directory));
	const content = readFileSync(file, 'utf-8');
	for (const match of content.matchAll(importPattern)) {
		const specifier = match[1];
		const dependency = resolveModule(file, specifier);
		if (dependency) graph.get(file).push(dependency);
		if (rule && !file.endsWith(`${sep}index.ts`) && rule.barrels.has(specifier)) {
			const line = content.slice(0, match.index).split('\n').length;
			violations.push(`${relative(webuiRoot, file)}:${line}: self-barrel import ${specifier}`);
		}
	}
}

let nextIndex = 0;
const indices = new Map();
const lowLinks = new Map();
const stack = [];
const onStack = new Set();
const cycles = [];

function visit(file) {
	indices.set(file, nextIndex);
	lowLinks.set(file, nextIndex++);
	stack.push(file);
	onStack.add(file);

	for (const dependency of graph.get(file)) {
		if (!indices.has(dependency)) {
			visit(dependency);
			lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
		} else if (onStack.has(dependency)) {
			lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(dependency)));
		}
	}

	if (lowLinks.get(file) !== indices.get(file)) return;
	const component = [];
	let member;
	do {
		member = stack.pop();
		onStack.delete(member);
		component.push(member);
	} while (member !== file);
	if (component.length > maximumAllowedCycleSize) cycles.push(component);
}

for (const file of files) {
	if (!indices.has(file)) visit(file);
}

for (const cycle of cycles) {
	violations.push(
		`import cycle (${cycle.length} modules): ${cycle
			.map((file) => relative(webuiRoot, file))
			.sort()
			.join(', ')}`
	);
}

if (violations.length > 0) {
	console.error(`Import boundary validation failed:\n${violations.join('\n')}`);
	process.exit(1);
}

console.log(
	`Import boundary validation passed (${files.length} modules, no cycles larger than ${maximumAllowedCycleSize} modules).`
);
