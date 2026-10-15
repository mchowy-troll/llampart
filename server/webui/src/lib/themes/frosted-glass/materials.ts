// Shared material palette: preserve alpha/blur, add a subtle wallpaper tint.
const ALPHAS = [
	0.035, 0.05, 0.075, 0.08, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.18, 0.2, 0.22, 0.23, 0.24,
	0.26, 0.28, 0.29, 0.34, 0.38, 0.42, 0.46, 0.48, 0.54, 0.58, 0.64, 0.66, 0.72, 0.74, 0.88, 0.92,
	0.96
];
const FILTERS = [
	[8, 104],
	[8, 108],
	[9, 108],
	[10, 104],
	[10, 106],
	[10, 108],
	[10, 110],
	[10, 112],
	[10, 115],
	[12, 108],
	[12, 114],
	[12, 130],
	[14, 108],
	[14, 110],
	[14, 124],
	[14, 128],
	[16, 112],
	[16, 124],
	[16, 126],
	[18, 116],
	[22, 122],
	[22, 126],
	[24, 122],
	[24, 135],
	[28, 132],
	[32, 138]
];
const PALETTES = {
	white: { channels: [255, 255, 255], alphas: ALPHAS },
	mint: { channels: [246, 249, 247], alphas: [0.72, 0.74] },
	grey: { channels: [137, 148, 146], alphas: [0.29, 0.34] }
};

export function materialAlpha(base: number, milkiness: number): number {
	const level = Number.isFinite(milkiness) ? Math.max(0, Math.min(100, milkiness)) : 50;
	// 0: a quarter of the existing alpha; 50: existing alpha; 100: at least 92%.
	return level <= 50
		? base * (0.25 + (0.75 * level) / 50)
		: base + ((Math.max(0.92, base) - base) * (level - 50)) / 50;
}

export function resolveGlassMaterials(config: SettingsConfigType): Record<string, string> {
	const opaque = config.frostedGlassOpaque === true;
	const styles: Record<string, string> = {};
	for (const [palette, { channels, alphas }] of Object.entries(PALETTES))
		for (const base of alphas) {
			const name = `--llampart-glass-${palette}-${Math.round(base * 1000)}`;
			const tint = `color-mix(in srgb, var(--llampart-frosted-glass-accent) ${Number((12 + base * 12).toFixed(3))}%, rgb(${channels.join(' ')}))`;
			styles[name] = opaque
				? `color-mix(in srgb, var(--llampart-frosted-glass-accent) ${Number((12 + base * 12).toFixed(3))}%, white)`
				: `color-mix(in srgb, ${tint} ${Number((materialAlpha(base, Number(config.frostedGlassMilkiness)) * 100).toFixed(6))}%, transparent)`;
		}
	for (const [blur, saturation] of FILTERS)
		styles[`--llampart-glass-filter-${blur}-${saturation}`] = opaque
			? 'none'
			: `blur(${blur}px) saturate(${saturation}%)`;
	return styles;
}

export const GLASS_STYLE_PROPERTIES = Object.keys(resolveGlassMaterials({} as SettingsConfigType));
