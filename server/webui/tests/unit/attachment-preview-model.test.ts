import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ChatForm from '$lib/components/app/chat/ChatForm/ChatForm.svelte';
import { modelsStore } from '$lib/stores/models.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { chatStore } from '$lib/stores/chat.svelte';
import { ServerRole } from '$lib/enums';

// Render the real ChatForm resolver; capture its attachment-list boundary, not a copied helper.
// The browser regression additionally exercises the full dialog/preview chain and reactivity.
const preview = vi.hoisted(() => ({ model: undefined as string | undefined }));
vi.mock('$lib/components/app/chat/ChatAttachments/ChatAttachmentsList.svelte', () => ({
	default: (_renderer: unknown, props: { activeModelId?: string }) => {
		preview.model = props.activeModelId;
	}
}));
vi.mock('$lib/components/app/chat/ChatForm/ChatFormActions/ChatFormActions.svelte', () => ({
	default: () => undefined
}));

const originalConfig = { ...settingsStore.config };
const originalRole = serverStore.role;
const options = [
	{ id: 'selector-A', model: 'backend-A', name: 'Display A' },
	{ id: 'selector-B', model: 'backend-B', name: 'Display B' }
] as ModelOption[];

afterEach(() => {
	vi.restoreAllMocks();
	settingsStore.config = { ...originalConfig };
	serverStore.role = originalRole;
	modelsStore.resetAllModelState();
});

function setup(provider: 'openai-compatible' | 'vllm' | 'llama-server', router = false) {
	settingsStore.config = { ...originalConfig, apiProvider: provider };
	serverStore.role = router ? ServerRole.ROUTER : ServerRole.MODEL;
	modelsStore.models = options.map((option) => ({ ...option }));
	modelsStore.selectedModelId = 'selector-B';
	vi.spyOn(chatStore, 'getConversationModel').mockReturnValue(null);
}

function renderedModel() {
	preview.model = undefined;
	expect(render(ChatForm).body).toContain('llampart-chat-form-root');
	return preview.model;
}

describe('composer attachment preview model ownership', () => {
	it.each(['openai-compatible', 'vllm'] as const)(
		'%s maps the selected option id to its backend model, not the first option or display name',
		(provider) => {
			setup(provider);
			expect(renderedModel()).toBe('backend-B');
		}
	);

	it('preserves router selection priority and conversation fallback', () => {
		setup('llama-server', true);
		vi.mocked(chatStore.getConversationModel).mockReturnValue('backend-A');
		expect(renderedModel()).toBe('backend-B');
		modelsStore.selectedModelId = null;
		expect(renderedModel()).toBe('backend-A');
		modelsStore.selectedModelId = 'obsolete';
		expect(renderedModel()).toBe('backend-A');
	});

	it('keeps the single-model server fallback without a selection', () => {
		setup('llama-server');
		modelsStore.selectedModelId = null;
		expect(renderedModel()).toBe('backend-A');
		modelsStore.models = [];
		expect(renderedModel()).toBeUndefined();
	});

	it.each(['openai-compatible', 'vllm', 'llama-server'] as const)(
		'%s does not borrow the first model for missing, stale or unavailable selection/context',
		(provider) => {
			setup(provider, provider === 'llama-server');
			modelsStore.selectedModelId = null;
			expect(renderedModel()).toBeUndefined();
			modelsStore.selectedModelId = 'obsolete';
			vi.mocked(chatStore.getConversationModel).mockReturnValue('removed-model');
			expect(renderedModel()).toBeUndefined();
			modelsStore.models = [];
			expect(renderedModel()).toBeUndefined();
		}
	);

	it('resolves conversation context by backend model, not option id', () => {
		setup('openai-compatible');
		modelsStore.selectedModelId = null;
		vi.mocked(chatStore.getConversationModel).mockReturnValue('backend-B');
		expect(renderedModel()).toBe('backend-B');
		vi.mocked(chatStore.getConversationModel).mockReturnValue('selector-B');
		expect(renderedModel()).toBeUndefined();
	});
});
