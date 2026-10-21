<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { settingsStore, SettingsPersistenceError } from '$lib/stores/settings.svelte';
	import { mcpStore } from '$lib/stores/mcp.svelte';
	import { toolsStore } from '$lib/stores/tools.svelte';
	import { permissionsStore } from '$lib/stores/permissions.svelte';
	import { conversationsStore } from '$lib/stores/conversations.svelte';
	import { RotateCcw } from '@lucide/svelte';
	import { t } from '$lib/i18n';

	interface Props {
		onReset?: () => void;
		onSave?: () => void;
	}

	let { onReset, onSave }: Props = $props();

	let showResetDialog = $state(false);
	let resetError = $state('');

	function handleResetClick() {
		resetError = '';
		showResetDialog = true;
	}

	async function handleConfirmReset(event: MouseEvent) {
		// AlertDialog.Action otherwise closes even when persistence fails.
		event.preventDefault();
		try {
			settingsStore.resetConfig();
			toolsStore.reloadPreferences();
			permissionsStore.reloadPreferences();
			conversationsStore.reloadGlobalPreferences();
			// Full Reset deliberately removes MCP configuration. Ordinary Save never
			// shuts down unchanged connections; invalidate late MCP results only here.
			await mcpStore.shutdown();
			mcpStore.clearAllHealthChecks();
			onReset?.();
			showResetDialog = false;
		} catch (error) {
			console.error('Settings reset failed:', error);
			resetError =
				error instanceof SettingsPersistenceError ? error.messageKey : 'common.resetFailed';
		}
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
		{#if resetError}<p role="alert" class="text-sm text-destructive">
				{t(resetError)}
			</p>{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={handleConfirmReset}
				>{t('common.resetToDefault')}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
