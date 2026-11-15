<script lang="ts">
	import { onMount } from 'svelte';
	import Maximize from '@lucide/svelte/icons/maximize';
	import Minimize from '@lucide/svelte/icons/minimize';
	import CornerButton from '$lib/components/ui/button/corner-button.svelte';
	import { t } from '$lib/i18n';

	let { class: className }: { class?: string } = $props();
	let supported = $state(false);
	let fullscreen = $state(false);
	let busy = $state(false);

	function syncFullscreen() {
		fullscreen = document.fullscreenElement !== null;
	}

	onMount(() => {
		supported =
			document.fullscreenEnabled === true &&
			typeof document.documentElement.requestFullscreen === 'function' &&
			typeof document.exitFullscreen === 'function';
		syncFullscreen();
		document.addEventListener('fullscreenchange', syncFullscreen);
		return () => document.removeEventListener('fullscreenchange', syncFullscreen);
	});

	async function toggleFullscreen() {
		if (!supported || busy) return;
		busy = true;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			// Browser policy or a concurrent exit may reject the request. Keep actual state.
		} finally {
			syncFullscreen();
			busy = false;
		}
	}
</script>

{#if supported}
	<CornerButton
		class={className}
		aria-label={t(fullscreen ? 'common.exitFullscreen' : 'common.enterFullscreen')}
		aria-pressed={fullscreen}
		disabled={busy}
		onclick={toggleFullscreen}
	>
		{#if fullscreen}<Minimize class="h-4 w-4" aria-hidden="true" />
		{:else}<Maximize class="h-4 w-4" aria-hidden="true" />{/if}
	</CornerButton>
{/if}
