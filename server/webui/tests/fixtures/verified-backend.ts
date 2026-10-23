import { beforeEach, vi } from 'vitest';
import { modelsStore } from '$lib/stores/models.svelte';

// These suites isolate stream/request/ownership semantics with already supplied
// synthetic metadata. Fresh HTTP verification has its own real-store/HTTP tests
// in backend-freshness.test.ts and backend-freshness.mjs; do not consume their
// completion-only HTTP fixtures as model discovery responses.
beforeEach(() => {
	vi.spyOn(modelsStore, 'verifyBackend').mockResolvedValue(undefined);
});
