import { ToolSource } from '$lib/enums/tools';

export const TOOL_GROUP_LABELS = {
	[ToolSource.BUILTIN]: 'Built-in'
} as const;

export const TOOL_SERVER_LABELS = {
	[ToolSource.BUILTIN]: 'Built-in Tools'
} as const;
