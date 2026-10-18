# llampart WebUI

SvelteKit/Svelte 5 frontend for llampart. This directory contains the UI, browser-side
stores and services, provider adapters, tests, documentation and development helpers.
For product features, see the [main README](../../README.md); for deployment, see the
[Linux/Caddy guide](../../docs/installation/linux-caddy.md).

## Providers and runtime boundaries

Select **llama-server**, **vLLM** or **OpenAI-compatible** in Settings, then save its
Server Address and optional API key. Addresses and keys are kept separately per provider.

| Provider          | Conversation API and model discovery                                                   | Native integration                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| llama-server      | `/v1/models`, Chat Completions                                                         | Props/defaults, router load/unload, built-in tools, timings, pre-encode, resume V2 |
| vLLM              | `/v1/models`, Chat Completions or Responses; vLLM request extensions and usage/metrics | No llama.cpp props, model management or resumable streams                          |
| OpenAI-compatible | `/v1/models`, Chat Completions or Responses                                            | No llama.cpp-native endpoints                                                      |

Adapters choose the protocol from explicit model metadata. Chat Completions is
preferred when both are declared and is the default when metadata is missing.
Responses is selected only when metadata requires it; there is no Settings protocol
switch, generation probe or automatic fallback after an error. See
[models and capabilities](docs/flows/models-flow.md) and [chat flow](docs/flows/chat-flow.md).
Adapter implementation support is not proof of a running model's capabilities:
missing evidence remains **unknown**, not unsupported.

Tools and the browser-side agentic loop are shared mechanisms. Built-in `/tools`
and the optional native MCP CORS proxy are llama-server-only; direct MCP connections
remain available with the other providers. Charts and Mermaid rendering are local
presentation features, not inference-backend capabilities.

## Requirements

- Node.js `>=22.13.0 <23 || >=24.0.0`, matching `package.json` (Node 23 is excluded).
- npm and Git; Bash for the development and build helper scripts.
- A separately running inference backend for real conversations. The UI alone can
  be developed without inference, but API calls will fail until a backend is available.

## Local development

From the repository root:

```bash
cd server/webui
npm ci --include=dev
npm run dev
```

`scripts/dev.sh` checks for a missing executable pre-commit hook, attempts to install
it if `.git/hooks` exists, then executes the repository-local Vite with
`--host 0.0.0.0`. The usual URL is `http://localhost:5173` (Vite may choose another
port if busy). No `--insecure-http-parser` flag is used.

`npm run dev` starts **only Vite**, not llama-server, vLLM or any other inference
backend. `scripts/dev-gateway.ts`, registered in `vite.config.ts`, installs streaming
middleware **inside the same Vite process**. No Caddy or extra gateway process is
needed for development.

Browser provider requests use the same-origin path
`/__llampart/api/{provider}/{endpoint}`. The transport supplies validated routing
headers derived from Settings; the gateway validates them independently, removes
them and cookies, and forwards the allowed request with Authorization to the backend.
HTTP/HTTPS, API base prefixes, query strings, upstream statuses, SSE and cancellation
are supported. Generation POSTs are not retried. Changing the saved address/key
does not require restarting Vite.

- An empty **llama-server** address selects the gateway's environment default,
  normally `http://127.0.0.1:8080`. Optionally set it when starting Vite:

  ```bash
  LLAMPART_DEV_BACKEND_URL=http://127.0.0.1:8081 npm run dev
  ```

- vLLM and OpenAI-compatible require an explicit HTTP(S) address and a model ID
  from `/v1/models`. A trailing `/v1` is normalized; safe base prefixes are retained.
- `localhost`/`127.0.0.1` in a backend address means the **Vite host**, not a remote
  browser device. HTTPS certificates must be trusted by that host.
- The gateway is restricted to private/loopback clients and same-origin requests
  with an endpoint/method allowlist. It is for a **trusted LAN**, not public hosting
  or an SSRF firewall: there is no destination allowlist or DNS/IP filtering.

The installed production setup uses Caddy to serve static files and implement the
same provider gateway contract. This middleware is a Vite development hook only:
`npm run preview` serves a build preview, **not** the development gateway. A plain
static host/preview alone is insufficient for real provider calls; production API
routing is described in the [installation guide](../../docs/installation/linux-caddy.md).

## Available scripts

Run these from `server/webui`:

