<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { RotateCcw } from '@lucide/svelte';
	import { t } from '$lib/i18n';

	interface Props {
		onReset?: () => void;
		onSave?: () => void;
	}

	let { onReset, onSave }: Props = $props();

	let showResetDialog = $state(false);

	function handleResetClick() {
		showResetDialog = true;
	}

	function handleConfirmReset() {
		settingsStore.forceSyncWithServerDefaults();
		onReset?.();

		showResetDialog = false;
	}

	function handleSave() {
		onSave?.();
	}
</script>

<div class="flex justify-between border-t border-border/30 p-6">
	<div class="flex gap-2">
		<Button variant="outline" onclick={handleResetClick}>
			<RotateCcw class="h-3 w-3" />

			{t('common.reset')}
		</Button>
	</div>

	<Button onclick={handleSave}>{t('common.saveSettings')}</Button>
</div>

<AlertDialog.Root bind:open={showResetDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t('common.resetSettingsToDefault')}</AlertDialog.Title>
			<AlertDialog.Description>
				{t('common.resetSettingsDescription')}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleConfirmReset}
				>{t('common.resetToDefault')}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
