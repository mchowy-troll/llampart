# llampart UI style ownership map

This directory is the planned home for llampart's shared UI styling layers.

The current project still keeps most global theme and Frosted Glass styling in `src/app.css`. That file remains the source of truth until styles are moved in small, reviewed steps. Do not move broad CSS blocks here without a focused audit, visual validation, and a dedicated commit.

## Goals

- Keep llampart desktop-only for 1080p and larger screens.
- Make light, dark, and Frosted Glass themes easier to maintain.
- Treat Frosted Glass as an independent theme, not as an extension of light or dark.
- Keep light and dark visually aligned through the same semantic structure and token names.
- Avoid component-level one-off colors, shadows, radii, and hover rules when a shared token or shared surface rule should own them.
- Avoid reintroducing mobile or narrow-layout branches.

## Theme model

The target model is layered but not hierarchical between themes:

1. **Base tokens** define shared non-theme primitives: spacing, radii, font sizes, icon sizes, transitions, z-index values, and common interaction timings.
2. **Light and dark themes** provide color and contrast values for the same semantic tokens. These two themes may share layout, spacing, radius, and interaction behavior because their visual structure is intentionally the same.
3. **Frosted Glass** is a separate theme with its own wallpaper-backed surfaces, blur, transparency, text glow, overlays, and contrast rules. It must not depend on light or dark visual behavior unless that dependency is explicit, audited, and documented.
4. **Component styles** consume semantic tokens and shared surface/action classes instead of hard-coding visual constants.

Light and dark may be managed together because their visual structure is intentionally the same. Frosted Glass should be maintained independently so that changing blur, surface opacity, wallpaper contrast, or glass-specific interaction states does not accidentally change light/dark behavior.

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

- light and dark can share one semantic theme structure with different values;
- Frosted Glass needs its own semantic values and its own glass-specific surface rules;
- Frosted Glass selectors should be easy to find, audit, and change without touching light/dark selectors;
- light/dark selectors should not contain hidden assumptions required only by Frosted Glass;
- common component classes are acceptable only when they consume theme-specific semantic tokens cleanly.

## Planned files

The following files are planned as the shared style layers mature. They do not need to be created all at once.

```text
tokens.css       shared non-theme primitives: spacing, radius, font scale, icon sizes, timings
themes.css       semantic token values for light, dark, and Frosted Glass as independent themes (active)
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

@custom-variant dark (&:is(.dark *));
```

Keep local imports grouped at the top unless a focused build and visual check proves another order is safe. This rule protects Tailwind processing while the style layers are being extracted.

## Current ownership

These areas are current ownership points:

- `src/lib/styles/themes.css` owns light/dark semantic theme variables and Frosted Glass theme-level surface tokens.
- `src/lib/styles/attachments.css` owns shared attachment card geometry and frame primitives for light/dark/Frosted Glass.
- `src/app.css` owns global Tailwind setup, Frosted Glass global selectors, sidebar shell styling, dialog/toast surfaces, and several global surface/action overrides.
- `components/app/content/MarkdownContent.svelte` owns Markdown rendering and local Markdown-specific styling.
- `components/app/content/SyntaxHighlightedCode.svelte` owns syntax-highlighted code presentation.
- `components/app/chat/ChatMessages/*` own assistant, user, system, reasoning, tools, and message action presentation.
- `components/app/chat/ChatForm/*` own composer layout, composer action placement, attachment entry points, and submit/record controls.
- `components/app/chat/ChatAttachments/*` own attachment thumbnail and attachment preview presentation.
- `components/app/dialogs/*Preview*.svelte` own existing preview dialog shells until a shared preview layer exists.
- `components/app/chat/ChatSidebar/*` and `components/ui/sidebar/*` own sidebar layout and sidebar primitives.

## Theme independence

Theme independence is a global architecture rule, not a preview-only rule.

Light, Dark, and Frosted Glass should be independently owned and independently changeable wherever feasible. Similar or identical visual output is allowed, but shared theme control is not, unless the value is an explicitly neutral primitive rather than a theme-specific decision.

Use this ownership split as the default:

- `src/lib/styles/tokens.css` owns neutral primitives and semantic base tokens that are intentionally shared;
- `src/lib/styles/themes.css` owns theme-specific values and per-theme contracts;
- `src/app.css` may consume theme contracts for global selectors and layout/surface wiring;
- component styles may own local structure/rendering, but should not own theme-specific visual values when a theme token can express them.

Guardrails:

- do not use a Light value as the architectural source of truth for Dark or Frosted Glass merely because it currently looks correct;
- do not use a Dark value as the architectural source of truth for Light or Frosted Glass;
- do not use a Frosted Glass value as the architectural source of truth for Light or Dark;
- identical rendered output must still be independently controllable when the surface is theme-specific;
- shared primitives are acceptable only when they are intentionally neutral, documented, and not likely to make one theme change accidentally affect another.

