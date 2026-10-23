import type { ApiProviderId } from '$lib/constants/api-providers';
import type { ModelModalities } from './models';

/** Bounded, JSON-only evidence captured for one verified generation operation. */
export interface MessageModelInfoSnapshot {
	schemaVersion: 1;
	providerId: ApiProviderId;
	requestedModelId: string | null;
	modelId: string | null;
	displayName: string | null;
	identity: 'verified' | 'response-only' | 'unavailable';
	/** Exact backend/catalog aliases, never inferred from basename normalization. */
	aliases: string[];
	contextSize?: number;
	modalities?: ModelModalities;
	native?: {
		model_path?: string;
		default_generation_settings?: { n_ctx?: number };
		total_slots?: number;
		build_info?: string;
		chat_template?: string;
	};
	meta?: {
		n_ctx_train?: number;
		size?: number;
		n_params?: number;
		n_embd?: number;
		n_vocab?: number;
		vocab_type?: string | number;
	};
}
