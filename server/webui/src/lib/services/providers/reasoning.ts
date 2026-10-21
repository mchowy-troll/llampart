import type {
	CapabilitySnapshot,
	CapabilityState,
	ProviderChatCompletionInput
} from '$lib/types/provider';
import type { ApiProviderId } from '$lib/constants/api-providers';
import type {
	ReasoningCapabilities,
	ReasoningIntent,
	ReasoningParameter,
	ResolvedReasoning
} from '$lib/types/reasoning';
import { llamaReasoningCompatibility } from '$lib/utils/llama-reasoning-compat';
import { normalizeGatewaySource } from './provider-transport';
import { sha256 } from '@noble/hashes/sha2.js';

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const state = (value: unknown): CapabilityState =>
	typeof value === 'boolean' ? (value ? 'supported' : 'unsupported') : 'unknown';
const levels = (value: unknown): string[] | undefined =>
	Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim().length > 0)
		? [...new Set(value as string[])]
		: undefined;

export function parseReasoningIntent(value: unknown): ReasoningIntent | undefined {
	const raw = record(value);
	if (raw.mode === 'default' || raw.mode === 'off' || raw.mode === 'on') return { mode: raw.mode };
	if (raw.mode === 'effort' && typeof raw.value === 'string' && raw.value.trim())
		return { mode: 'effort', value: raw.value };
}

export function legacyReasoningIntent(enabled?: boolean, effort?: string): ReasoningIntent {
	return enabled === false
		? { mode: 'off' }
		: effort
			? { mode: 'effort', value: effort }
			: { mode: enabled === true ? 'on' : 'default' };
}

/** Compatibility is read once at an operation boundary, never from the active view. */
export function requestReasoningIntent(options: {
	reasoning?: ReasoningIntent;
	enableThinking?: boolean;
	reasoningEffort?: string;
	reasoning_effort?: unknown;
}): ReasoningIntent {
	if (options.reasoning) return { ...options.reasoning };
	if (options.reasoning_effort !== undefined) {
		if (typeof options.reasoning_effort !== 'string')
			throw new Error('Reasoning effort must be a string');
		return options.reasoning_effort === 'none'
			? { mode: 'off' }
			: { mode: 'effort', value: options.reasoning_effort };
	}
	return legacyReasoningIntent(options.enableThinking, options.reasoningEffort);
}

/** Metadata-first capability resolution shared by the live UI and operation-owned snapshots.
 * Normalized features come from explicit per-model capabilities, not provider/model names.
 */
