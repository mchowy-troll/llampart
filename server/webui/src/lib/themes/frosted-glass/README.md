# Frosted Glass theme

This directory is the complete owner of Frosted Glass appearance, settings and runtime-specific data.

- `index.ts` exposes the theme definition to the generic registry.
- `tokens.css` defines theme values.
- Domain CSS files style semantic hooks rendered by shared components.
- `config.ts`, `wallpapers.ts` and the settings components own theme configuration.
- `translations.ts` owns all user-facing Frosted Glass labels.

## Bundled wallpapers

Add the original JPEG to `static/wallpapers/frosted-glass/` and register it once in
`FROSTED_GLASS_WALLPAPERS` in `wallpapers.ts` (with its translated label). Its small
preview uses the same basename in `thumbnails/`, with a `.webp` extension. Generate
it from this asset directory using local ImageMagick, without changing the JPEG:

```sh
magick frosted-glass-06.jpg -auto-orient -resize '768x>' -strip -quality 82 thumbnails/frosted-glass-06.webp
```

The gallery loads these static WebP files directly, independently of provider API
availability and the single-entry full-size wallpaper cache. A failed preview
keeps its neutral, named, clickable tile. The background still uses the original
JPEG; user wallpaper storage and preview transactions are separate and unchanged.
The maximum width of 768 px preserves detail in Settings tiles on high-DPR and
5K/6K displays; it is never used as a full-screen background.

Rules in this directory may select `html.has-frosted-glass-theme` while that compatibility class remains part of the theme definition. Code outside the theme module must use `data-theme`, registry metadata or neutral semantic classes instead.

Do not import application stores from theme core files. UI-only dependencies belong in the settings components or `ui-registry.ts` to keep registry/runtime modules cycle-free.
