<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import ChatSettings from '$lib/components/app/chat/ChatSettings/ChatSettings.svelte';
	import type { SettingsSectionTitle } from '$lib/constants';

	interface Props {
		open?: boolean;
		initialSection?: SettingsSectionTitle;
	}

	let { open = $bindable(false), initialSection }: Props = $props();

	let chatSettingsRef: ChatSettings | undefined = $state();

	function handleSave() {
		open = false;
	}

	$effect(() => {
		if (open && chatSettingsRef) {
			chatSettingsRef.reset();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="llampart-solid-dialog-content llampart-chat-settings-dialog-content z-[999999] flex h-auto max-h-[calc(100dvh-2rem)] min-h-0 w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)]! flex-col gap-0 rounded-none p-0 md:max-h-[80dvh] md:w-[60vw] md:max-w-[60vw]! md:rounded-lg"
	>
		<div class="llampart-chat-settings-scroll-shell">
			<ChatSettings bind:this={chatSettingsRef} onSave={handleSave} {initialSection} />
		</div>
	</Dialog.Content>
</Dialog.Root>
