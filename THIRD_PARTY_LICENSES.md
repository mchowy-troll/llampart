# Third-party licenses and notices

This document records third-party license and attribution information for llampart.

It is maintained as part of open-source release hygiene and is not legal advice.

## llama.cpp / llama-ui

llampart includes and adapts work from the `llama.cpp` / `llama-ui` foundation.

- Upstream project: `llama.cpp`
- Upstream organization: ggml-org
- License: MIT License
- Upstream copyright notice: Copyright (c) 2023-2026 The ggml authors

llampart is not an official llama.cpp project.

The following license text is preserved for the upstream llama.cpp project.

```text
MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Mermaid diagrams

The browser-only diagram renderer uses **Mermaid 12.3.0**, MIT-licensed,
Copyright (c) 2014–2022 Knut Sveidqvist. Mermaid source:
<https://github.com/mermaid-js/mermaid/tree/v12.3.0>.

The complete Mermaid MIT notice and the license/copyright/NOTICE files of its
locked runtime dependency closure are preserved in
`server/webui/static/licenses/mermaid.txt`, distributed locally with the Web UI.
Regenerate that snapshot with `node scripts/diagram-license-notices.mjs` in
`server/webui` after dependency changes. No upstream source was modified.

The transitive review includes MIT, ISC, BSD-2-Clause/BSD-3-Clause and Apache-2.0
notices; DOMPurify is used under its Apache-2.0 option. `khroma` omits a license
metadata field but ships the MIT license text, included in the snapshot.
`elkjs@0.12.1` offers `EPL-2.0 OR GPL-3.0-or-later`; llampart uses the
EPL-2.0 option. Its unmodified source remains available at
<https://github.com/kieler/elkjs/tree/v0.12.1>. ELK/elkjs is bundled by Mermaid
and used by llampart for Flowchart and State layouts. Preserve these notices and
source-availability information with redistributions; this does not change llampart's MIT license.

## Local typefaces

Merriweather, Google Sans, Barlow, Inter, Fira Sans, Literata and Domine,
plus Tinos as Merriweather's internal Greek fallback, are bundled locally under
the SIL Open Font License 1.1. Their complete copyright and license
texts, source/version records and WOFF2 inventory are in `server/webui/static/fonts/`.
See that directory's `README.md` and `sources.json`; no runtime font CDN is used.

Google Sans is the official v14.000 family, not Google Sans Flex. Its original
trademark notice is retained in `google-sans-TRADEMARKS.txt`; llampart is not
affiliated with or endorsed by Google. Original RFNs and compression-only
conversions are documented alongside the assets. The application remains MIT.

The mathematical typefaces shipped with **KaTeX 0.19.1** are also distributed
locally, embedded as WOFF2 data in the generated CSS. They are licensed under
**SIL Open Font License 1.1**, not the MIT license of the KaTeX code. Their full
license, Design Science / Khan Academy copyright notices, Reserved Font Names,
file inventory and versioned upstream sources are preserved in
`server/webui/static/licenses/katex-fonts.txt`. The existing KaTeX MIT notice in
`server/webui/static/licenses/mermaid.txt` remains applicable to the code.

## npm dependencies

### json-render interactive forms

The optional native Svelte form renderer uses `@json-render/core` and
`@json-render/svelte`, both pinned to **0.22.0**, Copyright 2025 Vercel Inc.,
licensed under Apache-2.0. Upstream: <https://github.com/vercel-labs/json-render>.
No upstream source was modified. The distribution notice is in
`server/webui/static/licenses/json-render.txt`; the complete Apache-2.0 license
text is distributed in the existing `server/webui/static/licenses/mermaid.txt`
license collection. Preserve both files when redistributing the Web UI.

The Web UI uses npm packages listed in:

```text
server/webui/package.json
server/webui/package-lock.json
```

The exact dependency versions for this release preparation checkpoint are locked
in `server/webui/package-lock.json`.

A dependency license review was repeated from the final Stage 9 lockfile and
installed package license texts. At this checkpoint:

- `server/webui/package.json` declared the Web UI package as MIT-licensed.
- The lockfile contains 632 `node_modules` package entries (including optional platform and bundled packages).
- The manifest declares 21 direct runtime dependency names and 40 direct
  development dependency names.
- No package entry was marked as `unknown` or `unlicensed`; two omit metadata but ship MIT notices.
- The most common license fields were MIT, ISC, Apache-2.0, MPL-2.0,
  BSD-3-Clause, and BSD-2-Clause.

Major updates to SvelteKit 3, ESLint 10, Vitest 5, Lucide 1 and Tailwind
Variants 4 retain permissive licenses. `graceful-fs` and `minimatch` now use
BlueOak-1.0.0, a permissive license compatible with this MIT distribution.
ELK's new dual-license metadata adds a choice, not a GPL-only requirement;
the existing EPL obligations and source availability remain applicable.

Two package entries have no `license` field in lockfile metadata,
but their installed package directories contain MIT LICENSE files:

- `svelte-toolbelt@0.10.7`
- `khroma@2.1.0`

If `server/webui/package-lock.json` changes before release, repeat the dependency
license review using the final lockfile.

## Frontend framework

llampart's frontend is built with Svelte and SvelteKit.

The following framework packages are MIT-licensed open-source projects and are included through npm dependency metadata:

| Package                        | License | Project                                          |
| ------------------------------ | ------- | ------------------------------------------------ |
| `svelte`                       | MIT     | `https://github.com/sveltejs/svelte`             |
| `@sveltejs/kit`                | MIT     | `https://github.com/sveltejs/kit`                |
| `@sveltejs/adapter-static`     | MIT     | `https://github.com/sveltejs/kit`                |
| `@sveltejs/vite-plugin-svelte` | MIT     | `https://github.com/sveltejs/vite-plugin-svelte` |

The full npm dependency tree is recorded in `server/webui/package-lock.json`.
The following framework notices are included here so that static distributions
do not depend on an installed `node_modules` directory to preserve them.

### Svelte — LICENSE.md

```text
Copyright (c) 2016-2025 [Svelte Contributors](https://github.com/sveltejs/svelte/graphs/contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### SvelteKit and adapter-static — LICENSE

```text
Copyright (c) 2020 [these people](https://github.com/sveltejs/kit/graphs/contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### vite-plugin-svelte — LICENSE

```text
MIT License

Copyright (c) 2021 [these people](https://github.com/sveltejs/vite-plugin-svelte/graphs/contributors)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The release packager stages `LICENSE`, `NOTICE` and this document beside the static
build, which already contains Mermaid dependency notices and local font licenses.
The build marker's `artifactDigest` covers only `server/public`; it is not rewritten
when these documents are added. The final archive SHA-256 covers both the original
static files and the additional distribution documents.
