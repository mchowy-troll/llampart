<script lang="ts">
	import { Check } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
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

	let { selectedWallpaper, onWallpaperChange }: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let customWallpaperSrc = $derived(getCustomFrostedGlassWallpaperSrc());
	let isCustomWallpaperSelected = $derived(selectedWallpaper === CUSTOM_FROSTED_GLASS_WALLPAPER_ID);

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

	function handleCustomWallpaperSelect() {
		if (customWallpaperSrc) {
			onWallpaperChange(CUSTOM_FROSTED_GLASS_WALLPAPER_ID);
			return;
		}

		fileInput?.click();
	}

	async function handleCustomWallpaperFileChange(event: Event) {
		const input = event.currentTarget;

		if (!(input instanceof HTMLInputElement)) return;

		const file = input.files?.[0];
		input.value = '';

		if (!file) return;

		if (!isAcceptedCustomFrostedGlassWallpaperType(file.type)) {
			toast.error(t('settings.frostedGlassWallpaperUploadInvalidType'));
			return;
		}

		if (file.size > CUSTOM_FROSTED_GLASS_WALLPAPER_MAX_SIZE_BYTES) {
			toast.error(t('settings.frostedGlassWallpaperUploadTooLarge'));
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

	function handleRemoveCustomWallpaper() {
		clearCustomFrostedGlassWallpaperSrc();
		customWallpaperSrc = undefined;

		if (isCustomWallpaperSelected) {
			onWallpaperChange(DEFAULT_FROSTED_GLASS_WALLPAPER_ID);
		}

		toast.success(t('settings.frostedGlassWallpaperUserRemoved'));
	}
</script>

<div class="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3" data-llampart-wallpaper-grid>
	{#each FROSTED_GLASS_WALLPAPERS as wallpaper (wallpaper.id)}
		{@const isSelected = selectedWallpaper === wallpaper.id}
		<button
			type="button"
			class={[
				'group flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background text-left transition-all hover:border-ring/60 hover:bg-muted/30',
				isSelected ? 'border-ring ring-2 ring-ring/20' : 'border-border'
			]
				.filter(Boolean)
				.join(' ')}
			onclick={() => onWallpaperChange(wallpaper.id)}
			data-llampart-wallpaper-card
			aria-pressed={isSelected}
		>
			<div
				class="relative aspect-video w-full flex-shrink-0 bg-muted bg-cover bg-center bg-no-repeat"
				style={`background-image: url("${wallpaper.src}")`}
			>
				{#if isSelected}
					<div
						class="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur-sm"
					>
						<Check class="h-4 w-4" />
					</div>
				{/if}
			</div>

			<div
				class="flex min-h-[3.35rem] flex-shrink-0 items-center justify-between gap-3 border-t border-border/70 px-3 py-2.5"
			>
				<span class="min-w-0 truncate text-sm font-medium">{t(wallpaper.labelKey)}</span>
				<span class="shrink-0 text-sm text-muted-foreground">
					{isSelected ? t('settings.selected') : t('settings.select')}
				</span>
			</div>
		</button>
	{/each}

	<div
		class={[
			'group flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background text-left transition-all hover:border-ring/60 hover:bg-muted/30',
			isCustomWallpaperSelected ? 'border-ring ring-2 ring-ring/20' : 'border-border'
		]
			.filter(Boolean)
			.join(' ')}
		data-llampart-wallpaper-card
	>
		<button
			type="button"
			class="block w-full flex-shrink-0 text-left"
			onclick={handleCustomWallpaperSelect}
			aria-pressed={isCustomWallpaperSelected}
		>
			<div
				class="relative aspect-video w-full bg-muted bg-cover bg-center bg-no-repeat"
				style={customWallpaperSrc ? `background-image: url("${customWallpaperSrc}")` : undefined}
			>
				{#if isCustomWallpaperSelected}
					<div
						class="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur-sm"
					>
						<Check class="h-4 w-4" />
					</div>
				{/if}

				{#if !customWallpaperSrc}
					<div
						class="flex h-full items-center justify-center px-4 text-center text-muted-foreground"
					>
						<p class="text-xs">{t('settings.frostedGlassWallpaperUserEmpty')}</p>
					</div>
				{/if}
			</div>
		</button>

		<div
			class="flex min-h-[3.35rem] flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3 py-2.5"
		>
			<span class="min-w-0 truncate text-sm font-medium">
				{t('settings.frostedGlassWallpaperUser')}
			</span>

			<div class="ml-auto flex flex-wrap items-center justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					onclick={() => fileInput?.click()}
				>
					{customWallpaperSrc
						? t('settings.frostedGlassWallpaperReplace')
						: t('settings.frostedGlassWallpaperUpload')}
				</button>

				{#if customWallpaperSrc}
					<button
						type="button"
						class="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						onclick={handleRemoveCustomWallpaper}
					>
						{t('settings.frostedGlassWallpaperRemove')}
					</button>
				{/if}
			</div>
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

<style>
	/* llampart-frosted-glass-wallpaper-card-equal-height */
	:global([data-llampart-wallpaper-grid]) {
		grid-auto-rows: 1fr;
		align-items: stretch;
	}

	:global([data-llampart-wallpaper-card]) {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
	}

	:global([data-llampart-wallpaper-card] > :first-child) {
		width: 100%;
		min-height: 0;
		aspect-ratio: 16 / 9;
		flex: 0 0 auto;
		overflow: hidden;
		background-size: cover !important;
		background-position: center !important;
		background-repeat: no-repeat !important;
	}

	:global([data-llampart-wallpaper-card] > button:first-child > :first-child) {
		height: 100%;
		width: 100%;
		background-size: cover !important;
		background-position: center !important;
		background-repeat: no-repeat !important;
	}

	:global([data-llampart-wallpaper-card] > :not(:first-child)) {
		position: relative;
		z-index: 1;
		flex: 0 0 auto;
		flex-shrink: 0;
	}
</style>
