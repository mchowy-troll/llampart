# llampart UI style ownership

Shared styles and theme styles have separate owners.

## Shared layers

- `tokens.css` owns neutral layout primitives such as spacing, sizing, radii and timing.
- `themes.css` owns semantic fallback values consumed by shared components.
- `attachments.css` owns theme-neutral attachment geometry.
- `src/app.css` is the CSS entry point and owns neutral global layout and Tailwind integration.

Shared component styles may define structure and semantic hooks. They must not contain concrete theme selectors, theme-specific colors, wallpaper behavior, blur values or theme identity checks.

## Theme layers

Themes live under `src/lib/themes/<theme-id>/`. Frosted Glass currently owns:

```text
frosted-glass/
├── index.ts             theme definition and runtime resolver
├── config.ts            flat persisted defaults and keys
├── wallpapers.ts        wallpaper assets, storage and validation
├── SettingsPanel.svelte theme-owned settings UI
├── WallpaperSettings.svelte
├── translations.ts
├── tokens.css
├── global.css
├── sidebar.css
├── composer.css
├── messages.css
├── content.css
├── dialogs.css
└── attachments.css
```

The generic infrastructure in `src/lib/themes/` owns registry lookup, normalization, DOM activation, settings-panel lookup and translation aggregation.

## Runtime contract

- The active theme is represented by `data-theme` on the document root.
- A theme definition owns its compatibility classes and CSS properties.
- `runtime.ts` is the only hydrated DOM activation owner.
- `app.html` contains only the pre-hydration bootstrap needed to avoid a visual flash.
- Shared components query generic motion metadata when behavior cannot be expressed in CSS.

## Component contract

Components provide stable semantic classes such as message surfaces, composer controls and sidebar actions. A theme styles those hooks from its own domain files.

Shared components must not:

- compare against a concrete theme ID;
- contain `html.has-frosted-glass-theme` selectors;
- define `--llampart-frosted-*` variables;
- change their semantic DOM structure for one concrete theme;
- use theme-specific names for reusable component hooks.

Run `npm run validate:themes` to enforce these boundaries.

## Adding a theme

1. Add `src/lib/themes/<theme-id>/` with its definition, token and domain CSS files.
2. Register the definition in `registry.ts`.
3. Optionally register a settings panel in `ui-registry.ts`.
4. Add translations through the generic theme translation aggregator.
5. Do not modify chat, sidebar, message or composer components unless a new neutral semantic hook is genuinely required.

## CSS import order

`src/app.css` imports neutral tokens and theme tokens before Tailwind. Domain theme CSS is imported after Tailwind so theme surfaces retain their intended cascade position.

Visual refactors should move one domain at a time and preserve rendered output before deduplication.
