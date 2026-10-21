import type { CapabilitySnapshot, CapabilityState } from './provider';

/** User intent, not an API parameter. Legacy effort fields remain readable without migration. */
export type ReasoningIntent =
	| { mode: 'default' }
	| { mode: 'off' }
	| { mode: 'on' }
	| { mode: 'effort'; value: string };

export interface ReasoningParameter {
	location: 'top-level' | 'chat_template_kwargs' | 'reasoning';
	name: string;
}

export interface ReasoningCapabilities extends Pick<
	CapabilitySnapshot,
	'providerId' | 'model' | 'serverBaseUrl' | 'sourceGeneration' | 'connectionIdentity' | 'protocol'
> {
	availability: CapabilityState;
	control: 'toggle' | 'effort' | 'default' | null;
	effort: {
		state: CapabilityState;
		values?: readonly string[];
		parameter?: ReasoningParameter;
		source?: 'metadata' | 'template' | 'user';
	};
	/** Stable hash of connection/model/protocol/template/server build, never credentials. */
	declarationKey?: string;
	toggle?: ReasoningParameter;
	/** Only explicit backend declarations (e.g. effort=none) establish an effort-based Off. */
	offValue?: string;
}

export interface ResolvedReasoning {
	available: boolean;
	capabilities: ReasoningCapabilities;
	requested: ReasoningIntent;
	selected: ReasoningIntent;
	choices: ReasoningIntent[];
	parameters: Record<string, unknown>;
}
