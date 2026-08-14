#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD_MARKER = '.llampart-build.json';

function collectArtifacts(rootDir, relativeDir = '') {
	const entries = [];

	for (const name of readdirSync(resolve(rootDir, relativeDir))) {
		const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
		if (relativePath === BUILD_MARKER) continue;

		entries.push(relativePath);
		const stat = lstatSync(resolve(rootDir, relativePath));
		if (stat.isDirectory()) entries.push(...collectArtifacts(rootDir, relativePath));
	}

	return entries;
}

export function calculateArtifactDigest(rootDir) {
	const hash = createHash('sha256');
	hash.update('llampart-static-artifacts-v1\0');

	for (const relativePath of collectArtifacts(rootDir).sort()) {
		const absolutePath = resolve(rootDir, relativePath);
		const stat = lstatSync(absolutePath);
		let type;
		let content;

		if (stat.isFile()) {
			type = 'file';
			content = readFileSync(absolutePath);
		} else if (stat.isSymbolicLink()) {
			type = 'symlink';
			content = Buffer.from(readlinkSync(absolutePath));
		} else if (stat.isDirectory()) {
			type = 'directory';
			content = Buffer.alloc(0);
		} else {
			throw new Error(`Unsupported static artifact type: ${relativePath}`);
		}

		const mode = (stat.mode & 0o7777).toString(8).padStart(4, '0');
		hash.update(`${JSON.stringify([relativePath, type, mode, content.length])}\n`);
		hash.update(content);
		hash.update('\n');
	}

	return hash.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const rootDir = process.argv[2];
	if (!rootDir) {
		console.error('Usage: static-artifact-digest.mjs DIRECTORY');
		process.exitCode = 2;
	} else {
		try {
			console.log(calculateArtifactDigest(resolve(rootDir)));
		} catch (error) {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	}
}
