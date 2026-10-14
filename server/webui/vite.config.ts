import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import { devGateway } from './scripts/dev-gateway';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			'katex-fonts': resolve('node_modules/katex/dist/fonts')
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

	plugins: [devGateway(), tailwindcss(), sveltekit()],

	test: {
		projects: [
			{
				extends: './vite.config.ts',
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