export function resolveReasoningCapabilities(
	owner: Pick<
		CapabilitySnapshot,
		| 'providerId'
		| 'model'
		| 'serverBaseUrl'
		| 'sourceGeneration'
		| 'connectionIdentity'
		| 'protocol'
		| 'features'
	>,
	metadata?: unknown,
	declarations?: string
): ReasoningCapabilities {
	const {
		features,
		providerId,
		model,
		serverBaseUrl,
		sourceGeneration,
		connectionIdentity,
		protocol
	} = owner;
	const identity = {
		providerId,
		model,
		serverBaseUrl,
		sourceGeneration,
		connectionIdentity,
		protocol
	};
	const declared = record(record(metadata).capabilities);
	const evidence = (name: string) => {
		const feature = features[name];
		if (feature && feature.state !== 'unknown') return feature;
		const value = declared[name];
		return {
			state: state(typeof value === 'boolean' ? value : record(value).supported),
			values: record(value).values
		};
	};
	let availability = evidence('reasoning').state;
	let effortState = evidence('reasoning_effort').state;
	let values = levels(evidence('reasoning_effort').values);
	let source: ReasoningCapabilities['effort']['source'] = values ? 'metadata' : undefined;
	let declarationKey: string | undefined;
	let toggle: ReasoningParameter | undefined;
	let parameter: ReasoningParameter | undefined;
	if (owner.providerId === 'llama-server') {
		const raw = record(metadata);
		const caps = record(raw.chat_template_caps);
		const compat = llamaReasoningCompatibility(
			typeof raw.chat_template === 'string' ? raw.chat_template : undefined
		);
		if (effortState === 'unknown') effortState = state(caps.supports_reasoning_effort);
		// Some servers explicitly extend caps with a list. A boolean alone is NOT a list.
		values ??= levels(caps.reasoning_effort_values);
		if (values) source = 'metadata';
		if (effortState === 'unknown' && compat.effortParameter) effortState = 'supported';
		if (effortState !== 'unsupported' && !values && compat.values) {
			values = compat.values;
			source = 'template';
		}
		if (connectionIdentity && effortState === 'supported') {
			declarationKey = Array.from(
				sha256(
					new TextEncoder().encode(
						JSON.stringify([
							providerId,
							serverBaseUrl,
							connectionIdentity,
							model,
							protocol,
							raw.build_info ?? null,
							raw.model_path ?? null,
							raw.chat_template ?? null
						])
					)
				),
				(b) => b.toString(16).padStart(2, '0')
			).join('');
			if (!values) {
				values = readReasoningDeclarations(declarations)[declarationKey];
				if (values) source = 'user';
			}
		}
		if (effortState === 'supported')
			parameter = {
				location: 'chat_template_kwargs',
				// Modern llama.cpp binds canonical effort to both effort/strength. Older
				// servers use the exact variable confirmed by the compatibility guard.
				name:
					caps.supports_reasoning_effort === true
						? 'reasoning_effort'
						: (compat.effortParameter ?? 'reasoning_effort')
			};
		const toggleEvidence = evidence('enable_thinking').state;
		const toggleState =
			toggleEvidence !== 'unknown' ? toggleEvidence : state(caps.supports_enable_thinking);
		if (toggleState === 'supported' || (toggleState === 'unknown' && compat.toggle))
			toggle = { location: 'chat_template_kwargs', name: 'enable_thinking' };
	} else {
		if (effortState === 'supported')
			parameter = {
				location: owner.protocol === 'responses' ? 'reasoning' : 'top-level',
				name: owner.protocol === 'responses' ? 'effort' : 'reasoning_effort'
			};
		if (
			owner.providerId === 'vllm' &&
			evidence('enable_thinking').state === 'supported' &&
			evidence('chat_template_kwargs').state === 'supported'
		)
			toggle = { location: 'chat_template_kwargs', name: 'enable_thinking' };
	}
	if (availability === 'unknown' && (effortState === 'supported' || toggle))
		availability = 'supported';
	if (availability === 'unsupported') {
		parameter = undefined;
		toggle = undefined;
		declarationKey = undefined;
	}
	if (effortState !== 'supported') values = undefined;
	return {
		...identity,
		availability,
		control:
			availability === 'unsupported'
				? null
				: parameter
					? 'effort'
					: toggle
						? 'toggle'
						: availability === 'supported'
							? 'default'
							: null,
		effort: { state: effortState, values, parameter, source },
		declarationKey,
		toggle,
		...(owner.providerId !== 'llama-server' && parameter && values?.includes('none')
			? { offValue: 'none' }
			: {})
	};
}

export function validateDeclaredReasoningLevels(values: unknown): string[] {
	if (
		!Array.isArray(values) ||
		values.length < 1 ||
		values.length > 16 ||
		!values.every((v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v)) ||
		new Set(values).size !== values.length
	)
		throw new Error('Invalid reasoning effort declaration');
	return [...values];
}

export function readReasoningDeclarations(raw?: string): Record<string, string[]> {
	try {
		const parsed = record(JSON.parse(raw || '{}'));
		if (Object.keys(parsed).length > 32) return {};
		return Object.fromEntries(
			Object.entries(parsed)
				.filter(([key]) => /^[a-f0-9]{64}$/.test(key))
				.map(([key, value]) => [key, validateDeclaredReasoningLevels(value)])
		);
	} catch {
		return {};
	}
}

export function sameReasoningIntent(a: ReasoningIntent, b: ReasoningIntent): boolean {
	return a.mode === b.mode && (a.mode !== 'effort' || (b.mode === 'effort' && a.value === b.value));
}

