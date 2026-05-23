<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { t } from '$lib/i18n';

	interface Props {
		open: boolean;
		displayName: string;
		onOpenChange: (open: boolean) => void;
		onConfirm: () => void;
	}

	let { open = $bindable(), displayName, onOpenChange, onConfirm }: Props = $props();
</script>

<AlertDialog.Root bind:open {onOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t('mcp.deleteServerTitle')}</AlertDialog.Title>

			<AlertDialog.Description>
				{t('mcp.deleteServerDescriptionPrefix')} <strong>{displayName}</strong>? {t(
					'mcp.deleteServerDescriptionSuffix'
				)}
			</AlertDialog.Description>
		</AlertDialog.Header>

		<AlertDialog.Footer>
			<AlertDialog.Cancel>{t('common.cancel')}</AlertDialog.Cancel>

			<AlertDialog.Action class="bg-[#e7000b] text-white hover:bg-[#d6000a]" onclick={onConfirm}>
				{t('common.delete')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
