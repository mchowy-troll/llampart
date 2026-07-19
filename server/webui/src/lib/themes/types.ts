import type { Icon } from '@lucide/svelte';
import type { ColorMode } from '$lib/enums/ui';

export interface ThemeMotionProfile {
	messageEntry: boolean;
	screenTransitions: boolean;
}

export interface ThemeRuntimeState {
	classes: readonly string[];
	styles: Readonly<Record<string, string>>;
}

export interface ThemeDefinition {
	id: ColorMode;
	labelKey: string;
	icon: typeof Icon;
	colorScheme: 'light' | 'dark';
	rootClass: string;
	ownedClasses: readonly string[];
	ownedStyleProperties: readonly string[];
	runtimeRefreshEvents?: readonly string[];
	motion: ThemeMotionProfile;
	configDefaults: Readonly<Record<string, SettingsConfigValue>>;
	configInfo: Readonly<Record<string, string>>;
	resolveRuntime: (config: SettingsConfigType, revision: number) => ThemeRuntimeState;
}
