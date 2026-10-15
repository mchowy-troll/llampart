# Local fonts

WOFF2 assets from Google Fonts families, distributed by Fontsource:
`@fontsource-variable/merriweather@5.3.0`,
`@fontsource-variable/frank-ruhl-libre@5.3.0`, and `@fontsource/dm-serif-display@5.3.0`.

Downloaded from `https://cdn.jsdelivr.net/npm/@fontsource-variable/merriweather@5.3.0/files/`
and `https://unpkg.com/<package>@5.3.0/files/` for the two other families.
Licenses are the corresponding packages' unmodified `LICENSE` files.
No runtime CDN requests or npm dependencies are used. Latin and Latin Extended
subsets cover English, Polish, German, French, Italian and Spanish. Each family
includes only the real styles listed below.

| Family | WOFF2 weight range | User-selectable base weights | License |
| --- | --- | --- | --- |
| Merriweather | 300–900 | 400, 500, 600, 700 | SIL Open Font License 1.1 (`merriweather-OFL.txt`) |
| Frank Ruhl Libre | 300–900, normal only | 400, 500, 600, 700 | SIL Open Font License 1.1 (`frank-ruhl-libre-OFL.txt`) |
| DM Serif Display | 400 (static), normal and italic | Regular 400 | SIL Open Font License 1.1 (`dm-serif-display-OFL.txt`) |

Merriweather and Frank Ruhl Libre's extra variable weights preserve emphasis above the chosen base.
Frank Ruhl Libre has no bundled italic: semantic italic can be synthesized by the browser,
but is not declared as a real face or selectable variant.
DM Serif Display has only genuine 400 upright and italic faces: synthetic bold is
disabled, heading sizes preserve hierarchy, and strong text uses genuine italic.
The default/system and monospace fonts are
not replaced. See `src/lib/styles/typography.css` for local faces and subset ranges.
