import type { Component } from 'svelte';
import {
	ArrowDown,
	Funnel,
	Lightbulb,
	LightbulbOff,
	ListRestart,
	MoreHorizontal,
	PanelLeftClose,
	PencilRuler,
	Shield,
	ShieldOff,
	SkipForward,
	Sliders,
	SquarePen,
	Video
} from '@lucide/svelte';

/**
 * Tracks lucide icons added upstream in llama.cpp b9585 compared with llampart.
 *
 * Icons are intentionally imported physically here so future upstream parity work can
 * reference a typed, modular inventory instead of re-auditing or scattering imports.
 *
 * `UNCONNECTED` means the icon is present in code but not rendered by any llampart UI
 * module yet. It is not a dead import: each icon is referenced by this registry.
 */
export const UPSTREAM_ICON_PARITY_STATUS = {
	CONNECTED: 'connected',
	UNCONNECTED: 'unconnected'
} as const;

export type UpstreamIconParityStatus =
	(typeof UPSTREAM_ICON_PARITY_STATUS)[keyof typeof UPSTREAM_ICON_PARITY_STATUS];

export interface UpstreamIconParityEntry {
	icon: string;
	component: Component;
	upstreamOwner: string;
	status: UpstreamIconParityStatus;
	plannedFor: string;
}

export const UPSTREAM_ICON_PARITY = [
	{
		icon: 'ArrowDown',
		component: ArrowDown,
		upstreamOwner: 'chat-screen',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'scroll-down action parity'
	},
	{
		icon: 'Funnel',
		component: Funnel,
		upstreamOwner: 'settings-registry',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future settings registry parity'
	},
	{
		icon: 'Lightbulb',
		component: Lightbulb,
		upstreamOwner: 'composer-actions',
		status: UPSTREAM_ICON_PARITY_STATUS.CONNECTED,
		plannedFor: 'Reasoning effort composer control'
	},
	{
		icon: 'LightbulbOff',
		component: LightbulbOff,
		upstreamOwner: 'composer-actions',
		status: UPSTREAM_ICON_PARITY_STATUS.CONNECTED,
		plannedFor: 'Reasoning effort composer control'
	},
	{
		icon: 'ListRestart',
		component: ListRestart,
		upstreamOwner: 'settings-registry',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future settings registry parity'
	},
	{
		icon: 'MoreHorizontal',
		component: MoreHorizontal,
		upstreamOwner: 'navigation',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future sidebar navigation parity'
	},
	{
		icon: 'PanelLeftClose',
		component: PanelLeftClose,
		upstreamOwner: 'ui-primitives',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future sidebar primitive parity'
	},
	{
		icon: 'PencilRuler',
		component: PencilRuler,
		upstreamOwner: 'composer-actions/settings-registry',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future Composer Tools menu or add menu parity'
	},
	{
		icon: 'Shield',
		component: Shield,
		upstreamOwner: 'dialogs',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future export settings dialog parity'
	},
	{
		icon: 'ShieldOff',
		component: ShieldOff,
		upstreamOwner: 'dialogs',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future export settings dialog parity'
	},
	{
		icon: 'SkipForward',
		component: SkipForward,
		upstreamOwner: 'composer-actions',
		status: UPSTREAM_ICON_PARITY_STATUS.CONNECTED,
		plannedFor: 'Skip reasoning composer action'
	},
	{
		icon: 'Sliders',
		component: Sliders,
		upstreamOwner: 'settings-registry',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future settings registry parity'
	},
	{
		icon: 'SquarePen',
		component: SquarePen,
		upstreamOwner: 'constants/ui',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future UI constants parity'
	},
	{
		icon: 'Video',
		component: Video,
		upstreamOwner: 'attachments/constants',
		status: UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED,
		plannedFor: 'future video attachment parity'
	}
] as const satisfies readonly UpstreamIconParityEntry[];

export const UNCONNECTED_UPSTREAM_ICONS = UPSTREAM_ICON_PARITY.filter(
	(icon) => icon.status === UPSTREAM_ICON_PARITY_STATUS.UNCONNECTED
);
