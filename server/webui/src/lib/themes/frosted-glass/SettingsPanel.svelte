<script lang="ts">
	import { t } from '$lib/i18n';
	import { FROSTED_GLASS_SETTINGS_KEYS } from './config';
	import WallpaperSettings from './WallpaperSettings.svelte';
	import Range from '$lib/components/ui/range/range.svelte';

	interface Props {
		config: SettingsConfigType;
		onConfigChange: (key: string, value: string | boolean | number) => void;
	}

	let { config, onConfigChange }: Props = $props();
</script>

<section class="rounded-2xl border border-border bg-background p-4 lg:col-span-2">
	<div class="mb-5 flex items-start justify-between gap-4 border-b border-border/30 pb-4">
		<div class="min-w-0">
			<h3 class="text-sm font-semibold">{t('settings.groupFrostedGlassWallpaper')}</h3>
			<p class="mt-1 text-sm text-muted-foreground">
				{t('settings.frostedGlassWallpaperDescription')}
			</p>
		</div>
	</div>
	<WallpaperSettings
		selectedWallpaper={String(config.frostedGlassWallpaper ?? '')}
		onWallpaperChange={(value) => onConfigChange(FROSTED_GLASS_SETTINGS_KEYS.WALLPAPER, value)}
	/>
	<div
		class="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 border-t border-border/30 pt-4"
	>
		<div class="flex items-center justify-between gap-4">
			<label for="frostedGlassMilkiness" class="text-sm font-medium"
				>{t('settings.frostedGlassMilkiness')}</label
			>
			<output for="frostedGlassMilkiness" class="text-sm tabular-nums"
				>{config.frostedGlassMilkiness}%</output
			>
		</div>
		<Range
			id="frostedGlassMilkiness"
			class="col-start-1 row-start-2"
			min="0"
			max="100"
			step="1"
			value={Number(config.frostedGlassMilkiness)}
			disabled={Boolean(config.frostedGlassOpaque)}
			aria-valuetext={`${config.frostedGlassMilkiness}%`}
			oninput={(event) =>
				onConfigChange(FROSTED_GLASS_SETTINGS_KEYS.MILKINESS, Number(event.currentTarget.value))}
		/>
		<label class="col-start-2 row-start-2 inline-flex items-center gap-2 text-sm whitespace-nowrap">
			<input
				type="checkbox"
				class="size-4 accent-foreground"
				checked={Boolean(config.frostedGlassOpaque)}
				onchange={(event) =>
					onConfigChange(FROSTED_GLASS_SETTINGS_KEYS.OPAQUE, event.currentTarget.checked)}
			/>
			<span>{t('settings.frostedGlassOpaque')}</span>
		</label>
	</div>
</section>
