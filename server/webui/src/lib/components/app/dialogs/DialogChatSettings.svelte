<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { ChatSettings } from '$lib/components/app';
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
		class="llampart-solid-dialog-content llampart-chat-settings-dialog-content z-[999999] flex h-[100dvh] max-h-[100dvh] min-h-[100dvh] w-[100vw] max-w-none! flex-col gap-0
			rounded-none p-0 md:h-[80dvh] md:max-h-[80dvh] md:min-h-0 md:w-[60vw] md:max-w-[60vw]! md:rounded-lg"
	>
		<ChatSettings bind:this={chatSettingsRef} onSave={handleSave} {initialSection} />
	</Dialog.Content>
</Dialog.Root>
