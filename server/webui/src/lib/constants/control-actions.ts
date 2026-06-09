/** Actions accepted by the realtime inference control endpoint. */
export const CONTROL_ACTION = {
	END_REASONING: 'reasoning_end'
} as const;

export type ControlAction = (typeof CONTROL_ACTION)[keyof typeof CONTROL_ACTION];
