/** Regenerate the distributable notice snapshot after changing Mermaid's lockfile.
 * Includes all runtime transitive packages, even optional engine chunks that our
 * four-type policy never executes. Does not fetch source or contact the network.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seen = new Set();
const entries = [];
function locate(from, name) {
	let parent = from;
	while (true) {
		const candidate = join(parent, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) return candidate;
		const next = dirname(parent);
		if (next === parent) throw new Error(`Missing dependency ${name}`);
		parent = next;
	}
}
function collect(path) {
	if (seen.has(path)) return;
	seen.add(path);
	const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
	const files = readdirSync(path).filter((file) =>
		/^(?:licen[sc]e|copying|notice)(?:\.|$)/i.test(file)
	);
	if (!files.length) throw new Error(`No license notice for ${pkg.name}`);
	entries.push({
		pkg,
		notices: files
			.map((file) => `${file}\n\n${readFileSync(join(path, file), 'utf8')}`)
			.join('\n\n')
	});
	for (const name of Object.keys(pkg.dependencies || {})) collect(locate(path, name));
}
collect(locate(root, 'mermaid'));
entries.sort((a, b) => a.pkg.name.localeCompare(b.pkg.name));
const notice =
	[
		'Mermaid and runtime dependencies — generated from installed, locked packages.',
		'Regenerate: node scripts/diagram-license-notices.mjs',
		'No third-party source has been modified by llampart.',
		'ELK / elkjs (EPL-2.0) source: https://github.com/kieler/elkjs/tree/v0.9.3',
		'DOMPurify is used under its Apache-2.0 license option.',
		...entries.map(
			({ pkg, notices }) =>
				`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nDeclared license: ${pkg.license || 'See included license text'}\nUpstream: ${typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository || pkg.homepage || ''}\n\n${notices}`
		)
	].join('\n') + '\n';
mkdirSync(join(root, 'static/licenses'), { recursive: true });
writeFileSync(join(root, 'static/licenses/mermaid.txt'), notice);
console.log(`Preserved ${entries.length} package notices in static/licenses/mermaid.txt`);
