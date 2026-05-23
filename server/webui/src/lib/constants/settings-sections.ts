/**
 * Settings section titles constants for ChatSettings component.
 *
 * These titles define the navigation sections in the settings dialog.
 * Used for both sidebar navigation and mobile horizontal scroll menu.
 */
export const SETTINGS_SECTION_TITLES = {
	GENERAL: 'General',
	APPEARANCE: 'Appearance',
	CHAT: 'Chat',
	MODEL: 'Model',
	MCP: 'MCP',
	TOOLS: 'Tools',
	DATA: 'Data',
	ADVANCED: 'Advanced'
} as const;

/** Type for settings section titles */
export type SettingsSectionTitle =
	(typeof SETTINGS_SECTION_TITLES)[keyof typeof SETTINGS_SECTION_TITLES];
