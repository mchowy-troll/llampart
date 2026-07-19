import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = resolve(projectRoot, 'src');
const themeRoot = resolve(sourceRoot, 'lib/themes');
const frostedThemeRoot = resolve(themeRoot, 'frosted-glass');
const allowedExtensions = new Set(['.css', '.html', '.svelte', '.ts']);

const rules = [
	{
		pattern: /has-frosted-glass-theme|has-frosted-glass-wallpaper-milk|--llampart-frosted-/,
		isAllowed: (filePath) =>
			filePath.startsWith(frostedThemeRoot) || filePath === resolve(sourceRoot, 'app.html'),
		message: 'Frosted Glass selectors and variables must stay inside its theme module.'
	},
	{
		pattern: /ColorMode\.FROSTED_GLASS|isFrostedGlassTheme/,
		isAllowed: (filePath) =>
			filePath.startsWith(themeRoot) || filePath === resolve(sourceRoot, 'lib/enums/ui.ts'),
		message: 'Shared code must use the theme registry instead of a concrete theme identity.'
	},
	{
		pattern: /llampart-frosted-glass-switch/,
		isAllowed: () => false,
		message: 'Shared component hooks must use semantic, theme-neutral names.'
	}
];

function getSourceFiles(directory) {
	return readdirSync(directory).flatMap((entry) => {
		const filePath = resolve(directory, entry);

		if (statSync(filePath).isDirectory()) return getSourceFiles(filePath);
		return allowedExtensions.has(extname(filePath)) ? [filePath] : [];
	});
}

const violations = [];

for (const filePath of getSourceFiles(sourceRoot)) {
	const content = readFileSync(filePath, 'utf8');

	for (const rule of rules) {
		if (rule.pattern.test(content) && !rule.isAllowed(filePath)) {
			violations.push(`${relative(projectRoot, filePath)}: ${rule.message}`);
		}
	}
}

if (violations.length > 0) {
	console.error('Theme ownership validation failed:\n');
	for (const violation of violations) console.error(`- ${violation}`);
	process.exit(1);
}

console.log('Theme ownership boundaries are valid.');
