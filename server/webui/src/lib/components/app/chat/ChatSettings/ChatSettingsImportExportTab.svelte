<script lang="ts">
	import { Download, Upload, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { DialogConversationSelection, DialogConfirmation } from '$lib/components/app';
	import { createMessageCountMap } from '$lib/utils';
	import {
		exportApplicationSettings,
		importApplicationSettings
	} from '$lib/utils/settings-import-export';
	import { ISO_DATE_TIME_SEPARATOR } from '$lib/constants';
	import { conversationsStore, conversations } from '$lib/stores/conversations.svelte';
	import { toast } from 'svelte-sonner';
	import { t } from '$lib/i18n';

	let exportedConversations = $state<DatabaseConversation[]>([]);
	let importedConversations = $state<DatabaseConversation[]>([]);
	let showExportSummary = $state(false);
	let showImportSummary = $state(false);

	let showExportDialog = $state(false);
	let showImportDialog = $state(false);
	let availableConversations = $state<DatabaseConversation[]>([]);
	let messageCountMap = $state<Map<string, number>>(new Map());
	let fullImportData = $state<Array<{ conv: DatabaseConversation; messages: DatabaseMessage[] }>>(
		[]
	);

	let showSettingsReloadDialog = $state(false);

	// Delete functionality state
	let showDeleteDialog = $state(false);

	async function handleExportClick() {
		try {
			const allConversations = conversations();
			if (allConversations.length === 0) {
				toast.info(t('settings.importExport.noConversationsToExport'));
				return;
			}

			const conversationsWithMessages = await Promise.all(
				allConversations.map(async (conv: DatabaseConversation) => {
					const messages = await conversationsStore.getConversationMessages(conv.id);
					return { conv, messages };
				})
			);

			messageCountMap = createMessageCountMap(conversationsWithMessages);
			availableConversations = allConversations;
			showExportDialog = true;
		} catch (err) {
			console.error('Failed to load conversations:', err);
			alert(t('settings.importExport.failedToLoadConversations'));
		}
	}

	async function handleExportConfirm(selectedConversations: DatabaseConversation[]) {
		try {
			const allData: ExportedConversations = await Promise.all(
				selectedConversations.map(async (conv) => {
					const messages = await conversationsStore.getConversationMessages(conv.id);
					return { conv: $state.snapshot(conv), messages: $state.snapshot(messages) };
				})
			);

			conversationsStore.downloadConversationFile(
				allData,
				`${new Date().toISOString().split(ISO_DATE_TIME_SEPARATOR)[0]}_conversations.json`
			);

			exportedConversations = selectedConversations;
			showExportSummary = true;
			showImportSummary = false;
			showExportDialog = false;
		} catch (err) {
			console.error('Export failed:', err);
			alert(t('settings.importExport.failedToExportConversations'));
		}
	}

	async function handleImportClick() {
		try {
			const input = document.createElement('input');

			input.type = 'file';
			input.accept = '.json';

			input.onchange = async (e) => {
				const file = (e.target as HTMLInputElement)?.files?.[0];
				if (!file) return;

				try {
					const text = await file.text();
					const parsedData = JSON.parse(text);
					let importedData: ExportedConversations;

					if (Array.isArray(parsedData)) {
						importedData = parsedData;
					} else if (
						parsedData &&
						typeof parsedData === 'object' &&
						'conv' in parsedData &&
						'messages' in parsedData
					) {
						// Single conversation object
						importedData = [parsedData];
					} else {
						throw new Error(t('settings.importExport.invalidFileFormat'));
					}

					fullImportData = importedData;
					availableConversations = importedData.map(
						(item: { conv: DatabaseConversation; messages: DatabaseMessage[] }) => item.conv
					);
					messageCountMap = createMessageCountMap(importedData);
					showImportDialog = true;
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : t('common.unknownError');

					console.error('Failed to parse file:', err);
					alert(`${t('settings.importExport.failedToParseFile')}: ${message}`);
				}
			};

			input.click();
		} catch (err) {
			console.error('Import failed:', err);
			alert(t('settings.importExport.failedToImportConversations'));
		}
	}

	async function handleImportConfirm(selectedConversations: DatabaseConversation[]) {
		try {
			const selectedIds = new Set(selectedConversations.map((c) => c.id));
			const selectedData = $state
				.snapshot(fullImportData)
				.filter((item) => selectedIds.has(item.conv.id));

			await conversationsStore.importConversationsData(selectedData);

			importedConversations = selectedConversations;
			showImportSummary = true;
			showExportSummary = false;
			showImportDialog = false;
		} catch (err) {
			console.error('Import failed:', err);
			alert(t('settings.importExport.failedToImportConversationsCheckFormat'));
		}
	}

	function handleSettingsExportClick() {
		try {
			exportApplicationSettings();
			toast.success(t('settings.importExport.settingsExported'));
		} catch (err) {
			console.error('Settings export failed:', err);
			toast.error(t('settings.importExport.failedToExportSettings'));
		}
	}

	async function handleSettingsImportClick() {
		try {
			const input = document.createElement('input');

			input.type = 'file';
			input.accept = '.json,application/json';

			input.onchange = async (e) => {
				const file = (e.target as HTMLInputElement)?.files?.[0];
				if (!file) return;

				try {
					const text = await file.text();
					importApplicationSettings(text);
					toast.success(t('settings.importExport.settingsImported'));
					showSettingsReloadDialog = true;
				} catch (err) {
					console.error('Settings import failed:', err);
					alert(t('settings.importExport.failedToImportSettingsCheckFormat'));
				}
			};

			input.click();
		} catch (err) {
			console.error('Settings import failed:', err);
			toast.error(t('settings.importExport.failedToImportSettings'));
		}
	}

	function handleSettingsReloadConfirm() {
		showSettingsReloadDialog = false;
		window.location.reload();
	}

	function handleSettingsReloadCancel() {
		showSettingsReloadDialog = false;
	}

	async function handleDeleteAllClick() {
		try {
			const allConversations = conversations();

			if (allConversations.length === 0) {
				toast.info(t('settings.importExport.noConversationsToDelete'));
				return;
			}

			showDeleteDialog = true;
		} catch (err) {
			console.error('Failed to load conversations for deletion:', err);
			toast.error(t('settings.importExport.failedToLoadConversations'));
		}
	}

	async function handleDeleteAllConfirm() {
		try {
			await conversationsStore.deleteAll();

			showDeleteDialog = false;
		} catch (err) {
			console.error('Failed to delete conversations:', err);
		}
	}

	function handleDeleteAllCancel() {
		showDeleteDialog = false;
	}
</script>

<div class="grid grid-cols-1 items-start gap-4">
	<section
		class="llampart-settings-import-export-section rounded-2xl border border-border bg-background p-4"
	>
		<div class="mb-4 border-b border-border/30 pb-3">
			<h4 class="text-sm font-semibold">{t('settings.groupImportExport')}</h4>
		</div>

		<div class="llampart-settings-import-export-grid">
			<div class="flex h-full flex-col">
				<h4 class="mb-2 text-sm font-medium">
					{t('settings.importExport.importConversationsTitle')}
				</h4>

				<p class="mb-4 text-sm text-muted-foreground">
					{t('settings.importExport.importConversationsDescription')}
				</p>

				<Button
					class="mt-auto w-full justify-start justify-self-start shadow-none focus-visible:ring-0 md:w-auto"
					onclick={handleImportClick}
					variant="outline"
				>
					<Upload class="mr-2 h-4 w-4" />
					{t('settings.importExport.importConversationsButton')}
				</Button>

				{#if showImportSummary && importedConversations.length > 0}
					<div class="mt-4 grid overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-4">
						<h5 class="mb-2 text-sm font-medium">
							{importedConversations.length === 1
								? t('settings.importExport.importedOne')
								: t('settings.importExport.importedMany')}
						</h5>

						<ul class="space-y-1 text-sm text-muted-foreground">
							{#each importedConversations.slice(0, 10) as conv (conv.id)}
								<li class="truncate">
									• {conv.name || t('settings.importExport.untitledConversation')}
								</li>
							{/each}

							{#if importedConversations.length > 10}
								<li class="italic">
									... {t('common.and')}
									{importedConversations.length - 10}
									{t('common.more').toLowerCase()}
								</li>
							{/if}
						</ul>
					</div>
				{/if}
			</div>

			<div class="flex h-full flex-col">
				<h4 class="mb-2 text-sm font-medium">
					{t('settings.importExport.exportConversationsTitle')}
				</h4>

				<p class="mb-4 text-sm text-muted-foreground">
					{t('settings.importExport.exportConversationsDescription')}
				</p>

				<Button
					class="mt-auto w-full justify-start justify-self-start shadow-none focus-visible:ring-0 md:w-auto"
					onclick={handleExportClick}
					variant="outline"
				>
					<Download class="mr-2 h-4 w-4" />

					{t('settings.importExport.exportConversationsButton')}
				</Button>

				{#if showExportSummary && exportedConversations.length > 0}
					<div class="mt-4 grid overflow-x-auto rounded-lg border border-border/50 bg-muted/30 p-4">
						<h5 class="mb-2 text-sm font-medium">
							{exportedConversations.length === 1
								? t('settings.importExport.exportedOne')
								: t('settings.importExport.exportedMany')}
						</h5>

						<ul class="space-y-1 text-sm text-muted-foreground">
							{#each exportedConversations.slice(0, 10) as conv (conv.id)}
								<li class="truncate">
									• {conv.name || t('settings.importExport.untitledConversation')}
								</li>
							{/each}

							{#if exportedConversations.length > 10}
								<li class="italic">
									... {t('common.and')}
									{exportedConversations.length - 10}
									{t('common.more').toLowerCase()}
								</li>
							{/if}
						</ul>
					</div>
				{/if}
			</div>

			<div class="flex h-full flex-col">
				<h4 class="mb-2 text-sm font-medium">
					{t('settings.importExport.importSettingsTitle')}
				</h4>

				<p class="mb-4 text-sm text-muted-foreground">
					{t('settings.importExport.importSettingsDescription')}
				</p>

				<Button
					class="mt-auto w-full justify-start justify-self-start shadow-none focus-visible:ring-0 md:w-auto"
					onclick={handleSettingsImportClick}
					variant="outline"
				>
					<Upload class="mr-2 h-4 w-4" />
					{t('settings.importExport.importSettingsButton')}
				</Button>
			</div>

			<div class="flex h-full flex-col">
				<h4 class="mb-2 text-sm font-medium">
					{t('settings.importExport.exportSettingsTitle')}
				</h4>

				<p class="mb-4 text-sm text-muted-foreground">
					{t('settings.importExport.exportSettingsDescription')}
				</p>

				<Button
					class="mt-auto w-full justify-start justify-self-start shadow-none focus-visible:ring-0 md:w-auto"
					onclick={handleSettingsExportClick}
					variant="outline"
				>
					<Download class="mr-2 h-4 w-4" />
					{t('settings.importExport.exportSettingsButton')}
				</Button>
			</div>
		</div>
	</section>

	<section class="rounded-2xl border border-border bg-background p-4">
		<div class="mb-4 border-b border-border/30 pb-3">
			<h4 class="text-sm font-semibold">
				{t('settings.importExport.conversationManagementTitle')}
			</h4>
		</div>

		<div class="grid gap-5 lg:grid-cols-2">
			<div class="grid">
				<h5 class="mb-2 text-sm font-medium text-destructive">
					{t('settings.importExport.deleteAllConversationsTitle')}
				</h5>

				<p class="mb-4 text-sm text-muted-foreground">
					{t('settings.importExport.deleteAllConversationsDescription')}
				</p>

				<Button
					class="w-full justify-start justify-self-start bg-red-600 text-white shadow-none hover:bg-red-600 hover:text-white focus-visible:bg-red-600 focus-visible:ring-0 active:bg-red-600 disabled:bg-red-600 disabled:text-white disabled:opacity-100 disabled:hover:bg-red-600 md:w-auto"
					onclick={handleDeleteAllClick}
					variant="destructive"
				>
					<Trash2 class="mr-2 h-4 w-4" />

					{t('settings.importExport.deleteAllConversationsButton')}
				</Button>
			</div>
		</div>
	</section>
</div>

<DialogConversationSelection
	conversations={availableConversations}
	{messageCountMap}
	mode="export"
	bind:open={showExportDialog}
	onCancel={() => (showExportDialog = false)}
	onConfirm={handleExportConfirm}
/>

<DialogConversationSelection
	conversations={availableConversations}
	{messageCountMap}
	mode="import"
	bind:open={showImportDialog}
	onCancel={() => (showImportDialog = false)}
	onConfirm={handleImportConfirm}
/>

<DialogConfirmation
	bind:open={showSettingsReloadDialog}
	title={t('settings.importExport.settingsImported')}
	description={t('settings.importExport.reloadAfterSettingsImport')}
	confirmText={t('settings.importExport.reloadSettingsImportConfirmText')}
	cancelText={t('common.cancel')}
	onConfirm={handleSettingsReloadConfirm}
	onCancel={handleSettingsReloadCancel}
/>

<DialogConfirmation
	bind:open={showDeleteDialog}
	title={t('settings.importExport.deleteAllDialogTitle')}
	description={t('settings.importExport.deleteAllDialogDescription')}
	confirmText={t('settings.importExport.deleteAllConfirmText')}
	cancelText={t('common.cancel')}
	variant="destructive"
	icon={Trash2}
	onConfirm={handleDeleteAllConfirm}
	onCancel={handleDeleteAllCancel}
/>
