<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import {
		clearCustomFrostedGlassWallpaperSrc,
		CUSTOM_FROSTED_GLASS_WALLPAPER_ACCEPT,
		CUSTOM_FROSTED_GLASS_WALLPAPER_ID,
		CUSTOM_FROSTED_GLASS_WALLPAPER_MAX_SIZE_BYTES,
		DEFAULT_FROSTED_GLASS_WALLPAPER_ID,
		FROSTED_GLASS_WALLPAPERS,
		getCustomFrostedGlassWallpaperSrc,
		isAcceptedCustomFrostedGlassWallpaperType,
		setCustomFrostedGlassWallpaperSrc
	} from '$lib/constants';
	import { t } from '$lib/i18n';

	interface Props {
		selectedWallpaper: string;
		onWallpaperChange: (wallpaperId: string) => void;
	}

	type WallpaperValidationDialog = {
		title: string;
		description: string;
	};

	let { selectedWallpaper, onWallpaperChange }: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let customWallpaperSrc = $derived(getCustomFrostedGlassWallpaperSrc());
	let isCustomWallpaperSelected = $derived(selectedWallpaper === CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
	let wallpaperValidationDialog = $state<WallpaperValidationDialog | undefined>(undefined);

	function readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();

			reader.onload = () => {
				if (typeof reader.result === 'string') {
					resolve(reader.result);
					return;
				}

				reject(new Error('Expected file reader result to be a data URL.'));
			};

			reader.onerror = () => {
				reject(reader.error ?? new Error('Failed to read file.'));
			};

			reader.readAsDataURL(file);
		});
	}

	function getWallpaperPreviewClass(isSelected: boolean): string {
		return [
			'llampart-settings-wallpaper-preview bg-muted bg-cover bg-center bg-no-repeat shadow-sm',
			isSelected ? 'is-selected' : ''
		]
			.filter(Boolean)
			.join(' ');
	}

	function showWallpaperValidationDialog(title: string) {
		wallpaperValidationDialog = {
			title,
			description: t('settings.frostedGlassWallpaperUploadRequirements')
		};
	}

	function handleValidationDialogOpenChange(open: boolean) {
		if (!open) {
			wallpaperValidationDialog = undefined;
		}
	}

	function selectBundledWallpaper(wallpaperId: string) {
		onWallpaperChange(wallpaperId);
	}

	function handleCustomWallpaperSelect() {
		if (customWallpaperSrc) {
			onWallpaperChange(CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
			return;
		}

		fileInput?.click();
	}

	function handleCustomWallpaperAddOrReplaceClick() {
		fileInput?.click();
	}

	function handleRemoveCustomWallpaper() {
		clearCustomFrostedGlassWallpaperSrc();
		customWallpaperSrc = undefined;

		if (isCustomWallpaperSelected) {
			onWallpaperChange(DEFAULT_FROSTED_GLASS_WALLPAPER_ID);
		}

		toast.success(t('settings.frostedGlassWallpaperUserRemoved'));
	}

	async function handleCustomWallpaperFileChange(event: Event) {
		const input = event.currentTarget;

		if (!(input instanceof HTMLInputElement)) return;

		const file = input.files?.[0];
		input.value = '';

		if (!file) return;

		if (!isAcceptedCustomFrostedGlassWallpaperType(file.type)) {
			showWallpaperValidationDialog(t('settings.frostedGlassWallpaperUploadInvalidType'));
			return;
		}

		if (file.size > CUSTOM_FROSTED_GLASS_WALLPAPER_MAX_SIZE_BYTES) {
			showWallpaperValidationDialog(t('settings.frostedGlassWallpaperUploadTooLarge'));
			return;
		}

		try {
			const src = await readFileAsDataUrl(file);
			const saved = setCustomFrostedGlassWallpaperSrc(src);

			if (!saved) {
				toast.error(t('settings.frostedGlassWallpaperUploadReadError'));
				return;
			}

			customWallpaperSrc = src;
			onWallpaperChange(CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
			toast.success(t('settings.frostedGlassWallpaperUserSaved'));
		} catch {
			toast.error(t('settings.frostedGlassWallpaperUploadReadError'));
		}
	}
</script>

<div class="llampart-settings-wallpaper-selector" data-llampart-wallpaper-grid>
	{#each FROSTED_GLASS_WALLPAPERS as wallpaper (wallpaper.id)}
		{@const isSelected = selectedWallpaper === wallpaper.id}
		<button
			type="button"
			class={getWallpaperPreviewClass(isSelected)}
			style={`background-image: url("${wallpaper.src}")`}
			onclick={() => selectBundledWallpaper(wallpaper.id)}
			aria-label={t(wallpaper.labelKey)}
			aria-pressed={isSelected}
			data-llampart-wallpaper-preview
			data-selected={isSelected ? 'true' : undefined}
		>
			<span class="sr-only">{t(wallpaper.labelKey)}</span>
		</button>
	{/each}

	<div class="llampart-settings-wallpaper-user-slot" data-llampart-wallpaper-user-slot>
		<button
			type="button"
			class={[
				getWallpaperPreviewClass(isCustomWallpaperSelected),
				'llampart-settings-wallpaper-user-preview',
				customWallpaperSrc ? 'has-custom-wallpaper' : ''
			]
				.filter(Boolean)
				.join(' ')}
			style={customWallpaperSrc ? `background-image: url("${customWallpaperSrc}")` : undefined}
			onclick={handleCustomWallpaperSelect}
			aria-label={t('settings.frostedGlassWallpaperUser')}
			aria-pressed={isCustomWallpaperSelected}
			data-llampart-wallpaper-preview
			data-llampart-user-wallpaper-preview
			data-selected={isCustomWallpaperSelected ? 'true' : undefined}
		>
			<span class="sr-only">{t('settings.frostedGlassWallpaperUser')}</span>
		</button>

		<div class="llampart-settings-wallpaper-user-actions">
			<button
				type="button"
				class="llampart-settings-wallpaper-user-action"
				onclick={handleCustomWallpaperAddOrReplaceClick}
			>
				{t(
					customWallpaperSrc
						? 'settings.frostedGlassWallpaperReplace'
						: 'settings.frostedGlassWallpaperAdd'
				)}
			</button>

			{#if customWallpaperSrc}
				<button
					type="button"
					class="llampart-settings-wallpaper-user-action llampart-settings-wallpaper-user-action-muted"
					onclick={handleRemoveCustomWallpaper}
				>
					{t('settings.frostedGlassWallpaperRemove')}
				</button>
			{/if}
		</div>
	</div>

	<input
		bind:this={fileInput}
		class="sr-only"
		type="file"
		accept={CUSTOM_FROSTED_GLASS_WALLPAPER_ACCEPT}
		onchange={handleCustomWallpaperFileChange}
	/>
</div>

<AlertDialog.Root
	open={Boolean(wallpaperValidationDialog)}
	onOpenChange={handleValidationDialogOpenChange}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title class="flex items-center gap-2">
				<AlertTriangle class="h-5 w-5 text-destructive" />
				{wallpaperValidationDialog?.title}
			</AlertDialog.Title>

			<AlertDialog.Description>
				{wallpaperValidationDialog?.description}
			</AlertDialog.Description>
		</AlertDialog.Header>

		<AlertDialog.Footer>
			<AlertDialog.Action onclick={() => (wallpaperValidationDialog = undefined)}>
				{t('common.gotIt')}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
