<script lang="ts">
	import { browser } from '$app/environment';

	import {
		escapeCodeHtml,
		highlightCodeAsync,
		loadHighlightThemeCss
	} from '$lib/utils/syntax-highlighting';

	interface Props {
		code: string;
		language?: string;
		class?: string;
		maxHeight?: string;
		maxWidth?: string;
	}

	let {
		code,
		language = 'text',
		class: className = '',
		maxHeight = '60vh',
		maxWidth = ''
	}: Props = $props();

	let highlightedHtml = $state('');
	let highlightRequestId = 0;

	async function loadHighlightTheme() {
		if (!browser) return;

		const existingThemes = document.querySelectorAll('style[data-highlight-theme-preview]');
		existingThemes.forEach((style) => style.remove());

		const style = document.createElement('style');
		style.setAttribute('data-highlight-theme-preview', 'true');
		style.textContent = await loadHighlightThemeCss();

		document.head.appendChild(style);
	}

	async function updateHighlightedHtml(codeToHighlight: string, languageToHighlight: string) {
		const requestId = ++highlightRequestId;

		if (!codeToHighlight) {
			highlightedHtml = '';
			return;
		}

		highlightedHtml = escapeCodeHtml(codeToHighlight);

		const html = await highlightCodeAsync(codeToHighlight, languageToHighlight);

		if (requestId === highlightRequestId) {
			highlightedHtml = html;
		}
	}

	$effect(() => {
		void loadHighlightTheme();
	});

	$effect(() => {
		void updateHighlightedHtml(code, language);
	});
</script>

<div
	class="code-preview-wrapper rounded-lg border border-border bg-muted {className}"
	style="max-height: {maxHeight}; max-width: {maxWidth};"
>
	<!-- Needs to be formatted as single line for proper rendering -->
	<pre class="m-0"><code class="hljs text-sm leading-relaxed">{@html highlightedHtml}</code></pre>
</div>

<style>
	.code-preview-wrapper {
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
			'Liberation Mono', Menlo, monospace;
	}

	.code-preview-wrapper pre {
		background: transparent;
	}

	.code-preview-wrapper code {
		background: transparent;
	}
</style>
