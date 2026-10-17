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

The browser-only diagram renderer uses **Mermaid 12.2.0**, MIT-licensed,
Copyright (c) 2014–2022 Knut Sveidqvist. Mermaid source:
<https://github.com/mermaid-js/mermaid/tree/v12.2.0>.

The complete Mermaid MIT notice and the license/copyright/NOTICE files of its
locked runtime dependency closure are preserved in
`server/webui/static/licenses/mermaid.txt`, distributed locally with the Web UI.
Regenerate that snapshot with `node scripts/diagram-license-notices.mjs` in
`server/webui` after dependency changes. No upstream source was modified.

The transitive review includes MIT, ISC, BSD-2-Clause/BSD-3-Clause and Apache-2.0
notices; DOMPurify is used under its Apache-2.0 option. `khroma` omits a license
metadata field but ships the MIT license text, included in the snapshot.
`elkjs@0.9.3` is EPL-2.0: its unmodified source remains available at
<https://github.com/kieler/elkjs/tree/v0.9.3>. ELK/elkjs is bundled by Mermaid
and used by llampart for Flowchart and State layouts. Preserve these notices and
source-availability information with redistributions; this does not change llampart's MIT license.

## Local typefaces

Merriweather, Frank Ruhl Libre, Crimson Text, Libre Caslon Condensed and Fira Sans
are bundled locally under the SIL Open Font License 1.1. Their license
texts, source/version records and WOFF2 inventory are in `server/webui/static/fonts/`.
See that directory's `README.md` and `sources.json`; no runtime font CDN is used.

## npm dependencies

The Web UI uses npm packages listed in:

```text
server/webui/package.json
server/webui/package-lock.json
```

The exact dependency versions for this release preparation checkpoint are locked
in `server/webui/package-lock.json`.

A dependency license review was performed from the lockfile and local installed
package metadata during public-release preparation. At that checkpoint:

- `server/webui/package.json` declared the Web UI package as MIT-licensed.
- The lockfile contained 544 `node_modules` package entries.
- The manifest declared 15 direct runtime dependency names and 40 direct
  development dependency names.
- The lockfile audit found 489 transitive package entries.
- No package entry was marked as `unknown` or `unlicensed`.
- The most common license fields were MIT, ISC, Apache-2.0, MPL-2.0,
  BSD-3-Clause, and BSD-2-Clause.

One transitive package entry had no `license` field in its package metadata,
but its tagged upstream source contained MIT license evidence:

- `svelte-toolbelt@0.10.6`

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

Their license notices are preserved through npm package metadata and installed package license files. The full npm dependency tree is recorded in `server/webui/package-lock.json`.
