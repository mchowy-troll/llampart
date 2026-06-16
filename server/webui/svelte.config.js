import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: [vitePreprocess(), mdsvex()],

	kit: {
		paths: {
			relative: true
		},
		router: { type: 'hash' },
		adapter: adapter({
			pages: '../public',
			assets: '../public',
			fallback: '200.html',
			precompress: false,
			strict: true
		}),
		output: {
			// Split output keeps the SvelteKit asset graph intact; public artifact normalization is owned by scripts/normalize-static-build.mjs.
			bundleStrategy: 'split'
		},
		alias: {
			$styles: 'src/styles'
		},
		version: {
			name: 'llampart-webui'
		}
	},

	extensions: ['.svelte', '.svx']
};

export default config;
