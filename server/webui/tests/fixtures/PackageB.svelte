<script lang="ts">
	import ChatFormActionRecord from '$lib/components/app/chat/ChatForm/ChatFormActions/ChatFormActionRecord.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import MarkdownContent from '$lib/components/app/content/MarkdownContent.svelte';
	import { tick } from 'svelte';
	let { math = false }: { math?: boolean } = $props();
	let content = $state('');
	let streaming = $state(false);
	let disableMath = $state(false);
	let inherit = $state(false);
	let revision = $state(0);
	export async function update(value: string, live = false, disabledMath = false, compact = false) {
		content = value;
		streaming = live;
		disableMath = disabledMath;
		inherit = compact;
		await tick();
	}
	export async function reopen() {
		revision++;
		await tick();
	}
	let audio = $state(false);
	let loading = $state(false);
	let disabled = $state(false);
	let recording = $state(false);
	let clicks = $state(0);
</script>

{#if math}
	<div id="package-b-math" class="fixed inset-10 z-50 overflow-auto bg-background p-6">
		{#key revision}
			<Tooltip.Provider>
				<MarkdownContent
					{content}
					isStreaming={streaming}
					{disableMath}
					inheritTypography={inherit}
					allowCharts
				/>
			</Tooltip.Provider>
		{/key}
	</div>
{:else}
	<div id="package-b-fixture" class="llampart-empty-chat-form fixed top-20 left-20 z-50 p-8">
		<div class="mb-4 flex gap-4 bg-background p-4">
			<label><input type="checkbox" bind:checked={audio} /> Audio</label>
			<label><input type="checkbox" bind:checked={loading} /> Loading</label>
			<label><input type="checkbox" bind:checked={disabled} /> Disabled</label>
			<output>{clicks}</output>
		</div>
		<div class="llampart-chat-input-frame flex items-center gap-4 p-6">
			<Tooltip.Provider>
				<ChatFormActionRecord
					hasAudioModality={audio}
					isLoading={loading}
					{disabled}
					isRecording={recording}
					onMicClick={() => {
						clicks++;
						recording = !recording;
					}}
				/>
			</Tooltip.Provider>
			<button type="button" class="llampart-composer-action-button h-8 w-8 rounded-full">+</button>
		</div>
	</div>
{/if}