| Command                           | Purpose                                                                   |
| --------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                     | Start local Vite and its gateway; check/install the missing Git hook      |
| `npm run dev:vite`                | Start local Vite with the same config/gateway, without the hook setup     |
| `npm run build`                   | Run `vite build`, then `scripts/post-build.sh`                            |
| `npm run preview`                 | Preview static output; no provider gateway                                |
| `npm run check`                   | Settings/theme/docs/import validators, Svelte sync and type checks        |
| `npm run check:watch`             | Svelte sync and type checks in watch mode                                 |
| `npm run validate:settings`       | Validate settings metadata                                                |
| `npm run validate:themes`         | Validate theme boundaries                                                 |
| `npm run validate:docs`           | Reject known stale documentation contracts; not a link or Mermaid checker |
| `npm run validate:imports`        | Enforce internal import boundaries                                        |
| `npm run lint`                    | Repository-wide Prettier check and ESLint                                 |
| `npm run format`                  | Repository-wide Prettier write                                            |
| `npm test`                        | Validate test discovery and run unit tests once                           |
| `npm run test:unit`               | Run the unit Vitest project                                               |
| `npm run validate:test-discovery` | Check test discovery                                                      |
| `npm run hooks:install`           | Install the WebUI pre-commit hook                                         |
| `npm run reset`                   | Remove `.svelte-kit` and `node_modules`                                   |
| `npm run cleanup`                 | Remove `.svelte-kit`, local `build` and `node_modules`                    |

`cleanup` does not remove `../public`. Use destructive cleanup scripts only when
you intend to discard those generated local directories.

## Static build and provenance

```text
server/webui → vite build / adapter-static → server/public → post-build normalization
```

`svelte.config.js` writes pages and assets directly to `../public`, uses hash routing,
`200.html` as fallback and the **split** bundle strategy. This is not a Node/SvelteKit
production server and does not bundle an inference backend or gateway.

`scripts/post-build.sh` invokes `scripts/normalize-static-build.mjs`. It reads the
generated client manifest, checks referenced split assets, preserves `_app/`, inlines
the favicon, copies the normalized `index.html` to `200.html`, and removes stale
single-bundle files/compressed HTML fallbacks. The normalizer also retains a legacy
single-bundle branch; that is not the current SvelteKit output mode.

The normalizer writes `server/public/.llampart-build.json` with `appVersion`,
`gitCommit`, `dirty`, `builtAt`, `normalizerVersion` and `artifactDigest`.
The digest is calculated by `scripts/static-artifact-digest.mjs`.

`scripts/package-release-llampart.sh` packages an **existing** build; it never builds
or tests it. It requires `index.html`, `200.html`, `_app/` and provenance, checks
package/lock versions, current `HEAD`, a clean source worktree (excluding generated
`server/public/`) and the recalculated artifact digest. Editing generated files after
normalization invalidates provenance. A dirty local build is usable for development,
not release packaging. Packaging, releases and deployment are separate manual work.

## Frontend workflow

1. Install locked dependencies with development dependencies included.
2. Run the backend separately if the task needs inference; configure the provider in Settings.
3. Use `npm run dev` and keep changes within the owning components, stores, services
   and adapters. Provider-specific payloads/parsing belong in `src/lib/services/providers/`.
4. Validate the changed scope. For documentation-only work, check links/Mermaid,
   run `npm run validate:docs`, and run local Prettier on explicit changed paths:

   ```bash
   ./node_modules/.bin/prettier --check README.md docs/flows/chat-flow.md
   ```

5. For application changes, also use the relevant unit/browser tests, `npm run check`
   and `npm run lint`; build when testing production output. Do not hand-edit `server/public`.

The installed pre-commit hook runs `format`, `lint` and `check` when staged paths touch
`server/webui`. It does **not** stage files or build output. Its `format` step writes
across the WebUI, so review unrelated working changes before using it.

## Documentation map

- [Simplified architecture](docs/architecture/high-level-architecture-simplified.md)
  and [detailed architecture](docs/architecture/high-level-architecture.md)
- [Chat](docs/flows/chat-flow.md), [models](docs/flows/models-flow.md),
  [server/connection](docs/flows/server-flow.md), [MCP](docs/flows/mcp-flow.md)
- [Charts](docs/charts.md), [Mermaid diagrams](docs/diagrams.md),
  [response preferences](docs/response-preferences.md)

If API calls fail, check the backend separately, saved provider/address/key and model
discovery, then the browser's gateway response. Do not assume every backend supports
`/props` or that opening a static preview supplies a gateway.
