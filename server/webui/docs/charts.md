# Assistant charts

Assistant answer text supports standalone, top-level `llampart-chart` fenced JSON.
User messages, reasoning, attachments and Markdown previews keep ordinary code blocks.
The stored/copied/exported message is still the original Markdown. No migration is needed.

## Cartesian charts

```llampart-chart
{
  "type": "line",
  "title": "Monthly revenue",
  "description": "Known figures only",
  "xKey": "month",
  "xLabel": "Month",
  "yLabel": "Amount",
  "series": [
    { "key": "revenue", "label": "Revenue" },
    { "key": "expenses", "label": "Expenses" }
  ],
  "data": [
    { "month": "January", "revenue": 12, "expenses": 8 },
    { "month": "February", "revenue": 18, "expenses": 11 }
  ]
}
```

Use `line`, `bar` or `area`. Bars group multiple series; set
`"orientation": "horizontal"` for horizontal bars (vertical is the default).
Areas overlap with translucent fills; they do not invent stacked totals.
X values are strings or finite numbers (one consistent type per chart). Series values must be finite numbers.
Every row must contain exactly the declared columns. Categories and series keys must be unique.
Keys are literal property names, not paths or expressions.

## Donut

```llampart-chart
{
  "type": "donut",
  "title": "Distribution",
  "labelKey": "category",
  "valueKey": "amount",
  "data": [
    { "category": "A", "amount": 3 },
    { "category": "B", "amount": 7 }
  ]
}
```

The supported types are `line`, `area`, `bar`, and `donut`. Labels must be unique strings, values nonnegative
numbers, with a strictly positive total. Zero slices are accepted. Invalid values
are never replaced, clamped or silently normalized.

## Shared options and limits

- Optional `title` (120 characters), `description` (500 characters).
- `format`: `number` (default) or `percent` (fractions: `0.25` displays as 25%).
- `decimals`: maximum displayed decimal places, 0–6; default 2. Formatting uses
  the current interface language. Large axis values use compact notation.
- Maximum 128 KiB of UTF-8 JSON per chart, 5 series, 500 Cartesian rows,
  20 donut rows, 8 chart fences per assistant message.
- Keys: 1–80 characters. Labels/category strings: 1–120 characters.
- Numeric absolute value: at most `1e12`. No null/missing/empty cells.
- Unknown fields, nested values, reserved prototype keys, styles, fonts, URLs,
  scripts and functional formatters are not part of the schema.
- Text that looks like HTML is inert text, not markup.
- Long category tick labels are shortened visually; tooltips and CSV retain them.

Invalid/excess charts display copyable original JSON instead of an empty plot.
Incomplete streaming JSON is not parsed or highlighted. A chart mounts only after
its closing fence. On Stop, an unfinished fence becomes a copyable fallback.
Appending later prose/charts preserves completed component identity.

## Appearance and interaction

LayerChart 2.8 uses the SVG-only entry point inside a lazy component. It is not
loaded for ordinary conversations or invalid chart blocks. The chart frame shares
the existing Markdown glass material. No library stylesheet or shadcn component
set is installed.

All four types share the exact fixed base palette owned by `chart-palette.ts`:
`#00BEFF`, `#00A3A3`, `#00C853`, `#AEEA00`, `#FF6D00`, `#FF1744`, `#D500F9`,
`#651FFF`, `#263238`. No wallpaper, surface, lightness or saturation adjustment is
applied to these values. Line/Area/Bar use the first N colors in source series order
(still at most five series), never sorted by height. Strokes, opaque marks, points,
legends and tooltip swatches share these colors; Area uses the original hue with
transparency only in the existing gradient stops.

For Donut categories 10–20 a deterministic, prefix-stable OKLCH farthest-point
extension fills missing wheel regions, with a small adjacent-distance preference.
Candidates are saturated sRGB-gamut-limited colors at three lightness levels; the
first nine colors never change. Colors do not cycle. With 20 categories, not every
pair is equally distinguishable, especially with color-vision deficiencies; use the
full legend and tooltip labels. Approved lime/charcoal colors can have low contrast
against some backgrounds and are not recolored to claim universal WCAG contrast.

`chart-surface.ts` applies fixed local tokens to charts and their portaled tooltips.
Wallpaper accents and glass materials remain owned by the existing theme runtime;
Settings preview/rollback still updates surfaces via CSS without remounting charts
or changing data colors. No wallpaper images are sampled by chart code.

The visual references are the official shadcn/ui `chart-line-multiple/dots/default`,
`chart-area-gradient/legend/default`, `chart-bar-multiple/horizontal/default/stacked`
and donut/active-donut examples. Their compact
tooltip rows, quiet grid, rounded bars, gradients and ring proportions are adapted
to LayerChart, not copied as React/Recharts components. No demo statistics/footer
or new JSON options are introduced. The existing schema has **no stacked mode**.

- Line/area use 2.25px rounded strokes and D3 monotone-X interpolation, without
  overshooting adjacent observations. Numeric X that is not strictly increasing
  uses linear interpolation; no observations are reordered by llampart. Small
  persistent points are solid series-colored dots with a 3.25px radius and no stroke,
  halo or ring, so they do not break the line with white outlines. They are rendered
  only for up to 40 rows. The unchanged hover points have a 4.5px radius and a 2px
  white outline, and remain available for dense charts. Geometry/density constants
  live in `chart-points.ts`. Each Area gradient has a component/series-unique Svelte ID.
- Bars remain grouped, with category/subseries gaps, 4px value-end corners and no
  black outlines or value-point markers. Category hover remains enabled.
  LayerChart's native `rounded="edge"` handles orientation/sign.
