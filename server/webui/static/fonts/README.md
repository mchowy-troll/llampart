# Local fonts

Seven Settings options, in order: **Merriweather, Google Sans, Barlow, Inter,
Fira Sans, Literata, Domine**. The last two extend the original five-family task
at the user's request. `src/lib/constants/typography.ts` owns IDs, labels, weights
and fallback stacks; Settings renders that catalog. Defaults remain Merriweather,
400, 13px. The internal `default` sentinel is not another selectable option.
Retired IDs migrate individually to Merriweather without resetting other settings.

All assets are local WOFF2. No runtime CDN, `local()` lookup, font npm dependency,
PWA or service worker is used. Download URLs below are provenance only.

## Inventory and provenance

`sources.json` records **every** distributed WOFF2, exact version, source URL,
SHA-256, size, CSS family, style, weight, axes, actual CSS-visible cmap range and
any conversion. Retained Latin assets are byte-identical to their previous files.

| Family | Version / official source | Faces and weights | Coverage / fallback | Legal text |
| --- | --- | --- | --- | --- |
| Merriweather | 2.100 normal / 2.101 italic; Merriweather4 4.008, Google Fonts v33; existing Latin from Fontsource-variable 5.3.0 | variable 300–900, normal/italic | Latin unchanged; separate Cyrillic and Cyrillic Extended; Greek → Tinos | `merriweather-OFL.txt` |
| Google Sans | official [v14.000](https://github.com/googlefonts/googlesans/releases/tag/v14.000), revision 08f2ac800 | variable 400–700, normal/italic | PL/BG/EL; opsz default **18**, GRAD default **0** | `google-sans-OFL.txt`, `google-sans-TRADEMARKS.txt` |
| Barlow | 1.408; [upstream](https://github.com/jpt/barlow/tree/b4726ddf91525818e85e5fce111c285b9273d764) | static 400/500/600/700, normal/italic | Latin/PL; BG/EL → local Inter | `barlow-OFL.txt` |
| Inter | 4.001;git-9221beed3; official [v4.1](https://github.com/rsms/inter/tree/v4.1) | variable 100–900, normal/italic | PL/BG/EL; no claim of BGR locl | `inter-OFL.txt` |
| Fira Sans | 4.203; [FiraGFVersion](https://github.com/googlefonts/FiraGFVersion/tree/a7d6892325d5b7382e426bea13bd3ef2c32bd53e) | static 400/500/600/700, normal/italic | retained Latin/Latin Extended; full upstream fonts restricted by CSS to Greek/Cyrillic/combining marks | `fira-sans-OFL.txt` |
| Literata | 3.103; [upstream](https://github.com/googlefonts/literata/tree/0c2761b727a1b3a7cffd313c37f0f5163dfc7a63) | variable 200–900, normal/italic; opsz 7–72, default 12 | PL/BG/EL | `literata-OFL.txt` |
| Domine | 2.000; [upstream](https://github.com/googlefonts/Domine/tree/2974ac627aad3a34190288c07fd0a0040d38550f) | variable 400–700, **normal only** | Latin/PL; BG/EL → local Literata; no genuine Domine italic exists | `domine-OFL.txt` |
| Tinos (internal only) | 1.340; [upstream](https://github.com/googlefonts/tinos/tree/3b4482a99b80ea5fc75f187b1be3120a3f5905b3) | static 400/700, normal/italic | Greek/Greek Extended/combining marks; only in Merriweather stack | `tinos-OFL.txt` |

Tinos is never a Settings option or a fallback for another family. Its full official
WOFF2 bytes are retained; CSS restricts use to actual Greek and combining cmap
entries. Barlow's CSS excludes its incidental Greek symbols so complete Greek
words use Inter consistently. Domine has no declared italic face: CSS uses its
upright face for Latin emphasis (exports disable synthetic outlines); this is not
a claim of a real italic design.

Merriweather Cyrillic Extended costs 71,952 bytes for both styles and adds a
separate, verified alphabet range without changing ordinary Bulgarian or Latin.
All CSS unicode ranges are intersections with actual cmap, not invented coverage.
Fira's supplementary files keep the full original repertoire in the binary but
expose only the missing scripts through CSS; this deliberately trades disk size
for unmodified outlines/names and preservation of existing Latin rendering.

### Conversion and legal notices

All eight families use **SIL OFL 1.1**; complete upstream notices are beside the
assets. Reserved Font Names: **Merriweather**, **Domine**
(see each exact OFL text). Google Sans, Barlow, Inter, Fira Sans, Literata and current Tinos OFL
texts do not declare RFNs. These are CSS aliases, not renamed internal fonts.

Google Sans is not Google Sans Flex. Its official OFL credits the "Google Sans
Flex Project Authors"; that upstream wording is intentionally preserved.
Official trademark notes are preserved, and llampart has no Google affiliation.

Google Sans, Barlow, supplementary Fira Sans, Literata and Domine were compressed
from pinned official TTFs using Google **woff2_compress 1.0.2** (no subsetting,
axis instancing or name edits). Decompression and fontTools 4.68.0 verified
identical cmap/name/GSUB/GPOS/fvar tables. Sources include original TTF hashes
and, for Google Sans, the release ZIP hash and member names. WOFF2 compression
alone is covered by the OFL webfont compression exception; see
<https://openfontlicense.org/ofl-faq/>. No custom Merriweather subset was made.

## Owners, loading, language and exports

`sources.json` owns the binary/CSS inventory; `scripts/generate-font-css.mjs`
regenerates `local-fonts.css` without downloading anything. `typography.css` owns
typographic rules, including disabling optical sizing for Google Sans so the
font's original opsz=18 default is not replaced with Google Sans Text (17).
Code keeps its existing system monospace stack, not the selected prose font.
KaTeX retains its 20 unchanged WOFF2 data fonts and independent OFL/RFN notice in
`static/licenses/katex-fonts.txt`; no mathematical font was removed.

Browser font matching downloads only used scripts, weights and styles. Exports
discover actual text, style, fallback and cmap ranges from CSSOM, including open
shadow roots. The existing **12-face / 4-MiB** embedding limits remain explicit
errors, not silent truncation or arbitrary increases. Highly heterogeneous text
requiring more than these limits is not supported. Mermaid waits on the actual
source text before measuring, rather than loading only the default Latin sample.
SVG roots retain the source's known language.

The document `lang` follows the committed interface language, just like `t()`;
an unsaved language draft does not relabel an interface that has not translated.
Explicit `lang="bg"` activates Merriweather BGR `locl`, including ѝ/Ѝ at 400/700
normal/italic. No alphabet-based language guessing, message schema change or raw
HTML Markdown passthrough is introduced. Unannotated Bulgarian messages under a
non-Bulgarian UI do **not** claim localized Bulgarian glyph forms.

The default text unit is **13px**; explicit sizes are 12–20px. UI Scale remains
independent. Local serving without internet works; a reload disconnected from
the local server does not provide an offline application shell.

## Verification

- `python3 scripts/validate-local-fonts.py`: offline SHA-256, cmap, real axes,
  style, weight, license, Greek NFC/NFD shaping and HarfBuzz BGR locl. Requires
  fontTools, Google woff2 tools and libharfbuzz; writes only temporary copies.
- Unit tests: `local-fonts`, `appearance`, settings preview/schema and `svg-fonts`.
- Browser tests use `LLAMPART_PLAYWRIGHT_MODULE`, `LLAMPART_TEST_URL` and external
  `LLAMPART_TEST_ARTIFACTS`; real production rendering/CDP and export reopening,
  with synthetic provider HTTP/SSE explicitly distinguished from real inference.

No static production assets in the original checkout are overwritten by tests;
production validation is performed on a separate build copy.
