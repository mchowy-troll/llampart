<script lang="ts">
	import { t } from '$lib/i18n';
	import { FROSTED_GLASS_SETTINGS_KEYS } from './config';
	import WallpaperSettings from './WallpaperSettings.svelte';

	interface Props {
		config: SettingsConfigType;
		onConfigChange: (key: string, value: string | boolean) => void;
	}

	let { config, onConfigChange }: Props = $props();
</script>

<section class="rounded-2xl border border-border bg-background p-4 lg:col-span-2">
	<div
		class="mb-5 flex items-start justify-between gap-4 border-b border-border/30 pb-4"
		data-llampart-wallpaper-softening-header
	>
		<div class="min-w-0">
			<h3 class="text-sm font-semibold">{t('settings.groupFrostedGlassWallpaper')}</h3>
			<p class="mt-1 text-sm text-muted-foreground">
				{t('settings.frostedGlassWallpaperDescription')}
			</p>
		</div>

		<label
			class="mt-0.5 inline-flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
		>
			<input
				type="checkbox"
				class="size-4 shrink-0 accent-foreground"
				checked={Boolean(config.frostedGlassWallpaperMilky)}
				onchange={(event) => {
					const input = event.currentTarget;

					if (input instanceof HTMLInputElement) {
						onConfigChange(FROSTED_GLASS_SETTINGS_KEYS.WALLPAPER_MILKY, input.checked);
					}
				}}
			/>
			<span class="font-medium whitespace-nowrap">
				{t('settings.frostedGlassWallpaperMilk')}
			</span>
		</label>
	</div>

	<WallpaperSettings
		selectedWallpaper={String(config.frostedGlassWallpaper ?? '')}
		onWallpaperChange={(value) => onConfigChange(FROSTED_GLASS_SETTINGS_KEYS.WALLPAPER, value)}
	/>
</section>
