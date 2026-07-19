# Frosted Glass theme

This directory is the complete owner of Frosted Glass appearance, settings and runtime-specific data.

- `index.ts` exposes the theme definition to the generic registry.
- `tokens.css` defines theme values.
- Domain CSS files style semantic hooks rendered by shared components.
- `config.ts`, `wallpapers.ts` and the settings components own theme configuration.
- `translations.ts` owns all user-facing Frosted Glass labels.

Rules in this directory may select `html.has-frosted-glass-theme` while that compatibility class remains part of the theme definition. Code outside the theme module must use `data-theme`, registry metadata or neutral semantic classes instead.

Do not import application stores from theme core files. UI-only dependencies belong in the settings components or `ui-registry.ts` to keep registry/runtime modules cycle-free.
