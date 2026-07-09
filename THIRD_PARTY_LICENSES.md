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
- The lockfile contained 751 `node_modules` package entries.
- The manifest declared 14 direct runtime dependency names and 53 direct
  development dependency names.
- The lockfile audit found 684 transitive package entries.
- No package entry was marked as `unknown` or `unlicensed`.
- The most common license fields were MIT, ISC, Apache-2.0, MPL-2.0,
  BSD-3-Clause, and BSD-2-Clause.

Five transitive package entries had no `license` field in their package metadata,
but the installed package files contained local MIT license/readme evidence:

- `runed@0.23.4`
- `runed@0.25.0`
- `svelte-toolbelt@0.10.6`
- `svelte-toolbelt@0.7.1`
- `union@0.5.0`

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

