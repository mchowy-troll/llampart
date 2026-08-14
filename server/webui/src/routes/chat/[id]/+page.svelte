<script lang="ts">
	import { t } from '$lib/i18n';
	import { formatConversationDocumentTitle } from '$lib/utils';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { ChatScreen, DialogModelNotAvailable } from '$lib/components/app';
	import { chatStore } from '$lib/stores/chat.svelte';
	import {
		conversationsStore,
		activeConversation,
		activeMessages
	} from '$lib/stores/conversations.svelte';
	import { modelsStore, modelOptions, selectedModelId } from '$lib/stores/models.svelte';
	import { runChatRouteTask } from '$lib/utils/chat-route-task';

	let chatId = $derived(page.params.id);
	let currentChatId: string | undefined = undefined;
	let navigationGeneration = 0;

	// URL parameters for prompt and model selection
	let qParam = $derived(page.url.searchParams.get('q'));
	let modelParam = $derived(page.url.searchParams.get('model'));

	// Dialog state for model not available error
	let showModelNotAvailable = $state(false);
	let requestedModelName = $state('');
	let availableModelNames = $derived(modelOptions().map((m) => m.model));

	// Track if URL params have been processed for this chat
	let urlParamsProcessed = $state(false);

	/**
	 * Clear URL params after message is sent to prevent re-sending on refresh
	 */
	function clearUrlParams() {
		const url = new URL(page.url);
		url.searchParams.delete('q');
		url.searchParams.delete('model');
		replaceState(url.toString(), {});
	}

	async function handleUrlParams(isCurrent: () => boolean) {
		// Ensure models are loaded first
		await modelsStore.fetch();
		if (!isCurrent()) return;

		// Handle model parameter - select model if provided
		if (modelParam) {
			const resolution = modelsStore.resolveModelReference(modelParam);
			if (resolution.status === 'resolved') {
				try {
					await modelsStore.selectModelById(resolution.model.id);
					if (!isCurrent()) return;
				} catch (error) {
					if (!isCurrent()) return;
					console.error('Failed to select model:', error);
					requestedModelName = modelParam;
					showModelNotAvailable = true;
					return;
				}
			} else {
				// Model not found - show error dialog
				requestedModelName = modelParam;
				showModelNotAvailable = true;
				return;
			}
		}

		// Handle ?q= parameter - send message in current conversation
		if (qParam !== null) {
			if (!isCurrent()) return;
			await chatStore.sendMessage(qParam);
			if (!isCurrent()) return;
			// Clear URL params after message is sent
			clearUrlParams();
		} else if (modelParam) {
			// Clear params even if no message was sent (just model selection)
			clearUrlParams();
		}

		urlParamsProcessed = true;
	}

	async function selectModelFromLastAssistantResponse() {
		const messages = activeMessages();
		if (messages.length === 0) return;

		let lastMessageWithModel: DatabaseMessage | undefined;

		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].model) {
				lastMessageWithModel = messages[i];
				break;
			}
		}

		if (!lastMessageWithModel) return;

		const currentModelId = selectedModelId();
		const currentModelName = modelOptions().find((m) => m.id === currentModelId)?.model;

		if (currentModelName === lastMessageWithModel.model) {
			return;
		}

		const matchingModel = modelOptions().find(
			(option) => option.model === lastMessageWithModel.model
		);

		if (matchingModel && modelsStore.isModelLoaded(matchingModel.model)) {
			try {
				await modelsStore.selectModelById(matchingModel.id);
			} catch (error) {
				console.warn('Failed to automatically select model from last message:', error);
			}
		}
	}

	afterNavigate(() => {
		setTimeout(() => {
			void selectModelFromLastAssistantResponse().catch((error) => {
				console.error('Failed to synchronize the conversation model:', error);
			});
		}, 100);
	});

	$effect(() => {
		if (chatId && chatId !== currentChatId) {
			currentChatId = chatId;
			const generation = ++navigationGeneration;
			const isCurrent = () => generation === navigationGeneration && currentChatId === chatId;
			urlParamsProcessed = false; // Reset for new chat

			void runChatRouteTask({
				isCurrent,
				isAlreadyActive: activeConversation()?.id === chatId,
				loadConversation: () => conversationsStore.loadConversation(chatId),
				syncLoadingState: () => chatStore.syncLoadingStateForChat(chatId),
				resumeStream: () => chatStore.resumeStreamForChat(chatId),
				handleUrlParams: () =>
					qParam !== null || (modelParam !== null && !urlParamsProcessed)
						? handleUrlParams(isCurrent)
						: Promise.resolve(),
				gotoFallback: () => goto('#/')
			}).catch((error) => {
				if (!isCurrent()) return;
				console.error('Failed to load chat route:', error);
				void goto('#/').catch((navigationError) => {
					if (isCurrent()) console.error('Failed to navigate to chat fallback:', navigationError);
				});
			});
		}
	});
</script>

<svelte:head>
	<title
		>{formatConversationDocumentTitle(activeConversation()?.name ?? '', t('common.chat'))}</title
	>
</svelte:head>

<ChatScreen />

<DialogModelNotAvailable
	bind:open={showModelNotAvailable}
	modelName={requestedModelName}
	availableModels={availableModelNames}
/>
