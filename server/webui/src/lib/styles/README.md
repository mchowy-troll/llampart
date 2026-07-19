# llampart UI style ownership map

This directory is the planned home for llampart's shared UI styling layers.

The current project still keeps most global theme and Frosted Glass styling in `src/app.css`. That file remains the source of truth until styles are moved in small, reviewed steps. Do not move broad CSS blocks here without a focused audit, visual validation, and a dedicated commit.

## Goals

- Keep llampart desktop-only for 1080p and larger screens.
- Make the Frosted Glass theme easy to maintain and extend.
- Avoid component-level one-off colors, shadows, radii, and hover rules when a shared token or shared surface rule should own them.
- Avoid reintroducing mobile or narrow-layout branches.

## Theme model

The target model is layered:

1. **Base tokens** define shared non-theme primitives: spacing, radii, font sizes, icon sizes, transitions, z-index values, and common interaction timings.
2. **Frosted Glass** is the theme with its own wallpaper-backed surfaces, blur, transparency, text glow, overlays, and contrast rules. Theme rules are scoped via the `html.has-frosted-glass-theme` class.
3. **Component styles** consume semantic tokens and shared surface/action classes instead of hard-coding visual constants.

Base tokens in `:root` define defaults. Frosted Glass overrides are applied via `html.has-frosted-glass-theme` selectors in `themes.css`.

## Theme ownership principle

Use shared primitives where the UI language is genuinely common, for example:

- spacing;
- radius;
- font scale;
- icon sizes;
- transition timing;
- z-index values;
- shared accessibility and focus behavior.

Do not use shared theme rules when the visual behavior is theme-specific.

In practice:

- Frosted Glass needs its own semantic values and its own glass-specific surface rules;
- Frosted Glass selectors should be easy to find, audit, and change;
- common component classes are acceptable only when they consume theme-specific semantic tokens cleanly.

## Planned files

The following files are planned as the shared style layers mature. They do not need to be created all at once.

```text
tokens.css       shared non-theme primitives: spacing, radius, font scale, icon sizes, timings
themes.css       semantic token values for the active theme (active)
surfaces.css     assistant, user, system, sidebar, composer, dialog, popover surfaces
actions.css      action icons, buttons, hover/focus/active states, disabled states
markdown.css     Markdown, tables, code, blockquotes, KaTeX, context-specific Markdown
preview.css      preview dialog/shell/header/body/actions layout and contrast
attachments.css  attachment thumbnails, frames, metadata, and attachment actions
```

## CSS import order

`src/app.css` is the CSS entry point. Local style files imported from `app.css` must stay before `@import 'tailwindcss'`.

Current order:

```css
@import './lib/styles/tokens.css';
@import './lib/styles/themes.css';

@import 'tailwindcss';

@import 'tw-animate-css';
```

Keep local imports grouped at the top unless a focused build and visual check proves another order is safe. This rule protects Tailwind processing while the style layers are being extracted.

## Current ownership

These areas are current ownership points:

- `src/lib/styles/themes.css` owns base token defaults (`:root`) and Frosted Glass theme-level surface tokens (`html.has-frosted-glass-theme`).
- `src/lib/styles/attachments.css` owns shared attachment card geometry and frame primitives.
- `src/app.css` owns global Tailwind setup, Frosted Glass global selectors, sidebar shell styling, dialog/toast surfaces, and several global surface/action overrides.
- `components/app/content/MarkdownContent.svelte` owns Markdown rendering and local Markdown-specific styling.
- `components/app/content/SyntaxHighlightedCode.svelte` owns syntax-highlighted code presentation.
- `components/app/chat/ChatMessages/*` own assistant, user, system, reasoning, tools, and message action presentation.
- `components/app/chat/ChatForm/*` own composer layout, composer action placement, attachment entry points, and submit/record controls.
- `components/app/chat/ChatAttachments/*` own attachment thumbnail and attachment preview presentation.
- `components/app/dialogs/*Preview*.svelte` own existing preview dialog shells until a shared preview layer exists.
- `components/app/chat/ChatSidebar/*` and `components/ui/sidebar/*` own sidebar layout and sidebar primitives.

## Theme architecture

Theme-specific values are defined in `src/lib/styles/themes.css` using two selector layers:

- `:root` defines base/fallback values (used when Frosted Glass is not active).
- `html.has-frosted-glass-theme` defines Frosted Glass overrides.

Components consume theme tokens via `var(--llampart-*)` custom properties with fallbacks.

### Token naming convention

All theme tokens follow the pattern `--llampart-<category>-<property>`. Examples:

- `--llampart-sidebar-conversation-title-foreground`
- `--llampart-frosted-surface-border`
- `--llampart-frosted-glass-wallpaper`

### Frosted Glass preview parity

Frosted Glass preview surfaces use a solid-preview parity contract:

- table, code, attachment, and rich preview surfaces in Frosted Glass must visually match the light-theme preview exactly;
- that visual identity must be controlled by Frosted Glass preview-owned tokens, selectors, or owner blocks;
- shared preview shell markup is allowed, but shared visual control is not;
- changing preview values must not automatically change Frosted Glass preview unless that change is explicitly scoped to Frosted Glass preview too.

Current preview appearance is correct. Treat preview modularization as an ownership change first, not a visual redesign.

When preview ownership is extracted, preserve the existing rendered result first and introduce independent theme-owned values without changing those values in the same step.

Current Frosted Glass preview parity values are defined in `src/lib/styles/themes.css` by `llampart-frosted-glass-preview-parity-tokens` and consumed in `src/app.css` by `llampart-frosted-glass-solid-preview-parity-surfaces`. These variables intentionally preserve the current rendered result while making Frosted preview control independent.

Attachment preview opaque-fill and view-all preview surfaces consume the same Frosted preview parity tokens in `src/lib/styles/attachments.css`, so attachment preview parity remains visually identical while still being Frosted-owned.

`ChatAttachmentPreview.svelte` keeps local rendering structure, but its Frosted inline markdown/text preview colors and glass resets consume `llampart-frosted-preview-inline-*` tokens from `themes.css` so component-local rendering does not own theme values.

## Extraction rules

Use small, reviewable commits.

Do:

- audit the current selector, component, and theme ownership before moving styles;
- move one responsibility at a time;
- keep Frosted Glass independent in selectors, tokens, and surface behavior;
- preserve current visuals unless the commit explicitly says it changes visuals;
- validate Frosted Glass after visual changes;
- keep public documentation and in-repo comments in English.

Do not:

- move large unrelated blocks from `app.css` in one commit;
- hide visual regressions behind `!important`;
- remove MCP/agentic diagnostics as part of style cleanup.

## Suggested migration order

1. Document ownership and current risk areas.
2. Introduce base non-theme tokens with no intentional visual change.
3. Introduce Frosted Glass semantic tokens as a separate independent theme.
4. Extract shared action icon styling.
5. Extract shared surface styling while preserving independent theme values.
6. Extract Markdown styling only after a dedicated Markdown audit.
7. Extract preview and attachment styling after their shell/action model is agreed.

## Composer controls boundary

Composer controls such as reasoning effort and per-tool enable/disable are functional changes, not only style changes. They should be planned separately from CSS extraction because they affect UI state, settings, chat request payloads, MCP/tool state, localization, and validation.

Style cleanup may prepare shared action/menu classes for composer controls, but it should not implement reasoning effort or tools enable/disable behavior in the same commit.
