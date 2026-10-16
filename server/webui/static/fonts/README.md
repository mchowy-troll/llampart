# Local fonts

All runtime faces are repository-local WOFF2 at `/fonts/`. No Google Fonts CSS,
CDN, runtime connection or font npm dependency is required.

## Sources and licenses

Existing Merriweather and Frank Ruhl Libre assets are unchanged:
`@fontsource-variable/merriweather@5.3.0` from jsDelivr and
`@fontsource-variable/frank-ruhl-libre@5.3.0` from unpkg. Their unmodified OFL
licenses remain alongside the files.

New assets were downloaded on 2026-10-16 directly from the Google Fonts CSS2 API
and its official WOFF2 distribution (`fonts.gstatic.com`), not converted or
renamed internally. Exact URLs, internal versions, sizes and SHA-256 checksums
are recorded in `sources.json`. Distribution versions: Crimson Text **v19**,
Libre Caslon Condensed **v3**, Fira Sans **v18**. Google Fonts specimen pages:

- https://fonts.google.com/specimen/Crimson+Text
- https://fonts.google.com/specimen/Libre+Caslon+Condensed
- https://fonts.google.com/specimen/Fira+Sans

The SIL Open Font License 1.1 texts come from
`https://raw.githubusercontent.com/google/fonts/main/ofl/<family>/OFL.txt`,
where `<family>` is `crimsontext`, `librecasloncondensed` or `firasans`.
These source URLs are documentation only; the app never contacts them.
License wording is preserved; trailing whitespace on one line in each of the
Crimson Text and Libre Caslon Condensed OFL files is normalized for Git checks.

| Family | Internal version | Local faces | Selectable base weights | License file |
| --- | --- | --- | --- | --- |
| Merriweather | unchanged Fontsource 5.3.0 | variable 300–900, normal and italic | 400, 500, 600, 700 | `merriweather-OFL.txt` |
| Frank Ruhl Libre | unchanged Fontsource 5.3.0 | variable 300–900, normal only | 400, 500, 600, 700 | `frank-ruhl-libre-OFL.txt` |
| Crimson Text | 1.100 | static normal and italic | 400, 600, 700 | `crimson-text-OFL.txt` |
| Libre Caslon Condensed | 2.000 | variable 400–700, normal and italic | 400, 500, 600, 700 | `libre-caslon-condensed-OFL.txt` |
| Fira Sans | 4.203 | static normal and italic | 400, 500, 600, 700 | `fira-sans-OFL.txt` |

Only Latin and Latin Extended subsets are shipped. Every weight/style's combined
actual `cmap` was checked using fontTools for English, Polish, German, French,
Italian and Spanish, including `ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ`, `ß`, `æ`, `œ`, `ñ`,
accented vowels and inverted Spanish punctuation. Both subsets are necessary:
Latin alone does **not** cover all Polish characters in Libre Caslon Condensed.
No Cyrillic, Greek, Hebrew or Vietnamese subset is included.

Frank Ruhl Libre does not supply italic outlines:
semantic italic uses the browser's synthesis, not a fictional declared face.
Static-family emphasis is mapped to available real weights and capped at 700;
the existing variable-family emphasis remains unchanged. Default/system,
monospace and KaTeX families are not replaced.

## Text size

`fontSize` uses the existing settings storage/preview transaction. Explicit values
are **12–20 px** in 1 px steps. The default sentinel `default` intentionally retains
the existing responsive baseline: 16 px below 1024 CSS px, desktop root rem
clamped to 12–14.4 px at UI Scale 100% (12 px at 1920 CSS px). Other UI Scale
presets retain their original root-rem behavior. There is no single fixed default
pixel size across viewports, so replacing it with a fixed number would change the
existing appearance.

Explicit `fontSize` changes `--llampart-text-unit` only. Tailwind text tokens and
custom text sizes use this unit; spacing, root rem, windows, buttons, icons and
chart geometry do not. Headings/captions keep their ratios. UI Scale continues to
control layout independently. Existing fixed-pixel caption utilities use the
chosen text size relative to the unchanged rem baseline, including on resize.
Chart SVG/PNG captures computed text sizes and
embeds only used local styles/weights, within the existing 12-face/4-MiB limits.
Fonts unsupported by an SVG consumer may still be substituted by that consumer.

`tests/browser/typography.mjs` checks actual Chromium platform fonts (no fallback
glyphs for the six-language sample), local-only Network requests, pixel sizes,
independent UI Scale, responsive controls and standalone PNG/SVG for every new
family and all four chart types. Run with `LLAMPART_PLAYWRIGHT_MODULE`,
`LLAMPART_TEST_URL` and an external `LLAMPART_TEST_ARTIFACTS` directory.

## New files (bytes)

| File | Bytes |
| --- | ---: |
| crimson-text-latin-ext-400-italic.woff2 | 20800 |
| crimson-text-latin-400-italic.woff2 | 26052 |
| crimson-text-latin-ext-600-italic.woff2 | 21036 |
| crimson-text-latin-600-italic.woff2 | 26064 |
| crimson-text-latin-ext-700-italic.woff2 | 21060 |
| crimson-text-latin-700-italic.woff2 | 26612 |
| crimson-text-latin-ext-400-normal.woff2 | 20212 |
| crimson-text-latin-400-normal.woff2 | 25184 |
| crimson-text-latin-ext-600-normal.woff2 | 21260 |
| crimson-text-latin-600-normal.woff2 | 26012 |
| crimson-text-latin-ext-700-normal.woff2 | 20832 |
| crimson-text-latin-700-normal.woff2 | 25540 |
| libre-caslon-condensed-latin-ext-wght-normal.woff2 | 21752 |
| libre-caslon-condensed-latin-wght-normal.woff2 | 38456 |
| libre-caslon-condensed-latin-ext-wght-italic.woff2 | 22552 |
| libre-caslon-condensed-latin-wght-italic.woff2 | 41760 |
| fira-sans-latin-ext-400-italic.woff2 | 47532 |
| fira-sans-latin-400-italic.woff2 | 24908 |
| fira-sans-latin-ext-500-italic.woff2 | 48380 |
| fira-sans-latin-500-italic.woff2 | 24864 |
| fira-sans-latin-ext-600-italic.woff2 | 51772 |
| fira-sans-latin-600-italic.woff2 | 25952 |
| fira-sans-latin-ext-700-italic.woff2 | 52112 |
| fira-sans-latin-700-italic.woff2 | 26112 |
| fira-sans-latin-ext-400-normal.woff2 | 46400 |
| fira-sans-latin-400-normal.woff2 | 23872 |
| fira-sans-latin-ext-500-normal.woff2 | 46996 |
| fira-sans-latin-500-normal.woff2 | 24056 |
| fira-sans-latin-ext-600-normal.woff2 | 50268 |
| fira-sans-latin-600-normal.woff2 | 24844 |
| fira-sans-latin-ext-700-normal.woff2 | 50368 |
| fira-sans-latin-700-normal.woff2 | 25012 |
