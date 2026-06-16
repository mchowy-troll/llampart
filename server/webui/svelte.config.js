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
			// Compatibility mode for the current static artifact model; modular output is handled in a later ownership step.
			bundleStrategy: 'single'
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
