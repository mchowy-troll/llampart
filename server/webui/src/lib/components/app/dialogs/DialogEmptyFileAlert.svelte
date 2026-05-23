<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { FileX } from '@lucide/svelte';
	import { t } from '$lib/i18n';

	interface Props {
		open: boolean;
		emptyFiles: string[];
		onOpenChange?: (open: boolean) => void;
	}

	let { open = $bindable(), emptyFiles, onOpenChange }: Props = $props();

	function handleOpenChange(newOpen: boolean) {
		open = newOpen;
		onOpenChange?.(newOpen);
	}
</script>

<AlertDialog.Root {open} onOpenChange={handleOpenChange}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title class="flex items-center gap-2">
				<FileX class="h-5 w-5 text-destructive" />

				{t('attachments.emptyFilesDetected')}
			</AlertDialog.Title>

			<AlertDialog.Description>
				{t('attachments.emptyFilesRemovedDescription')}
			</AlertDialog.Description>
		</AlertDialog.Header>

		<div class="space-y-3 text-sm">
			<div class="rounded-lg bg-muted p-3">
				<div class="mb-2 font-medium">{t('attachments.emptyFilesLabel')}</div>

				<ul class="list-inside list-disc space-y-1 text-muted-foreground">
					{#each emptyFiles as fileName (fileName)}
						<li class="font-mono text-sm">{fileName}</li>
					{/each}
				</ul>
			</div>

			<div>
				<div class="mb-2 font-medium">{t('attachments.whatHappened')}</div>

				<ul class="list-inside list-disc space-y-1 text-muted-foreground">
					<li>{t('attachments.emptyFilesCannotBeProcessed')}</li>

					<li>{t('attachments.emptyFilesAutomaticallyRemoved')}</li>

					<li>{t('attachments.tryUploadingFilesWithContent')}</li>
				</ul>
			</div>
		</div>

		<AlertDialog.Footer>
			<AlertDialog.Action onclick={() => handleOpenChange(false)}
				>{t('common.gotIt')}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
