import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import { devGateway } from './scripts/dev-gateway.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			'katex-fonts': resolve('node_modules/katex/dist/fonts'),
			$lib: resolve('src/lib'),
			$styles: resolve('src/styles')
		}
	},

	build: {
		assetsInlineLimit: 32000,
		chunkSizeWarningLimit: 3072,
		minify: true
	},

	css: {
		preprocessorOptions: {
			scss: {
				additionalData: `
					$use-woff2: true;
					$use-woff: false;
					$use-ttf: false;
				`
			}
		}
	},

	plugins: [
		devGateway(),
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			paths: { relative: true },
			router: { type: 'hash' },
			adapter: adapter({
				pages: '../public',
				assets: '../public',
				fallback: '200.html',
				precompress: false,
				strict: true
			}),
			// Preserve the asset graph consumed by normalize-static-build.mjs.
			output: { bundleStrategy: 'split' },
			version: { name: 'llampart-webui', pollInterval: 0 }
		})
	],

	test: {
		onConsoleLog(log, type) {
			// Suppress only routine MCP progress, never stderr or other diagnostics.
			if (
				type === 'stdout' &&
				log
					.trim()
					.split('\n')
					.every(
						(line) =>
							/^\[MCPService\]\[[^\]\r\n]+\] (Creating transport\.\.\.|Connecting to server\.\.\.|Connected, listing tools\.\.\.|Initialization complete with \d+ tools in \d+ms|Disconnecting\.\.\.)$/.test(
								line
							) ||
							/^\[MCPService\] Creating (StreamableHTTP|WebSocket) transport for \S+$/.test(line)
					)
			) {
				return false;
			}
		},
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['tests/unit/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	},

	server: {
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin'
		},
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd()), resolve(__dirname, 'tests')]
		}
	}
});
