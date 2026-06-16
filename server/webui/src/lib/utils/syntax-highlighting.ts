import { AMPERSAND_REGEX, LT_REGEX, GT_REGEX } from '$lib/constants';

type HighlightJsApi = typeof import('highlight.js').default;

let highlightJsPromise: Promise<HighlightJsApi> | null = null;
let highlightThemeCssPromise: Promise<{ dark: string; light: string }> | null = null;

function loadHighlightJs(): Promise<HighlightJsApi> {
	highlightJsPromise ??= import('highlight.js').then((module) => module.default);

	return highlightJsPromise;
}

async function loadHighlightThemeCssFiles(): Promise<{ dark: string; light: string }> {
	highlightThemeCssPromise ??= Promise.all([
		import('highlight.js/styles/github-dark.css?inline'),
		import('highlight.js/styles/github.css?inline')
	]).then(([dark, light]) => ({
		dark: dark.default,
		light: light.default
	}));

	return highlightThemeCssPromise;
}

export function escapeCodeHtml(code: string): string {
	return code.replace(AMPERSAND_REGEX, '&amp;').replace(LT_REGEX, '&lt;').replace(GT_REGEX, '&gt;');
}

export async function highlightCodeAsync(code: string, language: string): Promise<string> {
	if (!code) return '';

	try {
		const hljs = await loadHighlightJs();
		const lang = language.toLowerCase();
		const isSupported = hljs.getLanguage(lang);

		if (isSupported) {
			return hljs.highlight(code, { language: lang }).value;
		}

		return hljs.highlightAuto(code).value;
	} catch {
		return escapeCodeHtml(code);
	}
}

export async function loadHighlightThemeCss(isDark: boolean): Promise<string> {
	const { dark, light } = await loadHighlightThemeCssFiles();

	return isDark ? dark : light;
}