- Donut uses light separators. Its hole is 59% of its base radius; only the
  hovered slice expands outward by 4px over 140ms (native Svelte Tween). Its center
  remains empty. No numeric labels or Cartesian highlight marks are rendered.
  Actual tooltip shares use the visible total, not an assumed 100. When a source
  value already represents that share (whole-number percentages totaling 100, or
  percent-format fractions totaling 1), the tooltip shows `Category — 25%` once.
  Otherwise localized **Value** and **Share** labels distinguish them; no units are
  inferred. Hiding a category recalculates shares without altering source values.
  LayerChart 2.8 merges `props.highlight` after the high-level highlight options;
  Bar explicitly disables its points there, and Donut disables all Cartesian
  highlight marks there. Arc tooltip activation and Donut motion are independent.
- Donut renders an ascending-value copy of the source rows; equal values retain
  input order. The smallest category gets the first palette color. Legend order
  matches slice order, and hiding entries preserves the remaining color identities.
  Sorting never mutates the source JSON or CSV row order.
- Legends show only full category/series names and color swatches, with no ordinal
  prefixes, values or shares, and toggle entries (the last visible entry
  cannot be hidden). Tooltip rows align real values and corresponding swatches;
  the body portal avoids ancestor clipping. Tooltip positioning follows the pointer
  immediately, with a short fade (LayerChart tween positioning starts from null in
  2.8 and is deliberately not used). Hover filters, point transitions, donut motion
  and tooltip fade respect `prefers-reduced-motion`. There is no chart entry/replay
  animation on streaming append, glow or text shadow.

All text inherits the active interface family, weights and text-size unit, with
synthetic font faces disabled. No chart code lists supported font families.
Explicit pixel font sizes affect text, not chart geometry; the default retains
the existing responsive rem baseline. Local static faces are embedded by actual
used weight/style, rather than truncating a whole-family list of faces.

## Exports

- **PNG**: current visible plot, title, description, axes and legend, 2× pixels,
  a genuinely transparent RGBA background. No component/glass surface is painted.
  Tooltip/highlight overlays are excluded;
  graphic export forces base donut geometry and disables transient filters/motion.
- **SVG**: LayerChart inlines computed SVG styling; llampart adds native SVG text
  for the header and visible legend, without a whole-document backdrop.
  CSS variables and gradient stops are resolved;
  paint server references are made local to the standalone SVG. Active same-origin
  font faces are discovered from CSSOM and embedded as data URLs (maximum 4 MiB,
  12 faces). No duplicate font registry, CDN, HTML foreignObject or export dependency.
- **CSV**: all original data, including temporarily hidden series, in source
  row/series order. Readable series labels, UTF-8 BOM, comma separator, CRLF rows,
  RFC-style double-quote escaping. Numbers use JavaScript's lossless round-trip
  decimal representation, not display rounding or locale formatting. Formula-like
  textual cells receive a leading apostrophe, including after whitespace/control
  characters; numeric negatives remain numeric. Filenames use a `chart-` prefix and
  a bounded, path-free Unicode slug (also avoiding Windows reserved device names).
  No import/editor/conversion tools.

Exports wait for local fonts and rendering. Native system fonts have no webfont
file to embed and remain system-dependent. External/unreadable stylesheets and
non-local faces are not embedded. The bundled local fonts are OFL licensed and
Chromium PNG/SVG exports are tested with them; other SVG consumers may substitute
fonts if they do not support embedded WOFF2. Glyphs absent from the selected/local
fonts still depend on the receiving system's fallback. This is not conversion of
text to outlines and does not guarantee identical typography in every SVG editor.

## Model guidance and validation

`ChatService` adds a short request-local, provider-neutral optional-format hint
for conversation requests, ahead of the original system text without changing its
role or text. Other messages retain order/priority. Requests without a system
message receive one. It is idempotent across tool turns and included in pre-encode;
title-generation requests are unchanged. Nothing is persisted into user prompts.
Tools, MCP and provider adapters do not own this rendering capability.

Unit coverage: schema/limits/security, CSV, AST/fences, instructions and palettes.
`tests/browser/charts.mjs` runs against a real development app; set
`LLAMPART_PLAYWRIGHT_MODULE` and `LLAMPART_TEST_URL`. It uses isolated Chromium,
real IndexedDB, provider HTTP fixtures, actual Settings preview, native downloads
and standalone reopen. `LLAMPART_TEST_PRODUCTION=1` also supports static preview,
skipping development-only store editing probes. A controllable browser Response
exercises real ChatService incremental streaming and Stop, without inference.
Artifacts must be outside the repository (`LLAMPART_TEST_ARTIFACTS`).

`tests/browser/chart-family.mjs` uses the same isolated-app approach for the unified
family: all four types on wallpapers 02/01, Settings rollback, custom light/dark/
neutral images, opaque material, font/scale changes, mobile/tiny slices, active
donut/base-state export, negative bars, 500×5 data, independent gradients and reduced
motion. It saves per-type comparisons and reopens all PNG/SVG/CSV downloads. Run it
with the same environment variables against dev or the static build.

`tests/browser/chart-finalization.mjs` additionally checks exact computed SVG colors,
ascending arc start angles, stable ties/zeros, every nonzero slice for 5/9/20 categories,
source-order CSV, standalone PNG/SVG reopens on both wallpapers, and changed-source
mapping while a slice was active (the last probe is dev-only).

D3 `curveMonotoneX`/`curveLinear` are imported directly from `d3-shape` (already used
by LayerChart); it is now an explicit dependency. No React, alternate chart engine,
animation library or CSV library is added.