Current Light/Dark sidebar and conversation-list surface values are defined in `src/lib/styles/themes.css` by `llampart-light-dark-sidebar-surface-tokens` and consumed in `ChatSidebar.svelte` / `ChatSidebarConversationItem.svelte`. The components keep local structure and state selectors, while theme-specific colors, shadows, and checkbox imagery stay theme-owned.

Current Light/Dark attachment card values are defined in `src/lib/styles/themes.css` by `llampart-light-dark-attachment-card-tokens` and consumed in `src/lib/styles/attachments.css`. The attachment stylesheet keeps reusable geometry/selectors, while theme-specific border, shadow, and fill values stay theme-owned. The light attachment-card fill is intentionally independent from the generic composer surface so non-image file cards remain legible inside light composer and thread frames.

Current message-surface theme values are defined in `src/lib/styles/themes.css` by `llampart-message-surface-tokens` and consumed in `ChatMessageUser.svelte` / `ChatMessageAssistant.svelte`. Message components keep layout, spacing, and footer/action positioning; this ownership layer only moves visual color, fill, shadow, and filter values.

Current chat layout scale primitives are defined in `src/lib/styles/tokens.css` and consumed by `llampart-chat-layout-scale-primitives` in `src/app.css`. Components keep semantic structure, while chat/composer widths and shared scroll/message spacing are tunable from the layout token owner. Initial values intentionally preserve the current rendered layout before any visual scale tuning.

Current dialog/model surface values introduced during the UI scale polish are defined in `src/lib/styles/themes.css` by `llampart-dialog-model-surface-tokens`. MCP prompt picker and Frosted solid-dialog hooks are semantic component classes. `DialogModelInformation.svelte` owns the one-column dialog layout and local collapsed template disclosure without changing model payload ownership. Composer processing statistics and assistant message footer statistics remain in their original committed state.

Current Frosted Glass composer menu, sheet, and popover values are defined in `src/lib/styles/themes.css` by `llampart-frosted-glass-composer-menu-tokens` and consumed in `src/app.css` by `llampart-frosted-glass-composer-menu-surfaces`. Components keep semantic menu classes and do not own these Frosted Glass theme values.

Current Frosted Glass input/textbox and placeholder glow values are defined in `src/lib/styles/themes.css` by `llampart-frosted-glass-input-glow-tokens` and consumed in `src/app.css` by `llampart-frosted-glass-user-input-text-glow`.

### Frosted Glass preview parity

Frosted Glass preview surfaces use a solid-preview parity contract:

- table, code, attachment, and rich preview surfaces in Frosted Glass must visually match the light-theme preview exactly;
- that visual identity must be controlled by Frosted Glass preview-owned tokens, selectors, or owner blocks;
- shared preview shell markup is allowed, but shared visual control is not;
- changing light preview values must not automatically change Frosted Glass preview unless that change is explicitly scoped to Frosted Glass preview too;
- changing Frosted Glass preview ownership must preserve the current preview appearance exactly unless the commit explicitly states an intentional visual change.

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
- keep Frosted Glass independent from light/dark in selectors, tokens, and surface behavior;
- preserve current visuals unless the commit explicitly says it changes visuals;
- validate light, dark, and Frosted Glass after visual changes;
- keep public documentation and in-repo comments in English.

Do not:

- move large unrelated blocks from `app.css` in one commit;
- model Frosted Glass as an override layer on top of light or dark;
- merge Frosted Glass-specific blur/opacity/wallpaper rules into generic light/dark surfaces;
- reintroduce mobile or narrow-layout branches;
- add new user-facing appearance options before the underlying tokens are stable;
- hide visual regressions behind `!important`;
- remove MCP/agentic diagnostics as part of style cleanup.

## Suggested migration order

1. Document ownership and current risk areas.
2. Introduce base non-theme tokens with no intentional visual change.
3. Introduce semantic theme tokens for light and dark.
4. Introduce Frosted Glass semantic tokens as a separate independent theme, not as light/dark overrides.
5. Extract shared action icon styling.
6. Extract shared surface styling while preserving independent theme values.
7. Extract Markdown styling only after a dedicated Markdown audit.
8. Extract preview and attachment styling after their shell/action model is agreed.

## Composer controls boundary

Composer controls such as reasoning effort and per-tool enable/disable are functional changes, not only style changes. They should be planned separately from CSS extraction because they affect UI state, settings, chat request payloads, MCP/tool state, localization, and validation.

Style cleanup may prepare shared action/menu classes for composer controls, but it should not implement reasoning effort or tools enable/disable behavior in the same commit.