/** Pure provider error; presentation/localization belongs to the consuming UI/store. */
export class ReasoningSelectionUnavailableError extends Error {
	constructor(readonly intent: ReasoningIntent) {
		super(
			`Saved reasoning selection is unavailable for this source/model/protocol. Choose Default/Auto or a supported option. (${intent.mode === 'effort' ? intent.value : intent.mode})`
		);
		this.name = 'ReasoningSelectionUnavailableError';
	}
}

/** The ONLY selection/serialization resolver. Unavailable historical choices remain
 * visible and block a new request until the user explicitly chooses a valid intent.
 */
export function resolveReasoning(
	capabilities: ReasoningCapabilities,
	requested: ReasoningIntent = { mode: 'default' }
): ResolvedReasoning {
	const choices: ReasoningIntent[] = [{ mode: 'default' }];
	if (capabilities.availability !== 'unsupported') {
		if (capabilities.toggle || capabilities.offValue) choices.push({ mode: 'off' });
		if (capabilities.toggle) choices.push({ mode: 'on' });
		if (capabilities.effort.parameter)
			for (const value of capabilities.effort.values ?? []) {
				if (value !== capabilities.offValue) choices.push({ mode: 'effort', value });
			}
	}
	const available = choices.some((choice) => sameReasoningIntent(choice, requested));
	const selected = requested;
	const parameters: Record<string, unknown> = {};
	const put = (parameter: ReasoningParameter | undefined, value: unknown) => {
		if (!parameter) return;
		if (parameter.location === 'top-level') parameters[parameter.name] = value;
		else
			parameters[parameter.location] = {
				...record(parameters[parameter.location]),
				[parameter.name]: value
			};
	};
	if (!available) return { capabilities, requested, selected, choices, parameters, available };
	if (selected.mode === 'off') {
		if (capabilities.toggle) put(capabilities.toggle, false);
		else put(capabilities.effort.parameter, capabilities.offValue);
	} else if (selected.mode === 'on') put(capabilities.toggle, true);
	else if (selected.mode === 'effort') {
		// A selected effort must not inherit a disabled template default. Only use
		// an independently confirmed toggle, never infer llama kwargs for a provider.
		if (capabilities.toggle) put(capabilities.toggle, true);
		put(capabilities.effort.parameter, selected.value);
	}
	return { capabilities, requested, selected, choices, parameters, available };
}

const CONTROL_KEYS = [
	'reasoning_effort',
	'reasoning_strength',
	'enable_thinking',
	'thinking_budget_tokens',
	'thinking_budget',
	'reasoning_budget'
];

/** Shared boundary for automatic intent and explicit Custom JSON. Unknown explicit
 * extensions retain the existing opt-in policy; automatic controls require evidence.
 */
