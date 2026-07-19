import { getThemeDefinition, THEME_REGISTRY } from './registry';

const THEME_CLASSES = new Set(
	Object.values(THEME_REGISTRY).flatMap((theme) => [...theme.ownedClasses, theme.colorScheme])
);

const THEME_STYLE_PROPERTIES = new Set(
	Object.values(THEME_REGISTRY).flatMap((theme) => [...theme.ownedStyleProperties])
);

export function applyTheme(
	root: HTMLElement,
	config: SettingsConfigType,
	revision = 0
): () => void {
	const theme = getThemeDefinition(config.theme);
	const runtime = theme.resolveRuntime(config, revision);

	for (const className of THEME_CLASSES) {
		root.classList.remove(className);
	}

	for (const property of THEME_STYLE_PROPERTIES) {
		root.style.removeProperty(property);
	}

	root.dataset.theme = theme.id;
	root.classList.add(theme.colorScheme, theme.rootClass, ...runtime.classes);

	for (const [property, value] of Object.entries(runtime.styles)) {
		root.style.setProperty(property, value);
	}

	return () => {
		for (const className of theme.ownedClasses) {
			root.classList.remove(className);
		}
		root.classList.remove(theme.colorScheme);

		for (const property of theme.ownedStyleProperties) {
			root.style.removeProperty(property);
		}

		delete root.dataset.theme;
	};
}

export function getThemeRuntimeEvents(themeId: unknown): readonly string[] {
	return getThemeDefinition(themeId).runtimeRefreshEvents ?? [];
}