export function applyProviderReasoning(
	input: ProviderChatCompletionInput,
	providerId: ApiProviderId,
	body: Record<string, unknown>,
	custom: Record<string, unknown>
): void {
	const snapshot = input.capabilities;
	const operation = input.options.operationModel;
	if (
		operation &&
		(operation.requestContext.providerId !== providerId ||
			operation.requestContext.serverBaseUrl !== input.serverBaseUrl ||
			operation.requestContext.apiKey !== input.apiKey ||
			(operation.requestContext.sourceGeneration !== snapshot?.sourceGeneration && snapshot))
	)
		throw new Error('Reasoning request does not belong to this operation');
	if (
		snapshot &&
		(snapshot.providerId !== providerId ||
			snapshot.model !== (input.options.model ?? null) ||
			snapshot.serverBaseUrl !== normalizeGatewaySource(providerId, input.serverBaseUrl).baseUrl)
	)
		throw new Error('Reasoning capabilities do not belong to this provider/model/source');
	const capabilities =
		snapshot?.reasoning ??
		resolveReasoningCapabilities(
			snapshot ?? {
				providerId,
				model: input.options.model ?? null,
				serverBaseUrl: input.serverBaseUrl,
				sourceGeneration: 0,
				connectionIdentity: '',
				protocol: input.options.protocol ?? 'chat-completions',
				features: {}
			}
		);
	if (
		snapshot &&
		(
			[
				'providerId',
				'model',
				'serverBaseUrl',
				'sourceGeneration',
				'connectionIdentity',
				'protocol'
			] as const
		).some((key) => snapshot[key] !== capabilities[key])
	)
		throw new Error('Reasoning contract does not belong to this capability snapshot');
	if (input.options.protocol && input.options.protocol !== capabilities.protocol)
		throw new Error('Reasoning protocol does not match this request');
	const directEffort = (input.options as unknown as Record<string, unknown>).reasoning_effort;
	const requested = operation?.reasoning ?? requestReasoningIntent(input.options);
	const resolved = resolveReasoning(capabilities, requested);
	if (!resolved.available) throw new ReasoningSelectionUnavailableError(requested);
	if (
		directEffort !== undefined &&
		(typeof directEffort !== 'string' ||
			!sameReasoningIntent(requested, requestReasoningIntent({ reasoning_effort: directEffort })))
	)
		throw new Error('Reasoning effort value is not supported by this model');
	const kwargs = record(custom.chat_template_kwargs);
	const reasoning = record(custom.reasoning);
	const explicitEffort =
		custom.reasoning_effort ??
		reasoning.effort ??
		kwargs.reasoning_effort ??
		kwargs.reasoning_strength;
	const hasControls =
		CONTROL_KEYS.some((key) => Object.hasOwn(custom, key) || Object.hasOwn(kwargs, key)) ||
		custom.reasoning !== undefined;
	const managed = capabilities.control !== null;
	if (
		custom.chat_template_kwargs !== undefined &&
		Object.keys(record(custom.chat_template_kwargs)).length === 0 &&
		(custom.chat_template_kwargs === null ||
			Array.isArray(custom.chat_template_kwargs) ||
			typeof custom.chat_template_kwargs !== 'object')
	)
		throw new Error('Reasoning control conflict: chat_template_kwargs must be an object');
	if (hasControls) {
		if (capabilities.protocol === 'responses' && Object.hasOwn(custom, 'reasoning_effort'))
			throw new Error('Responses requires reasoning.effort, not reasoning_effort');
		for (const key of CONTROL_KEYS) {
			if (
				(Object.hasOwn(custom, key) || Object.hasOwn(kwargs, key)) &&
				snapshot?.features[key]?.state === 'unsupported'
			)
				throw new Error(
					`Custom reasoning parameter is not supported by this backend/model: ${key}`
				);
		}
		if (custom.reasoning !== undefined && capabilities.protocol !== 'responses')
			throw new Error('reasoning object requires the Responses protocol');
		if (capabilities.availability === 'unsupported')
			throw new Error('Custom reasoning is not supported by this backend/model');
		if ((providerId === 'llama-server' && managed) || resolved.selected.mode !== 'default')
			throw new Error(
				'Reasoning control conflict: choose the reasoning control or Custom JSON, not both'
			);
		const representations = [
			custom.reasoning,
			...CONTROL_KEYS.flatMap((key) => [custom[key], kwargs[key]])
		].filter((v) => v !== undefined);
		if (representations.length > 1)
			throw new Error('Reasoning control conflict: multiple reasoning representations');
		if (
			explicitEffort !== undefined &&
			(typeof explicitEffort !== 'string' ||
				(capabilities.effort.values && !capabilities.effort.values.includes(explicitEffort)))
		)
			throw new Error('Reasoning effort value is not supported by this model');
		if (explicitEffort !== undefined && capabilities.effort.state === 'unsupported')
			throw new Error('Custom reasoning_effort is not supported by this backend/model');
		if (kwargs.enable_thinking !== undefined && typeof kwargs.enable_thinking !== 'boolean')
			throw new Error('enable_thinking must be boolean');
	}
	for (const [key, value] of Object.entries(resolved.parameters))
		body[key] = key === 'chat_template_kwargs' ? { ...record(body[key]), ...record(value) } : value;
}
